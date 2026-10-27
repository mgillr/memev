// Preload (node --import) for the benchmark's no-network test: fetch, http, https and raw sockets throw, and
// every attempt is also written to the file named by NO_NET_LOG, because Memev's hooks swallow errors and a
// refused call would otherwise go unseen.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const refuse = (what) => () => {
  if (process.env.NO_NET_LOG) fs.appendFileSync(process.env.NO_NET_LOG, `${what}\n`);
  throw new Error(`network call refused: ${what}`);
};
globalThis.fetch = async (...a) => refuse('fetch')(...a);
http.request = refuse('http.request'); http.get = refuse('http.get');
https.request = refuse('https.request'); https.get = refuse('https.get');
net.connect = refuse('net.connect'); net.createConnection = refuse('net.createConnection');
tls.connect = refuse('tls.connect');
syncBuiltinESMExports();
