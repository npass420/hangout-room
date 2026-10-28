// =====================================================================
// slots.js — three slot machines along the back wall, played with free chips
// Lily Pad Leap is a 5-reel video slot with a Hop Meter (about 100% back over time).
// Trail Blazer and Midnight Moon are classic 3-reel machines (about 95% back).
// Everyone in the room can watch each other's reels spin.
// =====================================================================
import * as THREE from 'three';
import { ref, update, onValue, runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, scene, ROOM, std, colorIndex } from './core.js';
import { sfx } from './sounds.js';
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) { console.warn('Slots sound', e); } }

// ---------- The three machines ----------
// Symbols go from most common to rarest; the last one is the wild, which counts as any symbol.
// pay3 = three in a row on the middle line (times your bet), pay2 = the first two matching, payW = three wilds.
// Lily Pad Leap is a video slot: 5 reels, 3 rows, 5 lines. Its pays are for 3, 4 or 5 in a row (times the line bet).
const MACHINES = [
  { name: 'Lily Pad Leap', icon: '🐸', body: 0x1f5e3c, trim: 0x5cffb0, screen: '#e8f8ef', sign: '#0f3d26', glow: '#7dffc0', video: true,
    syms: ['🍃', '🐞', '🌸', '🦋', '👑', '🐸'], counts: [8, 7, 6, 4, 3, 2],
    pays: [[2, 5, 20], [3, 8, 25], [5, 15, 50], [8, 25, 100], [15, 60, 250], [25, 100, 500]] },
  { name: 'Trail Blazer', icon: '🥾', body: 0x2f5d3a, trim: 0xff8a3d, screen: '#fff3e4', sign: '#3b2414', glow: '#ff9a52',
    syms: ['🧭', '🎒', '🌲', '🔥', '⛰️', '🥾'], counts: [10, 8, 6, 4, 2, 2],
    pay3: [3, 5, 10, 26, 100], pay2: [1, 0, 0, 0, 0], payW: 300 },
  { name: 'Midnight Moon', icon: '🌙', body: 0x1f1d4a, trim: 0xb9a7ff, screen: '#e9e6ff', sign: '#120f33', glow: '#c9bbff',
    syms: ['⭐', '🦉', '🏮', '🔮', '🌙', '🌠'], counts: [12, 10, 8, 5, 2, 1],
    pay3: [4, 7, 18, 57, 285], pay2: [0, 0, 0, 0, 0], payW: 1500, pulse: true }
];
const WILD = 5;
const BETS = [10, 25, 50];
const START_CHIPS = 1000, REFILL = 500;
const SPIN_FIRST = 0.9, SPIN_GAP = 0.5;   // seconds until the first reel stops, and between reels
const VIDEO_GAP = 0.28;                   // the video slot's reels stop quicker, one after another
const HOP_MAX = 5;                        // losing spins on Lily Pad Leap until the frog's free Leap
function reelsOf(m) { return m.video ? 5 : 3; }
function spinTime(m) { return SPIN_FIRST + (m.video ? VIDEO_GAP : SPIN_GAP) * (reelsOf(m) - 1); }
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
// Each machine's reel strips: symbols shuffled the same way on every computer
function makeStrip(counts, seed) {
  const strip = [];
  counts.forEach((n, sym) => { for (let k = 0; k < n; k++) strip.push(sym); });
  const r = seeded(seed);
  for (let k = strip.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [strip[k], strip[j]] = [strip[j], strip[k]]; }
  return strip;
}
MACHINES.forEach((m, i) => {
  m.strip = makeStrip(m.counts, 1234 + i * 777);
  if (m.video) m.strips = [0, 1, 2, 3, 4].map(r => makeStrip(m.counts, 4321 + r * 97));
});
// The video slot's five lines: middle, top, bottom, a V and an upside-down V (row of each reel)
const LINES = [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2]];
function videoGrid(m, stops) {   // the 3 symbols showing on each reel
  return stops.map((k, r) => { const s = m.strips[r], L = s.length; return [s[(k - 1 + L) % L], s[k], s[(k + 1) % L]]; });
}
function videoPay(m, stops) {   // every winning line: { line, n, sym, pay } with pay in line bets
  const grid = videoGrid(m, stops), wins = [];
  LINES.forEach((ln, li) => {
    const syms = ln.map((row, r) => grid[r][row]);
    let wildRun = 0; while (wildRun < 5 && syms[wildRun] === WILD) wildRun++;
    const first = syms.find(x => x !== WILD);
    let n = 0;
    if (first !== undefined) while (n < 5 && (syms[n] === first || syms[n] === WILD)) n++;
    let best = null;
    if (first !== undefined && n >= 3) best = { line: li, n, sym: first, pay: m.pays[first][n - 3] };
    if (wildRun >= 3 && (!best || m.pays[WILD][wildRun - 3] > best.pay)) best = { line: li, n: wildRun, sym: WILD, pay: m.pays[WILD][wildRun - 3] };
    if (best) wins.push(best);
  });
  return { wins, units: wins.reduce((a, w) => a + w.pay, 0) };
}
function payout(m, line) {   // line = the three symbols on the middle row
  if (line.every(s => s === WILD)) return m.payW;
  const t = line.find(s => s !== WILD);
  if (line.every(s => s === t || s === WILD)) return m.pay3[t];
  const [a, b] = line;
  const t2 = a === WILD && b === WILD ? 0 : (a !== WILD ? a : b);
  if ((a === t2 || a === WILD) && (b === t2 || b === WILD)) return m.pay2[t2];
  return 0;
}

