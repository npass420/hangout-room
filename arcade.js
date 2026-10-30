// =====================================================================
// arcade.js — three arcade cabinets on the back wall. Each one can be set to any of three games:
//   Peak Hop: hop from cube to cube and light them all up. A cube sinks after you hop off it,
//             so every map is a little path puzzle. No enemies and no clock: take your time.
//   Bricks and Bug Invaders: quick action games (they live in arcadegames.js).
// Walk up to a cabinet and pick its game from the menu on the screen; it stays on that game for the next person.
// Each cabinet has its own player; the high scores and the daily map are shared by all three.
// =====================================================================
import * as THREE from 'three';
import { ref, set, update, onValue, runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, scene, camera, canvas, ROOM, std, colorIndex, RAINBOW_CSS } from './core.js';
import { ACT_GAMES } from './arcadegames.js';
import { sfx } from './sounds.js';
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) { console.warn('Arcade sound', e); } }

export const ARCADE_NAME = 'Arcade';
const RUN_LEVELS = 10;
const GAME_LIST = ['hop', 'bricks', 'bugs'];   // the menu, top to bottom
const TITLES = { hop: 'PEAK HOP', bricks: ACT_GAMES.bricks.title, bugs: ACT_GAMES.bugs.title };
const LABELS = { hop: '🧊 Peak Hop', bricks: ACT_GAMES.bricks.label, bugs: ACT_GAMES.bugs.label };
const isAct = mode => !!ACT_GAMES[mode];        // Bricks or Bug Invaders (not Peak Hop)
const isHop = mode => mode === 'run' || mode === 'daily';

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
let scores = {};        // room/arcade/scores: best run per name (shared by all three cabinets)
let daily = {};         // room/arcade/daily/<today>: best daily result per name (shared too)
const best = { bricks: {}, bugs: {} };   // room/arcade/best/<game>: best score per name for Bricks and Bug Invaders
let dailyDay = '';
let focus = -1;         // the cabinet you're standing at (playing or watching), or -1
const keyOf = name => String(name || '?').replace(/[.#$\[\]\/]/g, '_').slice(0, 20) || '?';
function dayKey() { return new Date(serverNow()).toISOString().slice(0, 10); }   // the same day for everyone, wherever they are
function occupant(cab) { const u = cab.live && cab.live.user; return u && S.presence[u] ? u : ''; }
export function arcadeCabOf(id) { for (const c of cabs) if (occupant(c) === id) return c.i; return -1; }   // which cabinet someone is playing, or -1
export function arcadeFocus(i) { focus = i; for (const c of cabs) c.dirty = true; }   // the room tells us which cabinet you walked up to
function levelFor(cab) {
  const l = cab.live;
  const key = l.mode + '|' + l.seed + '|' + l.level;
  if (cab.levelCache.key !== key) cab.levelCache = { key, level: genLevel(l.mode === 'daily' ? l.seed : l.seed + l.level * 1000, l.mode === 'daily' ? DAILY_RULES : levelRules(l.level)) };
  return cab.levelCache.level;
}
function banner(text, secs) { if (hooks.banner) hooks.banner(text, secs); }
function myCab() { return cabs.find(c => c.mine) || null; }

// ---------- The cabinets ----------
export const arcadeGroup = new THREE.Group();
scene.add(arcadeGroup);
const AXS = [3.95, 2.95, 1.95];             // the back wall's right corner, beside the game room door (number 1 is in the corner)
const AZ = -ROOM / 2 + 0.38;
const LIVE_PATHS = ['room/arcade/live', 'room/arcade/live2', 'room/arcade/live3'];
const BODY_COLS = [0x1d1640, 0x10343a, 0x3a1424];   // purple, teal and red cabinets
const SCREEN_Y = 1.42, SCREEN_W = 0.6, SCREEN_H = 0.5;
const CW = 576, CH = 480;                   // each screen's pixels
function makeCabinet(i) {
  const cab = {
    i, x: AXS[i], liveRef: ref(db, LIVE_PATHS[i]), live: {}, mine: false,
    pick: GAME_LIST[i], act: null, sendT: 0, lastInfo: '',   // the cabinet's game, and the Bricks or Bug Invaders game on it
    game: null, gameKey: '', levelCache: { key: '', level: null },
    anim: { segs: null, t: 0, sinking: [] }, face: [1, 1],
    dirty: true, lastDraw: 0, idleT: 0, wasNear: false, nextTimer: 0, sideGlow: [], marqueeMat: null
  };
  cab.scr = document.createElement('canvas');
  cab.scr.width = CW; cab.scr.height = CH;
  cab.sg = cab.scr.getContext('2d');
  cab.tex = new THREE.CanvasTexture(cab.scr);
  cab.tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group();
  cab.group = g;
  g.position.set(cab.x, 0, AZ);
  const body = std(BODY_COLS[i], 0.5, { metalness: 0.2 });
  const dark = std(0x0d0b14, 0.6);
  const add = (geo, mat, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(0.76, 0.9, 0.62), body, 0, 0.45, 0);                         // lower cabinet
  add(new THREE.BoxGeometry(0.62, 0.3, 0.01), dark, 0, 0.45, 0.311);                      // coin door
  add(new THREE.BoxGeometry(0.06, 0.1, 0.012), std(0xffc94a, 0.3, { metalness: 0.8 }), -0.1, 0.5, 0.318);   // coin slots
  add(new THREE.BoxGeometry(0.06, 0.1, 0.012), std(0xffc94a, 0.3, { metalness: 0.8 }), 0.1, 0.5, 0.318);
  add(new THREE.BoxGeometry(0.8, 0.08, 0.34), std(0x2a2160, 0.5), 0, 0.97, 0.2, -0.25);   // control panel
  add(new THREE.BoxGeometry(0.76, 0.84, 0.44), body, 0, 1.43, -0.1);                      // upper cabinet
  add(new THREE.BoxGeometry(0.68, 0.58, 0.02), dark, 0, SCREEN_Y, 0.125);                 // screen bezel
  const screen = add(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ map: cab.tex, toneMapped: false }), 0, SCREEN_Y, 0.137);
  screen.castShadow = false;
  screen.userData.arcadeScreen = true;
  // Joystick and two buttons
  const stick = add(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 8), std(0x222222, 0.4), -0.16, 1.05, 0.2);
  stick.rotation.x = -0.25;
  add(new THREE.SphereGeometry(0.025, 12, 10), std(0xe53935, 0.3), -0.16, 1.09, 0.21);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 14), std(0x43a047, 0.3), 0.08, 1.01, 0.22, -0.25);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 14), std(0x1e88e5, 0.3), 0.18, 1.0, 0.24, -0.25);
  // Lit marquee on top, with the game's name and the cabinet's number
  cab.mc = document.createElement('canvas'); cab.mc.width = 512; cab.mc.height = 144;
  cab.mTex = new THREE.CanvasTexture(cab.mc); cab.mTex.colorSpace = THREE.SRGBColorSpace;
  paintMarquee(cab);
  add(new THREE.BoxGeometry(0.8, 0.24, 0.48), dark, 0, 1.97, -0.08);
  cab.marqueeMat = new THREE.MeshBasicMaterial({ map: cab.mTex, toneMapped: false });
  add(new THREE.PlaneGeometry(0.78, 0.22), cab.marqueeMat, 0, 1.97, 0.161).castShadow = false;
  // Neon strips down the front edges of the sides
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.014, 1.95, 0.014), new THREE.MeshBasicMaterial({ color: sx < 0 ? 0xff4fd8 : 0x7af0ff, toneMapped: false }));
    strip.position.set(sx * 0.385, 1.06, 0.13);
    g.add(strip); cab.sideGlow.push(strip);
  }
  g.traverse(o => { if (o.isMesh) { o.userData.arcade = true; o.userData.cab = i; } });
  arcadeGroup.add(g);
  return cab;
}
// Each game has its own marquee colors: [back color, middle color, letters, glow]
const MARQUEE = { hop: ['#2a0f5c', '#5a1a8c', '#ffe36b', '#ff4fd8'], bricks: ['#0f2450', '#1a5a8c', '#ffb36b', '#ff7a3d'],
                  bugs: ['#0c3a1c', '#1a6a34', '#c8ff6b', '#3dff8a'] };
