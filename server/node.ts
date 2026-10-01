// Local dev server: `npm run server` -> ws://localhost:8787/room/<id>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomCore, type Conn } from './room.ts';
import { PROTOCOL_VERSION } from '../shared/protocol.ts';

const PORT = Number(process.env.PORT ?? 8787);

// Never let one bad message take the whole server down.
process.on('unhandledRejection', (e) => console.error('[liero] unhandled', e));
process.on('uncaughtException', (e) => console.error('[liero] uncaught', e));
const rooms = new Map<string, RoomCore>();
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  const m = req.url?.match(/^\/count\/([\w-]{1,64})$/);
  if (m) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ players: rooms.get(m[1])?.playerCount ?? 0 }));
    return;
  }
  // Same routes as production: landing page, /privacy, /r/<room> guest client, static files in web/.
  const url = (req.url ?? '/').split('?')[0];
  let file = url === '/' ? 'index.html'
    : /^\/r\/[\w-]{1,64}\/?$/.test(url) ? 'play.html'
    : url === '/privacy' ? 'privacy.html'
    : url.slice(1);
  const full = path.resolve(WEB, file);
  if (!full.startsWith(WEB + path.sep) || full.includes(`${path.sep}src${path.sep}`) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(full)] ?? 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

server.on('upgrade', (req, socket, head) => {
  const m = req.url?.match(/^\/room\/([\w-]{1,64})$/);
  if (!m) { socket.destroy(); return; }
  const id = m[1];
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    let room = rooms.get(id);
    if (!room) {
      room = new RoomCore(id, () => rooms.delete(id));
      rooms.set(id, room);
    }
    const r = room;
    const conn: Conn = {
      send: (d) => { if (ws.readyState === ws.OPEN) ws.send(d); },
      close: (code, reason) => ws.close(code, reason),
    };
    r.connect(conn);
    console.log(`[room ${id}] connect (${r.playerCount} players before)`);
    ws.on('message', (data, isBinary) => {
      const payload = isBinary ? new Uint8Array(data as Buffer) : data.toString();
      void r.message(conn, payload);
    });
    ws.on('close', (code) => { console.log(`[room ${id}] disconnect code=${code}`); r.disconnect(conn); });
    ws.on('error', () => r.disconnect(conn));
  });
});

server.listen(PORT, () => console.log(`liero dev server (protocol v${PROTOCOL_VERSION}) on http://localhost:${PORT}  (rooms: ws://localhost:${PORT}/room/<id>, invites: /r/<id>)`));
