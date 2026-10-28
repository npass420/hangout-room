// =====================================================================
// othello.js — the Othello board, rules and score counters
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, scene, TABLE_Y, paintTexture, std, easeInOut,
         makeCounter, drawCounter, placeCounter, sinkCounter, animateCounter } from './core.js';
import { sfx } from './sounds.js';

const gameRef = ref(db, 'room/game');
let game = null;     // the shared game state

export const CELL = 0.1;                  // size of one square
export const HALF = CELL * 4;             // half the board width
export const BOARD_TOP = TABLE_Y + 0.025; // height of the green surface
const DISC_H = 0.016;
export const othelloGroup = new THREE.Group();   // everything Othello, hidden while another game is on the table
scene.add(othelloGroup);

// Board frame and green felt
const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.06, 0.025, HALF * 2 + 0.06), std(0x2e1d12, 0.6));
boardFrame.position.y = TABLE_Y + 0.0125;
boardFrame.castShadow = true; boardFrame.receiveShadow = true;
othelloGroup.add(boardFrame);

const feltTex = paintTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#1e6b3c'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#0d3a1f'; g.lineWidth = 4;
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * w;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke();
  }
  g.fillStyle = '#0d3a1f';
  for (const [x, y] of [[2, 2], [2, 6], [6, 2], [6, 6]]) {
    g.beginPath(); g.arc((x / 8) * w, (y / 8) * h, 8, 0, Math.PI * 2); g.fill();
  }
});
export const felt = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), std(0xffffff, 0.95, { map: feltTex }));
felt.rotation.x = -Math.PI / 2;
felt.position.y = BOARD_TOP + 0.0005;
felt.receiveShadow = true;
felt.userData.isBoard = true;
othelloGroup.add(felt);

function cellCenter(idx) {
  const r = Math.floor(idx / 8), c = idx % 8;
  return new THREE.Vector3(-HALF + CELL * (c + 0.5), 0, -HALF + CELL * (r + 0.5));
}

// Discs: black on one side, white on the other. Rotation 0 = black up.
const discGeo = new THREE.CylinderGeometry(CELL * 0.4, CELL * 0.4, DISC_H / 2, 32);
const blackMat = std(0x111111, 0.75);   // less shiny so lamps can't wash it out
const whiteMat = std(0xf2efe6, 0.35);
const DISC_Y = BOARD_TOP + DISC_H / 2 + 0.001;
const discs = [];
for (let i = 0; i < 64; i++) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(discGeo, blackMat); b.position.y = DISC_H / 4;
  const w = new THREE.Mesh(discGeo, whiteMat); w.position.y = -DISC_H / 4;
  b.castShadow = w.castShadow = true;
  g.add(b, w);
  const p = cellCenter(i);
  g.position.set(p.x, DISC_Y, p.z);
  g.visible = false;
  othelloGroup.add(g);
  discs.push({ g, rot: 0, anim: null });
}

// Hint dots for legal moves
const hintMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
const hintGeo = new THREE.CircleGeometry(CELL * 0.14, 20);
const hintDots = [];
for (let i = 0; i < 64; i++) {
  const d = new THREE.Mesh(hintGeo, hintMat);
  const p = cellCenter(i);
  d.rotation.x = -Math.PI / 2;
  d.position.set(p.x, BOARD_TOP + 0.002, p.z);
  d.visible = false;
  othelloGroup.add(d);
  hintDots.push(d);
}

// ---------- Game rules ----------
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const NAMES = { 1: 'Black', 2: 'White' };
let cells = new Array(64).fill(0);   // what's shown on the board: 0 empty, 1 black, 2 white
let hintsOn = true;
const statusEl = document.getElementById('status');
const playersEl = document.getElementById('players');
const joinBtn = document.getElementById('join');
const newGameBtn = document.getElementById('newGame');
const hintsBtn = document.getElementById('hints');

function flipsFor(b, idx, who) {
  if (b[idx]) return [];
  const r0 = Math.floor(idx / 8), c0 = idx % 8, opp = 3 - who, out = [];
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr, c = c0 + dc;
    const line = [];
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === opp) { line.push(r * 8 + c); r += dr; c += dc; }
    if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === who) out.push(...line);
  }
  return out;
}
function legalMovesOn(b, who) {
  const m = [];
  for (let i = 0; i < 64; i++) if (flipsFor(b, i, who).length) m.push(i);
  return m;
}
function count(who) { return cells.filter(v => v === who).length; }
function freshCells() {
  const a = new Array(64).fill(0);
  a[27] = 2; a[28] = 1; a[35] = 1; a[36] = 2;
  return a.join('');
}

