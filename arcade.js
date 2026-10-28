// =====================================================================
// arcade.js — the arcade cabinet on the back wall, playing Peak Hop
// Peak Hop: hop from cube to cube and light them all up. A cube sinks after you hop off it,
// so every map is a little path puzzle. No enemies and no clock: take your time.
// =====================================================================
import * as THREE from 'three';
import { ref, set, update, onValue, runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, scene, ROOM, std, colorIndex, RAINBOW_CSS } from './core.js';
import { sfx } from './sounds.js';
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) { console.warn('Arcade sound', e); } }

export const ARCADE_NAME = 'Peak Hop';
const RUN_LEVELS = 10;
const liveRef = ref(db, 'room/arcade/live');

// ---------- Making the maps ----------
// The four hops, as they look on the screen: ↖ ↗ ↙ ↘
const DIRS = [[-1, 0], [0, -1], [0, 1], [1, 0]];
const K = (x, y) => x + ',' + y;
function seeded(seed) { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function hashText(t) { let h = 7; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) % 2147483647; return h; }
function levelRules(L) {   // bigger maps and new kinds of cubes as the levels go up
  return { n: 7 + L * 2, doubles: L >= 3 ? Math.floor((L - 1) / 2) : 0, springs: L >= 5 ? (L >= 8 ? 2 : 1) : 0, pads: L >= 7 ? 1 : 0 };
}
const DAILY_RULES = { n: 26, doubles: 3, springs: 2, pads: 1 };
// Every map is made by first walking a hidden path that lights every cube, so there is always a way through.
function genLevel(seed, rules) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const r = seeded(seed * 13 + attempt * 7919 + 1);
    const side = Math.ceil(Math.sqrt(rules.n * 1.5));
    const inB = (x, y) => x >= 0 && y >= 0 && x < side && y < side;
    const cells = new Map();
    const nbr = (x, y) => DIRS.reduce((n, [dx, dy]) => n + (cells.has(K(x + dx, y + dy)) ? 1 : 0), 0);
    let cx = Math.floor(r() * side), cy = Math.floor(r() * side);
    const start = [cx, cy];
    cells.set(K(cx, cy), { x: cx, y: cy, t: 'c', need: 1 });
    let targets = 1, dbl = rules.doubles, spr = rules.springs, pads = rules.pads, sol = '';
    while (targets < rules.n) {
      const opts = [];
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d], nx = cx + dx, ny = cy + dy;
        if (!inB(nx, ny)) continue;
        const c = cells.get(K(nx, ny));
        if (!c) {
          opts.push({ d, kind: 'step', x: nx, y: ny, w: 1 + nbr(nx, ny) * 1.5 });
          if (spr && targets > 2 && inB(nx + dx, ny + dy) && !cells.has(K(nx + dx, ny + dy))) opts.push({ d, kind: 'spring', sx: nx, sy: ny, x: nx + dx, y: ny + dy, w: 0.8 });
          if (pads && targets > 3) {
            for (let tries = 0; tries < 12; tries++) {
              const bx = Math.floor(r() * side), by = Math.floor(r() * side);
              if (cells.has(K(bx, by)) || Math.abs(bx - nx) + Math.abs(by - ny) < 3) continue;
              opts.push({ d, kind: 'pad', ax: nx, ay: ny, x: bx, y: by, w: 0.6 });
              break;
            }
          }
        } else if (c.t === 'c' && c.need === 1 && dbl && targets > 2) {
          opts.push({ d, kind: 'double', x: nx, y: ny, w: 0.7 });
        }
      }
      if (!opts.length) break;
      let pick = r() * opts.reduce((s, o) => s + o.w, 0), o = opts[0];
      for (const q of opts) { pick -= q.w; if (pick <= 0) { o = q; break; } }
      if (o.kind === 'step') { cells.set(K(o.x, o.y), { x: o.x, y: o.y, t: 'c', need: 1 }); targets++; }
      else if (o.kind === 'spring') { cells.set(K(o.sx, o.sy), { x: o.sx, y: o.sy, t: 's' }); cells.set(K(o.x, o.y), { x: o.x, y: o.y, t: 'c', need: 1 }); spr--; targets++; }
      else if (o.kind === 'pad') { cells.set(K(o.ax, o.ay), { x: o.ax, y: o.ay, t: 'p', link: K(o.x, o.y) }); cells.set(K(o.x, o.y), { x: o.x, y: o.y, t: 'p', link: K(o.ax, o.ay) }); pads--; }
      else { cells.get(K(o.x, o.y)).need = 2; dbl--; }
      sol += o.d;
      cx = o.x; cy = o.y;
    }
    if (targets >= rules.n) return { cells, start, sol, targets };
  }
  return null;
}

