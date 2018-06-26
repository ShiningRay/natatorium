import { Discover } from './discover';
import Swim from 'swim';
const networkAddress = require('network-address');
const udpFreePort = require('udp-free-port');

const host = networkAddress();
var swim: Swim;
udpFreePort(async (err: any, port: number) => {
  const id = `${host}:${port}`;
  console.log('id', id);
  const swim = new Swim({
    local: {
      host: id
    },
    interval: 500, // optional
    joinTimeout: 1000, // optional
    pingTimeout: 100, // optional
  });
  let set = new Set<string>();

  swim.on(Swim.EventType.Change, (event) => {
    switch (event.state) {
      case 0:
        if (!set.has(event.host)) {
          set.add(event.host)
          swim.emit('peerUp', event)
        }
        break;
    }
  });

  swim.on(Swim.EventType.Update, (event) => {
    switch (event.state) {
      case 0:
        if (!set.has(event.host)) {
          set.add(event.host)
          swim.emit('peerUp', event)
        }
        break;
      case 1:
        swim.emit('peerSuspect', event)
        break;
      case 2:
        set.delete(event.host)
        swim.emit('peerDown', event)
        break;
    }
  });
  swim.bootstrap([]);

  swim.on('peerUp', console.log);
  swim.on('peerDown', console.log);
  var d = await Discover.start(23456, { host: id });

  d.on('helloReceived', (data) => {
    console.log('hello', data);
    swim.join([data.host])
    d.stop();
  });
});