function paintMarquee(cab) {
  const m = cab.mc.getContext('2d'), [c0, c1, ink, glow] = MARQUEE[cab.pick] || MARQUEE.hop, title = TITLES[cab.pick] || TITLES.hop;
  const grad = m.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, c0); grad.addColorStop(0.5, c1); grad.addColorStop(1, c0);
  m.shadowBlur = 0;
  m.fillStyle = grad; m.fillRect(0, 0, 512, 144);
  m.strokeStyle = '#7af0ff'; m.lineWidth = 6; m.strokeRect(6, 6, 500, 132);
  m.textAlign = 'center'; m.textBaseline = 'middle';
  let size = 74;
  do { m.font = `bold ${size}px Georgia`; size -= 2; } while (m.measureText(title).width > 380 && size > 30);   // long names get smaller letters
  m.shadowColor = glow; m.shadowBlur = 22;
  m.fillStyle = ink; m.fillText(title, 240, 78);
  m.shadowBlur = 0; m.lineWidth = 2; m.strokeStyle = glow; m.strokeText(title, 240, 78);
  m.font = 'bold 40px Georgia'; m.fillStyle = '#7af0ff'; m.fillText(String(cab.i + 1), 470, 80);
  cab.mTex.needsUpdate = true;
}
const cabs = [0, 1, 2].map(makeCabinet);
export function arcadePickables() { return [arcadeGroup]; }
export function arcadeStandSpot(i) { const c = cabs[i] || cabs[0]; return { x: c.x, z: AZ + 0.95 }; }
// Where you stand to play (the room moves the camera there); aimed a bit low so the screen sits above the buttons
export function arcadeViewPose(i, aspect) {
  const c = cabs[i] || cabs[0];
  const halfH = Math.tan(Math.PI / 6);
  const dist = Math.max(0.85, Math.min(1.6, 0.72 / 2 / (halfH * Math.max(0.3, aspect))));
  const target = new THREE.Vector3(c.x, SCREEN_Y - 0.15, AZ + 0.14);
  const pos = new THREE.Vector3(c.x, SCREEN_Y - 0.1, AZ + 0.14 + dist);
  return { pos, target };
}

