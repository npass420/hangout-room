// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/checkers/checkers.js <<<<<
// Checkers in the game den: played on the board summoned onto the marble table (pieces/summon.js), with the checkers
// made in the Workshop (checkerset.js): black onyx discs with a glowing glass jewel, crimson and violet.
// Sitting at the table, click the board: it's yours while you set up (anyone else who clicks it is told you're setting
// up a game). Pick how many players: 1 Player goes straight into a game against the computer (you're Crimson, it's
// Violet); Play both sides goes straight in with both sides yours; 2 Players and you wait, and everyone else sitting at
// the table gets a Join box on their screen. When someone joins, you're asked to Start; Start takes you both into the game
// (studio.js does the view). Anyone else sitting at the table can click the board during a game to watch it. Click one of your pieces (its square lights up, and the squares it can go to, with hints on), then a square.
// A capture flies the piece over to blast the other with its laser; a piece reaching the far side is crowned into a
// floating glowing orb. Rules: classic American checkers (crimson first; captures are a must and you keep jumping).
// Shared through the database (tables/checkers, where the old Table Room's game was kept), so everyone sees the same board and the same game.
//   startCheckers({ center, top, cell, parent, glowLayer, onView, seated })
//     center: the board's middle (x, z); top: the squares' top height; cell: one square; parent: where the pieces go;
//     onView(side, watching): called with your side (1 crimson, 2 violet) when the game starts, and 0 when you leave it;
//       watching: you're only watching (side 1's view)
//     seated(): whether you're sitting at the table (only those can set up, join or watch a game)
//   gives back { pick, tap(point), canTap(point), deselect(), openPanel(), show(on), playing(), leave(), update(t, dt) }
// =====================================================================================================================
import * as THREE from 'three';
import { ref, set, get, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, PHONE, renderer } from '../core.js';

import { softEnv } from './pieceenv.js';
import { makeCheckerSet } from './checkerset.js';