// ---------- Shared state ----------
let machines = [{}, {}, {}];   // room/slots/m0..m2: who's playing, and their latest spin
let chips = {};                // room/slots/chips: name -> { n, day }
let myMachine = -1;
let myBet = BETS[0];
let pendingWin = 0, pendingUntil = 0;   // my last win isn't shown in my chip count until the reels stop
function chipKey(name) { return String(name || '?').replace(/[.#$\[\]\/]/g, '_').slice(0, 20) || '?'; }
function today() { return new Date().toDateString(); }
export function chipsOf(name) { const c = chips[chipKey(name)]; return c && typeof c.n === 'number' ? c.n : START_CHIPS; }
function hopOf(name) { const c = chips[chipKey(name)]; return c && c.hop ? Math.min(HOP_MAX, c.hop) : 0; }
function occupant(i) { const u = machines[i] && machines[i].user; return u && S.presence[u] ? u : ''; }
export function slotOccupantOf(id) { for (let i = 0; i < 3; i++) if (occupant(i) === id) return i; return -1; }
export function slotName(i) { return MACHINES[i].name; }
export const MACHINE_X = [-3.6, -2.7, -1.8];   // the Lucky Corner: back wall, left side
export function slotStandSpot(i) { return { x: MACHINE_X[i], z: -ROOM / 2 + 0.36 + 0.62 }; }   // where a player's snowman stands

// ---------- Building the machines ----------
export const slotsGroup = new THREE.Group();
scene.add(slotsGroup);
const MACHINE_Z = -ROOM / 2 + 0.36;
const SCREEN_Y = 1.32;
const CELL_W = 128, CELL_H = 80;
const views = [];   // per machine: reel canvas, positions, lights, lever
function signTexture(m) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = m.sign; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = m.glow; g.lineWidth = 8; g.strokeRect(8, 8, 496, 144);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '64px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.fillText(m.icon, 64, 82); g.fillText(m.icon, 448, 82);
  g.font = 'bold 50px Georgia'; g.fillStyle = m.glow;
  g.shadowColor = m.glow; g.shadowBlur = 16;
  g.fillText(m.name, 256, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
MACHINES.forEach((m, i) => {
  const g = new THREE.Group();
  g.position.set(MACHINE_X[i], 0, MACHINE_Z);
  const body = std(m.body, 0.5, { metalness: 0.2 });
  const trim = std(m.trim, 0.4, { metalness: 0.4 });
  const dark = std(0x111111, 0.6);
  const add = (geo, mat, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(0.72, 1.0, 0.56), body, 0, 0.5, 0);                        // lower cabinet
  add(new THREE.BoxGeometry(0.74, 0.04, 0.58), trim, 0, 1.0, 0);                        // trim band
  add(new THREE.BoxGeometry(0.72, 0.18, 0.3), body, 0, 1.06, 0.12, -0.35);              // button deck
  add(new THREE.BoxGeometry(0.72, 0.78, 0.4), body, 0, 1.42, -0.08);                    // upper cabinet
  add(new THREE.BoxGeometry(0.66, m.video ? 0.52 : 0.4, 0.02), m.video ? std(0x0a1a12, 0.5) : trim, 0, SCREEN_Y, 0.125);   // screen bezel
  // The reels (the video slot gets a bigger, taller screen)
  const cv = document.createElement('canvas');
  if (m.video) { cv.width = 640; cv.height = 480; } else { cv.width = CELL_W * 3; cv.height = CELL_H * 3; }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const screen = add(new THREE.PlaneGeometry(0.6, 0.6 * cv.height / cv.width), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0, SCREEN_Y, 0.137);
  screen.castShadow = false;
  // The video slot: glowing light strips up the front edges and a big lit spin button
  const strips = [];
  let spinBtn = null;
  if (m.video) {
    for (const sx of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.016, 1.75, 0.016), new THREE.MeshBasicMaterial({ color: m.glow, toneMapped: false }));
      st.position.set(sx * 0.365, 1.0, 0.29);
      g.add(st); strips.push(st);
    }
    spinBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 24), new THREE.MeshBasicMaterial({ color: 0x5cffb0, toneMapped: false }));
    spinBtn.position.set(0.16, 1.1, 0.2); spinBtn.rotation.x = -0.35;
    g.add(spinBtn);
  }
  // Lit sign on top
  add(new THREE.BoxGeometry(0.78, 0.26, 0.42), dark, 0, 1.95, -0.08);
  add(new THREE.PlaneGeometry(0.76, 0.24), new THREE.MeshBasicMaterial({ map: signTexture(m), toneMapped: false }), 0, 1.95, 0.131).castShadow = false;
  // A row of little bulbs under the sign
  const bulbs = [];
  for (let k = 0; k < 9; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshBasicMaterial({ color: m.glow, toneMapped: false }));
    b.position.set(-0.32 + k * 0.08, 1.8, 0.125);
    g.add(b); bulbs.push(b);
  }
  // The lever on the right side
  const lever = new THREE.Group();
  lever.position.set(0.4, 1.12, 0.05);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 10), std(0xcfcfcf, 0.3, { metalness: 0.8 }));
  arm.position.y = 0.21; lever.add(arm);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), std(0xd32f2f, 0.35));
  knob.position.y = 0.44; lever.add(knob);
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 16), trim, 0.38, 1.12, 0.05).rotation.z = Math.PI / 2;
  g.add(lever);
  g.traverse(o => { if (o.isMesh) o.userData.machine = i; });
  arm.userData.lever = true; knob.userData.lever = true;
  slotsGroup.add(g);
  const L = m.strip.length;
  const R = reelsOf(m);
  views.push({ cv, ctx: cv.getContext('2d'), tex, bulbs, lever, leverT: 0, pos: Array(R).fill(0), from: Array(R).fill(0), to: Array(R).fill(0),
    spinN: -1, at: 0, done: true, flashUntil: 0, L, drawn: '', strips, spinBtn, wins: [], winAt: 0, shownWin: 0, lastDraw: 0, leap: false });
});
export function slotPickables() { return slotsGroup.children; }

