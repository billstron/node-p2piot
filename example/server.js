const { server } = require('../');

server({ port: 3000 })
  .then(() => {
    console.log('server started');
  });
