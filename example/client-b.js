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
  .then((b) => {
    b.addFriend('a12345');
    b.router = function router(req, response) {
      const { route, method, body } = req;
      switch(route) {
        case '/ping':
          return response(200, { msg: 'pong' });
        default:
          return response(404, { msg: 'not found' });
      }
    };
  })
  .catch((error) => {
    console.error(error);
  });