// Where you stand to play machine i (the room moves the camera there)
export function slotViewPose(i, aspect) {
  const halfH = Math.tan(Math.PI / 6);   // half of the 60° view, up and down
  const fitW = 0.95 / 2 / (halfH * Math.max(0.3, aspect));   // far enough back to see the whole machine width
  const dist = Math.max(1.05, Math.min(2.2, fitW));
  const target = new THREE.Vector3(MACHINE_X[i], 1.38, MACHINE_Z);
  const pos = new THREE.Vector3(MACHINE_X[i], 1.5, MACHINE_Z + dist);
  return { pos, target };
}

// ---------- Drawing the reels ----------
function drawReels(i) {
  if (MACHINES[i].video) { drawVideo(i); return; }
  const v = views[i], m = MACHINES[i], g = v.ctx, L = v.L;
  const key = v.pos.map(p => p.toFixed(3)).join(',');
  if (key === v.drawn) return;
  v.drawn = key;
  g.fillStyle = m.screen; g.fillRect(0, 0, v.cv.width, v.cv.height);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '56px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  for (let r = 0; r < 3; r++) {
    const p = v.pos[r], base = Math.floor(p), frac = p - base;
    g.save();
    g.beginPath(); g.rect(r * CELL_W, 0, CELL_W, CELL_H * 3); g.clip();
    for (let k = -2; k <= 2; k++) {
      const sym = m.strip[(((base + k) % L) + L) % L];
      const y = CELL_H * 1.5 + (k - frac) * CELL_H;
      g.fillStyle = '#000'; g.fillText(m.syms[sym], r * CELL_W + CELL_W / 2, y + 3);
    }
    g.restore();
    // soft shading at the top and bottom of each reel
    const grad = g.createLinearGradient(0, 0, 0, CELL_H * 3);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)'); grad.addColorStop(0.3, 'rgba(0,0,0,0)'); grad.addColorStop(0.7, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = grad; g.fillRect(r * CELL_W, 0, CELL_W, CELL_H * 3);
    if (r) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(r * CELL_W - 2, 0, 4, CELL_H * 3); }
  }
  g.fillStyle = 'rgba(220,40,40,0.75)'; g.fillRect(0, CELL_H * 1.5 - 2, v.cv.width, 4);   // the pay line
  v.tex.needsUpdate = true;
}