// A player slot only counts if that person is still in the room
export function validPlayer(c) {
  const id = game && game['p' + c];
  return id && S.presence[id] ? id : '';
}
function playerName(c) { const id = validPlayer(c); return id ? S.presence[id].name : ''; }
function bothJoined() { return !!(validPlayer(1) && validPlayer(2)); }
function gameActive() { return !!game && bothJoined() && !game.over; }
function myColor() { return game ? (game.p1 === myId ? 1 : game.p2 === myId ? 2 : 0) : 0; }
function myTurn() { return gameActive() && game['p' + game.turn] === myId; }
export function canPlayAt(idx) { return myTurn() && flipsFor(cells, idx, game.turn).length > 0; }

export function refreshPanel() {
  if (!game) statusEl.textContent = 'Connecting…';
  else if (!validPlayer(1) && !validPlayer(2)) statusEl.textContent = 'Sit in a chair and click Join game to play';
  else if (!bothJoined()) statusEl.textContent = 'Waiting for a second player to sit and join';
  else if (game.over) {
    const b = count(1), w = count(2);
    statusEl.textContent = b === w ? `Game over, it's a tie ${b}–${w}` :
      `Game over, ${b > w ? playerName(1) + ' (Black)' : playerName(2) + ' (White)'} wins ${Math.max(b, w)}–${Math.min(b, w)}`;
  } else {
    const who = `${NAMES[game.turn]}'s turn (${playerName(game.turn)})`;
    statusEl.textContent = (game.pass ? game.pass + ' · ' : '') + (myTurn() ? 'Your move!' : who);
  }
  playersEl.textContent = `Black: ${playerName(1) || 'open'} · White: ${playerName(2) || 'open'}`;

  const mine = myColor() && validPlayer(myColor());
  if ((S.seated < 0 && !mine) || S.boardView || !game) { joinBtn.style.display = 'none'; }
  else {
    joinBtn.style.display = 'inline-block';
    if (mine) { joinBtn.textContent = 'Leave game'; joinBtn.disabled = false; }
    else if (bothJoined()) { joinBtn.textContent = 'Game full'; joinBtn.disabled = true; }
    else { joinBtn.textContent = 'Join game'; joinBtn.disabled = false; }
  }
  newGameBtn.disabled = !game || (!mine && !!(validPlayer(1) || validPlayer(2)));
  updateHints();
}

function showDisc(idx, color) {
  const d = discs[idx];
  d.rot = color === 1 ? 0 : Math.PI;
  d.g.rotation.x = d.rot;
  d.g.position.y = DISC_Y;
  d.g.visible = true;
  d.anim = null;
}
function dropDisc(idx, color) {
  showDisc(idx, color);
  discs[idx].anim = { type: 'drop', t: 0, delay: 0 };
  discs[idx].g.position.y = DISC_Y + 0.08;
}
function flipDisc(idx, delay) {
  const d = discs[idx];
  d.anim = { type: 'flip', t: 0, delay, from: d.rot, to: d.rot + Math.PI };
  d.rot += Math.PI;
}

function updateHints() {
  const moves = (hintsOn && myTurn()) ? legalMovesOn(cells, game.turn) : [];   // only the player whose turn it is sees them
  hintDots.forEach((d, i) => { d.visible = moves.includes(i); });
}

// A new game state arrived from the room: animate the move if it's the next one, otherwise just show it
function applyGame(g) {
  const nc = [...g.cells].map(Number);
  const animate = game && g.moveNo === game.moveNo + 1 && g.last >= 0;
  if (animate) {
    const origin = cellCenter(g.last);
    dropDisc(g.last, nc[g.last]);
    if (S.activeGame === 'othello') sfx.disc();
    for (let i = 0; i < 64; i++) {
      if (i !== g.last && cells[i] && nc[i] !== cells[i]) {
        const delay = 0.15 + cellCenter(i).distanceTo(origin) * 1.2;
        flipDisc(i, delay);
        if (S.activeGame === 'othello') sfx.flip(delay);
      }
    }
  } else {
    for (let i = 0; i < 64; i++) {
      if (nc[i]) showDisc(i, nc[i]);
      else { discs[i].g.visible = false; discs[i].anim = null; }
    }
  }
  cells = nc;
  game = g;
  hooks.refreshAll();
}