// ---------- Playing a map (the same steps run on everyone's screen) ----------
function newGame(level) {
  const g = { level, x: level.start[0], y: level.start[1], rem: new Map(), sunk: new Set(), moves: '' };
  for (const [k, c] of level.cells) if (c.t === 'c') g.rem.set(k, c.need);
  const k0 = K(g.x, g.y);
  g.rem.set(k0, g.rem.get(k0) - 1);
  return g;
}
function landing(g, d) {   // where a hop would end up, or null if you can't hop that way
  const [dx, dy] = DIRS[d];
  let x = g.x + dx, y = g.y + dy;
  let c = g.level.cells.get(K(x, y));
  if (!c || g.sunk.has(K(x, y))) return null;
  const hops = [[x, y, c.t]];
  if (c.t === 's') {   // a spring bounces you one more cube along
    x += dx; y += dy;
    c = g.level.cells.get(K(x, y));
    if (!c || g.sunk.has(K(x, y)) || c.t === 's') return null;
    hops.push([x, y, c.t]);
  }
  if (c.t === 'c' && g.rem.get(K(x, y)) <= 0) return null;
  if (c.t === 'p') { [x, y] = c.link.split(',').map(Number); hops.push([x, y, 'p']); }   // whoosh to the other pad
  return { x, y, hops };
}
function doMove(g, d) {
  const L = landing(g, d);
  if (!L) return null;
  const k = K(g.x, g.y), cur = g.level.cells.get(k);
  if (cur.t === 'c' && g.rem.get(k) <= 0) { g.sunk.add(k); L.sank = k; }
  g.x = L.x; g.y = L.y;
  const nk = K(L.x, L.y);
  if (g.level.cells.get(nk).t === 'c') g.rem.set(nk, g.rem.get(nk) - 1);
  g.moves += d;
  return L;
}
function cleared(g) { for (const v of g.rem.values()) if (v > 0) return false; return true; }
function stuck(g) { return !cleared(g) && [0, 1, 2, 3].every(d => !landing(g, d)); }
function replay(level, moves) { const g = newGame(level); for (const ch of moves) doMove(g, +ch); return g; }
function levelScore(targets, undos, restarts) {
  const base = 50 + 10 * targets;
  let s = Math.max(Math.round(base * 0.25), base - 5 * undos - 15 * restarts);
  if (!undos && !restarts) s += 50;   // perfect: no undo, no restart
  return s;
}

