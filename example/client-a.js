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
      client.sendRequest('b12345', '/ping', 'GET');
    }, 1000)
  })
  .catch((error) => {
    console.error(error);
  })
