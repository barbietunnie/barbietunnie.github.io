import Server from './Server';
import minimist from 'minimist';

const argv = minimist(process.argv, {
  'default': {
    'server-port': 8888
  }
});
const server = new Server(argv['server-port']);
server.setConnectionType('perfect');