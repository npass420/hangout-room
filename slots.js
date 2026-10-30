// =====================================================================
// slots.js — Lily Pad Leap, the frog video slot in the Lucky Corner, played with room money
// Room money: everyone starts with 5,000. The first time you join each day, if you're below 5,000
// you get up to 1,000 back (never past 5,000), so you're never stuck broke but can still build a high score.
// 5 reels × 5 rows, 10 lines, 🐸 is wild, and a Hop Meter: every losing spin lights a lily pad,
// and when all 5 are lit your next spin is a free Frog Leap that pays at least your bet.
// Pays back a little over 100% over time, so chips swing up and down but slowly grow.
// Everyone in the room can watch the reels spin.
// =====================================================================
import * as THREE from 'three';
import { ref, update, onValue, runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, scene, ROOM, std } from './core.js';
import { sfx } from './sounds.js';
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) { console.warn('Slots sound', e); } }

// ---------- The machine ----------
// Symbols go from most common to rarest; the last one (🐸) is wild and counts as any symbol.
// pays = what 3, 4 or 5 in a row (from the left) pay, times the line bet.
const M = {
  name: 'Lily Pad Leap', glow: '#7dffc0',
  syms: ['🍃', '🐞', '🌸', '🦋', '👑', '🐸'], counts: [10, 9, 8, 5, 3, 2],
  pays: [[2, 5, 15], [3, 8, 25], [6, 20, 75], [10, 40, 150], [25, 100, 400], [40, 150, 750]]
};
const WILD = 5, REELS = 5, ROWS = 5;
const BETS = [10, 25, 50];
const START_CHIPS = 5000, DAILY = 1000;   // room money: the starting amount, and the daily allowance (only tops you back up to 5,000)
const SPIN_FIRST = 0.9, REEL_GAP = 0.28;   // seconds until the first reel stops, and between reels
const SPIN_TIME = SPIN_FIRST + REEL_GAP * (REELS - 1);
const HOP_MAX = 5;                         // losing spins until the frog's free Leap
// The 10 lines (which row on each reel): the five rows, then four V shapes and one wave
const LINES = [[0, 0, 0, 0, 0], [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [3, 3, 3, 3, 3], [4, 4, 4, 4, 4],
               [0, 1, 2, 1, 0], [4, 3, 2, 3, 4], [2, 1, 0, 1, 2], [2, 3, 4, 3, 2], [1, 2, 3, 2, 1]];
const LINE_COLORS = ['#ffe36b', '#7af0ff', '#ff7ad8', '#9dff7a', '#ffb36b', '#c9a7ff', '#ff8a8a', '#7affd8', '#fff59d', '#8ac4ff'];
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function makeStrip(counts, seed) {   // a reel strip, shuffled the same way on every computer
  const strip = [];
  counts.forEach((n, sym) => { for (let k = 0; k < n; k++) strip.push(sym); });
  const r = seeded(seed);
  for (let k = strip.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [strip[k], strip[j]] = [strip[j], strip[k]]; }
  return strip;
}
M.strips = [0, 1, 2, 3, 4].map(r => makeStrip(M.counts, 4321 + r * 97));
// stops[r] is the strip position showing in the middle row of reel r
function grid(stops) { return stops.map((k, r) => { const s = M.strips[r], L = s.length; return [-2, -1, 0, 1, 2].map(d => s[((k + d) % L + L) % L]); }); }
function pay(stops) {   // every winning line: { line, n, sym, pay } with pay in line bets
  const gr = grid(stops), wins = [];
  LINES.forEach((ln, li) => {
    const syms = ln.map((row, r) => gr[r][row]);
    let wildRun = 0; while (wildRun < 5 && syms[wildRun] === WILD) wildRun++;
    const first = syms.find(x => x !== WILD);
    let n = 0;
    if (first !== undefined) while (n < 5 && (syms[n] === first || syms[n] === WILD)) n++;
    let best = null;
    if (first !== undefined && n >= 3) best = { line: li, n, sym: first, pay: M.pays[first][n - 3] };
    if (wildRun >= 3 && (!best || M.pays[WILD][wildRun - 3] > best.pay)) best = { line: li, n: wildRun, sym: WILD, pay: M.pays[WILD][wildRun - 3] };
    if (best) wins.push(best);
  });
  return { wins, units: wins.reduce((a, w) => a + w.pay, 0) };
}
function winFor(units, bet) { return Math.round(units * bet / LINES.length); }   // each line gets a tenth of the bet

// ---------- Shared state ----------
let machine = {};              // room/slots/m0: who's playing, and the latest spin
let chips = {};                // room/slots/chips: name -> { n, day, hop }
let mine = false;              // I'm at the machine
let myBet = BETS[0];
let pendingWin = 0, pendingUntil = 0;   // my last win isn't shown in my chip count until the reels stop
function chipKey(name) { return String(name || '?').replace(/[.#$\[\]\/]/g, '_').slice(0, 20) || '?'; }
function today() { return new Date().toDateString(); }
export function chipsOf(name) { const c = chips[chipKey(name)]; return c && typeof c.n === 'number' ? c.n : START_CHIPS; }
function hopOf(name) { const c = chips[chipKey(name)]; return c && c.hop ? Math.min(HOP_MAX, c.hop) : 0; }
function occupant() { const u = machine && machine.user; return u && S.presence[u] ? u : ''; }
export function slotOccupantOf(id) { return occupant() === id ? 0 : -1; }
export function slotName() { return M.name; }
export const MACHINE_X = [-2.7];   // the Lucky Corner: back wall, left side, in the middle of the carpet
export function slotStandSpot() { return { x: MACHINE_X[0], z: -ROOM / 2 + 0.4 + 0.66 }; }   // where a player's snowman stands

// ---------- Building the cabinet ----------
export const slotsGroup = new THREE.Group();
scene.add(slotsGroup);
const MZ = -ROOM / 2 + 0.4;
const SCREEN_Y = 1.42, SCREEN_W = 0.62;
const cv = document.createElement('canvas');
cv.width = 640; cv.height = 680;
const g2 = cv.getContext('2d');
const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
const view = { pos: Array(REELS).fill(0), from: Array(REELS).fill(0), to: Array(REELS).fill(0), spinN: -1, at: 0, done: true,
               spin: null, wins: [], winAt: 0, shownWin: 0, lastDraw: 0, flashUntil: 0, leverT: 0 };
let lever = null, spinBtn = null;
const strips = [], bulbs = [];
function signTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#0a2e1d'); grad.addColorStop(0.5, '#145c3a'); grad.addColorStop(1, '#0a2e1d');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = M.glow; g.lineWidth = 8; g.strokeRect(8, 8, 496, 144);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '64px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.fillText('🐸', 62, 82); g.fillText('🐸', 450, 82);
  g.font = 'bold 50px Georgia'; g.fillStyle = M.glow;
  g.shadowColor = M.glow; g.shadowBlur = 16;
  g.fillText(M.name, 256, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
(function cabinet() {
  const g = new THREE.Group();
  g.position.set(MACHINE_X[0], 0, MZ);
  const body = std(0x1f5e3c, 0.5, { metalness: 0.2 });
  const trim = std(0x5cffb0, 0.4, { metalness: 0.4 });
  const dark = std(0x0a1a12, 0.5);
  const add = (geo, mat, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(0.84, 0.96, 0.6), body, 0, 0.48, 0);                       // lower cabinet
  add(new THREE.BoxGeometry(0.86, 0.04, 0.62), trim, 0, 0.96, 0);                      // trim band
  add(new THREE.BoxGeometry(0.84, 0.18, 0.32), body, 0, 1.02, 0.14, -0.35);            // button deck
  add(new THREE.BoxGeometry(0.84, 1.06, 0.42), body, 0, 1.5, -0.09);                   // tall upper cabinet
  add(new THREE.BoxGeometry(0.7, 0.74, 0.02), dark, 0, SCREEN_Y, 0.125);               // screen bezel
  const screen = add(new THREE.PlaneGeometry(SCREEN_W, SCREEN_W * cv.height / cv.width), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0, SCREEN_Y, 0.137);
  screen.castShadow = false;
  // Glowing light strips on the front corners of the cabinet (lower part and upper part), and a big lit spin button
  const stripMats = [new THREE.MeshBasicMaterial({ color: M.glow, toneMapped: false }), new THREE.MeshBasicMaterial({ color: M.glow, toneMapped: false })];
  for (const sx of [-1, 1]) {
    const k = sx < 0 ? 0 : 1;
    const low = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.94, 0.02), stripMats[k]);
    low.position.set(sx * 0.42, 0.48, 0.3);
    const high = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.04, 0.02), stripMats[k]);
    high.position.set(sx * 0.42, 1.5, 0.12);
    g.add(low, high);
  }
  strips.push({ material: stripMats[0] }, { material: stripMats[1] });
  spinBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 24), new THREE.MeshBasicMaterial({ color: 0x5cffb0, toneMapped: false }));
  spinBtn.position.set(0.2, 1.07, 0.22); spinBtn.rotation.x = -0.35;
  g.add(spinBtn);
  // Lit sign on top, with a row of bulbs under it
  add(new THREE.BoxGeometry(0.9, 0.28, 0.44), dark, 0, 2.18, -0.09);
  add(new THREE.PlaneGeometry(0.88, 0.26), new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false }), 0, 2.18, 0.131).castShadow = false;
  for (let k = 0; k < 11; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshBasicMaterial({ color: M.glow, toneMapped: false }));
    b.position.set(-0.36 + k * 0.072, 1.9, 0.125);
    g.add(b); bulbs.push(b);
  }
  // The lever on the right side
  lever = new THREE.Group();
  lever.position.set(0.46, 1.1, 0.05);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 10), std(0xcfcfcf, 0.3, { metalness: 0.8 }));
  arm.position.y = 0.21; lever.add(arm);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), std(0xd32f2f, 0.35));
  knob.position.y = 0.44; lever.add(knob);
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 16), trim, 0.44, 1.1, 0.05).rotation.z = Math.PI / 2;
  g.add(lever);
  g.traverse(o => { if (o.isMesh) o.userData.machine = 0; });
  arm.userData.lever = true; knob.userData.lever = true;
  slotsGroup.add(g);
})();
export function slotPickables() { return slotsGroup.children; }