// ---------- Drawing the video slot ----------
const BUBBLES = Array.from({ length: 18 }, () => ({ x: Math.random(), y: Math.random(), r: 2 + Math.random() * 5, s: 0.03 + Math.random() * 0.05 }));
function ledText(g, text, x, y, size, color, align = 'center') {
  g.font = `bold ${size}px "Courier New", monospace`; g.textAlign = align; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 14; g.fillStyle = color; g.fillText(text, x, y); g.shadowBlur = 0;
}
function drawVideo(i) {
  const v = views[i], m = MACHINES[i], g = v.ctx, W = v.cv.width, H = v.cv.height, t = performance.now() / 1000;
  // pond background with rising bubbles
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#04261a'); bg.addColorStop(1, '#0b4a3a');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(160,255,220,0.25)'; g.lineWidth = 2;
  for (const b of BUBBLES) { const y = ((b.y - t * b.s) % 1 + 1) % 1; g.beginPath(); g.arc(b.x * W, y * H, b.r, 0, Math.PI * 2); g.stroke(); }
  // Hop Meter across the top
  const who = occupant(i) ? machines[i].name : '';
  const hop = v.done ? hopOf(who) : (v.spin && v.spin.leap ? HOP_MAX : hopOf(who));
  ledText(g, 'HOP METER', 18, 34, 22, '#7dffc0', 'left');
  for (let k = 0; k < HOP_MAX; k++) {
    const lit = k < hop, x = 250 + k * 62, y = 34;
    g.fillStyle = lit ? '#3ddc84' : 'rgba(61,220,132,0.18)';
    if (lit) { g.shadowColor = '#7dffc0'; g.shadowBlur = 16; }
    g.beginPath(); g.ellipse(x, y, 24, 15, 0, 0.35, Math.PI * 2 - 0.35); g.lineTo(x, y); g.closePath(); g.fill();
    g.shadowBlur = 0;
  }
  g.font = '34px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const full = hop >= HOP_MAX, bounce = full ? Math.abs(Math.sin(t * 5)) * 8 : 0;
  g.fillText('🐸', 250 + HOP_MAX * 62, 32 - bounce);
  // the reels
  const X0 = 16, Y0 = 66, CW2 = 121.6, RH = 110, ROWS = 3;
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(X0 - 4, Y0 - 4, CW2 * 5 + 8, RH * ROWS + 8);
  const winning = !v.done || !v.wins.length ? null : v.wins[Math.floor((t - v.winAt) / 1.1) % v.wins.length];
  const winCells = new Set();
  if (winning) LINES[winning.line].slice(0, winning.n).forEach((row, r) => winCells.add(r * 3 + row));
  for (let r = 0; r < 5; r++) {
    const strip = m.strips[r], L = strip.length, p = v.pos[r], base = Math.floor(p), frac = p - base;
    const moving = !v.done && v.pos[r] !== v.to[r];
    g.save();
    g.beginPath(); g.rect(X0 + r * CW2, Y0, CW2 - 4, RH * ROWS); g.clip();
    const cg = g.createLinearGradient(0, Y0, 0, Y0 + RH * ROWS);
    cg.addColorStop(0, '#0d3326'); cg.addColorStop(0.5, '#155c43'); cg.addColorStop(1, '#0d3326');
    g.fillStyle = cg; g.fillRect(X0 + r * CW2, Y0, CW2 - 4, RH * ROWS);
    g.font = '70px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    for (let k = -2; k <= 2; k++) {
      const sym = strip[(((base + k) % L) + L) % L];
      const y = Y0 + RH * 1.5 + (k - frac) * RH;
      const row = k + 1, isWin = !moving && frac === 0 && winCells.has(r * 3 + row);
      const sc = isWin ? 1 + 0.12 * Math.sin(t * 9) : 1;
      g.globalAlpha = moving ? 0.55 : 1;
      g.save(); g.translate(X0 + r * CW2 + CW2 / 2 - 2, y + 4); g.scale(sc, moving ? 1.25 : sc);
      if (isWin) { g.shadowColor = '#ffe36b'; g.shadowBlur = 25; }
      g.fillText(m.syms[sym], 0, 0);
      g.restore();
    }
    g.globalAlpha = 1;
    g.restore();
  }
  if (winning) {   // glowing line through the winning symbols
    g.strokeStyle = '#ffe36b'; g.lineWidth = 5; g.shadowColor = '#ffe36b'; g.shadowBlur = 18; g.globalAlpha = 0.85;
    g.beginPath();
    LINES[winning.line].forEach((row, r) => { const x = X0 + r * CW2 + CW2 / 2 - 2, y = Y0 + RH * (row + 0.5); r ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke(); g.shadowBlur = 0; g.globalAlpha = 1;
    for (let r = 0; r < winning.n; r++) {
      const row = LINES[winning.line][r];
      g.strokeStyle = '#ffe36b'; g.lineWidth = 3; g.strokeRect(X0 + r * CW2 + 3, Y0 + RH * row + 3, CW2 - 10, RH - 6);
    }
  }
  // big message over the reels
  let msg = '';
  if (!v.done && v.spin && v.spin.leap) msg = '🐸 FROG LEAP! 🐸';
  else if (v.done && v.spin && v.spin.win > 0 && t - v.winAt < 2.5) {
    const mult = v.spin.win / (v.spin.lineBet || v.spin.bet || 1);
    msg = mult >= 20 ? 'BIG WIN!' : v.spin.leap ? 'LEAP WIN!' : '';
  } else if (v.done && full && who) msg = 'FREE LEAP READY!';
  if (msg && (msg !== 'FREE LEAP READY!' || Math.floor(t * 2) % 2 === 0)) {
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, Y0 + RH * 1.5 - 34, W, 68);
    ledText(g, msg, W / 2, Y0 + RH * 1.5, 44, '#ffe36b');
  }
  // LED readouts along the bottom
  const credits = who ? Math.max(0, chipsOf(who) - (i === myMachine ? pendingWin : (v.done ? 0 : (v.spin ? v.spin.win : 0)))) : 0;
  const bet = i === myMachine ? myBet : (v.spin ? v.spin.bet : 0);
  const winShown = Math.round(v.shownWin);
  g.fillStyle = '#000'; g.fillRect(0, 410, W, 70);
  [['CREDITS', who ? credits.toLocaleString() : '----', 110], ['BET', bet ? String(bet) : '--', 320], ['WIN', String(winShown), 530]].forEach(([label, val, x]) => {
    ledText(g, label, x, 426, 14, '#7dffc0');
    ledText(g, val, x, 456, 32, label === 'WIN' && winShown ? '#ffe36b' : '#ff4a3d');
  });
  v.tex.needsUpdate = true;
}
MACHINES.forEach((m, i) => drawReels(i));

