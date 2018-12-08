const { server } = require('../');

server({ port: 3000 })
  .then((app) => {
    console.log('server started')
  });
