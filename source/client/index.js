const Q = require('q');
const stun = require('vs-stun');
const request = require('axios');
const EventEmitter = require('events');
const crypto = require('crypto');
const NodeRsa = require('node-rsa');

const getLocalIps = require('./get-local-ips');

const algorithm = 'aes256';
const inputEncoding = 'utf8';
const outputEncoding = 'hex';

if (process.env.DEBUG !== 'true') {
  console.debug = () => {};
}

module.exports = function Factory(uid, opts) {
  const DT_RESOLUTION = 300000;
  const DT_KEEP_ALIVE = 60000;
  const DT_OFFLINE_RETRY = 2000;
  const DT_TIMEOUT = 500;

  const { stunServer, locationServer, privateKey } = opts;

  const self = {
    friends: [],

    id: 0,

    uid,

    cert: new NodeRsa(privateKey),

    address: null,

    sendRaw(msg, port, host) {
      this.socket.send(msg, 0, msg.length, port, host, (error) => {
        if (error) {
          console.debug(`error sending message to ${uid}`, error);
          return this.emit('error', `error sending message to ${uid}`, error);
        }
        return this.emit('outgoing:raw', host, port, msg);
      });
    },

    signAndEncrypt(msg, publicKey) {
      const pub = new NodeRsa(publicKey);
      const text = JSON.stringify(msg);
      const signed = this.cert.sign(text, 'base64');
      const encrypted = pub.encrypt(`${text}\n${signed}}`, 'base64', 'utf8');
      return encrypted;
    },

    decryptAndVerify(emsg, publicKey) {
      const pub = new NodeRsa(publicKey);
      const unencrypted = this.cert.decrypt(emsg, 'utf8');
      const [msg, sig] = unencrypted.split('\n');
      const isSigned = pub.verify(msg, sig, 'utf8', 'base64');
      if (isSigned) {
        return JSON.parse(msg);
      }
      throw new Error('Verification Failed');
    },

    updateResolution(value) {
      return Q.fcall(() => {
        if (
          this.address
          && this.address.public.host === value.public.host
          && this.address.public.port === value.public.port
        ) {
          return null;
        }
        const addresses = this.friends.map(({ publicKey }) => this.signAndEncrypt(value, publicKey));
        return request.post(`${locationServer}/${uid}`, addresses);
      })
        .then(() => {
          console.debug('location updated', value);
          this.address = value;
        })
        .catch((err) => {
          console.debug('location update failed', err);
          this.emit('error', 'location update failed', err);
        });
    },

    connectToFriend(fuid) {
      const friend = this.friends.find(({ uid }) => uid === fuid);
      if (!friend) {
        throw new Error('Friend not found');
      }
      request.get(`${locationServer}/${friend.uid}`)
        .then(({ data }) => {
          const address = data.reduce((prev, encrypted) => {
            let next;
            try {
              next = this.decryptAndVerify(encrypted, friend.publicKey);
            } catch (err) {
              return prev;
            }
            return next;
          }, null);
          friend.address = address;
          return this.handleBinding(friend.uid);
        })
        .catch((err) => {
          console.debug(err);
          this.emit('error', err);
        });
    },

    sendMessage(uid, data) {
      let friend;
      this.id += 1;
      const toSend = Object.assign({}, data, { id: this.id });
      return Q.fcall(() => {
        friend = this.friends.find(f => f.uid === uid);
        if (friend.online) {
          return friend.address;
        }
        this.connectToFriend(friend.uid);
        throw new Error('Connection not alive');
      })
        .then((address) => {
          friend.address = address;
          const message = JSON.stringify(toSend);
          const cipher = crypto.createCipher(algorithm, friend.secret);
          let ciphered = cipher.update(message, inputEncoding, outputEncoding);
          ciphered += cipher.final(outputEncoding);
          const { port, host } = friend.address.public;
          this.sendRaw(ciphered, port, host);
          return this.id;
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

        if (text.indexOf('bind') === 0) {
          return this.handleBinding(friend.uid, text);
        }
        return this.handleEncrypted(friend.uid, text);
      }
      return null;
    },

    handleBinding(fuid, text = 'bind start') {
      const friend = this.friends.find(({ uid }) => uid === fuid);
      if (!friend) {
        throw new Error('Friend not found');
      }
      let [bind, state, ...data] = text.split(' '); // eslint-disable-line prefer-const
      if (bind !== 'bind') {
        throw new Error('Improper message');
      }
      if (state !== 'start') {
        [state, ...data] = this.decryptAndVerify(state, friend.publicKey).split(' ');
      }
      const { port, host } = friend.address.public;
      let time;
      let index;
      let secret;
      switch (state) {
        default:
        case 'start':
          console.debug('state: start', data);
          friend.secret = null;
          if (data.length > 0 && data[0] === 'continue') {
            friend.verify = {
              time: Date.now(),
              index: 0,
            };
            const toVerify = `verify ${friend.verify.time} ${friend.verify.index}`;
            const msg = `bind ${this.signAndEncrypt(toVerify, friend.publicKey)}`;
            this.sendRaw(msg, port, host);
          } else {
            friend.verify = null;
            this.sendRaw('bind start continue', port, host);
          }
          break;
        case 'verify':
          console.debug('state: verify', data);
          ([time, index] = data);
          if (friend.verify == null) {
            friend.secret = null;
            friend.verify = {
              time: Number(time),
              index: Number(index) + 1,
            };
            const toVerify = `verify ${friend.verify.time} ${friend.verify.index}`;
            const msg = `bind ${this.signAndEncrypt(toVerify, friend.publicKey)}`;
            this.sendRaw(msg, port, host);
          } else if (Number(time) === friend.verify.time && Number(index) === (friend.verify.index + 1)) {
            friend.secret = crypto.randomBytes(16).toString('hex');
            const msg = `bind ${this.signAndEncrypt(`exchange ${friend.secret}`, friend.publicKey)}`;
            this.sendRaw(msg, port, host);
          }
          break;
        case 'exchange':
          console.debug('state: exchange', data);
          ([secret] = data);
          if (secret.length === 32 && friend.secret == null) {
            friend.secret = `${secret}${crypto.randomBytes(16).toString('hex')}`;
            const msg = `bind ${this.signAndEncrypt(`exchange ${friend.secret}`, friend.publicKey)}`;
            this.sendRaw(msg, port, host);
          } else if (secret.length === 64 && friend.secret === secret) {
            const msg = `bind ${this.signAndEncrypt('finalize', friend.publicKey)}`;
            this.sendRaw(msg, port, host);
          } else if (secret.length === 64 && secret.indexOf(friend.secret) === 0) {
            friend.secret = secret;
            const msg = `bind ${this.signAndEncrypt(`exchange ${friend.secret}`, friend.publicKey)}`;
            this.sendRaw(msg, port, host);
          }
          break;
        case 'finalize':
          console.debug('state: finalize', data);
          if (data.length === 0) {
            const msg = `bind ${this.signAndEncrypt('finalize confirmed', friend.publicKey)}`;
            this.sendRaw(msg, port, host);
          } else if (data[0] === 'confirmed') {
            if (!friend.online) {
              this.emit('online', uid, true);
              friend.online = true;
            }
            this.sendKeepAlive(friend.uid);
          }
          break;
      }
    },

    handleEncrypted(fuid, text) {
      const friend = this.friends.find(({ uid }) => uid === fuid);
      const decipher = crypto.createDecipher(algorithm, friend.secret);
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
          console.debug(`${friend.uid}:`, msg);
          break;
      }
    },

    handleKeepAlive(uid, rid) {
      const friend = this.friends.find(f => f.uid === uid);
      if (!friend.online) {
        this.emit('online', friend.uid, true);
        friend.online = true;
      }
      friend.lastTime = Date.now() - DT_OFFLINE_RETRY;
      friend.tryCount = 0;
      return this.sendMessage(uid, { type: 'is-alive', data: { rid } })
        .catch((err) => {
          console.debug(err);
        });
    },

    sendKeepAlive(uid) {
      let friend;
      return Q.fcall(() => {
        friend = this.friends.find(f => f.uid === uid);
        return this.sendMessage(uid, { type: 'keep-alive' });
      })
        .then((id) => {
          friend.tryCount += 1;

          const callback = (rid, uid) => {
            if (rid === id) {
              this.removeListener('is-alive', callback);
              clearTimeout(timeout); // eslint-disable-line no-use-before-define
              if (!friend.online) {
                this.emit('online', uid, true);
                friend.online = true;
              }
              friend.lastTime = Date.now();
              friend.tryCount = 0;
            }
          };

          const timeout = setTimeout(() => {
            if (friend.online) {
              friend.online = false;
              this.emit('online', friend.uid, false);
            }
            friend.tryCount += 1;

            this.removeListener('is-alive', callback);
          }, DT_TIMEOUT);

          this.on('is-alive', callback);
        })
        .catch((err) => {
          if (friend.online) {
            friend.online = false;
            this.emit('online', friend.uid, false);
          }
          friend.tryCount += 1;
          console.debug(err);
        });
    },

    request(uid, request) {
      const def = Q.defer();

      this.sendMessage(uid, { type: 'request', data: request })
        .then((id) => {
          const callback = (rid, body) => {
            if (rid === id) {
              this.removeListener('response', callback);
              clearTimeout(timeout); // eslint-disable-line no-use-before-define
              def.resolve(body);
            }
          };

          const timeout = setTimeout(() => {
            this.removeListener('response', callback);
            def.reject(new Error('timeout waiting for response'));
          }, DT_TIMEOUT);

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

    addFriend(uid, publicKey, key = null) {
      this.friends.push({ uid, publicKey, key });
    },

    init() {
      this.socket.on('message', this.onMessage.bind(this));

      this.resolver = setInterval(() => {
        Q.ninvoke(stun, 'resolve', this.socket, stunServer)
          .then((value) => {
            const localIps = getLocalIps();
            value.local.host = localIps[0].address;
            return this.updateResolution(value);
          })
          .catch((error) => {
            console.error('Error with resolution', error);
            console.error('closing');
            this.emit('error', 'Error with resolution', error);
            this.close();
          });
      }, DT_RESOLUTION);

      setInterval(() => {
        this.processKeepAlives();
      }, 100);
      this.processKeepAlives();

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
          const localIps = getLocalIps();
          this.socket.stun.local.host = localIps[0].address;
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
