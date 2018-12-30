require('dotenv').config();
const fs = require('fs');
const { client } = require('../');

const uid = process.env.B_UID;
const privateKeyFile = process.env.B_PRIVATE_CERT;
const privateKey = fs.readFileSync(privateKeyFile).toString();

const friendUid = process.env.A_UID;
const friendPublicKeyFile = process.env.A_PUBLIC_KEY;
const friendPublicKey = fs.readFileSync(friendPublicKeyFile).toString();

const opts = {
  locationServer: 'http://34.238.60.160:3000',
  stunServer: {
    host: 'stun1.l.google.com',
    port: 19302,
  },
  privateKey,
};

const b = client(uid, opts);
b.connect();
b.once('connected', () => {
  console.log('connected');
});

b.addFriend(friendUid, friendPublicKey);
b.router = function router(req, response) {
  const { route, method, body } = req; // eslint-disable-line no-unused-vars
  switch (route) {
    case '/ping':
      return response(200, { msg: 'pong' });
    default:
      return response(404, { msg: 'not found' });
  }
};

b.on('online', (uid, status) => {
  console.log(`online: ${uid}`, status);
});
