// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/checkers/checkers.js <<<<<
// Checkers in the game den: played on the board summoned onto the marble table (pieces/summon.js), with the checkers
// made in the Workshop (checkerset.js): black onyx discs with a glowing glass jewel, crimson and violet.
// Click the board: a panel over it lets you play 1 Player (both sides yourself) or 2 Players (you take crimson and wait;
// anyone else who clicks the board can join as violet). Then Start: the room locks onto the board (studio.js does the
// view). Click one of your pieces (its square lights up, and the squares it can go to, with hints on), then a square.
// A capture flies the piece over to blast the other with its laser; a piece reaching the far side is crowned into a
// floating glowing orb. Rules: classic American checkers (crimson first; captures are a must and you keep jumping).
// Shared through the database (tables/checkers, where the old Table Room's game was kept), so everyone sees the same board and the same game.
//   startCheckers({ center, top, cell, parent, glowLayer, onView })
//     center: the board's middle (x, z); top: the squares' top height; cell: one square; parent: where the pieces go;
//     onView(side): called with your side (1 crimson, 2 violet) when you press Start, and 0 when you leave the game
//   gives back { pick, tap(point), canTap(point), deselect(), openPanel(), show(on), playing(), leave(), update(t, dt) }
// =====================================================================================================================
import * as THREE from 'three';
import { ref, set, get, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, PHONE, renderer } from '../core.js';