// ---------- Drawing a screen (C is the cabinet being drawn) ----------
let C = cabs[0], sg = C.sg;
let lastIdleFlip = 0, idleFlips = 0;
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
let fancy = false;   // glow effects only on the cabinet you're standing at; lighter from across the room
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
function drawGame() {
  const g = C.game, l = C.live, anim = C.anim, L = layout(g.level);
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
  if (!hidden) drawHopper(hx, hy, L.a, color, C.face);
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
function topList(obj, better, fmt, title, y0, n = 7) {
  const rows = Object.values(obj || {}).filter(r => r && r.name).sort(better).slice(0, n);
  neonText(title, CW / 2, y0, 24, '#7af0ff');
  if (!rows.length) { neonText('NO SCORES YET', CW / 2, y0 + 50, 18, 'rgba(255,255,255,0.6)'); return; }
  rows.forEach((r, i) => {
    const y = y0 + 42 + i * 34, col = RAINBOW_CSS[colorIndex(r)];
    neonText(`${i + 1}.`, 130, y, 20, '#ffffff', 'right');
    neonText(String(r.name).toUpperCase().slice(0, 12), 150, y, 20, col, 'left');
    neonText(fmt(r), CW - 110, y, 20, '#ffe36b', 'right');
  });
}
const byScore = (p, q) => q.score - p.score;
function scoresOf(game) { return game === 'hop' ? scores : best[game]; }
function drawIdle() {   // nobody's at this cabinet: its game's name and high scores
  background();
  const pick = C.pick;
  neonText(TITLES[pick], CW / 2, 46, pick === 'bugs' ? 44 : 52, (MARQUEE[pick] || MARQUEE.hop)[3]);
  const page = (idleFlips + C.i) % 2;   // Peak Hop screens take turns, so one shows high scores while the next shows the daily
  if (pick !== 'hop' || page === 0) topList(scoresOf(pick), byScore, r => String(r.score), 'HIGH SCORES', 110);
  else topList(daily, (p, q) => p.undos - q.undos || p.secs - q.secs, r => `${r.undos} UNDO`, "TODAY'S DAILY", 110);
  const blink = !fancy || Math.floor(performance.now() / 600) % 2 === 0;
  if (blink) neonText('CLICK THE CABINET TO PLAY', CW / 2, CH - 26, 20, '#ffffff');
}
const MENU_Y = 100, MENU_GAP = 54;
function drawMenu() {   // someone's at the cabinet picking a game
  background();
  neonText('PICK A GAME', CW / 2, 40, 32, '#7af0ff');
  GAME_LIST.forEach((g, j) => {
    const y = MENU_Y + j * MENU_GAP, on = C.pick === g;
    if (on) {
      sg.fillStyle = 'rgba(255,79,216,0.18)'; sg.fillRect(70, y - 24, CW - 140, 48);
      sg.strokeStyle = '#ff4fd8'; sg.lineWidth = 2; sg.strokeRect(70, y - 24, CW - 140, 48);
    }
    neonText((on ? '▶ ' : '') + TITLES[g], CW / 2, y, on ? 30 : 24, on ? '#ffe36b' : 'rgba(255,255,255,0.6)');
  });
  topList(scoresOf(C.pick), byScore, r => String(r.score), 'HIGH SCORES', 268, 4);
  const blink = !fancy || Math.floor(performance.now() / 600) % 2 === 0;
  if (blink) neonText(C.pick === 'hop' ? '↑ ↓ PICK · ENTER RUN · D DAILY' : '↑ ↓ PICK · ENTER TO PLAY', CW / 2, CH - 22, 18, '#ffffff');
}
function drawAct() {   // Bricks or Bug Invaders
  const l = C.live;
  ACT_GAMES[l.mode].draw(sg, C.act, { W: CW, H: CH, fancy, color: RAINBOW_CSS[colorIndex(l)], name: l.name || '',
    neon: neonText, bg: background, now: performance.now() });
}
function drawScreen(cab) {
  C = cab; sg = cab.sg;
  fancy = !!S.atArcade && focus === cab.i;
  const mode = cab.live.mode || '', here = !!occupant(cab);
  if (here && isAct(mode) && cab.act) drawAct();
  else if (here && isHop(mode) && cab.game) drawGame();
  else if (here && !mode) drawMenu();
  else drawIdle();
  cab.tex.needsUpdate = true;
}

// ---------- Applying the shared state ----------
function syncGame(cab, animate) {
  syncAct(cab);
  if (!occupant(cab) || !isHop(cab.live.mode)) { cab.game = null; cab.gameKey = ''; cab.dirty = true; return; }
  const level = levelFor(cab);
  if (!level) return;
  const key = cab.levelCache.key;
  const moves = cab.live.moves || '';
  const g = cab.game;
  if (g && cab.gameKey === key && moves === g.moves) return;
  if (animate && g && cab.gameKey === key && moves.length === g.moves.length + 1 && moves.startsWith(g.moves)) {
    playMove(cab, +moves[moves.length - 1]);
  } else {
    cab.game = replay(level, moves);
    cab.gameKey = key;
    cab.anim.segs = null; cab.anim.sinking = [];
  }
  cab.dirty = true;
}
function syncAct(cab) {   // Bricks or Bug Invaders: the player runs the game; everyone else shows the latest copy
  const mode = cab.live.mode;
  if (!occupant(cab) || !isAct(mode)) { cab.act = null; return; }
  if (cab.mine && cab.act && cab.actMode === mode) return;   // your own game: your screen is the real one
  cab.act = ACT_GAMES[mode].unpack(cab.live.snap);
  cab.actMode = mode;
  cab.dirty = true;
}
function playMove(cab, d) {   // hop on the screen, with sounds for whoever is standing at that cabinet
  const g = cab.game, from = [g.x, g.y];
  const L = doMove(g, d);
  if (!L) return null;
  cab.face = [DIRS[d][0] - DIRS[d][1], DIRS[d][0] + DIRS[d][1]];
  const segs = [];
  let prev = from;
  L.hops.forEach((h, i) => {
    const tele = i > 0 && L.hops[i - 1][2] === 'p' && h[2] === 'p';
    segs.push({ from: prev, to: [h[0], h[1]], spring: i > 0 && L.hops[i - 1][2] === 's', tele });
    prev = [h[0], h[1]];
  });
  cab.anim.segs = segs; cab.anim.t = 0;
  if (L.sank) cab.anim.sinking.push({ k: L.sank, t: 0 });
  const near = cab.mine || (S.atArcade && focus === cab.i);
  if (near) {
    sound('hop');
    if (L.hops.some(h => h[2] === 's')) setTimeout(() => sound('clack', 0.8), 170);
    if (L.hops.some(h => h[2] === 'p')) setTimeout(() => sound('whoosh'), 170);
    setTimeout(() => sound('flip'), 170 * segs.length);
  }
  return L;
}
function applyLive(cab, v) {
  const before = occupant(cab);
  cab.live = v || {};
  if (cab.mine && cab.live.user && cab.live.user !== myId) { cab.mine = false; if (hooks.arcadeKicked) hooks.arcadeKicked(); }
  syncGame(cab, true);
  if (occupant(cab) !== before && hooks.refreshAll) hooks.refreshAll();
  refreshArcadeUI();
}

// ---------- Playing ----------
export function arcadeEnter(i) {   // take a cabinet; resolves true if it's yours
  const cab = cabs[i];
  if (!S.myName || !cab) return Promise.resolve(false);
  if (myCab() && myCab() !== cab) arcadeLeave();   // you can only play one at a time
  return runTransaction(cab.liveRef, d => {
    d = d || {};
    if (d.user && d.user !== myId && S.presence[d.user]) return;   // someone else is playing
    return { user: myId, name: S.myName, c: S.myHue, mode: '', at: serverNow() };
  }).then(r => {
    if (!r.committed) return false;   // the room walks you up to watch instead
    cab.mine = true;
    onDisconnect(cab.liveRef).remove();
    refreshArcadeUI();
    return true;
  }).catch(e => { console.warn('Arcade enter', e); return false; });
}
export function arcadeLeave() {
  const cab = myCab();
  if (!cab) return;
  if (cab.act && isAct(cab.live.mode) && cab.act.ph === 'play' && cab.act.sc > 0) saveBest(cab.live.mode, cab.act.sc);   // walking away still counts your score
  cab.mine = false;
  cab.act = null;
  clearTimeout(cab.nextTimer);
  releaseInput();
  runTransaction(cab.liveRef, d => (d && d.user === myId ? null : undefined)).catch(() => {});
  try { onDisconnect(cab.liveRef).cancel(); } catch (e) {}
  refreshArcadeUI();
}
function writeLive(cab, changes) {
  Object.assign(cab.live, changes);
  update(cab.liveRef, changes).catch(e => console.warn('Arcade write', e));
}
function startRun() {
  const cab = myCab();
  if (!cab) return;
  clearTimeout(cab.nextTimer);
  if (cab.pick !== 'hop') setPick(cab, 'hop');
  writeLive(cab, { mode: 'run', seed: Math.floor(Math.random() * 1e9), level: 1, moves: '', undos: 0, restarts: 0, score: 0, gain: 0, phase: 'play', started: serverNow() });
  syncGame(cab, false);
  refreshArcadeUI();
}
function startDaily() {
  const cab = myCab();
  if (!cab) return;
  clearTimeout(cab.nextTimer);
  if (cab.pick !== 'hop') setPick(cab, 'hop');
  const day = dayKey();
  writeLive(cab, { mode: 'daily', seed: hashText('peakhop' + day), day, level: 1, moves: '', undos: 0, restarts: 0, score: 0, gain: 0, phase: 'play', started: serverNow() });
  syncGame(cab, false);
  refreshArcadeUI();
}
function startAct(game) {   // a new game of Bricks or Bug Invaders
  const cab = myCab();
  if (!cab || !isAct(game)) return;
  clearTimeout(cab.nextTimer);
  if (cab.pick !== game) setPick(cab, game);
  cab.act = ACT_GAMES[game].create();
  cab.actMode = game;
  cab.sendT = 0;
  writeLive(cab, { mode: game, phase: 'play', moves: '', score: 0, snap: ACT_GAMES[game].pack(cab.act), started: serverNow() });
  syncGame(cab, false);
  sound('buy');
  refreshArcadeUI();
}
function startPicked() {   // Enter or ▶ in the menu
  const cab = myCab();
  if (!cab) return;
  if (cab.pick === 'hop') startRun(); else startAct(cab.pick);
}
function toMenu() {   // back to the game menu (a Bricks or Bug Invaders score still counts)
  const cab = myCab();
  if (!cab || !cab.live.mode) return;
  if (cab.act && isAct(cab.live.mode) && cab.act.ph === 'play' && cab.act.sc > 0) saveBest(cab.live.mode, cab.act.sc);
  clearTimeout(cab.nextTimer);
  cab.act = null;
  writeLive(cab, { mode: '', phase: '', moves: '', snap: null });
  syncGame(cab, false);
  sound('card');
  refreshArcadeUI();
}
function setPick(cab, game) {   // change which game this cabinet is set to (everyone sees it)
  if (!GAME_LIST.includes(game) || cab.pick === game) return;
  cab.pick = game;
  set(ref(db, 'room/arcade/pick/c' + cab.i), game).catch(e => console.warn('Arcade pick', e));
  paintMarquee(cab);
  cab.dirty = true;
  refreshArcadeUI();
}
function stepPick(dir) {   // ↑ ↓ in the menu
  const cab = myCab();
  if (!cab || cab.live.mode) return;
  setPick(cab, GAME_LIST[(GAME_LIST.indexOf(cab.pick) + dir + GAME_LIST.length) % GAME_LIST.length]);
  sound('flip');
}
function saveBest(game, score) {   // a Bricks or Bug Invaders high score
  if (!isAct(game) || !(score > 0)) return;
  const top = Object.values(best[game] || {}).reduce((m, r) => Math.max(m, (r && r.score) || 0), 0);
  const r = ref(db, `room/arcade/best/${game}/${keyOf(S.myName)}`);
  runTransaction(r, d => {
    if (d && d.score >= score) return;
    return { name: S.myName, c: S.myHue, score, at: serverNow() };
  }).then(t => {
    if (!t.committed) return;
    banner(`🏆 New best: ${score}`, 2.5);
    if (score > top && hooks.addSys) hooks.addSys(`🕹️ ${S.myName} set the ${TITLES[game] === 'BRICKS' ? 'Bricks' : 'Bug Invaders'} high score: ${score}!`, S.myHue);
  }).catch(e => console.warn('Arcade best', e));
}
export function arcadeHop(d) {
  const cab = myCab();
  if (!cab) return;
  const g = cab.game, live = cab.live;
  if (!g || live.phase !== 'play' || cab.anim.segs) return;
  if (!landing(g, d)) { sound('disc'); return; }
  playMove(cab, d);
  const changes = { moves: g.moves };
  if (cleared(g)) {
    const gain = live.mode === 'daily' ? 0 : levelScore(g.level.targets, live.undos || 0, live.restarts || 0);
    Object.assign(changes, { phase: live.mode === 'daily' || live.level >= RUN_LEVELS ? 'done' : 'clear', gain, score: (live.score || 0) + gain });
    writeLive(cab, changes);
    setTimeout(() => sound(changes.phase === 'done' ? 'win' : 'buy'), 400);
    if (live.mode === 'daily') saveDaily(cab);
    else saveScore(changes.score);
    if (changes.phase === 'clear') cab.nextTimer = setTimeout(() => {
      if (!cab.mine || cab.live.phase !== 'clear') return;
      writeLive(cab, { level: cab.live.level + 1, moves: '', undos: 0, restarts: 0, gain: 0, phase: 'play' });
      syncGame(cab, false); refreshArcadeUI();
    }, 1800);
  } else {
    writeLive(cab, changes);
    if (stuck(g)) setTimeout(() => sound('out'), 450);
  }
  refreshArcadeUI();
}
function undo() {
  const cab = myCab();
  if (!cab || !cab.game || cab.live.phase !== 'play' || !cab.game.moves.length) return;
  writeLive(cab, { moves: cab.game.moves.slice(0, -1), undos: (cab.live.undos || 0) + 1 });
  syncGame(cab, false); sound('disc'); refreshArcadeUI();
}
function restart() {
  const cab = myCab();
  if (!cab || !cab.game || cab.live.phase !== 'play' || !cab.game.moves.length) return;
  const live = cab.live;
  writeLive(cab, { moves: '', restarts: (live.restarts || 0) + 1, undos: live.mode === 'daily' ? (live.undos || 0) + 1 : (live.undos || 0) });
  syncGame(cab, false); sound('card'); refreshArcadeUI();
}
function saveScore(score) {
  const r = ref(db, 'room/arcade/scores/' + keyOf(S.myName));
  runTransaction(r, d => {
    if (d && d.score >= score) return;
    return { name: S.myName, c: S.myHue, score, at: serverNow() };
  }).then(t => { if (t.committed) banner(`🏆 New best: ${score}`, 2.5); }).catch(e => console.warn('Arcade score', e));
}
function saveDaily(cab) {
  const live = cab.live;
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
// In the menu, tapping a game picks it, and tapping the picked one starts it
export function arcadeTap(point, i) {
  const cab = myCab();
  if (!cab || cab.i !== i) return;
  const u = ((point.x - cab.x) / SCREEN_W + 0.5) * CW, v = (0.5 - (point.y - SCREEN_Y) / SCREEN_H) * CH;
  if (!cab.live.mode) {
    const j = Math.round((v - MENU_Y) / MENU_GAP);
    if (j >= 0 && j < GAME_LIST.length && Math.abs(v - (MENU_Y + j * MENU_GAP)) < 27) {
      if (cab.pick === GAME_LIST[j]) startPicked(); else { setPick(cab, GAME_LIST[j]); sound('flip'); }
    }
    return;
  }
  if (isAct(cab.live.mode)) { if (cab.act && cab.act.ph === 'over') startAct(cab.live.mode); return; }   // play is by holding the screen
  if (!cab.game || cab.live.phase !== 'play') return;
  const L = layout(cab.game.level), p = cubeTop(L, cab.game.x, cab.game.y);
  const dx = u - p.x, dy = v - (p.y - L.a * 0.35);
  arcadeHop(dy < 0 ? (dx < 0 ? 0 : 1) : (dx < 0 ? 2 : 3));
}
// Keyboard: arrows (turned a quarter so ↑ hops up-right), Q W A S, or the number pad 7 9 1 3
const KEYS = { ArrowLeft: 0, ArrowUp: 1, ArrowDown: 2, ArrowRight: 3, q: 0, w: 1, a: 2, s: 3, Q: 0, W: 1, A: 2, S: 3, '7': 0, '9': 1, '1': 2, '3': 3 };
const ACT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'a', 'A', 'd', 'D', 'w', 'W']);
export function arcadeKey(key) {
  const cab = myCab();
  if (!cab) return false;
  const mode = cab.live.mode || '';
  if (!mode) {   // the menu
    if (key === 'ArrowUp' || key === 'ArrowLeft' || key === 'w' || key === 'W') { stepPick(-1); return true; }
    if (key === 'ArrowDown' || key === 'ArrowRight' || key === 's' || key === 'S') { stepPick(1); return true; }
    if (key === 'Enter' || key === ' ') { startPicked(); return true; }
    if ((key === 'd' || key === 'D') && cab.pick === 'hop') { startDaily(); return true; }
    return false;
  }
  if (key === 'm' || key === 'M') { toMenu(); return true; }
  if (isAct(mode)) {   // moving and shooting are read straight from the keys being held (see "Holding keys and buttons")
    if (key === 'Enter' && cab.act && cab.act.ph === 'over') { startAct(mode); return true; }
    return ACT_KEYS.has(key);
  }
  if (key in KEYS) { arcadeHop(KEYS[key]); return true; }
  if (key === 'z' || key === 'Z' || key === 'Backspace') { undo(); return true; }
  if (key === 'r' || key === 'R') { restart(); return true; }
  return false;
}