// ---------- Playing ----------
function banner(text, secs) { if (hooks.banner) hooks.banner(text, secs); }
export function slotEnter(i) {   // try to take machine i; resolves true if it's yours
  if (!S.myName) return Promise.resolve(false);
  return runTransaction(ref(db, 'room/slots/m' + i), d => {
    d = d || {};
    if (d.user && d.user !== myId && S.presence[d.user]) return;   // someone else is playing it
    d.user = myId; d.name = S.myName; d.c = S.myHue;
    return d;
  }).then(r => {
    if (!r.committed) { banner(`${MACHINES[i].name} is taken by ${machines[i].name || 'someone'}`, 2.5); return false; }
    myMachine = i;
    onDisconnect(ref(db, 'room/slots/m' + i + '/user')).remove();
    refreshSlotUI();
    return true;
  }).catch(e => { console.warn('Slots enter', e); return false; });
}
export function slotLeave() {
  if (myMachine < 0) return;
  const i = myMachine;
  myMachine = -1;
  runTransaction(ref(db, 'room/slots/m' + i + '/user'), u => (u === myId ? null : undefined)).catch(() => {});
  refreshSlotUI();
}
function spinning(i) { const v = views[i]; return !v.done; }
export function slotSpin() {
  const i = myMachine;
  if (i < 0 || spinning(i)) return;
  if (MACHINES[i].video) { videoSpin(i); return; }
  const m = MACHINES[i], bet = myBet;
  const stops = [0, 1, 2].map(() => Math.floor(Math.random() * m.strip.length));
  const win = payout(m, stops.map(s => m.strip[s])) * bet;
  let refilled = false, broke = false;
  runTransaction(ref(db, 'room/slots/chips/' + chipKey(S.myName)), c => {
    c = c || { n: START_CHIPS, day: '' };
    refilled = false; broke = false;
    if (c.n < bet) {
      if (c.n < BETS[0] && c.day !== today()) { c.n += REFILL; c.day = today(); refilled = true; }
      else { broke = true; return; }
    }
    c.n = c.n - bet + win;
    return c;
  }).then(r => {
    if (!r.committed) {
      banner(broke && chipsOf(S.myName) < BETS[0] ? '🪙 Out of chips · free refill tomorrow!' : `Not enough chips for a ${bet} bet`, 2.5);
      return;
    }
    if (refilled) banner(`🎁 Free refill! +${REFILL} chips`, 2.5);
    pendingWin = win; pendingUntil = serverNow() + spinTime(m) * 1000 + 300;
    const n = ((machines[i].spin && machines[i].spin.n) || 0) + 1;
    update(ref(db, 'room/slots/m' + i), { spin: { n, at: serverNow(), stops, bet, win, name: S.myName } });
  }).catch(e => console.warn('Slots spin', e));
}
function videoSpin(i) {   // Lily Pad Leap: 5 reels, and a free Leap that always wins once the Hop Meter is full
  const m = MACHINES[i], bet = myBet;
  const leap = hopOf(S.myName) >= HOP_MAX;
  let stops, res, tries = 0;
  do {
    stops = m.strips.map(s => Math.floor(Math.random() * s.length));
    res = videoPay(m, stops);
  } while (leap && res.units === 0 && ++tries < 500);
  const win = res.units * bet / 5;   // each of the 5 lines gets a fifth of the bet
  let refilled = false, broke = false, hopAfter = 0;
  runTransaction(ref(db, 'room/slots/chips/' + chipKey(S.myName)), c => {
    c = c || { n: START_CHIPS, day: '', hop: 0 };
    refilled = false; broke = false;
    const hop = c.hop || 0;
    if ((hop >= HOP_MAX) !== leap) return;   // the meter changed under us; try again
    if (leap) { c.n += win; c.hop = 0; hopAfter = 0; return c; }
    if (c.n < bet) {
      if (c.n < BETS[0] && c.day !== today()) { c.n += REFILL; c.day = today(); refilled = true; }
      else { broke = true; return; }
    }
    c.n = c.n - bet + win;
    c.hop = win > 0 ? hop : hop + 1;
    hopAfter = c.hop;
    return c;
  }).then(r => {
    if (!r.committed) {
      banner(broke && chipsOf(S.myName) < BETS[0] ? '🪙 Out of chips · free refill tomorrow!' : broke ? `Not enough chips for a ${bet} bet` : 'Try that spin again', 2.5);
      return;
    }
    if (refilled) banner(`🎁 Free refill! +${REFILL} chips`, 2.5);
    pendingWin = win; pendingUntil = serverNow() + spinTime(m) * 1000 + 300;
    const n = ((machines[i].spin && machines[i].spin.n) || 0) + 1;
    update(ref(db, 'room/slots/m' + i), { spin: { n, at: serverNow(), stops, bet: leap ? 0 : bet, lineBet: bet, win, name: S.myName, leap, hop: hopAfter } });
  }).catch(e => console.warn('Slots spin', e));
}
export function slotSetBet(b) { if (BETS.includes(b)) { myBet = b; refreshSlotUI(); } }