// ---------- Shared state ----------
let live = {};          // room/arcade/live: who's playing and every hop of their current map
let scores = {};        // room/arcade/scores: best run per name
let daily = {};         // room/arcade/daily/<today>: best daily result per name
let dailyDay = '';
let mine = false;       // I'm at the cabinet
let game = null, gameKey = '', levelCache = { key: '', level: null };
const keyOf = name => String(name || '?').replace(/[.#$\[\]\/]/g, '_').slice(0, 20) || '?';
function dayKey() { return new Date(serverNow()).toISOString().slice(0, 10); }   // the same day for everyone, wherever they are
function occupant() { const u = live && live.user; return u && S.presence[u] ? u : ''; }
export function arcadeOccupant() { return occupant(); }
function levelFor(l) {
  const key = l.mode + '|' + l.seed + '|' + l.level;
  if (levelCache.key !== key) levelCache = { key, level: genLevel(l.mode === 'daily' ? l.seed : l.seed + l.level * 1000, l.mode === 'daily' ? DAILY_RULES : levelRules(l.level)) };
  return levelCache.level;
}
function banner(text, secs) { if (hooks.banner) hooks.banner(text, secs); }

// ---------- The cabinet ----------
export const arcadeGroup = new THREE.Group();
scene.add(arcadeGroup);
const AX = 2.6, AZ = -ROOM / 2 + 0.38;     // back wall, right side
const SCREEN_Y = 1.42, SCREEN_W = 0.6, SCREEN_H = 0.5;
const CW = 576, CH = 480;                   // the screen's pixels
const scr = document.createElement('canvas');
scr.width = CW; scr.height = CH;
const sg = scr.getContext('2d');
const scrTex = new THREE.CanvasTexture(scr);
scrTex.colorSpace = THREE.SRGBColorSpace;
let marqueeMat = null;
const sideGlow = [];
(function cabinet() {
  const g = arcadeGroup;
  g.position.set(AX, 0, AZ);
  const body = std(0x1d1640, 0.5, { metalness: 0.2 });
  const dark = std(0x0d0b14, 0.6);
  const add = (geo, mat, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(0.76, 0.9, 0.62), body, 0, 0.45, 0);                         // lower cabinet
  add(new THREE.BoxGeometry(0.62, 0.3, 0.01), dark, 0, 0.45, 0.311);                      // coin door
  add(new THREE.BoxGeometry(0.06, 0.1, 0.012), std(0xffc94a, 0.3, { metalness: 0.8 }), -0.1, 0.5, 0.318);   // coin slots
  add(new THREE.BoxGeometry(0.06, 0.1, 0.012), std(0xffc94a, 0.3, { metalness: 0.8 }), 0.1, 0.5, 0.318);
  add(new THREE.BoxGeometry(0.8, 0.08, 0.34), std(0x2a2160, 0.5), 0, 0.97, 0.2, -0.25);   // control panel
  add(new THREE.BoxGeometry(0.76, 0.84, 0.44), body, 0, 1.43, -0.1);                      // upper cabinet
  add(new THREE.BoxGeometry(0.68, 0.58, 0.02), dark, 0, SCREEN_Y, 0.125);                 // screen bezel
  const screen = add(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }), 0, SCREEN_Y, 0.137);
  screen.castShadow = false;
  screen.userData.arcadeScreen = true;
  // Joystick and two buttons
  const stick = add(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 8), std(0x222222, 0.4), -0.16, 1.05, 0.2);
  stick.rotation.x = -0.25;
  add(new THREE.SphereGeometry(0.025, 12, 10), std(0xe53935, 0.3), -0.16, 1.09, 0.21);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 14), std(0x43a047, 0.3), 0.08, 1.01, 0.22, -0.25);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 14), std(0x1e88e5, 0.3), 0.18, 1.0, 0.24, -0.25);
  // Lit marquee on top
  const mc = document.createElement('canvas'); mc.width = 512; mc.height = 144;
  const m = mc.getContext('2d');
  const grad = m.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#2a0f5c'); grad.addColorStop(0.5, '#5a1a8c'); grad.addColorStop(1, '#2a0f5c');
  m.fillStyle = grad; m.fillRect(0, 0, 512, 144);
  m.strokeStyle = '#7af0ff'; m.lineWidth = 6; m.strokeRect(6, 6, 500, 132);
  m.textAlign = 'center'; m.textBaseline = 'middle';
  m.font = 'bold 74px Georgia';
  m.shadowColor = '#ff4fd8'; m.shadowBlur = 22;
  m.fillStyle = '#ffe36b'; m.fillText('PEAK HOP', 256, 78);
  m.shadowBlur = 0; m.lineWidth = 2; m.strokeStyle = '#ff4fd8'; m.strokeText('PEAK HOP', 256, 78);
  const mTex = new THREE.CanvasTexture(mc); mTex.colorSpace = THREE.SRGBColorSpace;
  add(new THREE.BoxGeometry(0.8, 0.24, 0.48), dark, 0, 1.97, -0.08);
  marqueeMat = new THREE.MeshBasicMaterial({ map: mTex, toneMapped: false });
  add(new THREE.PlaneGeometry(0.78, 0.22), marqueeMat, 0, 1.97, 0.161).castShadow = false;
  // Neon strips down the front edges of the sides
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.014, 1.95, 0.014), new THREE.MeshBasicMaterial({ color: sx < 0 ? 0xff4fd8 : 0x7af0ff, toneMapped: false }));
    strip.position.set(sx * 0.385, 1.06, 0.13);
    g.add(strip); sideGlow.push(strip);
  }
  g.traverse(o => { if (o.isMesh) o.userData.arcade = true; });
})();
export function arcadePickables() { return [arcadeGroup]; }
export function arcadeStandSpot() { return { x: AX, z: AZ + 0.95 }; }
// Where you stand to play (the room moves the camera there); aimed a bit low so the screen sits above the buttons
export function arcadeViewPose(aspect) {
  const halfH = Math.tan(Math.PI / 6);
  const dist = Math.max(0.85, Math.min(1.6, 0.72 / 2 / (halfH * Math.max(0.3, aspect))));
  const target = new THREE.Vector3(AX, SCREEN_Y - 0.15, AZ + 0.14);
  const pos = new THREE.Vector3(AX, SCREEN_Y - 0.1, AZ + 0.14 + dist);
  return { pos, target };
}