// ---------- The bottom bar while you're at a cabinet ----------
const aInfo = document.getElementById('arcadeInfo');
const padBtns = ['aUL', 'aUR', 'aDL', 'aDR'].map((id, d) => { const b = document.getElementById(id); b.addEventListener('click', () => arcadeHop(d)); return b; });
const aUndo = document.getElementById('aUndo'), aRestart = document.getElementById('aRestart');
const aRun = document.getElementById('aRun'), aDaily = document.getElementById('aDaily');
const aPad = document.getElementById('arcadePad'), aBtns = document.getElementById('arcadeBtns'), aBack = document.getElementById('aBack');
// New parts of the bar: the three game buttons (in the menu), the ◀ fire ▶ buttons (in Bricks and Bug Invaders), and 🎮 Games
const barStyle = document.createElement('style');
barStyle.textContent = `#aGames, #aMove { display: inline-block; vertical-align: middle; }
  #actionBar #aGames button { font-size: 15px; padding: 8px 12px; margin: 3px; background: #d9c8ff; }
  #actionBar #aGames button.on { background: #ffe36b; box-shadow: 0 0 0 3px rgba(255,255,255,0.5) inset, 0 3px 10px rgba(0,0,0,0.5); }
  #actionBar #aMove button { font-size: 24px; width: 68px; padding: 8px 0; margin: 3px; background: #7af0ff; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  #actionBar #aMove button.fire { background: #ff8a65; }
  #actionBar #aMove button.held { filter: brightness(0.8); }`;
