require('dotenv').config();
const { client } = require('../');

const uid = 'b12345';
const opts = {
  locationServer: 'http://34.238.60.160:3000',
  stunServer: {
    host: 'stun1.l.google.com',
    port: 19302,
  },
};

const b = client(uid, opts);
b.connect();
b.once('connected', () => {
  console.log('connected');
});

b.addFriend('a12345', 'oiuytertyukjhg');
b.router = function router(req, response) {
  const { route, method, body } = req; // eslint-disable-line no-unused-vars
  switch (route) {
    case '/ping':
      return response(200, { msg: 'pong' });
    default:
      return response(404, { msg: 'not found' });
  }
};

b.on('online', (uid) => {
  console.log(`online: ${uid}`);
});
