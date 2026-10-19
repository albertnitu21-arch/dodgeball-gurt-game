'use strict';
// Authoritative match simulation. One state object per room, ticked by server.js.

const W = 960, H = 600;
const TYPES = [
  { n: 'Rubber ball',  sp: 660, r: 9,  dr: 0.35, kb: 320 },
  { n: 'Bowling ball', sp: 420, r: 13, dr: 0.10, kb: 900 },
  { n: 'Beach ball',   sp: 450, r: 15, dr: 0.75, kb: 170 },
  { n: 'Watermelon',   sp: 560, r: 12, dr: 0.30, kb: 320 },
  { n: 'Boomerang',    sp: 620, r: 10, dr: 0.08, kb: 320 },
  { n: 'Chicken',      sp: 540, r: 11, dr: 0.40, kb: 280 },
  { n: 'Ghost ball',   sp: 480, r: 8,  dr: 0.22, kb: 220 },
];
const WEIGHTS = [34, 12, 15, 13, 13, 13];
const BOT_NAMES = ['Gerald', 'Brenda', 'Big Steve', 'Coach Dale', 'Mitch'];
const GHOST_CD = 7;
const MAX_PLAYERS = 5;

const rad = s => s >= 3 ? 24 : s === 2 ? 19 : 14;
const speedFor = s => s <= 0 ? 250 : 215 + (3 - s) * 30;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a, b) => a + Math.random() * (b - a);

function wetAt(list, x, y) {
  for (const w of list) { const dx = w.x - x, dy = w.y - y; if (dx * dx + dy * dy < 26 * 26) return true; }
  return false;
}

function mkPlayer(id, nm, bot, c) {
  return { id, nm, bot, c, s: 3, w: 0, hd: -1, cd: 0, x: W / 2, y: H / 2, vx: 0, vy: 0, kx: 0, ky: 0,
    dashT: 0, dashCd: 0, ddx: 1, ddy: 0, hitT: 0, aim: 0, dashing: 0, ai: { t: 0 } };
}

function newState() {
  return { ph: 'lobby', tl: 0, rd: 0, pl: [], balls: [], ev: [], evId: 0, fx: 0, fxT: 0, lastFx: 0,
    wet: [], jan: null, nextFx: 12, spawnCd: 1, ballId: 1, lastT: {}, lastSr: {}, lastEr: {}, bots: true };
}

function pushEv(st, arr) { st.evId++; arr.unshift(st.evId); st.ev.push(arr); if (st.ev.length > 10) st.ev.shift(); }

function startRound(st, hs) {
  const humans = hs.slice().sort((a, b) => a.joined - b.joined).slice(0, MAX_PLAYERS);
  const wins = new Map(st.pl.map(p => [p.id, p.w]));
  let botCount = st.bots ? MAX_PLAYERS - humans.length : 0;
  if (humans.length + botCount < 2) botCount = 2 - humans.length;
  const pl = [];
  humans.forEach(h => pl.push(mkPlayer(h.id, h.nm, false, 0)));
  for (let i = 0; i < botCount; i++) pl.push(mkPlayer('bot' + i, BOT_NAMES[i], true, 0));
  const n = pl.length, off = Math.random() * Math.PI * 2;
  pl.forEach((p, i) => {
    p.c = i; p.w = wins.get(p.id) || 0;
    const a = off + i / n * Math.PI * 2;
    p.x = W / 2 + Math.cos(a) * 340; p.y = H / 2 + Math.sin(a) * 200;
    if (!p.bot) pushEv(st, [6, p.id, Math.round(p.x), Math.round(p.y)]);
  });
  st.pl = pl; st.balls = []; st.wet = []; st.jan = null; st.fx = 0; st.fxT = 0;
  st.nextFx = rnd(11, 14); st.spawnCd = 0.4; st.rd++;
  for (let i = 0; i < 3; i++) spawnBall(st, W / 2 + (i - 1) * 90, H / 2);
  st.ph = 'cd'; st.tl = 3;
}

function endMatch(st) {
  st.ph = 'lobby'; st.tl = 0; st.balls = []; st.wet = []; st.jan = null; st.fx = 0;
  for (const p of st.pl) { p.s = 3; p.hd = -1; }
}

