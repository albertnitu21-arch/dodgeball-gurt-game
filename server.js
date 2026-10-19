'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const sim = require('./sim');

const PORT = process.env.PORT || 3000;
const TICK_HZ = 30;      // simulation rate
const SEND_HZ = 20;      // state broadcast rate
const MAX_ROOM = 12;     // people allowed in one room (5 play, the rest watch)

// index.html can live in public/ or next to this file (handy when uploading through GitHub's website).
const INDEX = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')]
  .find(p => fs.existsSync(p)) || path.join(__dirname, 'public', 'index.html');

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, buf) => {
      if (err) { res.writeHead(500); res.end('Missing public/index.html'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found');
});

const wss = new WebSocketServer({ server, maxPayload: 4096, perMessageDeflate: { threshold: 256 } });
const rooms = new Map(); // code -> { code, clients: Map<id, client>, st }

const cleanName = s => {
  s = typeof s === 'string' ? s : '';
  s = s.replace(/[^\p{L}\p{N} ._'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  return s || 'Player';
};
const cleanCode = s => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'gym';
const num = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : d;

function leaveRoom(c) {
  if (!c.room) return;
  const r = rooms.get(c.room);
  c.room = null;
  if (!r) return;
  r.clients.delete(c.id);
  if (!r.clients.size) rooms.delete(r.code);
}

function joinRoom(c, code) {
  leaveRoom(c);
  let r = rooms.get(code);
  if (!r) { r = { code, clients: new Map(), st: sim.newState() }; rooms.set(code, r); }
  if (r.clients.size >= MAX_ROOM) { send(c.ws, { type: 'full', room: code }); return; }
  r.clients.set(c.id, c);
  c.room = code;
  c.joined = Date.now();
  // Forget old baselines; the next tick takes this client's current counters as the new baseline,
  // so an old "start" or "throw" never replays in the new room.
  delete r.st.lastT[c.id]; delete r.st.lastSr[c.id]; delete r.st.lastEr[c.id];
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

wss.on('connection', ws => {
  const c = { id: crypto.randomBytes(6).toString('hex'), ws, room: null, joined: Date.now(), alive: true,
    st: { nm: 'Player', x: sim.W / 2, y: sim.H / 2, d: 0, a: 0, t: 0, sr: 0, er: 0, bo: 1 } };
  send(ws, { type: 'hello', id: c.id });
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.type === 'st' || m.type === 'join') {
      const s = c.st;
      s.nm = cleanName(m.nm);
      s.x = num(m.x, s.x, 0, sim.W); s.y = num(m.y, s.y, 0, sim.H);
      s.d = m.d ? 1 : 0; s.a = num(m.a, 0, -10, 10);
      s.t = num(m.t, s.t, 0, 1e9); s.sr = num(m.sr, s.sr, 0, 1e9); s.er = num(m.er, s.er, 0, 1e9);
      s.bo = m.bo ? 1 : 0;
      if (m.type === 'join') joinRoom(c, cleanCode(m.room));
    }
  });
  ws.on('close', () => leaveRoom(c));
  ws.on('error', () => {});
});

// Drop connections that stopped answering pings.
setInterval(() => {
  for (const r of rooms.values()) for (const c of r.clients.values()) {
    if (!c.alive) { try { c.ws.terminate(); } catch (e) {} leaveRoom(c); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch (e) {}
  }
}, 20000);

let last = Date.now(), sendAcc = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  sendAcc += dt;
  const doSend = sendAcc >= 1 / SEND_HZ;
  if (doSend) sendAcc = 0;
  for (const r of rooms.values()) {
    const hs = [...r.clients.values()].map(c => ({ id: c.id, joined: c.joined, ...c.st }));
    try { sim.tick(r.st, hs, dt); } catch (e) { console.error('tick failed in room', r.code, e); r.st = sim.newState(); }
    if (!doSend) continue;
    const msg = JSON.stringify({
      type: 's', room: r.code, g: sim.serialize(r.st),
      p: hs.map(h => [h.id, h.nm, Math.round(h.x), Math.round(h.y), Math.round(h.a * 100) / 100, h.d]),
    });
    for (const c of r.clients.values()) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log('Midnight Dodgeball listening on port ' + PORT));