// ---------- Drawing the screen ----------
const anim = { segs: null, t: 0, sinking: [] };   // the hop in progress, and cubes sinking away
let dirty = true, lastIdleFlip = 0, idlePage = 0;
const FONT = '"Courier New", monospace';
function layout(level) {   // fit the map onto the screen
  let minD = 99, maxD = -99, minS = 99, maxS = -99;
  for (const c of level.cells.values()) { const d = c.x - c.y, s = c.x + c.y; minD = Math.min(minD, d); maxD = Math.max(maxD, d); minS = Math.min(minS, s); maxS = Math.max(maxS, s); }
  const top = 54, bottom = CH - 40;
  const a = Math.min(46, (CW - 40) / (maxD - minD + 2), (bottom - top) / (maxS - minS + 2.4));
  const ox = CW / 2 - (minD + maxD) / 2 * a;
  const contentH = (maxS - minS) * a + a * 2.4;
  const oy = top + (bottom - top - contentH) / 2 + a / 2 - (minS - maxS / 2) * a;
  return { a, ox, oy, maxS };
}
function cubeTop(L, x, y) { return { x: L.ox + (x - y) * L.a, y: L.oy + (x + y - L.maxS / 2) * L.a }; }
function drawCube(L, c, rem, color, dy = 0, alpha = 1) {
  const a = L.a, p = cubeTop(L, c.x, c.y), cx = p.x, cy = p.y + dy, D = a * 0.9;
  sg.globalAlpha = alpha;
  const poly = (pts, fill) => { sg.beginPath(); sg.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) sg.lineTo(q[0], q[1]); sg.closePath(); sg.fillStyle = fill; sg.fill(); };
  const side = c.t === 's' ? ['#8a4b12', '#5e320a'] : c.t === 'p' ? ['#1b5a63', '#103a40'] : ['#3d3a78', '#2a2756'];
  poly([[cx - a, cy], [cx, cy + a / 2], [cx, cy + a / 2 + D], [cx - a, cy + D]], side[0]);
  poly([[cx + a, cy], [cx, cy + a / 2], [cx, cy + a / 2 + D], [cx + a, cy + D]], side[1]);
  const topPts = [[cx, cy - a / 2], [cx + a, cy], [cx, cy + a / 2], [cx - a, cy]];
  if (c.t === 's') {
    poly(topPts, '#ff9f2e');
    sg.strokeStyle = '#5e320a'; sg.lineWidth = Math.max(2, a * 0.08); sg.beginPath();
    for (let i = 0; i <= 6; i++) sg.lineTo(cx - a * 0.45 + i * a * 0.15, cy + (i % 2 ? -a * 0.14 : a * 0.14));
    sg.stroke();
  } else if (c.t === 'p') {
    poly(topPts, '#1f8a96');
    const glow = fancy ? 0.6 + 0.4 * Math.sin(performance.now() / 250) : 0.85;
    sg.strokeStyle = `rgba(150,250,255,${glow})`; sg.lineWidth = Math.max(2, a * 0.09);
    sg.beginPath(); sg.ellipse(cx, cy, a * 0.5, a * 0.25, 0, 0, Math.PI * 2); sg.stroke();
  } else {
    const lit = rem <= 0, half = c.need === 2 && rem === 1;
    poly(topPts, lit ? color : c.need === 2 ? '#b8a6ff' : '#8f9bd0');
    if (c.need === 2 && !lit) {   // a double cube: the middle lights up after your first hop
      const s = 0.45;
      poly([[cx, cy - a / 2 * s], [cx + a * s, cy], [cx, cy + a / 2 * s], [cx - a * s, cy]], half ? color : '#ffffff');
    }
    sg.strokeStyle = 'rgba(0,0,0,0.25)'; sg.lineWidth = 1.5;
    sg.beginPath(); sg.moveTo(topPts[0][0], topPts[0][1]); for (const q of topPts.slice(1)) sg.lineTo(q[0], q[1]); sg.closePath(); sg.stroke();
  }
  sg.globalAlpha = 1;
}
function drawHopper(x, y, a, color, face) {
  const r = a * 0.42;
  sg.fillStyle = 'rgba(0,0,0,0.3)';
  sg.beginPath(); sg.ellipse(x, y + r * 0.95, r * 0.9, r * 0.32, 0, 0, Math.PI * 2); sg.fill();
  sg.fillStyle = '#222';
  for (const s of [-1, 1]) { sg.beginPath(); sg.ellipse(x + s * r * 0.45, y + r * 0.9, r * 0.32, r * 0.18, 0, 0, Math.PI * 2); sg.fill(); }   // feet
  sg.fillStyle = color; sg.strokeStyle = 'rgba(0,0,0,0.6)'; sg.lineWidth = Math.max(1.5, a * 0.06);
  sg.beginPath(); sg.arc(x, y, r, 0, Math.PI * 2); sg.fill(); sg.stroke();
  sg.fillStyle = 'rgba(255,255,255,0.35)';
  sg.beginPath(); sg.arc(x - r * 0.35, y - r * 0.4, r * 0.28, 0, Math.PI * 2); sg.fill();
  const lx = face[0] * r * 0.18, ly = face[1] * r * 0.12;
  for (const s of [-1, 1]) {   // eyes looking the way you last hopped
    sg.fillStyle = '#fff'; sg.beginPath(); sg.arc(x + s * r * 0.32, y - r * 0.08, r * 0.24, 0, Math.PI * 2); sg.fill();
    sg.fillStyle = '#111'; sg.beginPath(); sg.arc(x + s * r * 0.32 + lx, y - r * 0.08 + ly, r * 0.11, 0, Math.PI * 2); sg.fill();
  }
}
let fancy = false;   // glow effects only while you're standing at the cabinet; lighter from across the room
function neonText(text, x, y, size, color, align = 'center') {
  sg.font = `bold ${size}px ${FONT}`; sg.textAlign = align; sg.textBaseline = 'middle';
  if (fancy) { sg.shadowColor = color; sg.shadowBlur = 12; }
  sg.fillStyle = color; sg.fillText(text, x, y);
  sg.shadowBlur = 0;
}
function background() {
  const grad = sg.createLinearGradient(0, 0, 0, CH);
  grad.addColorStop(0, '#0a0620'); grad.addColorStop(1, '#1a0a33');
  sg.fillStyle = grad; sg.fillRect(0, 0, CW, CH);
  sg.fillStyle = 'rgba(255,255,255,0.5)';
  for (const [x, y] of STARS) sg.fillRect(x * CW, y * CH, 1.5, 1.5);
}
const STARS = Array.from({ length: 40 }, () => [Math.random(), Math.random()]);
let face = [1, 1];
function drawGame() {
  const g = game, l = live, L = layout(g.level);
  const color = RAINBOW_CSS[colorIndex(l)];
  background();
  const order = [...g.level.cells.values()].sort((p, q) => (p.x + p.y) - (q.x + q.y) || p.x - q.x);
  const sinkNow = new Map(anim.sinking.map(s => [s.k, s]));
  // where the hopper is right now (mid-hop or standing)
  let hx, hy, hidden = false;
  if (anim.segs) {
    const segDur = 0.17, i = Math.min(anim.segs.length - 1, Math.floor(anim.t / segDur)), u = Math.min(1, anim.t / segDur - i);
    const s = anim.segs[i];
    const p0 = cubeTop(L, s.from[0], s.from[1]), p1 = cubeTop(L, s.to[0], s.to[1]);
    if (s.tele) { const q = u < 0.5 ? p0 : p1; hx = q.x; hy = q.y - L.a * 0.35; hidden = Math.abs(u - 0.5) < 0.25; }
    else { hx = p0.x + (p1.x - p0.x) * u; hy = p0.y + (p1.y - p0.y) * u - L.a * 0.35 - Math.sin(u * Math.PI) * L.a * (s.spring ? 1.3 : 0.7); }
  } else { const p = cubeTop(L, g.x, g.y); hx = p.x; hy = p.y - L.a * 0.35; }
  for (const c of order) {
    const k = K(c.x, c.y);
    const sk = sinkNow.get(k);
    if (sk) { const u = Math.min(1, sk.t / 0.4); drawCube(L, c, 0, color, u * u * L.a * 2.5, 1 - u); continue; }
    if (g.sunk.has(k)) continue;
    drawCube(L, c, c.t === 'c' ? g.rem.get(k) : 0, color);
  }
  if (!hidden) drawHopper(hx, hy, L.a, color, face);
  // Top line: level and score, or the daily map
  if (l.mode === 'daily') {
    neonText('DAILY MAP', 16, 24, 22, '#7af0ff', 'left');
    neonText(`UNDO ${l.undos || 0}`, CW - 16, 24, 22, '#ffe36b', 'right');
  } else {
    neonText(`LEVEL ${l.level}/${RUN_LEVELS}`, 16, 24, 22, '#7af0ff', 'left');
    neonText(`SCORE ${l.score || 0}`, CW - 16, 24, 22, '#ffe36b', 'right');
  }
  neonText(l.name || '', CW / 2, 24, 18, color);
  // Bottom line
  let msg = '', mcol = '#ffffff';
  if (l.phase === 'clear') { msg = `CLEAR!  +${l.gain || 0}`; mcol = '#7dff8a'; }
  else if (l.phase === 'done') { msg = l.mode === 'daily' ? `DAILY DONE · ${l.undos || 0} UNDO${l.undos === 1 ? '' : 'S'}` : `RUN COMPLETE · ${l.score || 0}`; mcol = '#ffe36b'; }
  else if (!anim.segs && stuck(g)) { msg = 'STUCK! UNDO OR RESTART'; mcol = '#ff7a7a'; }
  else { let left = 0; for (const v of g.rem.values()) left += v; msg = `${left} TO GO`; mcol = 'rgba(255,255,255,0.7)'; }
  neonText(msg, CW / 2, CH - 20, msg.endsWith('TO GO') ? 18 : 26, mcol);
}
function topList(obj, better, fmt, title, y0) {
  const rows = Object.values(obj || {}).filter(r => r && r.name).sort(better).slice(0, 7);
  neonText(title, CW / 2, y0, 24, '#7af0ff');
  if (!rows.length) { neonText('NO SCORES YET', CW / 2, y0 + 50, 18, 'rgba(255,255,255,0.6)'); return; }
  rows.forEach((r, i) => {
    const y = y0 + 42 + i * 34, col = RAINBOW_CSS[colorIndex(r)];
    neonText(`${i + 1}.`, 130, y, 20, '#ffffff', 'right');
    neonText(String(r.name).toUpperCase().slice(0, 12), 150, y, 20, col, 'left');
    neonText(fmt(r), CW - 110, y, 20, '#ffe36b', 'right');
  });
}
function drawIdle() {
  background();
  neonText('PEAK HOP', CW / 2, 46, 52, '#ff4fd8');
  if (idlePage === 0) topList(scores, (p, q) => q.score - p.score, r => String(r.score), 'HIGH SCORES', 110);
  else topList(daily, (p, q) => p.undos - q.undos || p.secs - q.secs, r => `${r.undos} UNDO`, "TODAY'S DAILY", 110);
  const blink = !fancy || Math.floor(performance.now() / 600) % 2 === 0;
  const who = occupant();
  if (who && live.name) neonText(`${String(live.name).toUpperCase()} IS PICKING A GAME`, CW / 2, CH - 26, 18, '#ffffff');
  else if (blink) neonText('CLICK THE CABINET TO PLAY', CW / 2, CH - 26, 20, '#ffffff');
}
function drawScreen() {
  fancy = !!S.atArcade;
  if (game && occupant() && live.mode) drawGame(); else drawIdle();
  scrTex.needsUpdate = true;
}