// Where you stand to play (the room moves the camera there); aimed a little low so the reels sit above the buttons
export function slotViewPose(i, aspect) {
  const halfH = Math.tan(Math.PI / 6);   // half of the 60° view, up and down
  const fitW = 0.95 / 2 / (halfH * Math.max(0.3, aspect));
  const dist = Math.max(1.3, Math.min(2.2, fitW));
  const target = new THREE.Vector3(MACHINE_X[0], SCREEN_Y - 0.12, MZ);
  const pos = new THREE.Vector3(MACHINE_X[0], SCREEN_Y - 0.04, MZ + dist);
  return { pos, target };
}

// ---------- Drawing the screen ----------
const BUBBLES = Array.from({ length: 22 }, () => ({ x: Math.random(), y: Math.random(), r: 2 + Math.random() * 5, s: 0.03 + Math.random() * 0.05 }));
const EMOJI = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
function ledText(text, x, y, size, color, align = 'center') {
  const g = g2;
  g.font = `bold ${size}px "Courier New", monospace`; g.textAlign = align; g.textBaseline = 'middle';
  if (fancy) { g.shadowColor = color; g.shadowBlur = 14; }
  g.fillStyle = color; g.fillText(text, x, y); g.shadowBlur = 0;
}
const X0 = 16, Y0 = 70, CWD = 121.6, RH = 104;   // reel area: 5 columns × 5 rows
// Each symbol is drawn once into its own little picture and then copied, which is much faster than drawing emoji every time
const SYM_PX = 96;
function symPic(e, glow) {
  const c = document.createElement('canvas'); c.width = c.height = SYM_PX;
  const g = c.getContext('2d');
  g.font = `64px ${EMOJI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (glow) { g.shadowColor = '#ffe36b'; g.shadowBlur = 22; }
  g.fillText(e, SYM_PX / 2, SYM_PX / 2 + 4);
  return c;
}
const symPics = M.syms.map(e => symPic(e, false));
const symGlows = M.syms.map(e => symPic(e, true));   // the same symbols with a golden glow, for winning lines
let fancy = false;   // full effects only while you're standing at the machine; a lighter screen from across the room
function cellCenter(r, row) { return { x: X0 + r * CWD + CWD / 2 - 2, y: Y0 + RH * (row + 0.5) }; }
function drawScreen() {
  const g = g2, W = cv.width, H = cv.height, v = view;
  fancy = S.atSlot >= 0;
  const t = fancy ? performance.now() / 1000 : 0;   // from across the room nothing wiggles
  // pond background with rising bubbles
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#04261a'); bg.addColorStop(1, '#0b4a3a');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(160,255,220,0.25)'; g.lineWidth = 2;
  if (fancy) for (const b of BUBBLES) { const y = ((b.y - t * b.s) % 1 + 1) % 1; g.beginPath(); g.arc(b.x * W, y * H, b.r, 0, Math.PI * 2); g.stroke(); }
  // Hop Meter across the top
  const who = occupant() ? machine.name : '';
  const hop = !v.done && v.spin && v.spin.leap ? HOP_MAX : hopOf(who);
  ledText('HOP METER', 18, 36, 22, '#7dffc0', 'left');
  for (let k = 0; k < HOP_MAX; k++) {
    const lit = k < hop, x = 250 + k * 62, y = 36;
    g.fillStyle = lit ? '#3ddc84' : 'rgba(61,220,132,0.18)';
    if (lit && fancy) { g.shadowColor = '#7dffc0'; g.shadowBlur = 16; }
    g.beginPath(); g.ellipse(x, y, 24, 15, 0, 0.35, Math.PI * 2 - 0.35); g.lineTo(x, y); g.closePath(); g.fill();
    g.shadowBlur = 0;
  }
  const full = hop >= HOP_MAX, bounce = full ? Math.abs(Math.sin(t * 5)) * 8 : 0;
  g.font = `34px ${EMOJI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('🐸', 250 + HOP_MAX * 62, 34 - bounce);
  // the reels
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(X0 - 4, Y0 - 4, CWD * REELS + 8, RH * ROWS + 8);
  const winning = !v.done || !v.wins.length ? null : v.wins[fancy ? Math.floor((t - v.winAt) / 1.1) % v.wins.length : 0];
  const winCells = new Set();
  if (winning) LINES[winning.line].slice(0, winning.n).forEach((row, r) => winCells.add(r * ROWS + row));
  for (let r = 0; r < REELS; r++) {
    const strip = M.strips[r], L = strip.length, p = v.pos[r], base = Math.floor(p), frac = p - base;
    const moving = !v.done && v.pos[r] !== v.to[r];
    g.save();
    g.beginPath(); g.rect(X0 + r * CWD, Y0, CWD - 4, RH * ROWS); g.clip();
    const cg = g.createLinearGradient(0, Y0, 0, Y0 + RH * ROWS);
    cg.addColorStop(0, '#0d3326'); cg.addColorStop(0.5, '#155c43'); cg.addColorStop(1, '#0d3326');
    g.fillStyle = cg; g.fillRect(X0 + r * CWD, Y0, CWD - 4, RH * ROWS);
    for (let k = -3; k <= 3; k++) {
      const sym = strip[(((base + k) % L) + L) % L];
      const y = Y0 + RH * 2.5 + (k - frac) * RH;
      const row = k + 2, isWin = !moving && frac === 0 && winCells.has(r * ROWS + row);
      const sc = isWin ? 1 + 0.12 * Math.sin(t * 9) : 1;
      g.globalAlpha = moving ? 0.55 : 1;
      const cx = X0 + r * CWD + CWD / 2 - 2, w = SYM_PX * sc, h = SYM_PX * (moving ? 1.25 : sc);
      g.drawImage(isWin ? symGlows[sym] : symPics[sym], cx - w / 2, y - h / 2, w, h);
    }
    g.globalAlpha = 1;
    g.restore();
  }
  if (winning) {   // glowing line through the winning symbols, in that line's color
    const col = LINE_COLORS[winning.line];
    g.strokeStyle = col; g.lineWidth = 5; if (fancy) { g.shadowColor = col; g.shadowBlur = 18; } g.globalAlpha = 0.85;
    g.beginPath();
    LINES[winning.line].forEach((row, r) => { const c = cellCenter(r, row); r ? g.lineTo(c.x, c.y) : g.moveTo(c.x, c.y); });
    g.stroke(); g.shadowBlur = 0; g.globalAlpha = 1;
    for (let r = 0; r < winning.n; r++) {
      const row = LINES[winning.line][r];
      g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(X0 + r * CWD + 3, Y0 + RH * row + 3, CWD - 10, RH - 6);
    }
  }
  // big message over the reels
  let msg = '';
  if (!v.done && v.spin && v.spin.leap) msg = '🐸 FROG LEAP! 🐸';
  else if (fancy && v.done && v.spin && v.spin.win > 0 && t - v.winAt < 2.5) {
    const mult = v.spin.win / (v.spin.lineBet || v.spin.bet || 1);
    msg = mult >= 20 ? 'BIG WIN!' : v.spin.leap ? 'LEAP WIN!' : '';
  } else if (v.done && full && who && fancy) msg = 'FREE LEAP READY!';
  if (msg && (msg !== 'FREE LEAP READY!' || !fancy || Math.floor(t * 2) % 2 === 0)) {
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, Y0 + RH * 2.5 - 36, W, 72);
    ledText(msg, W / 2, Y0 + RH * 2.5, 46, '#ffe36b');
  }
  // LED readouts along the bottom
  const credits = who ? Math.max(0, chipsOf(who) - (mine ? pendingWin : (v.done ? 0 : (v.spin ? v.spin.win : 0)))) : 0;
  const bet = mine ? myBet : (v.spin ? v.spin.lineBet || v.spin.bet : 0);
  const winShown = Math.round(v.shownWin);
  const LY = Y0 + RH * ROWS + 8;
  g.fillStyle = '#000'; g.fillRect(0, LY, W, H - LY);
  [['CREDITS', who ? credits.toLocaleString() : '----', 110], ['BET', bet ? String(bet) : '--', 320], ['WIN', String(winShown), 530]].forEach(([label, val, x]) => {
    ledText(label, x, LY + 18, 14, '#7dffc0');
    ledText(val, x, LY + 52, 34, label === 'WIN' && winShown ? '#ffe36b' : '#ff4a3d');
  });
  tex.needsUpdate = true;
}
drawScreen();

