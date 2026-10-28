import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
// Test adapters supply their own fake transports. Real network access is never needed.
const denied = () => { throw new Error('OFFLINE_TEST_NETWORK_FORBIDDEN'); };
globalThis.fetch = denied;
http.request = http.get = https.request = https.get = denied;
net.connect = net.createConnection = tls.connect = dgram.createSocket = denied;
syncBuiltinESMExports();
