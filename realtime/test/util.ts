import { SignJWT } from 'jose';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export const TEST_SECRET = 'test-secret-at-least-32-characters-long!!';

export function makeToken(claims: Record<string, unknown>, secret = TEST_SECRET): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

export function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

type BufferedSocket = WebSocket & {
  __queue: string[];
  __waiters: Array<(msg: string) => void>;
};

export function connect(
  port: number,
  party: string,
  room: string,
  token: string
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/parties/${party}/${room}?token=${encodeURIComponent(token)}&_pk=test`
    ) as BufferedSocket;
    ws.__queue = [];
    ws.__waiters = [];
    // Buffer every frame from the start so a message can never be lost
    // between connection and the first nextMessage() call.
    ws.on('message', (d) => {
      const msg = d.toString();
      const waiter = ws.__waiters.shift();
      if (waiter) waiter(msg);
      else ws.__queue.push(msg);
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

export function nextMessage(ws: WebSocket): Promise<string> {
  const buffered = ws as BufferedSocket;
  const queued = buffered.__queue.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  return new Promise((resolve) => buffered.__waiters.push(resolve));
}