// ---------- The rules ----------
// The board: 64 letters, row by row: '.' empty, 'r' crimson, 'R' crimson king, 'w' violet, 'W' violet king. Crimson
// starts on rows 5 to 7 and moves toward row 0; violet starts on rows 0 to 2 and moves toward row 7. Pieces stand on squares where
// row + column is odd (the dark marble squares).
const rc = sq => [Math.floor(sq / 8), sq % 8];
const at = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1);
const START = (() => {
  let b = '';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) b += (r + c) % 2 === 1 ? (r < 3 ? 'w' : r > 4 ? 'r' : '.') : '.';
  return b;
})();
const owner = ch => (ch === 'r' || ch === 'R' ? 1 : ch === 'w' || ch === 'W' ? 2 : 0);
const isKing = ch => ch === 'R' || ch === 'W';
function dirs(ch) {
  if (isKing(ch)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return ch === 'r' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}
function jumps(b, sq) {
  const ch = b[sq], me = owner(ch), out = [], [r, c] = rc(sq);
  for (const [dr, dc] of dirs(ch)) {
    const mid = at(r + dr, c + dc), land = at(r + 2 * dr, c + 2 * dc);
    if (land >= 0 && b[land] === '.' && owner(b[mid]) === 3 - me) out.push({ f: sq, t: land, cap: mid });
  }
  return out;
}
function steps(b, sq) {
  const [r, c] = rc(sq), out = [];
  for (const [dr, dc] of dirs(b[sq])) { const t = at(r + dr, c + dc); if (t >= 0 && b[t] === '.') out.push({ f: sq, t }); }
  return out;
}
function allMoves(st, who) {   // every legal move for a side (only jumps, if any jump exists)
  const b = st.board;
  if (st.chain >= 0) return jumps(b, st.chain);
  let js = [], ss = [];
  for (let sq = 0; sq < 64; sq++) {
    if (owner(b[sq]) !== who) continue;
    js = js.concat(jumps(b, sq));
    if (!js.length) ss = ss.concat(steps(b, sq));
  }
  return js.length ? js : ss;
}
const movesFrom = (st, sq) => allMoves(st, st.turn).filter(m => m.f === sq);
function play(st, m) {   // the next state after a legal move
  const b = [...st.board], who = st.turn, ch = b[m.f];
  b[m.t] = ch; b[m.f] = '.';
  if (m.cap !== undefined) b[m.cap] = '.';
  const [r] = rc(m.t);
  let crowned = false;
  if (ch === 'r' && r === 0) { b[m.t] = 'R'; crowned = true; }
  if (ch === 'w' && r === 7) { b[m.t] = 'W'; crowned = true; }
  st.board = b.join('');
  st.last = { f: m.f, t: m.t, cap: m.cap === undefined ? -1 : m.cap };
  if (m.cap !== undefined && !crowned && jumps(st.board, m.t).length) { st.chain = m.t; return st; }   // keep jumping
  st.chain = -1;
  st.turn = 3 - who;
  if (!allMoves(st, st.turn).length) { st.over = 1; st.winner = who; }
  return st;
}
const count = (b, who) => [...b].filter(ch => owner(ch) === who).length;
const fresh = () => ({ board: START, turn: 1, chain: -1, over: 0, winner: 0, last: { f: -1, t: -1, cap: -1 } });
const SIDES = { 1: 'Crimson', 2: 'Violet' };

// ---------- The computer: looks a few moves ahead (both sides playing their best), then picks the best move ----------
function worth(st) {   // how good the board is for Violet (the computer)
  if (st.over) return st.winner === 2 ? 100000 : -100000;
  let v = 0;
  const b = st.board;
  for (let sq = 0; sq < 64; sq++) {
    const ch = b[sq];
    if (ch === '.') continue;
    const [r, c] = rc(sq), who = owner(ch);
    let p = isKing(ch) ? 175 : 100 + (who === 2 ? r : 7 - r) * 5;   // (men are worth more the closer they get to crowning)
    if (!isKing(ch) && ((who === 2 && r === 0) || (who === 1 && r === 7))) p += 12;   // (the back row guarded)
    if (c >= 2 && c <= 5 && r >= 2 && r <= 5) p += 6;   // (the middle of the board)
    v += who === 2 ? p : -p;
  }
  return v;
}
function search(st, depth, lo, hi) {
  if (depth <= 0 || st.over) return worth(st) + (st.over ? (st.winner === 2 ? depth : -depth) : 0);   // (sooner wins first)
  const moves = allMoves(st, st.turn);
  if (!moves.length) return st.turn === 2 ? -100000 : 100000;
  const max = st.turn === 2;
  let best = max ? -Infinity : Infinity;
  for (const m of moves) {
    const v = search(play({ ...st }, m), depth - 1, lo, hi);
    if (max) { if (v > best) best = v; if (best > lo) lo = best; }
    else { if (v < best) best = v; if (best < hi) hi = best; }
    if (lo >= hi) break;
  }
  return best;
}
function cpuPick(st) {
  const moves = allMoves(st, 2);
  if (moves.length < 2) return moves[0];
  const pieces = [...st.board].filter(ch => ch !== '.').length;
  const depth = pieces > 12 ? 6 : 7;   // (fewer pieces left: it looks further ahead)
  let best = null, bestV = -Infinity;
  for (const m of moves) {
    const v = search(play({ ...st }, m), depth - 1, -Infinity, Infinity) + Math.random() * 4;   // (a touch of chance between equal moves)
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}

// ---------- The game ----------
// The board's rows run along x (crimson's end at +x), its columns along z.
export function startCheckers({ center, top, cell, parent, glowLayer = 1, onView = () => {}, seated = () => true, onStart = () => {} }) {
  const HALF = cell * 4, SIZE = cell * 0.82;   // (a piece fits well inside its square)
  const cellPos = sq => { const [r, c] = rc(sq); return [center.x - HALF + cell * (r + 0.5), center.z - HALF + cell * ((7 - c) + 0.5)]; };
  const G = { st: null, sel: -1, targets: [], ref: ref(db, 'tables/checkers'), pieces: {}, J: null, queue: Promise.resolve(), shown: false, cpuFor: -1 };
  let viewing = false;   // (in the game view: the room is locked onto the board)
  let watching = false;  // (in it only to watch)
  const ctrlRef = ref(db, 'tables/control');   // who's setting up a game at the board right now: { id, name }
  let ctrl = null;
  onValue(ctrlRef, s => { ctrl = s.val(); refreshPanel(); });
  const holding = () => !!(ctrl && ctrl.id === myId);
  function claim() {   // the board is yours while you set up (if nobody else has it)
    return runTransaction(ctrlRef, c => (!c || !here(c.id) || c.id === myId ? { id: myId, name: S.myName } : undefined))
      .then(r => r.committed && r.snapshot.val() && r.snapshot.val().id === myId).catch(() => false);
  }
  function release() { runTransaction(ctrlRef, c => (c && c.id === myId ? null : undefined)).catch(() => {}); }

  // the pieces: the Workshop's checkers with their own light (phones: the lighter ones), set out fresh when needed
  function setOut(st) {
    if (G.J) { parent.remove(G.J.group); G.J.dispose(); G.J = null; }
    G.pieces = {};
    if (!G.shown) return;
    const mats = [];
    G.J = makeCheckerSet(THREE, { materials: mats, glowLayer, lite: PHONE, light: false, envMap: softEnv(renderer) });   // (each piece made reflecting the soft round lights)   // (a drawn glow, not 24 real lights: those overwork the computer)
    parent.add(G.J.group);
    for (let sq = 0; sq < 64; sq++) {
      const ch = st.board[sq];
      if (ch === '.') continue;
      const [x, z] = cellPos(sq);
      const p = G.J.piece(x, z, top, SIZE, owner(ch) === 1 ? 'crimson' : 'violet');
      if (isKing(ch)) p.setKing(true, true);
      p.restore();   // (each grows up onto its square)
      G.pieces[sq] = p;
    }
  }

  // the marks on the board: the square you picked (a soft gold glow) and, with hints on, where it can go
  const markGeo = new THREE.PlaneGeometry(cell * 0.92, cell * 0.92).rotateX(-Math.PI / 2);
  const markMat = color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  const selMark = new THREE.Mesh(markGeo, markMat(0xffc860));
  selMark.visible = false; parent.add(selMark);
  const targetMarks = Array.from({ length: 12 }, () => { const m = new THREE.Mesh(markGeo, markMat(0x8affc8)); m.visible = false; parent.add(m); return m; });
  let hintsOn = true;
  try { hintsOn = localStorage.getItem('tableHints') !== 'off'; } catch (e) {}
  function refreshMarks() {
    const put = (m, sq) => { const [x, z] = cellPos(sq); m.position.set(x, top + 0.001, z); m.visible = true; };
    selMark.visible = false; targetMarks.forEach(m => { m.visible = false; });
    if (!G.shown) return;
    if (G.sel >= 0) put(selMark, G.sel);
    if (hintsOn) G.targets.forEach((m, i) => { if (targetMarks[i]) put(targetMarks[i], m.t); });
  }

  // clicking on the board: an invisible sheet over the squares (and half a square past them)
  const pick = new THREE.Mesh(new THREE.PlaneGeometry(cell * 9, cell * 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(center.x, top + 0.002, center.z);
  pick.userData.boardPick = true;
  pick.visible = false;
  parent.add(pick);
  function squareAt(point) {
    const r = Math.floor((point.x - center.x + HALF) / cell), c = 7 - Math.floor((point.z - center.z + HALF) / cell);
    return at(r, c);
  }

  // ---------- Players ----------
  const here = id => !!(id && S.presence[id]);
  const solo = () => !!(G.st && G.st.p1 && G.st.p1 === G.st.p2 && here(G.st.p1));
  const name = c => { if (G.st && G.st.cpu && c === 2) return 'Computer'; const id = G.st && G.st['p' + c]; return here(id) ? S.presence[id].name : ''; };
  const bothIn = () => !!(G.st && here(G.st.p1) && here(G.st.p2));
  const active = () => bothIn() && !G.st.over;
  const mySide = () => (G.st ? (G.st.p1 === myId ? 1 : G.st.p2 === myId ? 2 : 0) : 0);
  const cpuTurn = () => !!(G.st && G.st.cpu && G.st.turn === 2);
  const myTurn = () => active() && G.st['p' + G.st.turn] === myId && !cpuTurn();

  const tx = f => runTransaction(G.ref, st => f(st || { ...fresh(), moveNo: 0, p1: '', p2: '' })).catch(e => console.warn('checkers', e));
  const othersIn = st => (here(st.p1) && st.p1 !== myId) || (here(st.p2) && st.p2 !== myId);
  function players(n) {   // 1: straight into the game against the computer; 0: playing both sides yourself; 2: you take crimson and wait for someone to join
    if (n === 0 || n === 1) { tx(st => (othersIn(st) ? undefined : { ...st, ...fresh(), p1: myId, p2: myId, cpu: n, go: 1, moveNo: (st.moveNo || 0) + 1 })); release(); onStart(); }
    else tx(st => (othersIn(st) ? undefined : { ...st, ...fresh(), p1: myId, p2: '', cpu: 0, go: 0, moveNo: (st.moveNo || 0) + 1 }));
    panelOpen = false;
  }
  function join() {   // the open side of someone's game
    tx(st => {
      const open = here(st.p1) && !here(st.p2) ? 2 : here(st.p2) && !here(st.p1) ? 1 : 0;
      if (!open || st.p1 === myId || st.p2 === myId) return;
      return { ...st, ['p' + open]: myId, go: 0 };
    });
  }
  function begin() {   // the one who set it up: Start, and you both go in
    tx(st => (st['p1'] === myId && here(st.p1) && here(st.p2) ? { ...st, go: 1 } : undefined));
    release(); onStart();
  }
  function watch() { if (viewing) return; viewing = watching = true; panelOpen = false; onView(1, true); refreshPanel(); }
  function leave() {   // out of the game (your side opens up; playing alone, the whole game ends)
    if (viewing) { viewing = false; onView(0); }
    if (watching) { watching = false; refreshPanel(); return; }   // (only watching: nothing else changes)
    release();
    tx(st => {
      if (st.p1 === myId && st.p2 === myId) return { ...st, p1: '', p2: '', cpu: 0 };
      if (st.p1 === myId) return { ...st, p1: '' };
      if (st.p2 === myId) return { ...st, p2: '' };
      return;
    });
    G.sel = -1; G.targets = []; refreshMarks(); panelOpen = false; refreshPanel();
  }
  function enter() { const side = mySide(); if (!side || !bothIn() || viewing) return; viewing = true; panelOpen = false; if (holding()) release(); onView(side, false); refreshPanel(); }

  // ---------- Moves ----------
  function sendMove(m, asCpu) {
    tx(st => {
      if (st.over || !here(st.p1) || !here(st.p2)) return;
      if (asCpu ? !(st.cpu && st.turn === 2 && st.p1 === myId) : (st['p' + st.turn] !== myId || (st.cpu && st.turn === 2))) return;
      st.chain = st.chain === undefined ? -1 : st.chain;
      const legal = movesFrom(st, m.f).find(x => x.t === m.t);
      if (!legal) return;
      st = play(st, legal);
      st.moveNo = (st.moveNo || 0) + 1;
      return st;
    });
    if (!asCpu) { G.sel = -1; G.targets = []; }
    refreshMarks();
  }
  function cpuMove() {   // (the computer's move, made by the one playing against it, once the last move has played out)
    const st = G.st;
    if (!st || !st.cpu || st.over || st.turn !== 2 || st.p1 !== myId || !viewing || G.cpuFor === st.moveNo) return;
    G.cpuFor = st.moveNo;
    G.queue.then(() => setTimeout(() => {
      const now = G.st;
      if (!now || now.moveNo !== st.moveNo || now.over) return;
      const m = cpuPick({ ...now, chain: now.chain === undefined ? -1 : now.chain });
      if (m) sendMove(m, true);
    }, st.chain >= 0 ? 450 : 800));
  }
  const NEAR_MOVE = 0.65;   // (a click a little off still counts for the nearest square it can go to)
  function nearestMove(point) {
    let best = null, bestD = NEAR_MOVE * cell;
    for (const m of G.targets) {
      const [x, z] = cellPos(m.t), d = Math.hypot(point.x - x, point.z - z);
      if (d < bestD) { best = m; bestD = d; }
    }
    return best;
  }
  const mine = (st, sq) => sq >= 0 && owner(st.board[sq]) === st.turn && !(st.chain >= 0 && sq !== st.chain);
  function tap(point) {   // a click on the board: in the game, a move; otherwise, setting one up (or watching one)
    if (!viewing) { boardClicked(); return; }
    if (!G.st || !myTurn()) return;
    const st = G.st, sq = squareAt(point);
    if (mine(st, sq)) {
      if (sq === G.sel && st.chain < 0) { G.sel = -1; G.targets = []; }
      else {
        const moves = movesFrom(st, sq);
        G.sel = sq; G.targets = moves;
        if (!moves.length && allMoves(st, st.turn).some(x => x.cap !== undefined) && hooks.banner) hooks.banner('You have to jump!', 1.8);
      }
    } else if (G.sel >= 0) {
      const m = G.targets.find(x => x.t === sq) || nearestMove(point);
      if (m) { sendMove(m); return; }
    }
    refreshMarks(); refreshPanel();
  }
  function boardClicked() {
    const say = t => { if (hooks.banner) hooks.banner(t, 2); };
    if (!seated()) { say('Sit at the table to play'); return; }
    const st = G.st;
    if (!st) return;
    if (mySide()) { panelOpen = true; refreshPanel(); return; }                   // (your own game: its panel)
    if (bothIn() && st.go) { watch(); return; }                                  // (a game going on: watch it)
    if (here(st.p1) || here(st.p2)) { panelOpen = true; refreshPanel(); return; }   // (someone waiting: the join box)
    if (ctrl && ctrl.id !== myId && here(ctrl.id)) { say(`${ctrl.name} is setting up a game`); return; }
    claim().then(ok => {
      if (ok) { panelOpen = true; refreshPanel(); }
      else if (ctrl && ctrl.id !== myId) say(`${ctrl.name} is setting up a game`);
    });
  }
  function canTap(point) {
    if (watching) return false;
    if (!viewing) return true;
    if (!G.st || !myTurn()) return false;
    const sq = squareAt(point);
    if (mine(G.st, sq) && movesFrom(G.st, sq).length > 0) return true;
    return G.sel >= 0 && !!(G.targets.find(x => x.t === sq) || nearestMove(point));
  }
  function deselect() {
    if (panelOpen && !viewing) { closePanel(); return true; }
    if (G.sel < 0 || (G.st && G.st.chain >= 0)) return false;
    G.sel = -1; G.targets = []; refreshMarks();
    return true;
  }

  // ---------- Shared state arrives: animate the move that was made, or set the board out ----------
  function applyState(st) {
    st.last = st.last || { f: -1, t: -1, cap: -1 };
    if (st.chain === undefined) st.chain = -1;
    const prev = G.st;
    const next = prev && G.J && st.moveNo === (prev.moveNo || 0) + 1 && prev.board !== st.board && st.last.f >= 0 && G.pieces[st.last.f];
    G.st = st;
    if (next) {
      const { f, t, cap } = st.last, p = G.pieces[f], target = cap >= 0 ? G.pieces[cap] : null;
      delete G.pieces[f]; if (cap >= 0) delete G.pieces[cap];
      G.pieces[t] = p;
      const crowned = isKing(st.board[t]) && !isKing(prev.board[f]);
      const [x, z] = cellPos(t);
      G.queue = G.queue.then(() => p.moveTo(x, z, target)).then(() => { if (crowned) p.setKing(true); });
    } else if (!prev || prev.board !== st.board) {
      G.queue = Promise.resolve();
      setOut(st);
    }
    if (G.sel >= 0 && !(myTurn() && owner(st.board[G.sel]) === st.turn)) { G.sel = -1; G.targets = []; }
    else if (G.sel >= 0) G.targets = movesFrom(st, G.sel);
    if (myTurn() && st.chain >= 0) { G.sel = st.chain; G.targets = movesFrom(st, st.chain); }
    refreshMarks();
    if (prev && myTurn() && st.moveNo !== prev.moveNo && hooks.banner) hooks.banner(st.chain >= 0 ? 'Keep jumping!' : 'Your turn!', 1.8);
    if (prev && st.over && !prev.over) {
      const text = `${SIDES[st.winner]} wins!` + (solo() ? '' : ` (${name(st.winner)})`);
      if (hooks.banner) hooks.banner(text, 3.5);
      if (hooks.addSys) hooks.addSys('Checkers: ' + text);
    }
    if (viewing && !watching && !mySide()) { viewing = false; onView(0); }   // (your side was taken away: out of the game view)
    if (watching && !(bothIn() && st.go)) { viewing = watching = false; onView(0); }   // (the game you were watching is over and done)
    cpuMove();
    refreshPanel();
  }

  // ---------- The panel: over the board, bottom middle ----------
  const css = document.createElement('style');
  css.textContent = `
    #gamePanel { left: 50%; bottom: 16px; transform: translateX(-50%); min-width: 280px; max-width: 92vw; text-align: center; display: none;
      background: rgba(14,11,20,0.82); backdrop-filter: blur(6px); box-shadow: 0 4px 18px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(201,162,39,0.55); }
    #gamePanel.on { display: block; }
    #gamePanel .gpTitle { font-size: 19px; color: #ffe0a8; margin-bottom: 4px; font-style: italic; letter-spacing: 1px; }
    #gamePanel .gpStatus { font-size: 15px; margin-bottom: 4px; }
    #gamePanel .gpPlayers { font-size: 13px; opacity: 0.8; margin-bottom: 8px; }
    #gamePanel button { margin: 0 4px 6px; }
    #gamePanel button.big { font-size: 16px; padding: 8px 18px; }
    #gameOffer { left: 50%; top: 22%; transform: translateX(-50%); min-width: 260px; max-width: 92vw; text-align: center; display: none;
      background: rgba(14,11,20,0.88); backdrop-filter: blur(6px); box-shadow: 0 4px 18px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(201,162,39,0.7); }
    #gameOffer.on { display: block; }
    #gameOffer .goText { font-size: 17px; color: #ffe0a8; margin-bottom: 10px; }
    #gameOffer button { margin: 0 4px 6px; }
    #gameOffer button.big { font-size: 16px; padding: 8px 22px; }`;
  document.head.appendChild(css);
  const panel = document.createElement('div');
  panel.id = 'gamePanel'; panel.className = 'panel';
  panel.innerHTML = `<div class="gpTitle">Checkers</div><div class="gpStatus"></div><div class="gpPlayers"></div><div class="gpButtons"></div>`;
  document.body.appendChild(panel);
  const el = { status: panel.querySelector('.gpStatus'), players: panel.querySelector('.gpPlayers'), buttons: panel.querySelector('.gpButtons') };
  let panelOpen = false;
  function openPanel() { boardClicked(); }
  function closePanel() { panelOpen = false; if (holding() && !mySide()) release(); refreshPanel(); }
  // the Join box: everyone sitting at the table (not in the game) gets it when someone's waiting for a partner
  const offer = document.createElement('div');
  offer.id = 'gameOffer'; offer.className = 'panel';
  document.body.appendChild(offer);
  const said = {};   // (offers you said no to)
  function refreshOffer() {
    const st = G.st;
    const open = st && !st.cpu ? (here(st.p1) && !here(st.p2) ? 2 : here(st.p2) && !here(st.p1) ? 1 : 0) : 0;
    const key = st ? `${st.p1}|${st.p2}|${st.moveNo}` : '';
    const show = !!(st && open && !mySide() && seated() && !viewing && !panelOpen && !said[key]);
    offer.classList.toggle('on', show);
    if (!show) return;
    offer.textContent = '';
    const t = document.createElement('div'); t.className = 'goText';
    t.textContent = `${name(3 - open)} wants to play Checkers`;
    offer.appendChild(t);
    const yes = document.createElement('button'); yes.className = 'big'; yes.textContent = 'Join';
    yes.addEventListener('click', () => { yes.blur(); join(); });
    const no = document.createElement('button'); no.textContent = 'No thanks';
    no.addEventListener('click', () => { no.blur(); said[key] = true; refreshOffer(); });
    offer.append(yes, no);
  }
  const armed = {};
  function button(label, action, big = false, ask = false) {   // (buttons that end a game ask twice)
    const b = document.createElement('button');
    b.textContent = armed[label] ? 'Sure? Click again' : label;
    if (big) b.className = 'big';
    b.addEventListener('click', () => {
      b.blur();
      if (ask && !armed[label]) { armed[label] = true; setTimeout(() => { armed[label] = false; refreshPanel(); }, 3000); refreshPanel(); return; }
      armed[label] = false; action();
    });
    el.buttons.appendChild(b);
  }
  function refreshPanel() {
    if (!viewing && G.shown && G.st && G.st.go && mySide() && bothIn()) { enter(); cpuMove(); return; }   // (Start was pressed: in you both go)
    refreshOffer();
    const show = G.shown && G.st && (panelOpen || viewing || (mySide() && !viewing));
    panel.classList.toggle('on', !!show);
    if (!show) return;
    const st = G.st, side = mySide(), alone = solo();
    el.buttons.textContent = '';
    let s = '';
    if (watching) {
      s = st.over ? `${SIDES[st.winner]} wins!` : `Watching · ${SIDES[st.turn]} to move`;
    } else if (!side) {
      const open = !st.cpu && (here(st.p1) && !here(st.p2) ? 2 : here(st.p2) && !here(st.p1) ? 1 : 0);
      if (!here(st.p1) && !here(st.p2)) {
        s = 'How many players?';
        button('1 Player', () => players(1), true);
        button('2 Players', () => players(2), true);
        button('Play both sides', () => players(0), true);
      }
      else if (open) { s = `${name(3 - open)} is waiting for a partner`; button(`Join as ${SIDES[open]}`, join, true); }
      else s = st.cpu ? `${name(1)} is playing the computer` : alone ? `${name(1)} is playing` : `${name(1)} and ${name(2)} are playing`;
      button('Close', closePanel);
    } else if (!bothIn()) {
      s = 'Waiting for someone to join…';
      button('Cancel', leave);
    } else if (!viewing) {
      if (st.p1 === myId) { s = `${name(2)} joined! Start?`; button('Start', begin, true); button('Cancel', leave); }
      else { s = `Waiting for ${name(1)} to start…`; button('Leave', leave); }
    } else {
      if (st.over) s = `${SIDES[st.winner]} wins!`;
      else if (st.cpu) s = cpuTurn() ? 'The computer is thinking…' : (st.chain >= 0 ? 'Keep jumping! ' : '') + 'Your move!';
      else if (alone) s = (st.chain >= 0 ? 'Keep jumping! ' : '') + `${SIDES[st.turn]} to move`;
      else s = (st.chain >= 0 ? 'Keep jumping! ' : '') + (myTurn() ? 'Your move!' : `${SIDES[st.turn]}'s turn (${name(st.turn)})`);
      button(hintsOn ? '💡 Hints: on' : '💡 Hints: off', () => {
        hintsOn = !hintsOn; try { localStorage.setItem('tableHints', hintsOn ? 'on' : 'off'); } catch (e) {}
        refreshMarks(); refreshPanel();
      });
      button('New game', () => tx(st2 => ({ ...st2, ...fresh(), moveNo: (st2.moveNo || 0) + 1 })), false, active());
      if (!alone && !st.over) button('Resign', () => tx(st2 => (st2.over || st2['p' + side] !== myId ? undefined : { ...st2, over: 1, winner: 3 - side, moveNo: (st2.moveNo || 0) + 1 })), false, true);
    }
    el.status.textContent = s;
    el.players.textContent = (st.cpu ? `Crimson: ${name(1)} · Violet: Computer` : alone ? `Crimson and Violet: ${name(1)}` : `Crimson: ${name(1) || 'open'} · Violet: ${name(2) || 'open'}`) +
      ` · ${count(st.board, 1)} – ${count(st.board, 2)}`;
  }

  // ---------- Start: make the game the first time anyone ever visits, then listen ----------
  get(G.ref).then(s => { if (!s.exists()) set(G.ref, { ...fresh(), moveNo: 0, p1: '', p2: '' }); }).catch(() => {});
  onValue(G.ref, s => { if (s.exists()) applyState(s.val()); });

  return {
    pick, tap, canTap, deselect, openPanel, leave,
    shown: () => G.shown,
    playing: () => viewing,
    watching: () => watching,
    mySide,
    busy: () => !!(G.st && (here(G.st.p1) || here(G.st.p2))),
    // the den emptied: a fresh game with nobody in it (left alone if it already is one: everyone here sends it)
    reset: () => tx(st => (!st.p1 && !st.p2 && !st.over && st.board === START ? undefined
      : { ...st, ...fresh(), p1: '', p2: '', cpu: 0, go: 0, moveNo: (st.moveNo || 0) + 1 })),   // (someone's in a game: the board stays out)
    show(on) {   // the board is out (pieces set out, clicks on) or away
      if (G.shown === on) return;
      G.shown = on; pick.visible = on;
      if (G.st) setOut(G.st);
      if (!on) { panelOpen = false; if (holding()) release(); if (viewing) leave(); }
      refreshMarks(); refreshPanel();
    },
    refresh: refreshPanel,
    update(t) { if (G.J) G.J.update(t); }
  };
}
// >>>>> END OF FILE: HangoutRoom/checkers/checkers.js <<<<<