function pickType() {
  let r = Math.random() * WEIGHTS.reduce((a, b) => a + b, 0);
  for (let i = 0; i < WEIGHTS.length; i++) { r -= WEIGHTS[i]; if (r <= 0) return i; }
  return 0;
}

function spawnBall(st, x, y, t) {
  if (x === undefined) {
    for (let k = 0; k < 12; k++) {
      x = rnd(60, W - 60); y = rnd(60, H - 60);
      if (st.pl.every(p => Math.hypot(p.x - x, p.y - y) > 110)) break;
    }
  }
  st.balls.push({ id: st.ballId++, t: t === undefined ? pickType() : t, x, y, vx: 0, vy: 0, live: 0, spawnT: 0.6, age: 0, own: '',
    turn: Math.random() < 0.5 ? 1 : -1, wt: 0 });
}

function dropHeld(st, p) {
  if (p.hd < 0) return;
  st.balls.push({ id: st.ballId++, t: p.hd, x: p.x, y: p.y, vx: rnd(-90, 90), vy: rnd(-90, 90), live: 0, spawnT: 0, age: 0, own: '', turn: 1, wt: 0 });
  p.hd = -1;
}

function tryThrow(st, p, a) {
  if (st.ph !== 'playing') return;
  let t;
  if (p.s > 0) { if (p.hd < 0) return; t = p.hd; p.hd = -1; }
  else { if (p.cd > 0) return; t = 6; p.cd = GHOST_CD; }
  const T = TYPES[t], r = rad(p.s) + T.r + 4;
  st.balls.push({ id: st.ballId++, t, x: clamp(p.x + Math.cos(a) * r, T.r, W - T.r), y: clamp(p.y + Math.sin(a) * r, T.r, H - T.r),
    vx: Math.cos(a) * T.sp, vy: Math.sin(a) * T.sp, live: 1, spawnT: 0, age: 0, own: p.id, turn: Math.random() < 0.5 ? 1 : -1, wt: 0 });
  p.aim = a;
}

function splat(st, x, y) {
  for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2, d = rnd(0, 34); st.wet.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, tl: 10 }); }
  pushEv(st, [3, Math.round(x), Math.round(y)]);
}

function hit(st, b, p) {
  p.s--; p.hitT = 0.7;
  const sp = Math.hypot(b.vx, b.vy) || 1, nx = b.vx / sp, ny = b.vy / sp, kb = TYPES[b.t].kb;
  pushEv(st, [1, p.id, Math.round(nx * kb), Math.round(ny * kb), Math.round(p.x), Math.round(p.y), b.t]);
  if (p.bot) { p.kx += nx * kb; p.ky += ny * kb; }
  if (p.s <= 0) { p.s = 0; dropHeld(st, p); p.cd = 3; pushEv(st, [8, p.id]); }
  if (b.t === 3) { splat(st, b.x, b.y); b.dead = 1; }
  else if (b.t === 6) { b.dead = 1; }
  else { b.vx = -nx * sp * 0.22 + rnd(-60, 60); b.vy = -ny * sp * 0.22 + rnd(-60, 60); b.live = 0; }
}

function rotate(o, ang) { const c = Math.cos(ang), s = Math.sin(ang), vx = o.vx; o.vx = vx * c - o.vy * s; o.vy = vx * s + o.vy * c; }

