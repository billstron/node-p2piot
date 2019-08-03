require('dotenv').config();
const fs = require('fs');
const client = require('../');

const uid = process.env.A_UID;
const privateKeyFile = process.env.A_PRIVATE_CERT;
const privateKey = fs.readFileSync(privateKeyFile).toString();

const friendUid = process.env.B_UID;
const friendPublicKeyFile = process.env.B_PUBLIC_KEY;
const friendPublicKey = fs.readFileSync(friendPublicKeyFile).toString();

const opts = {
  locationServer: 'https://pdns.billstron.com',
  stunServer: {
    host: 'stun1.l.google.com',
    port: 19302,
  },
  privateKey,
};

const a = client(uid, opts);
a.connect();
a.once('connected', () => {
  console.log('connected');
});

a.addFriend(friendUid, friendPublicKey);

a.on('online', (uid, status) => {
  console.log(`online: ${uid}`, status);
});

function echo(uid, text) {
  setTimeout(() => {
    console.log('echoing...');
    a.request(uid, { route: '/message', method: 'POST', body: { text } })
      .catch((err) => {
        console.error(err);
      });
  }, 1000);
}

a.router = function router(req, response) {
  const { route, method, body, uid } = req; // eslint-disable-line no-unused-vars
  switch (route) {
    case '/ping':
      return response(200, { msg: 'pong' });
    case '/message':
      console.log('received', uid, body.text);
      echo(uid, body.text);
      return response(200, { msg: 'received' });
    default:
      return response(404, { msg: 'not found' });
  }
};
