// =====================================================================
// slots.js — three slot machines along the back wall, played with free chips
// Lily Pad Leap (lots of small wins), Trail Blazer (in between), Midnight Moon (rare big hits).
// Each pays back about 95% over time. Everyone in the room can watch each other's reels spin.
// =====================================================================
import * as THREE from 'three';
import { ref, update, onValue, runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, scene, ROOM, std, colorIndex } from './core.js';
import { sfx } from './sounds.js';
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) { console.warn('Slots sound', e); } }

// ---------- The three machines ----------
// Symbols go from most common to rarest; the last one is the wild, which counts as any symbol.
// pay3 = three in a row on the middle line (times your bet), pay2 = the first two matching, payW = three wilds.
const MACHINES = [
  { name: 'Lily Pad Leap', icon: '🐸', body: 0x2e7d4f, trim: 0x8fe3bd, screen: '#e8f8ef', sign: '#1b5e3a', glow: '#8fe3bd',
    syms: ['🍃', '🪰', '🌸', '🐞', '👑', '🐸'], counts: [9, 8, 7, 3, 2, 2],
    pay3: [3, 4, 9, 22, 70], pay2: [1, 1, 1, 0, 0], payW: 175 },
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
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
// Each machine's reel strip: its symbols shuffled the same way on every computer
MACHINES.forEach((m, i) => {
  const strip = [];
  m.counts.forEach((n, sym) => { for (let k = 0; k < n; k++) strip.push(sym); });
  const r = seeded(1234 + i * 777);
  for (let k = strip.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [strip[k], strip[j]] = [strip[j], strip[k]]; }
  m.strip = strip;
});
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
function occupant(i) { const u = machines[i] && machines[i].user; return u && S.presence[u] ? u : ''; }
export function slotOccupantOf(id) { for (let i = 0; i < 3; i++) if (occupant(i) === id) return i; return -1; }
export function slotName(i) { return MACHINES[i].name; }
export function slotStandSpot(i) { return { x: [-1.2, 0, 1.2][i], z: -ROOM / 2 + 0.36 + 0.62 }; }   // where a player's snowman stands

// ---------- Building the machines ----------
export const slotsGroup = new THREE.Group();
scene.add(slotsGroup);
const MACHINE_X = [-1.2, 0, 1.2];
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
  add(new THREE.BoxGeometry(0.66, 0.4, 0.02), trim, 0, SCREEN_Y, 0.125);                // screen bezel
  // The reels
  const cv = document.createElement('canvas'); cv.width = CELL_W * 3; cv.height = CELL_H * 3;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const screen = add(new THREE.PlaneGeometry(0.6, 0.6 * cv.height / cv.width), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0, SCREEN_Y, 0.137);
  screen.castShadow = false;
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
  views.push({ cv, ctx: cv.getContext('2d'), tex, bulbs, lever, leverT: 0, pos: [0, 0, 0], from: [0, 0, 0], to: [0, 0, 0], spinN: -1, at: 0, done: true, flashUntil: 0, L, drawn: '' });
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
    pendingWin = win; pendingUntil = serverNow() + (SPIN_FIRST + SPIN_GAP * 2) * 1000 + 300;
    const n = ((machines[i].spin && machines[i].spin.n) || 0) + 1;
    update(ref(db, 'room/slots/m' + i), { spin: { n, at: serverNow(), stops, bet, win, name: S.myName } });
  }).catch(e => console.warn('Slots spin', e));
}
export function slotSetBet(b) { if (BETS.includes(b)) { myBet = b; refreshSlotUI(); } }

// A new spin arrived (mine or someone else's): start the reels toward their stops
function startSpin(i, spin, live) {
  const v = views[i], L = v.L;
  v.spinN = spin.n; v.at = spin.at; v.spin = spin;
  for (let r = 0; r < 3; r++) {
    const start = ((Math.round(v.pos[r]) % L) + L) % L;
    const dist = ((spin.stops[r] - start) % L + L) % L;
    v.from[r] = start;
    v.to[r] = start + dist + L * (2 + r);   // a few full turns, more for later reels
    if (!live) v.pos[r] = spin.stops[r];
  }
  v.done = !live;
  if (live) { v.leverT = 0.001; if (i === myMachine) sound('clack', 0.9); }
  drawReels(i);
}
function finishSpin(i) {
  const v = views[i], m = MACHINES[i], s = v.spin;
  v.done = true;
  if (!s) return;
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
      for (let r = 0; r < 3; r++) {
        const T = SPIN_FIRST + SPIN_GAP * r;
        const u = Math.min(1, Math.max(0, el / T));
        const before = v.pos[r];
        v.pos[r] = v.from[r] + (v.to[r] - v.from[r]) * (1 - Math.pow(1 - u, 3));
        if (u < 1) allDone = false;
        else if (before !== v.to[r] && i === myMachine) sound('reel');
        if (u >= 1) v.pos[r] = v.to[r];
      }
      if (allDone) { v.pos = v.pos.map(p => ((Math.round(p) % v.L) + v.L) % v.L); finishSpin(i); }
      drawReels(i);
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
      if (d.spin && d.spin.n !== views[i].spinN) {
        const live = !first && serverNow() - d.spin.at < (SPIN_FIRST + SPIN_GAP * 2) * 1000 + 2000;
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