function stepBall(st, b, dt) {
  b.age += dt; if (b.spawnT > 0) b.spawnT -= dt;
  const T = TYPES[b.t];
  if (b.live) {
    if (b.t === 2) rotate(b, Math.sin(b.age * 6.5) * 2.2 * dt);
    if (b.t === 4) rotate(b, b.turn * 3.4 * dt);
    const f = Math.exp(-T.dr * dt); b.vx *= f; b.vy *= f;
    if (Math.hypot(b.vx, b.vy) < 220 || b.age > (b.t === 4 ? 2.2 : 3)) { if (b.t === 6) b.dead = 1; else b.live = 0; }
  } else if (b.t === 5 && b.spawnT <= 0 && st.ph === 'playing') {
    let near = null, nd = 230;
    for (const p of st.pl) { if (p.s <= 0) continue; const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < nd) { nd = d; near = p; } }
    b.wt -= dt;
    if (near) {
      const a = Math.atan2(b.y - near.y, b.x - near.x) + rnd(-0.5, 0.5), k = Math.min(1, dt * 6);
      b.vx += (Math.cos(a) * 165 - b.vx) * k; b.vy += (Math.sin(a) * 165 - b.vy) * k;
    } else if (b.wt <= 0) {
      const a = Math.random() * Math.PI * 2; b.vx = Math.cos(a) * 60; b.vy = Math.sin(a) * 60; b.wt = rnd(0.6, 1.4);
    }
  } else {
    const f = Math.exp(-3 * dt); b.vx *= f; b.vy *= f;
  }
  b.x += b.vx * dt; b.y += b.vy * dt;
  let wall = false;
  const bounce = b.t === 1 ? 0.9 : 0.78;
  if (b.x < T.r) { b.x = T.r; b.vx = Math.abs(b.vx) * bounce; wall = true; }
  if (b.x > W - T.r) { b.x = W - T.r; b.vx = -Math.abs(b.vx) * bounce; wall = true; }
  if (b.y < T.r) { b.y = T.r; b.vy = Math.abs(b.vy) * bounce; wall = true; }
  if (b.y > H - T.r) { b.y = H - T.r; b.vy = -Math.abs(b.vy) * bounce; wall = true; }
  if (wall && b.live && b.t === 3) { splat(st, b.x, b.y); b.dead = 1; }
}

function movePlayer(p, ix, iy, dt, wet, s) {
  const sp = speedFor(s);
  if (p.dashT > 0) { p.vx = p.ddx * sp * 2.7; p.vy = p.ddy * sp * 2.7; }
  else { const a = 1 - Math.exp(-(wet ? 1.3 : 14) * dt); p.vx += (ix * sp - p.vx) * a; p.vy += (iy * sp - p.vy) * a; }
  const kd = Math.exp(-(wet ? 1.1 : 4.5) * dt); p.kx *= kd; p.ky *= kd;
  p.x += (p.vx + p.kx) * dt; p.y += (p.vy + p.ky) * dt;
  const r = rad(s);
  if (p.x < r) { p.x = r; if (p.vx < 0) p.vx = 0; p.kx = Math.abs(p.kx) * 0.5; }
  if (p.x > W - r) { p.x = W - r; if (p.vx > 0) p.vx = 0; p.kx = -Math.abs(p.kx) * 0.5; }
  if (p.y < r) { p.y = r; if (p.vy < 0) p.vy = 0; p.ky = Math.abs(p.ky) * 0.5; }
  if (p.y > H - r) { p.y = H - r; if (p.vy > 0) p.vy = 0; p.ky = -Math.abs(p.ky) * 0.5; }
}