// ---------- Playing ----------
function banner(text, secs) { if (hooks.banner) hooks.banner(text, secs); }
export function slotEnter() {   // try to take the machine; resolves true if it's yours
  if (!S.myName) return Promise.resolve(false);
  return runTransaction(ref(db, 'room/slots/m0'), d => {
    d = d || {};
    if (d.user && d.user !== myId && S.presence[d.user]) return;   // someone else is playing it
    d.user = myId; d.name = S.myName; d.c = S.myHue;
    return d;
  }).then(r => {
    if (!r.committed) { banner(`${M.name} is taken by ${machine.name || 'someone'}`, 2.5); return false; }
    mine = true;
    onDisconnect(ref(db, 'room/slots/m0/user')).remove();
    refreshSlotUI();
    return true;
  }).catch(e => { console.warn('Slots enter', e); return false; });
}
export function slotLeave() {
  if (!mine) return;
  mine = false;
  runTransaction(ref(db, 'room/slots/m0/user'), u => (u === myId ? null : undefined)).catch(() => {});
  refreshSlotUI();
}
export function slotSpin() {
  if (!mine || !view.done) return;
  const bet = myBet;
  const leap = hopOf(S.myName) >= HOP_MAX;
  let stops, res, tries = 0;
  do {
    stops = M.strips.map(s => Math.floor(Math.random() * s.length));
    res = pay(stops);
  } while (leap && res.units < LINES.length && ++tries < 2000);   // a Leap always pays at least your bet back
  const win = winFor(res.units, bet);
  let broke = false, hopAfter = 0;
  runTransaction(ref(db, 'room/slots/chips/' + chipKey(S.myName)), c => {
    c = c || { n: START_CHIPS, day: today(), hop: 0, m: 1 };
    broke = false;
    const hop = c.hop || 0;
    if ((hop >= HOP_MAX) !== leap) return;   // the meter changed under us; try again
    if (leap) { c.n += win; c.hop = 0; hopAfter = 0; return c; }
    if (c.n < bet) { broke = true; return; }
    c.n = c.n - bet + win;
    c.hop = win > 0 ? hop : hop + 1;
    hopAfter = c.hop;
    return c;
  }).then(r => {
    if (!r.committed) {
      banner(broke && chipsOf(S.myName) < BETS[0] ? `🪙 Out of money · +${DAILY.toLocaleString()} allowance tomorrow!` : broke ? `Not enough money for a ${bet} bet` : 'Try that spin again', 2.5);
      return;
    }
    pendingWin = win; pendingUntil = serverNow() + SPIN_TIME * 1000 + 300;
    const n = ((machine.spin && machine.spin.n) || 0) + 1;
    update(ref(db, 'room/slots/m0'), { spin: { n, at: serverNow(), stops, bet: leap ? 0 : bet, lineBet: bet, win, name: S.myName, leap, hop: hopAfter, v: 2 } });
  }).catch(e => console.warn('Slots spin', e));
}
export function slotSetBet(b) { if (BETS.includes(b)) { myBet = b; refreshSlotUI(); } }