// ---------- Applying the shared state ----------
function syncGame(animate) {
  if (!occupant() || !live.mode) { game = null; gameKey = ''; dirty = true; return; }
  const level = levelFor(live);
  if (!level) return;
  const key = levelCache.key;
  const moves = live.moves || '';
  if (game && gameKey === key && moves === game.moves) return;
  if (animate && game && gameKey === key && moves.length === game.moves.length + 1 && moves.startsWith(game.moves)) {
    playMove(+moves[moves.length - 1]);
  } else {
    game = replay(level, moves);
    gameKey = key;
    anim.segs = null; anim.sinking = [];
  }
  dirty = true;
}
function playMove(d) {   // hop on the screen, with sounds for whoever is watching closely
  const from = [game.x, game.y];
  const L = doMove(game, d);
  if (!L) return null;
  face = [DIRS[d][0] - DIRS[d][1], DIRS[d][0] + DIRS[d][1]];
  const segs = [];
  let prev = from;
  L.hops.forEach((h, i) => {
    const tele = i > 0 && L.hops[i - 1][2] === 'p' && h[2] === 'p';
    segs.push({ from: prev, to: [h[0], h[1]], spring: i > 0 && L.hops[i - 1][2] === 's', tele });
    prev = [h[0], h[1]];
  });
  anim.segs = segs; anim.t = 0;
  if (L.sank) anim.sinking.push({ k: L.sank, t: 0 });
  const near = mine || S.atArcade;
  if (near) {
    sound('hop');
    if (L.hops.some(h => h[2] === 's')) setTimeout(() => sound('clack', 0.8), 170);
    if (L.hops.some(h => h[2] === 'p')) setTimeout(() => sound('whoosh'), 170);
    setTimeout(() => sound('flip'), 170 * segs.length);
  }
  return L;
}
function applyLive(v) {
  const before = occupant();
  live = v || {};
  if (mine && live.user && live.user !== myId) { mine = false; if (hooks.arcadeKicked) hooks.arcadeKicked(); }
  syncGame(true);
  if (occupant() !== before && hooks.refreshAll) hooks.refreshAll();
  refreshArcadeUI();
}