// Place a disc (only on your own turn). The room checks it again so two clicks can't clash.
export function play(idx) {
  if (!myTurn() || !flipsFor(cells, idx, game.turn).length) return;
  runTransaction(gameRef, g => {
    if (!g) return;
    const b = [...g.cells].map(Number);
    const who = g.turn;
    if (g.over || g['p' + who] !== myId) return;
    const flips = flipsFor(b, idx, who);
    if (!flips.length) return;
    b[idx] = who;
    flips.forEach(f => { b[f] = who; });
    let next = 3 - who, pass = '', over = false;
    if (!legalMovesOn(b, next).length) {
      if (legalMovesOn(b, who).length) { pass = `${NAMES[next]} has no moves, ${NAMES[who]} goes again`; next = who; }
      else over = true;
    }
    return { ...g, cells: b.join(''), turn: next, pass, over, last: idx, moveNo: (g.moveNo || 0) + 1 };
  });
}

function newGame() {
  if (newGameBtn.disabled) return;
  update(gameRef, { cells: freshCells(), turn: 1, over: false, pass: '', last: -1, moveNo: (game.moveNo || 0) + 1 });
}

function joinOrLeave() {
  if (!game) return;
  const mine = myColor();
  if (mine) { update(gameRef, { ['p' + mine]: '', ['s' + mine]: -1 }); return; }
  if (S.seated < 0) return;
  const c = !validPlayer(1) ? 1 : !validPlayer(2) ? 2 : 0;
  if (!c) return;
  const seat = S.seated;
  runTransaction(gameRef, g => {
    if (!g) return;
    const cur = g['p' + c];
    if (cur && cur !== myId && S.presence[cur]) return;   // someone else just took it
    g['p' + c] = myId;
    g['s' + c] = seat;
    return g;
  });
}
joinBtn.addEventListener('click', joinOrLeave);
newGameBtn.addEventListener('click', newGame);
hintsBtn.addEventListener('click', () => {
  hintsOn = !hintsOn;
  hintsBtn.textContent = hintsOn ? 'Hints: On' : 'Hints: Off';
  updateHints();
});

// Your counter follows you when you change seats
export function othelloSeatChanged(seat) {
  const mine = myColor();
  if (mine) update(gameRef, { ['s' + mine]: seat });
}

// Start listening to the shared game (called when you enter the room)
export function startOthello() {
  get(gameRef).then(s => {   // create it the first time anyone ever visits
    if (!s.exists()) set(gameRef, { cells: freshCells(), turn: 1, over: false, pass: '', last: -1, moveNo: 0, p1: '', p2: '', s1: -1, s2: -1 });
  });
  onValue(gameRef, s => { if (s.exists()) applyGame(s.val()); });
}

// ---------- Score counters in front of each player ----------
const CNT_DIST = HALF + 0.03 + 0.07;   // just off the board's edge (straight-on seats)
const CNT_DIST_CORNER = 0.76;          // seats facing a corner of the board sit a bit farther out
const counters = { 1: makeCounter(13, 0.12, othelloGroup), 2: makeCounter(13, 0.12, othelloGroup) };
export function refreshCounters() {
  for (const c of [1, 2]) {
    const cnt = counters[c];
    const seat = validPlayer(c) ? game['s' + c] : -1;
    if (seat >= 0) { if (!cnt.active || cnt.seat !== seat) placeCounter(cnt, seat, seat % 2 ? CNT_DIST_CORNER : CNT_DIST); }
    else if (cnt.active) sinkCounter(cnt);
  }
}

// ---------- Every frame ----------
export function updateOthello(dt) {
  for (const d of discs) {
    const a = d.anim;
    if (!a) continue;
    a.t += dt;
    if (a.t < a.delay) continue;
    if (a.type === 'drop') {
      const p = Math.min((a.t - a.delay) / 0.2, 1);
      d.g.position.y = DISC_Y + 0.08 * (1 - p * p);
      if (p >= 1) d.anim = null;
    } else {
      const p = Math.min((a.t - a.delay) / 0.35, 1);
      d.g.rotation.x = a.from + (a.to - a.from) * easeInOut(p);
      d.g.position.y = DISC_Y + Math.sin(p * Math.PI) * 0.045;
      if (p >= 1) { d.g.rotation.x = a.to; d.g.position.y = DISC_Y; d.anim = null; }
    }
  }
  for (const color of [1, 2]) {
    const cnt = counters[color];
    if (cnt.outer.visible) drawCounter(cnt, count(color));
    animateCounter(cnt, dt);
  }
}

// Show the starting board until the room's game arrives
[...freshCells()].map(Number).forEach((v, i) => { if (v) showDisc(i, v); });
cells = [...freshCells()].map(Number);