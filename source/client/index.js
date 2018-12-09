const Q = require('q');
const stun = require('vs-stun');
const request = require('axios');

const server = { host: 'stun.l.google.com', port: 19302 };
const server2 = { host: 'stun1.l.google.com', port: 19302 };

module.exports = function Factory(uid, opts) {
  const DT_RESOLUTION = 10000;
  const DT_KEEP_ALIVE = 60000;
  const DT_OFFLINE_RETRY = 2000;

  const { stunServer, locationServer } = opts;

  const self = {
    friends: [],

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
        switch(msg.type) {
          case 'text':
            console.log(`${friend.uid} says '${msg.body}'`);
            break;
          case 'keep-alive':
            console.log(`telling ${friend.uid} that I'm alive`);
            this.sendIsAlive(friend.uid);
            break;
          case 'is-alive':
            console.log(`friend ${friend.uid} is alive`);
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

    sendMessage(uid, data) {
      let friend;
      const message = JSON.stringify(data);
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

    sendIsAlive(uid) {
      return this.sendMessage(uid, { type: 'is-alive' });
    },

    sendKeepAlive(uid) {
      return this.sendMessage(uid, { type: 'keep-alive' });
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
        friend.online = false;
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

  return self;
};