// ---------- Playing ----------
export function arcadeEnter() {   // take the cabinet; resolves true if it's yours
  if (!S.myName) return Promise.resolve(false);
  return runTransaction(liveRef, d => {
    d = d || {};
    if (d.user && d.user !== myId && S.presence[d.user]) return;   // someone else is playing
    return { user: myId, name: S.myName, c: S.myHue, mode: '', at: serverNow() };
  }).then(r => {
    if (!r.committed) { banner(`${ARCADE_NAME} is being played by ${live.name || 'someone'}`, 2.5); return false; }
    mine = true;
    onDisconnect(liveRef).remove();
    refreshArcadeUI();
    return true;
  }).catch(e => { console.warn('Arcade enter', e); return false; });
}
export function arcadeLeave() {
  if (!mine) return;
  mine = false;
  runTransaction(liveRef, d => (d && d.user === myId ? null : undefined)).catch(() => {});
  try { onDisconnect(liveRef).cancel(); } catch (e) {}
  refreshArcadeUI();
}
function writeLive(changes) {
  Object.assign(live, changes);
  update(liveRef, changes).catch(e => console.warn('Arcade write', e));
}
let nextTimer = 0;
function startRun() {
  if (!mine) return;
  clearTimeout(nextTimer);
  writeLive({ mode: 'run', seed: Math.floor(Math.random() * 1e9), level: 1, moves: '', undos: 0, restarts: 0, score: 0, gain: 0, phase: 'play', started: serverNow() });
  syncGame(false);
  refreshArcadeUI();
}
function startDaily() {
  if (!mine) return;
  clearTimeout(nextTimer);
  const day = dayKey();
  writeLive({ mode: 'daily', seed: hashText('peakhop' + day), day, level: 1, moves: '', undos: 0, restarts: 0, score: 0, gain: 0, phase: 'play', started: serverNow() });
  syncGame(false);
  refreshArcadeUI();
}
export function arcadeHop(d) {
  if (!mine || !game || live.phase !== 'play' || anim.segs) return;
  if (!landing(game, d)) { sound('disc'); return; }
  playMove(d);
  const changes = { moves: game.moves };
  if (cleared(game)) {
    const gain = live.mode === 'daily' ? 0 : levelScore(game.level.targets, live.undos || 0, live.restarts || 0);
    Object.assign(changes, { phase: live.mode === 'daily' || live.level >= RUN_LEVELS ? 'done' : 'clear', gain, score: (live.score || 0) + gain });
    writeLive(changes);
    setTimeout(() => sound(changes.phase === 'done' ? 'win' : 'buy'), 400);
    if (live.mode === 'daily') saveDaily();
    else saveScore(changes.score);
    if (changes.phase === 'clear') nextTimer = setTimeout(() => {
      if (!mine || live.phase !== 'clear') return;
      writeLive({ level: live.level + 1, moves: '', undos: 0, restarts: 0, gain: 0, phase: 'play' });
      syncGame(false); refreshArcadeUI();
    }, 1800);
  } else {
    writeLive(changes);
    if (stuck(game)) setTimeout(() => sound('out'), 450);
  }
  refreshArcadeUI();
}
function undo() {
  if (!mine || !game || live.phase !== 'play' || !game.moves.length) return;
  writeLive({ moves: game.moves.slice(0, -1), undos: (live.undos || 0) + 1 });
  syncGame(false); sound('disc'); refreshArcadeUI();
}
function restart() {
  if (!mine || !game || live.phase !== 'play' || !game.moves.length) return;
  writeLive({ moves: '', restarts: (live.restarts || 0) + 1, undos: live.mode === 'daily' ? (live.undos || 0) + 1 : (live.undos || 0) });
  syncGame(false); sound('card'); refreshArcadeUI();
}
function saveScore(score) {
  const r = ref(db, 'room/arcade/scores/' + keyOf(S.myName));
  runTransaction(r, d => {
    if (d && d.score >= score) return;
    return { name: S.myName, c: S.myHue, score, at: serverNow() };
  }).then(t => { if (t.committed) banner(`🏆 New best: ${score}`, 2.5); }).catch(e => console.warn('Arcade score', e));
}
function saveDaily() {
  const undos = live.undos || 0, secs = Math.round((serverNow() - (live.started || serverNow())) / 1000);
  const r = ref(db, `room/arcade/daily/${live.day || dayKey()}/${keyOf(S.myName)}`);
  runTransaction(r, d => {
    if (d && (d.undos < undos || (d.undos === undos && d.secs <= secs))) return;
    return { name: S.myName, c: S.myHue, undos, secs };
  }).then(t => {
    banner(t.committed ? `📅 Daily done with ${undos} undo${undos === 1 ? '' : 's'}!` : '📅 Daily done! (your earlier try was better)', 3);
    if (undos === 0) hooks.addSys(`🕹️ ${S.myName} solved today's Peak Hop daily map without a single undo!`);
  }).catch(e => console.warn('Arcade daily', e));
}

