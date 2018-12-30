require('dotenv').config();
const fs = require('fs');
const { client } = require('../');

const uid = process.env.UID;
const privateKeyFile = process.env.PRIVATE_CERT;
const privateKey = fs.readFileSync(privateKeyFile).toString();

const friendUid = process.env.FRIEND_UID;
const friendPublicKeyFile = process.env.FRIEND_PUBLIC_KEY;
const friendPublicKey = fs.readFileSync(friendPublicKeyFile).toString();

const opts = {
  locationServer: 'http://34.238.60.160:3000',
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
setInterval(() => {
  a.request(friendUid, { route: '/ping', method: 'GET' })
    .then((reply) => {
      console.log(reply);
    });
}, 20000);

a.on('online', (uid) => {
  console.log(`online: ${uid}`);
});