// A new spin arrived (mine or someone else's): start the reels toward their stops
function startSpin(i, spin, live) {
  const v = views[i], L = v.L;
  v.spinN = spin.n; v.at = spin.at; v.spin = spin;
  const m = MACHINES[i];
  for (let r = 0; r < reelsOf(m); r++) {
    const Lr = m.video ? m.strips[r].length : L;
    const start = ((Math.round(v.pos[r]) % Lr) + Lr) % Lr;
    const dist = ((spin.stops[r] - start) % Lr + Lr) % Lr;
    v.from[r] = start;
    v.to[r] = start + dist + Lr * (2 + (m.video ? Math.floor(r / 2) : r));   // a few full turns, more for later reels
    if (!live) v.pos[r] = spin.stops[r];
  }
  v.done = !live;
  v.wins = m.video ? videoPay(m, spin.stops).wins : [];
  v.shownWin = live ? 0 : (spin.win || 0);
  v.winAt = performance.now() / 1000;
  if (live) { v.leverT = 0.001; if (i === myMachine) sound(spin.leap ? 'whoosh' : 'clack', 0.9); }
  drawReels(i);
}
function finishSpin(i) {
  const v = views[i], m = MACHINES[i], s = v.spin;
  v.done = true;
  if (!s) return;
  v.winAt = performance.now() / 1000;
  if (m.video) {   // the video slot shows its own win on the screen and counts it up
    const mult = s.win / (s.lineBet || s.bet || 1);
    if (s.win > 0) v.flashUntil = performance.now() + (mult >= 20 ? 4000 : 1800);
    if (i === myMachine && s.name === S.myName) {
      pendingWin = 0;
      if (s.leap) banner(`🐸 Frog Leap! +${s.win}`, 2.5);
      else if (mult >= 20) banner(`🎉 BIG WIN! +${s.win}`, 4);
      if (s.win > 0) sound(mult >= 20 || s.leap ? 'win' : 'coin');
    }
    if (mult >= 30) hooks.addSys(`🎰 ${s.name} hit a big win on ${m.name}! +${s.win}`);
    refreshSlotUI();
    return;
  }
  const line = s.stops.map(k => m.strip[k]);
  const mult = s.bet ? s.win / s.bet : 0;
  if (s.win > 0) v.flashUntil = performance.now() + (mult >= 20 ? 4000 : 1800);
  const mine = i === myMachine && s.name === S.myName;
  if (mine) {
    pendingWin = 0;
    if (s.win > 0) {
      banner(`${line.map(k => m.syms[k]).join('')}  ${mult >= 50 ? '🎉 BIG WIN! ' : ''}+${s.win}`, mult >= 50 ? 5 : 2.5);
      sound(mult >= 20 ? 'win' : 'coin');
    }
  }
  if (mult >= 50) hooks.addSys(`🎰 ${s.name} hit ${line.map(k => m.syms[k]).join('')} on ${m.name}! +${s.win}`);
  refreshSlotUI();
}