// Tapping the screen hops toward where you tapped (up-left, up-right, down-left or down-right of your hopper)
export function arcadeTap(point) {
  if (!mine || !game || live.phase !== 'play') return;
  const u = ((point.x - AX) / SCREEN_W + 0.5) * CW, v = (0.5 - (point.y - SCREEN_Y) / SCREEN_H) * CH;
  const L = layout(game.level), p = cubeTop(L, game.x, game.y);
  const dx = u - p.x, dy = v - (p.y - L.a * 0.35);
  arcadeHop(dy < 0 ? (dx < 0 ? 0 : 1) : (dx < 0 ? 2 : 3));
}
// Keyboard: arrows (turned a quarter so ↑ hops up-right), Q W A S, or the number pad 7 9 1 3
const KEYS = { ArrowLeft: 0, ArrowUp: 1, ArrowDown: 2, ArrowRight: 3, q: 0, w: 1, a: 2, s: 3, Q: 0, W: 1, A: 2, S: 3, '7': 0, '9': 1, '1': 2, '3': 3 };
export function arcadeKey(key) {
  if (!mine) return false;
  if (key in KEYS) { arcadeHop(KEYS[key]); return true; }
  if (key === 'z' || key === 'Z' || key === 'Backspace') { undo(); return true; }
  if (key === 'r' || key === 'R') { restart(); return true; }
  return false;
}

