require('dotenv').config()
const { client } = require('../');

const uid = 'b12345';
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
    a.addFriend('a12345');
  })
  .catch((error) => {
    console.error(error);
  });
