const Q = require('q');
const stun = require('vs-stun');
const request = require('axios');
const EventEmitter = require('events');
const crypto = require('crypto');
const NodeRsa = require('node-rsa');

const algorithm = 'aes256';
const inputEncoding = 'utf8';
const outputEncoding = 'hex';

module.exports = function Factory(uid, opts) {
  const DT_RESOLUTION = 300000; // 5 minutes
  const DT_KEEP_ALIVE = 60000;
  const DT_OFFLINE_RETRY = 2000;

  const { stunServer, locationServer, privateKey } = opts;

  const self = {
    friends: [],

    id: 0,

    uid,

    cert: new NodeRsa(privateKey),

    address: null,

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
          console.log('location updated', value);
          this.address = value;
        })
        .catch((err) => {
          console.log('location update failed', err);
        });
    },

    connectToFriend(fuid) {
      let friend;
      return Q.fcall(() => {
        friend = this.friend.find(({ uid }) => uid === fuid);
        if (!friend) {
          throw new Error('Friend not found');
        }
        return request.get(`${locationServer}/${friend.uid}`);
      })
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
          const cipher = crypto.createCipher(algorithm, friend.key);
          let ciphered = cipher.update(message, inputEncoding, outputEncoding);
          ciphered += cipher.final(outputEncoding);
          const { port, host } = friend.address.public;
          this.socket.send(ciphered, 0, ciphered.length, port, host, (error) => {
            if (error) {
              return console.log(`error sending message to ${uid}`, error);
            }
            return this.emit('outgoing', friend.uid, toSend);
          });
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
        return this.handleEncryptedMessage(friend, text);
      }
      return null;
    },

    handleBinding(fuid, text = '') {
      let friend;
      return Q.fcall(() => {
        friend = this.friend.find(({ uid }) => uid === fuid);
        if (!friend) {
          throw new Error('Friend not found');
        }
        const { port, host } = friend.address.public;
        const { state } = friend;
        switch (state) {
          default:
            console.log('binding default', text);
            if (text === 'bind start') {
              friend.state = 'verify';
              friend.verify = null;
            } else {
              friend.state = 'start';
            }
            this.send('bind start', port, host);
            break;
          case 'start':
            console.log('binding start', text);
            if (text === 'bind start') {
              friend.state = 'verify';
              friend.verify = {
                time: Date.now(),
                index: 0,
              };
              const toVerify = `verify ${friend.verify.time} ${friend.verify.index}`;
              const msg = `bind ${this.signAndEncrypt(toVerify, friend.publicKey)}`;
              this.send(msg, port, host);
            } else {
              this.send('bind start', port, host);
            }
            break;
          case 'verify':
            console.log('binding verify', text);
            if (text) {
              let toVerify;
              try {
                toVerify = this.decryptAndVerify(text.split(' ')[1], friend.publicKey);
              } catch (err) {
                // log this later
              }
              const [code, time, index] = toVerify.split(' ');
              if (code && code === 'verify') {
                if (friend.verify == null) {
                  friend.state = 'exchange';
                  friend.secret = null;
                  const toVerify = `verify ${time} ${Number(index) + 1}`;
                  const msg = `bind ${this.signAndEncrypt(toVerify, friend.publicKey)}`;
                  this.send(msg, port, host);
                } else if (Number(time) === friend.verify.time && Number(index) === (friend.verify.index + 1)) {
                  friend.state = 'exchange';
                  friend.secret = crypto.randomBytes(32).toString('hex');
                  const msg = `bind ${this.signAndEncrypt(`secret ${friend.secret}`, friend.publicKey)}`;
                  this.send(msg, port, host);
                } else {
                  friend.state = 'failure';
                }
              } else {
                friend.state = 'failure';
              }
            }
            break;
          case 'exchange':
            console.log('binding exchange', text);
            if (text) {
              let toVerify;
              try {
                toVerify = this.decryptAndVerify(text.split(' ')[1], friend.publicKey);
              } catch (err) {
                // log this later
              }
              const [code, secret] = toVerify;
              if (code && code === 'secret') {
                if (secret.length === 32 && friend.secret == null) {
                  friend.secret = `${secret}${crypto.randomBytes(32).toString('hex')}`;
                  const msg = `bind ${this.signAndEncrypt(`secret ${friend.secret}`, friend.publicKey)}`;
                  this.send(msg, port, host);
                } else if (secret.length === 64 && friend.secret === secret) {
                  friend.state = 'finalize';
                  const msg = `bind ${this.signAndEncrypt('finalize', friend.publicKey)}`;
                  this.send(msg, port, host);
                } else if (secret.length === 64 && secret.indexOf(friend.secret) === 0) {
                  friend.state = 'finalize';
                  friend.secret = secret;
                  const msg = `bind ${this.signAndEncrypt(`secret ${friend.secret}`, friend.publicKey)}`;
                  this.send(msg, port, host);
                } else {
                  friend.state = 'failure';
                }
              } else {
                friend.state = 'failure';
              }
            }
            break;
          case 'finalize':
            console.log('binding finalize', text);
            if (text) {
              let toVerify;
              try {
                toVerify = this.decryptAndVerify(text.split(' ')[1], friend.publicKey);
              } catch (err) {
                // log this later
              }
              if (toVerify && toVerify === 'finalize') {
                friend.state = 'bound';
                const msg = `bind ${this.signAndEncrypt('finalize confirmed', friend.publicKey)}`;
                this.send(msg, port, host);
              } else if (toVerify && toVerify === 'finalize confirmed') {
                friend.state = 'bound';
                this.sendKeepAlive(friend.uid);
              } else {
                friend.state = 'failure';
              }
            }
            break;
        }
      });
    },

    send(msg, port, host) {
      this.socket.send(msg, 0, msg.length, port, host, (error) => {
        if (error) {
          return console.log(`error sending message to ${uid}`, error);
        }
        return this.emit('outgoing:raw', host, port, msg);
      });
    },

    handleEncryptedMessage(friend, text) {
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
    },

    handleKeepAlive(uid, rid) {
      const friend = this.friends.find(f => f.uid === uid);
      friend.online = true;
      friend.lastTime = Date.now() - DT_OFFLINE_RETRY;
      friend.tryCount = 0;
      this.emit('online', friend.uid);
      return this.sendMessage(uid, { type: 'is-alive', data: { rid } })
        .catch((err) => {
          console.log(err);
        });
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
        })
        .catch((err) => {
          console.error(err);
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

    addFriend(uid, publicKey, key = null) {
      this.friends.push({ uid, publicKey, key });
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
      }, 1000);

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