// ---------- The bottom bar while you're at the cabinet ----------
const aInfo = document.getElementById('arcadeInfo');
const padBtns = ['aUL', 'aUR', 'aDL', 'aDR'].map((id, d) => { const b = document.getElementById(id); b.addEventListener('click', () => arcadeHop(d)); return b; });
const aUndo = document.getElementById('aUndo'), aRestart = document.getElementById('aRestart');
const aRun = document.getElementById('aRun'), aDaily = document.getElementById('aDaily');
aUndo.addEventListener('click', undo);
aRestart.addEventListener('click', restart);
aRun.addEventListener('click', startRun);
aDaily.addEventListener('click', startDaily);
export function refreshArcadeUI() {
  if (!mine) return;
  const playing = !!(game && live.mode && live.phase === 'play');
  padBtns.forEach(b => { b.disabled = !playing; });
  aUndo.disabled = aRestart.disabled = !(playing && game.moves.length);
  aRun.textContent = live.mode === 'run' && live.phase !== 'done' ? '🎲 New run' : '🎲 Run';
  if (!live.mode) aInfo.textContent = '🕹️ Pick 🎲 Run (10 levels) or 📅 Daily map';
  else if (live.mode === 'daily') aInfo.textContent = `📅 Daily map · undos ${live.undos || 0}`;
  else aInfo.textContent = `Level ${live.level}/${RUN_LEVELS} · score ${live.score || 0}${live.undos || live.restarts ? '' : ' · perfect so far'}`;
}

// ---------- Listening ----------
let dailyOff = null;
function listenDaily() {
  const day = dayKey();
  if (day === dailyDay) return;
  dailyDay = day;
  if (dailyOff) dailyOff();
  dailyOff = onValue(ref(db, 'room/arcade/daily/' + day), s => { daily = s.val() || {}; dirty = true; });
}
export function startArcade() {
  onValue(liveRef, s => applyLive(s.val()));
  onValue(ref(db, 'room/arcade/scores'), s => { scores = s.val() || {}; dirty = true; });
  listenDaily();
  setInterval(listenDaily, 60000);
}

// ---------- Every frame ----------
let idleT = 0, lastDraw = 0, wasNear = false;
export function updateArcade(dt) {
  const t = performance.now(), near = !!S.atArcade;
  let moving = false;
  if (anim.segs) {
    anim.t += dt;
    if (anim.t >= anim.segs.length * 0.17) { anim.segs = null; refreshArcadeUI(); dirty = true; }
    moving = true;
  }
  if (anim.sinking.length) {
    anim.sinking.forEach(s => { s.t += dt; });
    anim.sinking = anim.sinking.filter(s => s.t < 0.4);
    if (!anim.sinking.length) dirty = true;
    moving = true;
  }
  if (t - lastIdleFlip > 6000) { lastIdleFlip = t; idlePage = 1 - idlePage; if (!game) dirty = true; }
  if (near) {   // up close: blinking text and glowing pads
    idleT += dt;
    if (idleT > 0.3) { idleT = 0; if (!game || [...game.level.cells.values()].some(c => c.t === 'p')) dirty = true; }
  }
  if (near !== wasNear) { wasNear = near; dirty = true; }
  // hops animate smoothly up close and at a lighter rate from across the room; otherwise only redraw when something changed
  if (dirty || (moving && t - lastDraw > (near ? 0 : 66))) { dirty = false; lastDraw = t; drawScreen(); }
  // the marquee and neon strips hum a little
  const hum = 0.9 + 0.1 * Math.sin(t / 110);
  if (marqueeMat) marqueeMat.color.setScalar(hum);
  sideGlow.forEach((s, i) => s.material.color.set(i ? 0x7af0ff : 0xff4fd8).multiplyScalar(0.75 + 0.25 * Math.sin(t / 400 + i * 2)));
}