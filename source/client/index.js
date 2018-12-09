const Q = require('q');
const stun = require('vs-stun');
const request = require('axios');

const server = { host: 'stun.l.google.com', port: 19302 };
const server2 = { host: 'stun1.l.google.com', port: 19302 };

module.exports = function Factory(uid, opts) {
  const DT_RESOLUTION = 10000;

  const { stunServer, locationServer } = opts;

  const self = {
    friends: [],

    uid,

    address: null,

    updateResolution(stun) {
      return Q.fcall(() => {
        if (this.address && this.address.public.host == stun.public.host && this.address.public.port == stun.public.port) {
          return null;
        }
        return request
          .post(`${locationServer}/${uid}`, stun)
          .then((reply) => {
            console.log('location updated', stun);
            this.address = stun;
          });
      })
        .catch((err) => {
          console.log('location update failed', err);
        });
    },

    onMessage(msg, rinfo) {
      const { address, port } = rinfo;
      const friend = this.friends.find(({ address }) => {
        return address && address.public.host === rinfo.address && address.public.port === rinfo.port;
      });
      if (friend) {
        const text = msg.toString('utf8');
        console.log(`${friend.uid} says '${text}'`);
      }
    },

    sendMessage(uid, message, callback) {
      let friend;
      return Q.fcall(() => {
        // friend = this.friends.find(friend => friend.uid === uid);
        // if (friend.address) {
        //   return friend.address;
        // }
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
        this.friends.forEach(({ uid }) => this.sendMessage(uid, 'ping'));
      }, 2000);
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
