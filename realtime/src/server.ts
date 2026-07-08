import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { verifyConnectionToken, type PartyName } from './auth.js';
import { RoomManager } from './rooms.js';
import type { PartyHandler } from './parties/types.js';

export type RealtimeServerOptions = {
  sessionSecret: string;
  handlers: Record<PartyName, PartyHandler>;
};

const PARTY_PATH = /^\/parties\/(main|tabletop|tabletop_map)\/([^/?]+)$/;

function parsePartyUrl(url: string | undefined): { party: PartyName; roomId: string } | null {
  if (!url) return null;
  const { pathname } = new URL(url, 'http://internal');
  const match = PARTY_PATH.exec(pathname);
  if (!match) return null;
  return { party: match[1] as PartyName, roomId: decodeURIComponent(match[2]) };
}

export function createRealtimeServer(opts: RealtimeServerOptions): Server {
  const rooms = new RoomManager();
  const wss = new WebSocketServer({ noServer: true });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    const target = parsePartyUrl(req.url);
    if (target) {
      const handler = opts.handlers[target.party];
      if (!handler.onRequest) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const [status, body] = await handler.onRequest(
        rooms.get(target.party, target.roomId),
        req.headers,
        Buffer.concat(chunks).toString('utf8')
      );
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const target = parsePartyUrl(req.url);
    if (!target) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const token = new URL(req.url ?? '/', 'http://internal').searchParams.get('token');

    // Quick validation: reject obviously invalid tokens before upgrade
    if (!token || typeof token !== 'string' || !token.includes('.')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const authPromise = verifyConnectionToken(
      target.party,
      target.roomId,
      token,
      opts.sessionSecret
    );

    wss.handleUpgrade(req, socket, head, (ws) => {
      authPromise
        .then((auth) => {
          if (!auth) {
            ws.terminate();
            return;
          }
          const room = rooms.get(target.party, target.roomId);
          const peer = room.addPeer(ws, auth);
          const handler = opts.handlers[target.party];
          handler.onConnect?.(peer, room);
          ws.on('message', (data) => {
            void handler.onMessage(data.toString(), peer, room);
          });
          ws.on('close', () => {
            room.removePeer(peer);
            rooms.releaseIfEmpty(room);
          });
        })
        .catch(() => {
          ws.terminate();
        });
    });
  });

  server.on('close', () => {
    for (const ws of wss.clients) ws.terminate();
  });

  return server;
}
