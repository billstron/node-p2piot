const os = require('os');


module.exports = function get() {
  const ifaces = os.networkInterfaces();

  const ips = Object.keys(ifaces).reduce((list, ifname) => {
    const newList = ifaces[ifname].reduce((list2, iface) => {
      if (iface.family !== 'IPv4' || iface.internal !== false) {
        // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
        return list2;
      }

      return list2.concat({ ifname, alias: list2.length > 0, address: iface.address });
    }, []);
    return list.concat(newList);
  }, []);

  return ips;
};