// ---------- Every frame ----------
export function updateSlots(dt) {
  const now = serverNow(), t = performance.now();
  for (let i = 0; i < 3; i++) {
    const v = views[i], m = MACHINES[i];
    if (!v.done) {
      const el = (now - v.at) / 1000;
      let allDone = true;
      for (let r = 0; r < reelsOf(m); r++) {
        const T = SPIN_FIRST + (m.video ? VIDEO_GAP : SPIN_GAP) * r;
        const u = Math.min(1, Math.max(0, el / T));
        const before = v.pos[r];
        v.pos[r] = v.from[r] + (v.to[r] - v.from[r]) * (1 - Math.pow(1 - u, 3));
        if (u < 1) allDone = false;
        else if (before !== v.to[r] && i === myMachine) sound('reel');
        if (u >= 1) v.pos[r] = v.to[r];
      }
      if (allDone) { v.pos = v.pos.map((p, r) => { const Lr = m.video ? m.strips[r].length : v.L; return ((Math.round(p) % Lr) + Lr) % Lr; }); finishSpin(i); }
      drawReels(i);
    } else if (m.video) {   // the video screen keeps moving: bubbles, win lines and the WIN counter
      if (v.spin && v.shownWin < v.spin.win) v.shownWin = Math.min(v.spin.win, v.shownWin + Math.max(1, v.spin.win) * dt * 1.2);
      if (t - v.lastDraw > 50) { v.lastDraw = t; drawVideo(i); }
    }
    if (m.video) {   // light strips and the spin button glow, brighter while it spins or after a win
      const hot = !v.done || t < v.flashUntil;
      const lvl = hot ? 0.6 + 0.4 * Math.abs(Math.sin(t / 90)) : 0.55 + 0.25 * Math.sin(t / 700);
      v.strips.forEach((st, k) => st.material.color.set(m.glow).multiplyScalar(k ? lvl : 1.15 - lvl));
      if (v.spinBtn) v.spinBtn.material.color.set(myMachine === i && v.done ? 0x5cffb0 : 0x2e8a5c).multiplyScalar(0.7 + 0.3 * Math.sin(t / 250));
    }
    // the lever swings down and back when a spin starts
    if (v.leverT > 0) { v.leverT += dt; if (v.leverT > 0.5) v.leverT = 0; }
    v.lever.rotation.x = v.leverT > 0 ? Math.sin(Math.min(1, v.leverT / 0.5) * Math.PI) * 1.1 : 0;
    // bulbs: a slow chase, a fast flash after a win, and Midnight Moon's slow glow
    const flashing = t < v.flashUntil;
    v.bulbs.forEach((b, k) => {
      let on = flashing ? (Math.floor(t / 120) % 2 === 0) : ((Math.floor(t / 300) + k) % 3 === 0);
      let level = on ? 1 : 0.25;
      if (m.pulse && !flashing) level = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 900 + k * 0.4));
      b.material.color.set(m.glow).multiplyScalar(level);
    });
  }
  if (pendingWin && serverNow() > pendingUntil + 1500) pendingWin = 0;   // safety: never hide a win for long
}