document.head.appendChild(barStyle);
const aGames = document.createElement('div');
aGames.id = 'aGames';
const gameBtns = GAME_LIST.map(g => {
  const b = document.createElement('button');
  b.textContent = LABELS[g];
  b.addEventListener('click', () => { const cab = myCab(); if (cab && !cab.live.mode) { setPick(cab, g); sound('flip'); } b.blur(); });
  aGames.appendChild(b);
  return b;
});
const aMove = document.createElement('div');
aMove.id = 'aMove';
const btnHeld = { left: false, fire: false, right: false };
function holdButton(text, what, cls) {   // a button that counts as held down while your finger or mouse is on it
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  const on = e => { e.preventDefault(); btnHeld[what] = true; b.classList.add('held'); };
  const off = () => { btnHeld[what] = false; b.classList.remove('held'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('contextmenu', e => e.preventDefault());
  aMove.appendChild(b);
  return b;
}
holdButton('◀', 'left');
const fireBtn = holdButton('🔥', 'fire', 'fire');
holdButton('▶', 'right');
aPad.parentNode.insertBefore(aGames, aPad);
aPad.parentNode.insertBefore(aMove, aBtns);
const aMenu = document.createElement('button');
aMenu.textContent = '🎮 Games';
aBtns.insertBefore(aMenu, aBack);
aMenu.addEventListener('click', () => { toMenu(); aMenu.blur(); });
aUndo.addEventListener('click', undo);
aRestart.addEventListener('click', restart);
aRun.addEventListener('click', () => {
  const cab = myCab();
  aRun.blur();
  if (!cab) return;
  const mode = cab.live.mode || '';
  if (!mode) startPicked(); else if (isAct(mode)) startAct(mode); else startRun();
});
aDaily.addEventListener('click', () => { aDaily.blur(); startDaily(); });
function actInfo(cab) {   // the line above the buttons during Bricks or Bug Invaders
  const st = cab.act, G = ACT_GAMES[cab.live.mode];
  if (!st || !G) return '';
  if (st.ph === 'over') return `${G.label} · game over · score ${st.sc}`;
  return `${G.label} · ${G.what === 'LEVEL' ? 'level ' + st.lv : 'wave ' + st.wv} · score ${st.sc} · ${st.li} ${G.what === 'LEVEL' ? 'ball' : 'ship'}${st.li === 1 ? '' : 's'} left`;
}
export function refreshArcadeUI() {
  const cab = myCab();
  if (!cab) return;
  const live = cab.live, game = cab.game, mode = live.mode || '';
  const menu = !mode, hop = isHop(mode), act = isAct(mode);
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  show(aGames, menu);
  gameBtns.forEach((b, j) => b.classList.toggle('on', cab.pick === GAME_LIST[j]));
  show(aPad, hop);
  show(aUndo, hop); show(aRestart, hop);
  show(aMove, act);
  fireBtn.textContent = mode === 'bricks' ? '⬆' : '🔥';
  fireBtn.title = mode === 'bricks' ? 'Launch the ball' : 'Shoot';
  show(aDaily, (menu && cab.pick === 'hop') || hop);
  show(aMenu, !menu);
  const playing = !!(game && hop && live.phase === 'play');
  padBtns.forEach(b => { b.disabled = !playing; });
  aUndo.disabled = aRestart.disabled = !(playing && game.moves.length);
  if (menu) aRun.textContent = cab.pick === 'hop' ? '🎲 Run' : '▶ Play';
  else if (act) aRun.textContent = '▶ New game';
  else aRun.textContent = mode === 'run' && live.phase !== 'done' ? '🎲 New run' : '🎲 Run';
  let info;
  if (menu) info = `🕹️ Cabinet ${cab.i + 1} · pick a game, then ${cab.pick === 'hop' ? '🎲 Run (10 levels) or 📅 Daily map' : '▶ Play'}`;
  else if (act) info = actInfo(cab);
  else if (mode === 'daily') info = `📅 Daily map · undos ${live.undos || 0}`;
  else info = `Level ${live.level}/${RUN_LEVELS} · score ${live.score || 0}${live.undos || live.restarts ? '' : ' · perfect so far'}`;
  if (info !== cab.lastInfo) { cab.lastInfo = info; aInfo.textContent = info; }
}

// ---------- Holding keys and buttons, and holding the screen, for Bricks and Bug Invaders ----------
const keyHeld = { left: false, right: false, fire: false };
let touchId = null, touchU = null;   // a finger (or mouse button) held on the screen, and where across it is
function releaseInput() {
  keyHeld.left = keyHeld.right = keyHeld.fire = false;
  btnHeld.left = btnHeld.right = btnHeld.fire = false;
  touchId = null; touchU = null;
}
function actPlaying() { const cab = myCab(); return cab && S.atArcade && isAct(cab.live.mode) ? cab : null; }
function keyChange(e, down) {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (!actPlaying()) { if (!down) releaseInput(); return; }
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') keyHeld.left = down;
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') keyHeld.right = down;
  else if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') keyHeld.fire = down;
  else return;
  e.preventDefault();
}
window.addEventListener('keydown', e => keyChange(e, true));
window.addEventListener('keyup', e => keyChange(e, false));
window.addEventListener('blur', releaseInput);   // switching windows lets go of everything
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function screenSpot(e, cab) {   // where the pointer is on the cabinet's screen, in screen pixels
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction, z = AZ + 0.137;
  if (Math.abs(d.z) < 1e-6) return null;
  const t = (z - o.z) / d.z;
  if (t < 0) return null;
  return { u: ((o.x + d.x * t - cab.x) / SCREEN_W + 0.5) * CW, v: (0.5 - (o.y + d.y * t - SCREEN_Y) / SCREEN_H) * CH };
}
canvas.addEventListener('pointerdown', e => {
  const cab = actPlaying();
  if (!cab) return;
  const p = screenSpot(e, cab);
  if (!p || p.u < -40 || p.u > CW + 40 || p.v < -40 || p.v > CH + 40) return;
  touchId = e.pointerId;
  touchU = Math.max(0, Math.min(CW, p.u));
});
window.addEventListener('pointermove', e => {
  if (e.pointerId !== touchId) return;
  const cab = actPlaying();
  if (!cab) { touchId = null; touchU = null; return; }
  const p = screenSpot(e, cab);
  if (p) touchU = Math.max(0, Math.min(CW, p.u));
});
function touchEnd(e) { if (e.pointerId === touchId) { touchId = null; touchU = null; } }
window.addEventListener('pointerup', touchEnd);
window.addEventListener('pointercancel', touchEnd);
function playerInput() {   // holding the screen moves you there and fires (Bug Invaders) or launches (Bricks) by itself
  return { left: keyHeld.left || btnHeld.left, right: keyHeld.right || btnHeld.right,
           fire: keyHeld.fire || btnHeld.fire || touchId !== null, px: touchId !== null ? touchU : null };
}
function runMyAct(cab, dt) {   // your own Bricks or Bug Invaders game, every frame
  const G = ACT_GAMES[cab.live.mode], st = cab.act;
  if (!G || !st) return;
  const wasOver = st.ph === 'over', ev = [];
  G.step(st, dt, playerInput(), ev);
  for (const name of new Set(ev)) sound(name);
  const over = !wasOver && st.ph === 'over';
  cab.sendT += dt;
  if (over || ev.length && cab.sendT > 0.06 || cab.sendT >= 0.12) {   // about 8 copies a second for watchers
    cab.sendT = 0;
    writeLive(cab, { snap: G.pack(st), score: st.sc });
    refreshArcadeUI();
  }
  cab.dirty = true;
  if (over) {
    saveBest(cab.live.mode, st.sc);
    if (st.sc > 0) banner(`🕹️ Game over · ${st.sc}`, 2);
  }
}

// ---------- Listening ----------
let dailyOff = null;
function allDirty() { for (const c of cabs) c.dirty = true; }
function listenDaily() {
  const day = dayKey();
  if (day === dailyDay) return;
  dailyDay = day;
  if (dailyOff) dailyOff();
  dailyOff = onValue(ref(db, 'room/arcade/daily/' + day), s => { daily = s.val() || {}; allDirty(); });
}
export function startArcade() {
  for (const cab of cabs) onValue(cab.liveRef, s => applyLive(cab, s.val()));
  onValue(ref(db, 'room/arcade/scores'), s => { scores = s.val() || {}; allDirty(); });
  for (const g of Object.keys(best)) onValue(ref(db, 'room/arcade/best/' + g), s => { best[g] = s.val() || {}; allDirty(); });
  onValue(ref(db, 'room/arcade/pick'), s => {   // which game each cabinet is set to
    const v = s.val() || {};
    for (const cab of cabs) {
      const g = GAME_LIST.includes(v['c' + cab.i]) ? v['c' + cab.i] : GAME_LIST[cab.i];
      if (g !== cab.pick) { cab.pick = g; paintMarquee(cab); cab.dirty = true; if (cab.mine) refreshArcadeUI(); }
    }
  });
  listenDaily();
  setInterval(listenDaily, 60000);
}

// ---------- Every frame ----------
export function updateArcade(dt) {
  const t = performance.now();
  if (t - lastIdleFlip > 6000) { lastIdleFlip = t; idleFlips++; for (const c of cabs) if (!c.game) c.dirty = true; }
  const hum = 0.9 + 0.1 * Math.sin(t / 110);
  let drawn = 0;
  for (const cab of cabs) {
    const near = !!S.atArcade && focus === cab.i;
    const anim = cab.anim;
    let moving = false;
    if (anim.segs) {
      anim.t += dt;
      if (anim.t >= anim.segs.length * 0.17) { anim.segs = null; if (cab.mine) refreshArcadeUI(); cab.dirty = true; }
      moving = true;
    }
    if (cab.act && occupant(cab) && isAct(cab.live.mode)) {   // Bricks or Bug Invaders running on this cabinet
      if (cab.mine) runMyAct(cab, dt); else ACT_GAMES[cab.live.mode].drift(cab.act, dt);
      if (cab.act && cab.act.ph === 'play') moving = true;
    }
    if (anim.sinking.length) {
      anim.sinking.forEach(s => { s.t += dt; });
      anim.sinking = anim.sinking.filter(s => s.t < 0.4);
      if (!anim.sinking.length) cab.dirty = true;
      moving = true;
    }
    if (near) {   // up close: blinking text and glowing pads
      cab.idleT += dt;
      if (cab.idleT > 0.3) { cab.idleT = 0; if (!cab.game || [...cab.game.level.cells.values()].some(c => c.t === 'p')) cab.dirty = true; }
    }
    if (near !== cab.wasNear) { cab.wasNear = near; cab.dirty = true; }
    // smooth up close; from across the room, hops redraw at a light rate, and at most one idle screen redraws per frame
    const due = moving && t - cab.lastDraw > (near ? 0 : 100);
    if (due || (cab.dirty && (near || moving || drawn === 0))) { cab.dirty = false; cab.lastDraw = t; drawScreen(cab); drawn++; }
    // the marquee and neon strips hum a little
    cab.marqueeMat.color.setScalar(hum);
    cab.sideGlow.forEach((s, i) => s.material.color.set(i ? 0x7af0ff : 0xff4fd8).multiplyScalar(0.75 + 0.25 * Math.sin(t / 400 + i * 2 + cab.i)));
  }
}