function botThink(st, p, dt) {
  const ai = p.ai; ai.t -= dt;
  if (p.dashT > 0) p.dashT -= dt;
  if (p.dashCd > 0) p.dashCd -= dt;
  let ix = 0, iy = 0;
  const enemies = st.pl.filter(q => q !== p && q.s > 0);
  const nearest = list => { let best = null, bd = 1e9; for (const q of list) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } } return best; };
  if (p.s > 0) {
    if (p.dashCd <= 0) {
      ai.dodged = ai.dodged || {};
      for (const b of st.balls) {
        if (!b.live || b.own === p.id || ai.dodged[b.id]) continue;
        const rx = p.x - b.x, ry = p.y - b.y, d = Math.hypot(rx, ry);
        if (d > 150) continue;
        const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp;
        if (rx * ux + ry * uy <= 0) continue;
        if (Math.abs(rx * uy - ry * ux) > rad(p.s) + TYPES[b.t].r + 12) continue;
        ai.dodged[b.id] = 1;
        if (Math.random() < 0.5) { const side = Math.random() < 0.5 ? 1 : -1; p.ddx = -uy * side; p.ddy = ux * side; p.dashT = 0.17; p.dashCd = 1.6; }
        break;
      }
    }
    if (p.hd >= 0) {
      const tgt = nearest(enemies);
      if (tgt) {
        const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy) || 1;
        const want = d > 330 ? 1 : d < 190 ? -1 : 0;
        ai.str = ai.str || 1;
        ix = dx / d * want - dy / d * 0.5 * ai.str; iy = dy / d * want + dx / d * 0.5 * ai.str;
        p.aim = Math.atan2(dy, dx);
        if (ai.t <= 0) {
          if (!ai.aiming) { ai.aiming = true; ai.t = rnd(0.35, 1.1); }
          else { tryThrow(st, p, Math.atan2(dy, dx) + rnd(-0.22, 0.22)); ai.aiming = false; ai.t = 0.3; ai.str = Math.random() < 0.5 ? 1 : -1; }
        }
      }
    } else {
      ai.aiming = false;
      const ball = nearest(st.balls.filter(b => !b.live && b.spawnT <= 0 && b.t !== 6));
      if (ball) { const dx = ball.x - p.x, dy = ball.y - p.y, d = Math.hypot(dx, dy) || 1; ix = dx / d; iy = dy / d; p.aim = Math.atan2(dy, dx); }
      else {
        if (!ai.wx || Math.hypot(ai.wx - p.x, ai.wy - p.y) < 30) { ai.wx = rnd(100, W - 100); ai.wy = rnd(80, H - 80); }
        const dx = ai.wx - p.x, dy = ai.wy - p.y, d = Math.hypot(dx, dy) || 1; ix = dx / d * 0.6; iy = dy / d * 0.6;
      }
    }
  } else {
    if (!ai.wx || Math.hypot(ai.wx - p.x, ai.wy - p.y) < 30) { ai.wx = rnd(60, W - 60); ai.wy = rnd(60, H - 60); }
    const dx = ai.wx - p.x, dy = ai.wy - p.y, d = Math.hypot(dx, dy) || 1; ix = dx / d * 0.5; iy = dy / d * 0.5;
    if (p.cd <= 0 && enemies.length && Math.random() < dt * 0.8) {
      const tgt = enemies[(Math.random() * enemies.length) | 0];
      tryThrow(st, p, Math.atan2(tgt.y - p.y, tgt.x - p.x) + rnd(-0.25, 0.25));
    }
  }
  const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
  movePlayer(p, ix, iy, dt, wetAt(st.wet, p.x, p.y), p.s);
}

function startFx(st) {
  let k; do { k = 1 + ((Math.random() * 3) | 0); } while (k === st.lastFx);
  st.lastFx = k;
  if (k === 1) { st.fx = 1; st.fxT = 5; }
  if (k === 2) { const dir = Math.random() < 0.5 ? 1 : -1; st.jan = { x: dir > 0 ? -30 : W + 30, y: rnd(90, H - 90), dir, drop: 0 }; }
  if (k === 3) { for (let i = 0; i < 4; i++) spawnBall(st); }
  pushEv(st, [4, k]);
}

// hs: [{id, nm, x, y, d, a, t, sr, er, bo, joined}]
function tick(st, hs, dt) {
  const byId = new Map(hs.map(h => [h.id, h]));
  for (const p of st.pl) {
    if (p.bot) continue;
    const h = byId.get(p.id);
    if (!h) { p.gone = true; continue; }
    p.x = h.x; p.y = h.y; p.dashing = h.d; p.nm = h.nm; p.aim = h.a;
  }
  for (const p of st.pl) if (p.gone) dropHeld(st, p);
  st.pl = st.pl.filter(p => !p.gone);
  for (const h of hs) {
    if (st.lastSr[h.id] === undefined) st.lastSr[h.id] = h.sr;
    if (st.lastEr[h.id] === undefined) st.lastEr[h.id] = h.er;
    if (st.lastT[h.id] === undefined) st.lastT[h.id] = h.t;
    if (h.sr > st.lastSr[h.id]) { st.lastSr[h.id] = h.sr; if (st.ph === 'lobby') { st.bots = !!h.bo; startRound(st, hs); } }
    if (h.er > st.lastEr[h.id]) { st.lastEr[h.id] = h.er; if (st.ph !== 'lobby') endMatch(st); }
    if (h.t > st.lastT[h.id]) { st.lastT[h.id] = h.t; const p = st.pl.find(q => q.id === h.id); if (p) tryThrow(st, p, h.a); }
  }
  // Nobody human left in the match: go back to the locker room.
  if (st.ph !== 'lobby' && !st.pl.some(p => !p.bot)) endMatch(st);
  if (st.ph === 'cd') { st.tl -= dt; if (st.tl <= 0) { st.ph = 'playing'; st.tl = 0; pushEv(st, [4, 0]); } }
  else if (st.ph === 'over') { st.tl -= dt; if (st.tl <= 0) startRound(st, hs); }
  if (st.ph === 'playing' || st.ph === 'over') simulate(st, dt);
}