// A new spin arrived (mine or someone else's): start the reels toward their stops
function startSpin(spin, live) {
  const v = view;
  v.spinN = spin.n; v.at = spin.at; v.spin = spin;
  for (let r = 0; r < REELS; r++) {
    const L = M.strips[r].length;
    const start = ((Math.round(v.pos[r]) % L) + L) % L;
    const dist = ((spin.stops[r] - start) % L + L) % L;
    v.from[r] = start;
    v.to[r] = start + dist + L * (2 + Math.floor(r / 2));   // a few full turns, more for later reels
    if (!live) v.pos[r] = spin.stops[r];
  }
  v.done = !live;
  v.wins = pay(spin.stops).wins;
  v.shownWin = live ? 0 : (spin.win || 0);
  v.winAt = performance.now() / 1000;
  if (live) { v.leverT = 0.001; if (mine) sound(spin.leap ? 'whoosh' : 'clack', 0.9); }
  drawScreen();
}
function finishSpin() {
  const v = view, s = v.spin;
  v.done = true;
  v.winAt = performance.now() / 1000;
  if (!s) return;
  const mult = s.win / (s.lineBet || s.bet || 1);
  if (s.win > 0) v.flashUntil = performance.now() + (mult >= 20 ? 4000 : 1800);
  if (mine && s.name === S.myName) {
    pendingWin = 0;
    if (s.leap) banner(`🐸 Frog Leap! +${s.win}`, 2.5);
    else if (mult >= 20) banner(`🎉 BIG WIN! +${s.win}`, 4);
    if (s.win > 0) sound(mult >= 20 || s.leap ? 'win' : 'coin');
  }
  if (mult >= 30) hooks.addSys(`🎰 ${s.name} hit a big win on ${M.name}! +${s.win}`);
  refreshSlotUI();
}

