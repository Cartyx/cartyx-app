import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { verifyConnectionToken, type PartyName } from './auth.js';
import { RoomManager } from './rooms.js';
import type { PartyHandler } from './parties/types.js';
import { log } from './logger.js';

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
  try {
    return { party: match[1] as PartyName, roomId: decodeURIComponent(match[2]) };
  } catch {
    return null; // malformed percent-encoding → treated as unknown path (404)
  }
}

function invokeSafely(label: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.catch((err) => log.error({ label, err }, 'handler failed'));
    }
  } catch (err) {
    log.error({ label, err }, 'handler failed');
  }
}

type LiveSocket = import('ws').WebSocket & { isAlive?: boolean };

export function createRealtimeServer(opts: RealtimeServerOptions): Server {
  const rooms = new RoomManager();
  const wss = new WebSocketServer({ noServer: true });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients as Set<LiveSocket>) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30_000);

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
      const room = rooms.get(target.party, target.roomId);
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const [status, body] = await handler.onRequest(
          room,
          req.headers,
          Buffer.concat(chunks).toString('utf8')
        );
        res.writeHead(status, { 'content-type': 'text/plain' });
        res.end(body);
      } catch (err) {
        log.error({ err }, 'onRequest failed');
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Internal error');
      } finally {
        rooms.releaseIfEmpty(room);
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const target = parsePartyUrl(req.url);
    if (!target) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const token = new URL(req.url ?? '/', 'http://internal').searchParams.get('token');
    const auth = await verifyConnectionToken(
      target.party,
      target.roomId,
      token,
      opts.sessionSecret
    );
    if (!auth) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as LiveSocket).isAlive = true;
      ws.on('pong', () => ((ws as LiveSocket).isAlive = true));
      const room = rooms.get(target.party, target.roomId);
      const peer = room.addPeer(ws, auth);
      const handler = opts.handlers[target.party];
      ws.on('error', (err) => {
        log.error({ peerId: peer.id, err }, 'socket error');
        try {
          ws.terminate();
        } catch {
          // already closed
        }
      });
      invokeSafely('onConnect', () => handler.onConnect?.(peer, room));
      ws.on('message', (data) => {
        invokeSafely('onMessage', () => handler.onMessage(data.toString(), peer, room));
      });
      ws.on('close', () => {
        room.removePeer(peer);
        rooms.releaseIfEmpty(room);
      });
    });
  });

  server.on('close', () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
  });

  return server;
}
