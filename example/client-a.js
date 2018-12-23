require('dotenv').config();
const { client } = require('../');

const uid = 'a12345';
const opts = {
  locationServer: 'http://34.238.60.160:3000',
  stunServer: {
    host: 'stun1.l.google.com',
    port: 19302,
  },
};

client(uid, opts)
  .connect()
  .then((a) => {
    a.addFriend('b12345');

    setInterval(() => {
      a.request('b12345', { route: '/ping', method: 'GET' })
        .then((reply) => {
          console.log(reply);
        });
    }, 20000)
  })
  .catch((error) => {
    console.error(error);
  })