// ---------- The bottom bar while you're at a machine ----------
const slotChips = document.getElementById('slotChips');
const slotSpinBtn = document.getElementById('slotSpin');
const slotPays = document.getElementById('slotPays');
const betBtns = BETS.map(b => {
  const btn = document.getElementById('slotBet' + b);
  btn.addEventListener('click', () => slotSetBet(b));
  return btn;
});
slotSpinBtn.addEventListener('click', slotSpin);
export function refreshSlotUI() {
  if (myMachine < 0) return;
  const m = MACHINES[myMachine];
  const shown = Math.max(0, chipsOf(S.myName) - pendingWin);
  slotChips.textContent = `🪙 ${shown.toLocaleString()}`;
  betBtns.forEach((b, k) => b.classList.toggle('on', BETS[k] === myBet));
  slotSpinBtn.disabled = spinning(myMachine);
  const s = m.syms;
  if (m.video) {
    const hop = hopOf(S.myName);
    slotSpinBtn.textContent = hop >= HOP_MAX ? '🐸 Free Leap!' : '🎰 Spin';
    slotPays.textContent = `5 lines · ${s[WILD]} is wild · every losing spin fills the Hop Meter (${hop}/${HOP_MAX}); when it's full your next spin is a free Leap that always wins`
      + ` · Pays (× line bet, 3/4/5 in a row): ${[5, 4, 3, 2, 1, 0].map(k => `${s[k]} ${m.pays[k].join('/')}`).join(' · ')}`;
    return;
  }
  slotSpinBtn.textContent = '🎰 Spin';
  slotPays.textContent = `Pays (× bet): ${s[WILD].repeat(3)} ${m.payW} · ${s[4].repeat(3)} ${m.pay3[4]} · ${s[3].repeat(3)} ${m.pay3[3]} · ${s[2].repeat(3)} ${m.pay3[2]} · ${s[1].repeat(3)} ${m.pay3[1]} · ${s[0].repeat(3)} ${m.pay3[0]}`
    + (m.pay2.some(x => x) ? ` · first two ${m.pay2.map((x, k) => x ? s[k] : '').filter(Boolean).join('/')} ${Math.max(...m.pay2)}` : '')
    + ` · ${s[WILD]} is wild`;
}

// ---------- Listening ----------
export function startSlots() {
  for (let i = 0; i < 3; i++) {
    let first = true;
    onValue(ref(db, 'room/slots/m' + i), snap => {
      const d = snap.val() || {};
      const prevUser = occupant(i);
      machines[i] = d;
      const fits = d.spin && Array.isArray(d.spin.stops) && d.spin.stops.length === reelsOf(MACHINES[i]);   // skip spins saved by the old 3-reel Lily Pad Leap
      if (fits && d.spin.n !== views[i].spinN) {
        const live = !first && serverNow() - d.spin.at < spinTime(MACHINES[i]) * 1000 + 2000;
        startSpin(i, d.spin, live);
      }
      first = false;
      if (myMachine === i && d.user && d.user !== myId) { myMachine = -1; if (hooks.slotKicked) hooks.slotKicked(); }
      if (occupant(i) !== prevUser && hooks.refreshAll) hooks.refreshAll();
      refreshSlotUI();
    });
  }
  onValue(ref(db, 'room/slots/chips'), snap => {
    chips = snap.val() || {};
    refreshSlotUI();
    if (hooks.refreshWho) hooks.refreshWho();
  });
}