// ---------- Every frame ----------
let redraw = true, wasNear = false;
export function updateSlots(dt) {
  const now = serverNow(), t = performance.now(), v = view, near = S.atSlot >= 0;
  if (!v.done) {
    const el = (now - v.at) / 1000;
    let allDone = true;
    for (let r = 0; r < REELS; r++) {
      const T = SPIN_FIRST + REEL_GAP * r;
      const u = Math.min(1, Math.max(0, el / T));
      const before = v.pos[r];
      v.pos[r] = v.from[r] + (v.to[r] - v.from[r]) * (1 - Math.pow(1 - u, 3));
      if (u < 1) allDone = false;
      else if (before !== v.to[r] && mine) sound('reel');
      if (u >= 1) v.pos[r] = v.to[r];
    }
    if (allDone) { v.pos = v.pos.map((p, r) => { const L = M.strips[r].length; return ((Math.round(p) % L) + L) % L; }); finishSpin(); redraw = true; }
    if (redraw || t - v.lastDraw > (near ? 33 : 100)) { v.lastDraw = t; redraw = false; drawScreen(); }   // smooth up close, lighter from afar
  } else {
    if (v.spin && v.shownWin < v.spin.win) {   // the WIN counter counts up
      v.shownWin = near ? Math.min(v.spin.win, v.shownWin + Math.max(1, v.spin.win) * dt * 1.2) : v.spin.win;
      redraw = true;
    }
    // up close the screen keeps moving (bubbles, win lines); from across the room it only redraws when something changes
    if ((near && t - v.lastDraw > 50) || (redraw && t - v.lastDraw > 100) || near !== wasNear) { v.lastDraw = t; redraw = false; drawScreen(); }
  }
  wasNear = near;
  // light strips and the spin button glow, brighter while it spins or after a win
  const hot = !v.done || t < v.flashUntil;
  const lvl = hot ? 0.6 + 0.4 * Math.abs(Math.sin(t / 90)) : 0.55 + 0.25 * Math.sin(t / 700);
  strips.forEach((st, k) => st.material.color.set(M.glow).multiplyScalar(k ? lvl : 1.15 - lvl));
  spinBtn.material.color.set(mine && v.done ? 0x5cffb0 : 0x2e8a5c).multiplyScalar(0.7 + 0.3 * Math.sin(t / 250));
  // the lever swings down and back when a spin starts
  if (v.leverT > 0) { v.leverT += dt; if (v.leverT > 0.5) v.leverT = 0; }
  lever.rotation.x = v.leverT > 0 ? Math.sin(Math.min(1, v.leverT / 0.5) * Math.PI) * 1.1 : 0;
  // bulbs: a slow chase, and a fast flash after a win
  const flashing = t < v.flashUntil;
  bulbs.forEach((b, k) => {
    const on = flashing ? (Math.floor(t / 120) % 2 === 0) : ((Math.floor(t / 300) + k) % 3 === 0);
    b.material.color.set(M.glow).multiplyScalar(on ? 1 : 0.25);
  });
  if (pendingWin && serverNow() > pendingUntil + 1500) pendingWin = 0;   // safety: never hide a win for long
}

