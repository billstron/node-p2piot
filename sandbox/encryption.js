require('dotenv').config();
const fs = require('fs');
const NodeRsa = require('node-rsa');

const certFile = process.env.PRIVATE_CERT;
const pubFile = process.env.PUBLIC_KEY;

const certString = fs.readFileSync(certFile).toString();
const cert = new NodeRsa(certString);

const pubString = fs.readFileSync(pubFile).toString();
const pub = new NodeRsa(pubString);

const msg = 'this is a message';

const signed = cert.sign(msg, 'base64');
const encrypted = pub.encrypt(`${msg}\n${signed}}`, 'base64', 'utf8');

const unencrypted = cert.decrypt(encrypted, 'utf8');
const [unencryptedMsg, unencryptedSig] = unencrypted.split('\n');
const isSigned = pub.verify(unencryptedMsg, unencryptedSig, 'utf8', 'base64');

console.log(msg, '\n');
console.log(signed, '\n');
console.log(encrypted, '\n');
console.log(unencrypted, '\n');

console.log(isSigned);
