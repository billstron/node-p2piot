const Q = require('q');
const stun = require('vs-stun');
const request = require('axios');
const EventEmitter = require('events');
const crypto = require('crypto');

const algorithm = 'aes256';
const inputEncoding = 'utf8';
const outputEncoding = 'hex';

module.exports = function Factory(uid, opts) {
  const DT_RESOLUTION = 300000; // 5 minutes
  const DT_KEEP_ALIVE = 60000;
  const DT_OFFLINE_RETRY = 2000;

  const { stunServer, locationServer } = opts;

  const self = {
    friends: [],

    id: 0,

    uid,

    address: null,

    updateResolution(value) {
      return Q.fcall(() => {
        if (
          this.address
          && this.address.public.host === value.public.host
          && this.address.public.port === value.public.port
        ) {
          return null;
        }
        return request
          .post(`${locationServer}/${uid}`, value)
          .then(() => {
            console.log('location updated', value);
            this.address = value;
          });
      })
        .catch((err) => {
          console.log('location update failed', err);
        });
    },

    onMessage(buffer, rinfo) {
      const friend = this.friends.find(({ address }) => {
        return address
          && address.public.host === rinfo.address
          && address.public.port === rinfo.port;
      });
      if (friend) {
        const text = buffer.toString('utf8');

        this.emit('incoming', friend.uid, text);
        const decipher = crypto.createDecipher(algorithm, friend.key);
        let deciphered = decipher.update(text, outputEncoding, inputEncoding);
        deciphered += decipher.final(inputEncoding);
        const msg = JSON.parse(deciphered);

        const { type, id, data } = msg;
        let body;
        let status;
        let rid;
        switch (type) {
          case 'request':
            this.handleRequest(friend.uid, id, data);
            break;
          case 'response':
            ({ rid, status, body } = data);
            this.emit('response', rid, { status, body });
            break;
          case 'keep-alive':
            this.handleKeepAlive(friend.uid, id);
            break;
          case 'is-alive':
            ({ rid } = data);
            this.emit('is-alive', rid, friend.uid);
            break;
          default:
            console.log(`${friend.uid}:`, msg);
            break;
        }
      }
    },

    sendMessage(uid, data) {
      let friend;
      this.id += 1;
      const toSend = Object.assign({}, data, { id: this.id });
      const message = JSON.stringify(toSend);
      return Q.fcall(() => {
        friend = this.friends.find(f => f.uid === uid);
        if (friend.online) {
          return friend.address;
        }
        return request
          .get(`${locationServer}/${friend.uid}`)
          .then(reply => reply.data);
      })
        .then((address) => {
          const cipher = crypto.createCipher(algorithm, friend.key);
          let ciphered = cipher.update(message, inputEncoding, outputEncoding);
          ciphered += cipher.final(outputEncoding);
          friend.address = address;
          const { port, host } = address.public;
          this.socket.send(ciphered, 0, ciphered.length, port, host, (error) => {
            if (error) {
              return console.log(`error sending message to ${uid}`, error);
            }
            return this.emit('outgoing', friend.uid, toSend);
          });
          return this.id;
        })
        .catch(err => console.error(err));
    },

    handleKeepAlive(uid, rid) {
      const friend = this.friends.find(f => f.uid === uid);
      friend.online = true;
      friend.lastTime = Date.now() - DT_OFFLINE_RETRY;
      friend.tryCount = 0;
      this.emit('online', friend.uid);
      return this.sendMessage(uid, { type: 'is-alive', data: { rid } });
    },

    sendKeepAlive(uid) {
      this.sendMessage(uid, { type: 'keep-alive' })
        .then((id) => {
          const friend = this.friends.find(f => f.uid === uid);
          friend.online = false;

          const callback = (rid, uid) => {
            if (rid === id) {
              this.removeListener('is-alive', callback);
              friend.online = true;
              friend.lastTime = Date.now();
              friend.tryCount = 0;
              this.emit('online', uid);
            }
          };
          this.on('is-alive', callback);
        });
    },

    request(uid, request) {
      const def = Q.defer();

      this.sendMessage(uid, { type: 'request', data: request })
        .then((id) => {
          const callback = (rid, body) => {
            if (rid === id) {
              this.removeListener('response', callback);
              def.resolve(body);
            }
          };
          this.on('response', callback);
        });

      return def.promise;
    },

    handleRequest(uid, rid, data) {
      const { route, method, body } = data;
      const response = (status, body) => {
        this.sendMessage(uid, { type: 'response', data: { rid, status, body } });
      };
      this.router({ route, method, body, uid }, response);
    },

    router(req, res) {
      res(404, { msg: 'not found' });
    },

    processKeepAlives() {
      const send = this.friends.filter(({ online = false, lastTime = 0 }) => {
        if (online) {
          return (lastTime + DT_KEEP_ALIVE) < Date.now();
        }
        return (lastTime + DT_OFFLINE_RETRY) < Date.now();
      });

      return Q.all(send.map((friend) => {
        const { tryCount = 0 } = friend;
        friend.tryCount = tryCount + 1;
        friend.lastTime = Date.now();
        return this.sendKeepAlive(friend.uid);
      }));
    },

    addFriend(uid, key = null) {
      this.friends.push({ uid, key });
    },

    init() {
      this.socket.on('message', this.onMessage.bind(this));

      this.resolver = setInterval(() => {
        Q.ninvoke(stun, 'resolve', this.socket, stunServer)
          .then((value) => {
            return this.updateResolution(value);
          })
          .catch((error) => {
            console.error('Error with resolution', error);
            console.error('closing');
            this.close();
          });
      }, DT_RESOLUTION);

      setInterval(() => {
        this.processKeepAlives();
      }, 100);

      this.emit('connected');
    },

    close() {
      this.socket.close();
      return clearInterval(this.resolver);
    },

    connect() {
      return Q.ninvoke(stun, 'connect', stunServer)
        .then((value) => {
          this.socket = value;
          return this.updateResolution(this.socket.stun);
        })
        .then(() => {
          return this.init();
        })
        .then(() => {
          return this;
        });
    },
  };

  return Object.assign(self, EventEmitter.prototype);
};