function simulate(st, dt) {
  const playing = st.ph === 'playing';
  for (const p of st.pl) {
    if (p.hitT > 0) p.hitT -= dt;
    if (p.s === 0 && p.cd > 0) p.cd -= dt;
    if (p.bot && playing) botThink(st, p, dt);
  }
  for (const b of st.balls) stepBall(st, b, dt);
  if (playing) {
    for (const b of st.balls) {
      if (b.dead || b.live || b.spawnT > 0 || b.t === 6) continue;
      for (const p of st.pl) {
        if (p.s <= 0 || p.hd >= 0) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < rad(p.s) + TYPES[b.t].r + 6) { p.hd = b.t; b.dead = 1; break; }
      }
    }
    for (const b of st.balls) {
      if (b.dead || !b.live) continue;
      for (const p of st.pl) {
        if (p.s <= 0 || p.hitT > 0) continue;
        if (p.id === b.own && !(b.t === 4 && b.age > 0.45)) continue;
        if (p.bot ? p.dashT > 0 : p.dashing) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < rad(p.s) + TYPES[b.t].r) { hit(st, b, p); break; }
      }
    }
  }
  st.balls = st.balls.filter(b => !b.dead);
  if (playing) {
    const alive = st.pl.filter(p => p.s > 0);
    const count = st.balls.filter(b => b.t !== 6).length + st.pl.filter(p => p.hd >= 0).length;
    st.spawnCd -= dt;
    if (st.spawnCd <= 0 && count < clamp(alive.length + 2, 3, 7)) { spawnBall(st); st.spawnCd = 1.1; }
    st.nextFx -= dt;
    if (st.nextFx <= 0) { startFx(st); st.nextFx = rnd(15, 22); }
  }
  if (st.fx === 1) { st.fxT -= dt; if (st.fxT <= 0) { st.fx = 0; st.fxT = 0; } }
  if (st.jan) {
    const j = st.jan; j.x += j.dir * 115 * dt; j.drop += 115 * dt;
    if (j.drop > 20) { j.drop = 0; st.wet.push({ x: j.x - j.dir * 18, y: j.y + rnd(-10, 10), tl: 12 }); }
    if (j.x < -60 || j.x > W + 60) st.jan = null;
  }
  for (const w of st.wet) w.tl -= dt;
  st.wet = st.wet.filter(w => w.tl > 0);
  if (st.wet.length > 60) st.wet = st.wet.slice(-60);
  if (playing) {
    const alive = st.pl.filter(p => p.s > 0);
    if (alive.length <= 1) {
      st.ph = 'over'; st.tl = 4.5;
      const w = alive[0]; if (w) w.w++;
      pushEv(st, [5, w ? w.id : '']);
    }
  }
}

function serialize(st) {
  return {
    ph: st.ph, tl: Math.round(st.tl * 1000), rd: st.rd, bots: st.bots ? 1 : 0,
    pl: st.pl.map(p => [p.id, p.nm, p.c, p.s, p.w, p.hd, p.bot ? 1 : 0, Math.max(0, Math.round(p.cd * 10)), p.hitT > 0 ? 1 : 0]),
    bt: st.pl.filter(p => p.bot).map(p => [p.id, Math.round(p.x), Math.round(p.y), p.dashT > 0 ? 1 : 0, Math.round((p.aim || 0) * 100) / 100]),
    b: st.balls.map(b => [b.id, b.t, Math.round(b.x), Math.round(b.y), Math.round(b.vx), Math.round(b.vy), b.live ? 1 : 0, b.spawnT > 0 ? Math.round(b.spawnT * 100) : 0]),
    ev: st.ev.slice(),
    fx: st.fx ? [st.fx, Math.round(st.fxT * 1000)] : 0,
    wet: st.wet.map(w => [Math.round(w.x), Math.round(w.y)]),
    jan: st.jan ? [Math.round(st.jan.x), Math.round(st.jan.y), st.jan.dir] : 0,
  };
}

module.exports = { W, H, MAX_PLAYERS, newState, tick, serialize };
