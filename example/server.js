const redis = require('redis');
const { server } = require('../');

const db = redis.createClient();

server({ port: 3000 }, db)
  .then(() => {
    console.log('server started');
  });
