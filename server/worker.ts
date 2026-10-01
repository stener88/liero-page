// Cloudflare Worker + Durable Object. One Durable Object instance per room.
//   wss://liero.page/room/<id>   (game rooms)
//   https://liero.page/r/<id>    (guest client for invite links)
/// <reference types="@cloudflare/workers-types" />
import { RoomCore, type Conn } from './room.ts';

interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

// Static files in web/ (landing page, /privacy, /dist/play.js, icons) are served by Cloudflare
// before this code runs; everything else lands here.
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Any other domain pointed at this worker (old or spare domains, www.) forwards to liero.page,
    // keeping the path, so old links and invites keep working.
    if (url.hostname !== 'liero.page' && !/^(localhost|127\.|\[::1\])|\.workers\.dev$/.test(url.hostname)) {
      return Response.redirect(`https://liero.page${url.pathname}${url.search}`, 301);
    }
    if (url.pathname === '/health') return Response.json({ ok: true });
    const m = url.pathname.match(/^\/(room|count)\/([\w-]{1,64})$/);
    if (m) {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[2]));
      return stub.fetch(req);
    }
    // Invite links: liero.page/r/<room> -> the guest client
    if (/^\/r\/[\w-]{1,64}\/?$/.test(url.pathname)) {
      const page = await env.ASSETS.fetch(new URL('/play', url));
      return new Response(page.body, { status: 200, headers: page.headers });
    }
    return env.ASSETS.fetch(req);
  },
};

export class Room {
  private core: RoomCore;

  constructor(private state: DurableObjectState) {
    this.core = new RoomCore(state.id.toString());
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/count/')) {
      return Response.json({ players: this.core.playerCount }, { headers: { 'access-control-allow-origin': '*' } });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    // Standard (non-hibernating) accept: the room ticks at 60 Hz while anyone is connected anyway.
    server.accept();
    const conn: Conn = {
      send: (d) => { try { server.send(d); } catch { /* socket closed */ } },
      close: (code, reason) => { try { server.close(code, reason); } catch { /* already closed */ } },
    };
    this.core.connect(conn);
    server.addEventListener('message', (ev) => { void this.core.message(conn, ev.data as string | ArrayBuffer); });
    server.addEventListener('close', () => this.core.disconnect(conn));
    server.addEventListener('error', () => this.core.disconnect(conn));
    return new Response(null, { status: 101, webSocket: client });
  }
}
