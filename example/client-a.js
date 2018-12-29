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

const a = client(uid, opts);
a.connect();
a.once('connected', () => {
  console.log('connected');
});

a.addFriend('b12345', 'oiuytertyukjhg');
setInterval(() => {
  a.request('b12345', { route: '/ping', method: 'GET' })
    .then((reply) => {
      console.log(reply);
    });
}, 20000);

a.on('online', (uid) => {
  console.log(`online: ${uid}`);
});
