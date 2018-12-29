require('dotenv').config();
const fs = require('fs');
const NodeRsa = require('node-rsa');

const { client } = require('../');

const certFile = process.env.PRIVATE_CERT;
const pubFile = process.env.PUBLIC_KEY;

const privateKey = fs.readFileSync(certFile).toString();
const publicKey = fs.readFileSync(pubFile).toString();

const uid = 'a12345';
const opts = {
  locationServer: 'http://34.238.60.160:3000',
  stunServer: {
    host: 'stun1.l.google.com',
    port: 19302,
  },
  privateKey,
};

const a = client(uid, opts);
const msg = {
  message: 'butts',
};

const encrypted = a.signAndEncrypt(msg, publicKey);
const decrypted = a.decryptAndVerify(encrypted, publicKey);

console.log(msg);
console.log(encrypted, '\n');
console.log(decrypted);

const pub = new NodeRsa(publicKey);
const encrypted2 = pub.encrypt(`${JSON.stringify(msg)}\nsdfgsdfdsdfgfdf}`, 'base64', 'utf8');
let decrypted2;
try {
  decrypted2 = a.decryptAndVerify(encrypted2, publicKey);
} catch (ex) {
  console.log(ex);
}
console.log(decrypted2);
