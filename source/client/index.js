const Q = require('q');
const stun = require('vs-stun');
const request = require('axios');
const EventEmitter = require('events');
const util = require('util');

module.exports = function Factory(uid, opts) {
  const DT_RESOLUTION = 300000;  // 5 minutes
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
        if (this.address && this.address.public.host == value.public.host && this.address.public.port == value.public.port) {
          return null;
        }
        return request
          .post(`${locationServer}/${uid}`, value)
          .then((reply) => {
            console.log('location updated', value);
            this.address = value;
          });
      })
        .catch((err) => {
          console.log('location update failed', err);
        });
    },

    onMessage(buffer, rinfo) {
      const { address, port } = rinfo;
      const friend = this.friends.find(({ address }) => {
        return address && address.public.host === rinfo.address && address.public.port === rinfo.port;
      });
      if (friend) {
        const msg = JSON.parse(buffer.toString('utf8'));
        const { type, id, data, rid } = msg;
        switch(type) {
          case 'request':
            const { method, route, body } = data;
            console.log(`${friend.uid}: ${method}, ${route}, ${body}`);
            this.handleRequest(friend.uid, id, data);
            break;
          case 'keep-alive':
            console.log(`${friend.uid}: keep-alive, ${id}`);
            this.sendIsAlive(friend.uid, id);
            break;
          case 'response':
            console.log(`${friend.uid}: response ${rid}`);
            this.emit('response', rid, data);
            break;
          case 'is-alive':
            console.log(`${friend.uid}: is-alive, ${rid}`);
            friend.online = true;
            friend.lastTime = Date.now();
            friend.tryCount = 0;
            break;
          default:
            console.log(`${friend.uid}:`, msg);
            break;
        }
      }
    },

    handleRequest(uid, id, data) {
      const { route, method, body } = data;
      const response = (status, body) => {
        this.sendMessage(uid, { type: 'response', rid, data });
      };
      this.router({ route, method, body, uid }, response);
    },

    sendMessage(uid, data) {
      let friend;
      this.id += 1;
      const toSend = Object.assign({}, data, { id: this.id });
      const message = JSON.stringify(toSend);
      return Q.fcall(() => {
        friend = this.friends.find(friend => friend.uid === uid);
        if (friend.online) {
          return friend.address;
        }
        console.log('getting address from server', friend.uid);
        return request
          .get(`${locationServer}/${friend.uid}`)
          .then(reply => reply.data);
      })
        .then((address) => {
          friend.address = address;
          const { port, host } = address.public;
          this.socket.send(message, 0, message.length, port, host, (error) => {
            if (error) {
              return console.log(`error sending message to ${uid}`, error);
            }
            console.log(`message sent to ${host}:${port}`);
          });
        })
    },

    sendIsAlive(uid, rid) {
      return this.sendMessage(uid, { type: 'is-alive', rid });
    },

    sendKeepAlive(uid) {
      return this.sendMessage(uid, { type: 'keep-alive' })
        .then(() => {
          const friend = this.friends.find(friend => friend.uid === uid);
          friend.online = false;
        });
    },

    sendRequest(uid, request) {
      const def = Q.defer();

      const callback = (rid, body) => {
        if (rid === id) {
          this.removeListener('response', callback);
          promise.resolve(body);
        }
      }

      this.sendMessage(uid, { type: 'request', data: request })
        .then((id) => {
          this.on('response', callback);
        });

      return def.promise;
    },

    processKeepAlives() {
      const send = this.friends.filter(({ online = false, lastTime = 0, tryCount = 0 }) => {
        if (online) {
          return (lastTime + DT_KEEP_ALIVE) < Date.now();
        }
        return (lastTime + DT_OFFLINE_RETRY) < Date.now();
      });

      return Q.all(send.map((friend) => {
        const { tryCount = 0 } = friend;
        friend.tryCount = tryCount + 1;
        friend.lastTime = Date.now();
        return this.sendKeepAlive(friend.uid)
      }));
    },

    addFriend(uid) {
      this.friends.push({ uid });
    },

    init() {
      this.socket.on('message', this.onMessage.bind(this));

      this.resolver = setInterval(() => {
        Q.ninvoke(stun, 'resolve', this.socket, server)
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

      this.emit('started');

      // setInterval(() => {
      //   this.friends.forEach(({ uid }) => this.sendMessage(uid, 'ping'));
      // }, 2000);
    },

    close() {
      socket.close();
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
    }
  };

  return Object.assign(self, EventEmitter.prototype);

  return self;
};
