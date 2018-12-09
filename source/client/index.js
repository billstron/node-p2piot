const Q = require('q');
const stun = require('vs-stun');
const request = require('axios');

const server = { host: 'stun.l.google.com', port: 19302 };
const server2 = { host: 'stun1.l.google.com', port: 19302 };

module.exports = function Factory(uid, opts) {
  const DT_RESOLUTION = 10000;

  const { stunServers, locationServer } = opts;

  const location = locationServer.port ?
    `http://${locationServer.host}:${locationServer.port}` :
    `http://${locationServer.host}`;

  const self = {
    friends: [],

    uid,

    updateResolution(stun) {
      return request
        .post(`${location}/${uid}`, stun)
        .then((reply) => {
          console.log('location updated', stun);
        })
        .catch((err) => {
          console.log('location update failed', err);
        });
    },

    onMessage(msg, rinfo) {
      const { address, port } = rinfo;
      const friend = this.friends.find((friend) => {
        return friend.address.public.host === address && friend.address.public.port === port;
      });
      if (friend) {
        const text = msg.toString('utf8');
        console.log(`${friend.uid} says '${text}'`);
      }
    },

    sendMessage(uid, message, callback) {
      let friend;
      return Q.fcall(() => {
        friend = this.friends.find(friend => friend.uid === uid);
        if (friend.address) {
          return address;
        }

        return request
          .get(`${location}/${uid}`)
          .then((reply) => reply.body);
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

    connect(server, callback) {
      const [server] = stunServers;
      stun.connect(server, (error, value) => {
        if (error) {
          return callback(error);
          return console.log('Something went wrong: ' + error);
        }

        this.socket = value;
        console.log(this.socket.stun);
        this.updateResolution(this.socket.stun);

        this.socket.on('message', this.onMessage.bind(this));

        const resolver = setInterval(() => {
          stun.resolve(this.socket, server, (error, value) => {
            if (error) {
              console.error('Error with resolution', error);
              socket.close();
              return clearInterval(resolver);
            }

            return this.updateResolution(value);
          });
        }, DT_RESOLUTION);
      });

      setInterval(() => {
        this.friends.forEach(({ uid }) => this.sendMessage(uid, 'ping'));
      }, 2000);
    }
  };

  self.connect(stunServer, callback);
};
