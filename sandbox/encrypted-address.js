require('dotenv').config();
const fs = require('fs');

const { client } = require('../');

const certFile = process.env.PRIVATE_CERT;
const pubFile = process.env.PUBLIC_KEY;

const privateKey = fs.readFileSync(certFile).toString();
const publicKey = fs.readFileSync(pubFile).toString();

const uid = 'a12345a';
const opts = {
  locationServer: 'http://34.238.60.160:3000',
  stunServer: {
    host: 'stun1.l.google.com',
    port: 19302,
  },
  privateKey,
};

const a = client(uid, opts);
a.addFriend('a12345a', publicKey);
a.connect();

a.once('connected', () => {
  console.log('connected');
});
