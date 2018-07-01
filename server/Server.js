import express from 'express';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import os from 'os';
import compression from 'compression';
import http from 'http';
import url from 'url';
import net from 'net';
import Throttle from 'throttle';
import indexTemplate from './templates/index';
import converterTemplate from './templates/converter';

const maxMessages = 30;

const compressor = compression({
  flush: zlib.Z_PARTIAL_FLUSH
});

const appServerPath = os.platform() == 'win32' ?
  '\\\\.\\pipe\\offlinefirst' + Date.now() + '.sock' :
  'offlinefirst.sock';

const connectionProperties = {
  perfect: {bps: 100000000, delay: 0},
  slow: {bps: 4000, delay: 3000},
  'lie-fi': {bps: 1, delay: 10000}
};

export default class Server {
  constructor(port) {
    this._app = express();
    this._serverUp = false;
    this._appServerUp = false;
    this._port = port;
    this._connectionType = '';
    this._connections = [];

    this._appServer = http.createServer(this._app);
    this._exposedServer = net.createServer();
    
    const staticOptions = {
      maxAge: 0
    };

    this._exposedServer.on('connection', socket => this._onServerConnection(socket));

    this._app.use(compressor);
    this._app.use('/scripts', express.static('../public/scripts', staticOptions));
    this._app.use('/styles', express.static('../public/styles', staticOptions));
    this._app.use('/images', express.static('../public/images', staticOptions));
    this._app.use('/sw.js', (req, res) => res.sendFile(path.resolve('../public/sw.js'), staticOptions));
    this._app.use('/sw.js.map', (req, res) => res.sendFile(path.resolve('../public/sw.js.map'), staticOptions));
    // this._app.use('/manifest.json', (req, res) => res.sendFile(path.resolve('../public/manifest.json'), staticOptions));

    this._app.get('/', (req, res) => {
      res.send(indexTemplate({
        scripts: '<script src="/scripts/main.js" defer></script>',
        converter: converterTemplate(),
      }));
    });

    this._app.get('/skeleton', (req, res) => {
      res.send(indexTemplate({
        scripts: '<script src="/scripts/main.js" defer></script>',
        converter: converterTemplate(),
      }));
    });

    // this._app.get('/ping', (req, res) => {
    //   res.set('Access-Control-Allow-Origin', '*');
    //   res.status(200).send({ok: true});
    // });

    // this._app.get('/idb-test/', (req, res) => {
    //   res.send(idbTestTemplate());
    // });
  }

  _onServerConnection(socket) {
    let closed = false;
    this._connections.push(socket);

    socket.on('close', _ => {
      closed = true;
      this._connections.splice(this._connections.indexOf(socket), 1);
    });

    socket.on('error', err => console.log(err));

    const connection = connectionProperties[this._connectionType];
    const makeConnection = _ => {
      if (closed) return;
      const appSocket = net.connect(appServerPath);
      appSocket.on('error', err => console.log(err));
      socket.pipe(new Throttle(connection.bps)).pipe(appSocket);
      appSocket.pipe(new Throttle(connection.bps)).pipe(socket);
    };

    if (connection.delay) {
      setTimeout(makeConnection, connection.delay);
      return;
    }
    makeConnection();
  }

  _listen() {
    this._serverUp = true;
    this._exposedServer.listen(this._port, _ => {
      console.log("Server listening at localhost:" + this._port);
    });

    if (!this._appServerUp) {
      if (fs.existsSync(appServerPath)) fs.unlinkSync(appServerPath);
      this._appServer.listen(appServerPath);
      this._appServerUp = true;
    }
  }

  _destroyConnections() {
    this._connections.forEach(c => c.destroy());
  }

  setConnectionType(type) {
    if (type === this._connectionType) return;
    this._connectionType = type;
    this._destroyConnections();

    if (type === 'offline') {
      if (!this._serverUp) return;
      this._exposedServer.close();
      this._serverUp = false;
      return;
    }

    if (!this._serverUp) {
      this._listen();
    }
  }
}