// ---------- The bottom bar while you're at the machine ----------
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
  if (!mine) return;
  const shown = Math.max(0, chipsOf(S.myName) - pendingWin);
  slotChips.textContent = `🪙 ${shown.toLocaleString()}`;
  betBtns.forEach((b, k) => b.classList.toggle('on', BETS[k] === myBet));
  slotSpinBtn.disabled = !view.done;
  const hop = hopOf(S.myName), s = M.syms;
  slotSpinBtn.textContent = hop >= HOP_MAX ? '🐸 Free Leap!' : '🎰 Spin';
  slotPays.textContent = `10 lines · ${s[WILD]} is wild · every losing spin fills the Hop Meter (${hop}/${HOP_MAX}); when it's full your next spin is a free Leap that pays at least your bet`
    + ` · Pays (× line bet, 3/4/5 in a row): ${[5, 4, 3, 2, 1, 0].map(k => `${s[k]} ${M.pays[k].join('/')}`).join(' · ')}`;
}

// ---------- Room money: the 5,000 start and the daily allowance (checked when you join the room) ----------
function claimDaily() {
  if (!S.myName) return;
  let got = '', added = 0;
  runTransaction(ref(db, 'room/slots/chips/' + chipKey(S.myName)), c => {
    got = ''; added = 0;
    if (!c) { got = 'start'; return { n: START_CHIPS, day: today(), hop: 0, m: 1 }; }   // first time here
    if (typeof c.n !== 'number') c.n = 0;
    if (!c.m) {   // money from before room money: anyone below 5,000 gets topped up once
      c.m = 1;
      if (c.n < START_CHIPS) { added = START_CHIPS - c.n; c.n = START_CHIPS; got = 'bump'; }
      c.day = today();
      return c;
    }
    if (c.day !== today()) {
      c.day = today();
      if (c.n < START_CHIPS) { added = Math.min(DAILY, START_CHIPS - c.n); c.n += added; got = 'daily'; }
    }
    return c;
  }).then(r => {
    if (!r.committed) return;
    if (got === 'start') banner(`🪙 Welcome! You start with ${START_CHIPS.toLocaleString()} room money`, 3.5);
    else if (got === 'bump') banner(`🪙 Room money! Topped up to ${START_CHIPS.toLocaleString()}`, 3.5);
    else if (got === 'daily') banner(`🎁 Daily allowance! +${added.toLocaleString()}`, 3.5);
  }).catch(e => console.warn('Room money', e));
}

// ---------- Listening ----------
export function startSlots() {
  claimDaily();
  let first = true;
  onValue(ref(db, 'room/slots/chips'), snap => {
    chips = snap.val() || {};
    redraw = true;
    refreshSlotUI();
    if (hooks.refreshWho) hooks.refreshWho();
  });
  onValue(ref(db, 'room/slots/m0'), snap => {
    const d = snap.val() || {};
    const prevUser = occupant();
    machine = d;
    redraw = true;
    const fits = d.spin && d.spin.v === 2 && Array.isArray(d.spin.stops) && d.spin.stops.length === REELS;   // skip spins saved by older machines
    if (fits && d.spin.n !== view.spinN) {
      const live = !first && serverNow() - d.spin.at < SPIN_TIME * 1000 + 2000;
      startSpin(d.spin, live);
    }
    first = false;
    if (mine && d.user && d.user !== myId) { mine = false; if (hooks.slotKicked) hooks.slotKicked(); }
    if (occupant() !== prevUser && hooks.refreshAll) hooks.refreshAll();
    refreshSlotUI();
  });
}