// what the pieces' polish reflects: a dark room with a few soft round lights (the room's own reflection picture has
// square light panels, which showed as square glares on the pieces); made once
let pieceEnv = null;
function softEnv() {
  if (pieceEnv) return pieceEnv;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#2a2630'); sky.addColorStop(0.45, '#0e0c12'); sky.addColorStop(1, '#030304');
  g.fillStyle = sky; g.fillRect(0, 0, 1024, 512);
  const blob = (x, y, r, rgb, a) => {
    for (const dx of [-1024, 0, 1024]) {
      const s = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      s.addColorStop(0, `rgba(${rgb},${a})`); s.addColorStop(0.35, `rgba(${rgb},${a * 0.45})`); s.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = s; g.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  };
  blob(512, 40, 170, '255,246,235', 0.9);   // (a soft round light overhead)
  blob(180, 150, 70, '255,240,225', 0.8);   // (smaller round lights round about, for round glints)
  blob(760, 170, 60, '235,225,255', 0.7);
  blob(930, 120, 40, '255,255,255', 0.6);
  blob(330, 230, 120, '120,40,60', 0.35);    // (faint warm and violet color low down)
  blob(640, 240, 120, '70,40,120', 0.35);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  const gen = new THREE.PMREMGenerator(renderer);
  pieceEnv = gen.fromEquirectangular(t).texture;
  gen.dispose(); t.dispose();
  return pieceEnv;
}
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

// ---------- The game ----------
// The board's rows run along x (crimson's end at +x), its columns along z.
export function startCheckers({ center, top, cell, parent, glowLayer = 1, onView = () => {} }) {
  const HALF = cell * 4, SIZE = cell * 0.82;   // (a piece fits well inside its square)
  const cellPos = sq => { const [r, c] = rc(sq); return [center.x - HALF + cell * (r + 0.5), center.z - HALF + cell * ((7 - c) + 0.5)]; };
  const G = { st: null, sel: -1, targets: [], ref: ref(db, 'tables/checkers'), pieces: {}, J: null, queue: Promise.resolve(), shown: false };
  let viewing = false;   // (you pressed Start: the room is locked onto the board)

  // the pieces: the Workshop's checkers with their own light (phones: the lighter ones), set out fresh when needed
  function setOut(st) {
    if (G.J) { parent.remove(G.J.group); G.J.dispose(); G.J = null; }
    G.pieces = {};
    if (!G.shown) return;
    const mats = [];
    G.J = makeCheckerSet(THREE, { materials: mats, glowLayer, lite: PHONE, light: false });   // (a drawn glow, not 24 real lights: those overwork the computer)
    for (const m of mats) if ('envMap' in m && !m.envMap) { m.envMap = softEnv(); m.envMapIntensity = 1.3; m.needsUpdate = true; }   // (something bright to reflect: the onyx polish and the glass)
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
  const name = c => { const id = G.st && G.st['p' + c]; return here(id) ? S.presence[id].name : ''; };
  const bothIn = () => !!(G.st && here(G.st.p1) && here(G.st.p2));
  const active = () => bothIn() && !G.st.over;
  const mySide = () => (G.st ? (G.st.p1 === myId ? 1 : G.st.p2 === myId ? 2 : 0) : 0);
  const myTurn = () => active() && G.st['p' + G.st.turn] === myId;

  const tx = f => runTransaction(G.ref, st => f(st || { ...fresh(), moveNo: 0, p1: '', p2: '' })).catch(e => console.warn('checkers', e));
  const othersIn = st => (here(st.p1) && st.p1 !== myId) || (here(st.p2) && st.p2 !== myId);
  function onePlayer() { tx(st => (othersIn(st) ? undefined : { ...st, ...fresh(), p1: myId, p2: myId, moveNo: (st.moveNo || 0) + 1 })); }
  function twoPlayers() {   // you take crimson and wait for someone to join as violet
    tx(st => {
      if (othersIn(st)) return;
      return { ...st, ...fresh(), p1: myId, p2: '', moveNo: (st.moveNo || 0) + 1 };
    });
  }
  function join() {   // the open side of someone's game
    tx(st => {
      const open = here(st.p1) && !here(st.p2) ? 2 : here(st.p2) && !here(st.p1) ? 1 : 0;
      if (!open || st.p1 === myId || st.p2 === myId) return;
      return { ...st, ['p' + open]: myId };
    });
  }
  function leave() {   // out of the game (your side opens up; playing alone, the whole game ends)
    if (viewing) { viewing = false; onView(0); }
    tx(st => {
      if (st.p1 === myId && st.p2 === myId) return { ...st, p1: '', p2: '' };
      if (st.p1 === myId) return { ...st, p1: '' };
      if (st.p2 === myId) return { ...st, p2: '' };
      return;
    });
    G.sel = -1; G.targets = []; refreshMarks(); panelOpen = false; refreshPanel();
  }
  function start() { const side = mySide(); if (!side || !bothIn()) return; viewing = true; panelOpen = false; onView(side); refreshPanel(); }

  // ---------- Moves ----------
  function sendMove(m) {
    tx(st => {
      if (st.over || st['p' + st.turn] !== myId || !here(st.p1) || !here(st.p2)) return;
      st.chain = st.chain === undefined ? -1 : st.chain;
      const legal = movesFrom(st, m.f).find(x => x.t === m.t);
      if (!legal) return;
      st = play(st, legal);
      st.moveNo = (st.moveNo || 0) + 1;
      return st;
    });
    G.sel = -1; G.targets = [];
    refreshMarks();
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
  function tap(point) {   // a click on the board: in the game, a move; otherwise, the panel
    if (!viewing) { openPanel(); return; }
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
  function canTap(point) {
    if (!viewing) return true;
    if (!G.st || !myTurn()) return false;
    const sq = squareAt(point);
    if (mine(G.st, sq) && movesFrom(G.st, sq).length > 0) return true;
    return G.sel >= 0 && !!(G.targets.find(x => x.t === sq) || nearestMove(point));
  }
  function deselect() {
    if (panelOpen && !viewing) { panelOpen = false; refreshPanel(); return true; }
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
    if (viewing && !mySide()) { viewing = false; onView(0); }   // (your side was taken away: out of the game view)
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
    #gamePanel button.big { font-size: 16px; padding: 8px 18px; }`;
  document.head.appendChild(css);
  const panel = document.createElement('div');
  panel.id = 'gamePanel'; panel.className = 'panel';
  panel.innerHTML = `<div class="gpTitle">Checkers</div><div class="gpStatus"></div><div class="gpPlayers"></div><div class="gpButtons"></div>`;
  document.body.appendChild(panel);
  const el = { status: panel.querySelector('.gpStatus'), players: panel.querySelector('.gpPlayers'), buttons: panel.querySelector('.gpButtons') };
  let panelOpen = false;
  function openPanel() { panelOpen = true; refreshPanel(); }
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
    const show = G.shown && G.st && (panelOpen || viewing || (mySide() && !viewing));
    panel.classList.toggle('on', !!show);
    if (!show) return;
    const st = G.st, side = mySide(), alone = solo();
    el.buttons.textContent = '';
    let s = '';
    if (!side) {
      const open = here(st.p1) && !here(st.p2) ? 2 : here(st.p2) && !here(st.p1) ? 1 : 0;
      if (!here(st.p1) && !here(st.p2)) { s = 'How many players?'; button('1 Player', onePlayer, true); button('2 Players', twoPlayers, true); }
      else if (open) { s = `${name(3 - open)} is waiting for a partner`; button(`Join as ${SIDES[open]}`, join, true); }
      else s = alone ? `${name(1)} is playing` : `${name(1)} and ${name(2)} are playing`;
      button('Close', () => { panelOpen = false; refreshPanel(); });
    } else if (!bothIn()) {
      s = 'Waiting for another player… (they click the board to join)';
      button('Cancel', leave);
    } else if (!viewing) {
      s = alone ? 'Playing both sides' : `You're ${SIDES[side]}`;
      button('Start', start, true);
      button('Leave game', leave);
    } else {
      if (st.over) s = `${SIDES[st.winner]} wins!`;
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
    el.players.textContent = (alone ? `Crimson and Violet: ${name(1)}` : `Crimson: ${name(1) || 'open'} · Violet: ${name(2) || 'open'}`) +
      ` · ${count(st.board, 1)} – ${count(st.board, 2)}`;
  }

  // ---------- Start: make the game the first time anyone ever visits, then listen ----------
  get(G.ref).then(s => { if (!s.exists()) set(G.ref, { ...fresh(), moveNo: 0, p1: '', p2: '' }); }).catch(() => {});
  onValue(G.ref, s => { if (s.exists()) applyState(s.val()); });

  return {
    pick, tap, canTap, deselect, openPanel, leave,
    shown: () => G.shown,
    playing: () => viewing,
    mySide,
    busy: () => !!(G.st && (here(G.st.p1) || here(G.st.p2))),   // (someone's in a game: the board stays out)
    show(on) {   // the board is out (pieces set out, clicks on) or away
      if (G.shown === on) return;
      G.shown = on; pick.visible = on;
      if (G.st) setOut(G.st);
      if (!on) { panelOpen = false; if (viewing) leave(); }
      refreshMarks(); refreshPanel();
    },
    refresh: refreshPanel,
    update(t) { if (G.J) G.J.update(t); }
  };
}
// >>>>> END OF FILE: HangoutRoom/checkers/checkers.js <<<<<
