// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/checkers/othello.js <<<<<
// Othello in the game den: played on the crystal and gold board summoned onto the marble table (pieces/summon.js),
// with the Workshop's discs (pieces/othellodisc.js): pearl white marble with gold cracks, black marble with violet
// cracks, a river of liquid energy round each one's middle.
// Setting up works like checkers: sitting at the table, click the board: it's yours while you set up. 1 player: you're
// Black against the computer (White). 2 players: everyone else sitting at the table gets a Join box; when someone
// joins, you're asked to Start, and in you both go (studio.js does the view). Anyone else sitting at the table can
// click the board during a game to watch it. Your turn: the squares you can play on glow softly (with hints on); click
// one. Each move plays out with its beams: from your own disc at the far end of every line you take, through each
// disc taken (filling it with your energy), to the empty square, where your new disc forms. A side with no move
// passes; when neither can move, the game's done: every one of the loser's discs is taken over, glitching, and the
// board's squares all glitch over to the winner's crystal.
// Rules: classic Othello (Black first). Shared through the database (tables/othello), so everyone sees the same game.
//   startOthello({ center, top, cell, parent, board, onView, seated, onStart })
//     board: the Othello board (its flood() and restore()); the rest as in checkers.js
//   gives back the same as checkers.js: { pick, tap, canTap, deselect, openPanel, show, playing, leave, busy, ... }
// =====================================================================================================================
import * as THREE from 'three';
import { ref, set, get, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks } from '../core.js';
import { makeOthelloPlay, captures, legalMoves, cpuPick } from '../pieces/othellodisc.js';

// ---------- The rules ----------
// The board: 64 letters, row by row: '.' empty, 'b' black, 'w' white. Side 1 is Black (moves first), side 2 White.
// (The disc pieces count white as 1 and black as 2: PIECE turns a side into that.)
const PIECE = side => (side === 1 ? 2 : 1);
const START = (() => { const b = Array(64).fill('.'); b[27] = b[36] = 'w'; b[28] = b[35] = 'b'; return b.join(''); })();
const gridOf = board => Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => (board[r * 8 + c] === 'w' ? 1 : board[r * 8 + c] === 'b' ? 2 : 0)));
const boardOf = grid => grid.map(row => row.map(v => (v === 1 ? 'w' : v === 2 ? 'b' : '.')).join('')).join('');
const count = (b, side) => [...b].filter(ch => ch === (side === 1 ? 'b' : 'w')).length;
function play(st, c, r) {   // the next state after a legal move (or nothing, if it isn't one)
  const grid = gridOf(st.board), p = PIECE(st.turn), lines = captures(grid, c, r, p);
  if (!lines.length) return null;
  grid[r][c] = p;
  for (const l of lines) for (const [x, y] of l.run) grid[y][x] = p;
  st.board = boardOf(grid);
  st.last = { c, r, side: st.turn };
  const next = 3 - st.turn;
  st.passed = 0;
  if (legalMoves(grid, PIECE(next)).length) st.turn = next;
  else if (legalMoves(grid, PIECE(st.turn)).length) st.passed = next;   // (the other side has no move: they pass)
  else {
    st.over = 1;
    const b = count(st.board, 1), w = count(st.board, 2);
    st.winner = b > w ? 1 : w > b ? 2 : 0;
  }
  return st;
}
const fresh = () => ({ board: START, turn: 1, over: 0, winner: 0, passed: 0, last: { c: -1, r: -1, side: 0 } });
const SIDES = { 1: 'Black', 2: 'White' };
const MAX_PLAYERS = 2;   // (the player count buttons: 1 up to this)

// ---------- The game ----------
// Columns run along x, rows along z.
export function startOthello({ center, top, cell, parent, board, onView = () => {}, seated = () => true, onStart = () => {} }) {
  const HALF = cell * 4;
  const cellPos = (c, r) => [center.x - HALF + cell * (c + 0.5), center.z - HALF + cell * (r + 0.5)];
  const G = { st: null, ref: ref(db, 'tables/othello'), shown: false, endTimer: 0, cpuFor: -1 };
  let viewing = false, watching = false;
  const ctrlRef = ref(db, 'tables/control');   // who's setting up a game at the board right now: { id, name }
  let ctrl = null;
  onValue(ctrlRef, s => { ctrl = s.val(); refreshPanel(); });
  const holding = () => !!(ctrl && ctrl.id === myId);
  function claim() {
    return runTransaction(ctrlRef, c => (!c || !here(c.id) || c.id === myId ? { id: myId, name: S.myName } : undefined))
      .then(r => r.committed && r.snapshot.val() && r.snapshot.val().id === myId).catch(() => false);
  }
  function release() { runTransaction(ctrlRef, c => (c && c.id === myId ? null : undefined)).catch(() => {}); }

  // the discs and every move's beams (pieces/othellodisc.js)
  const playOut = makeOthelloPlay({ cell, top, cellPos });
  playOut.group.visible = false;
  parent.add(playOut.group);

  // the marks: where you can play (soft gold glows, with hints on)
  const markGeo = new THREE.CircleGeometry(cell * 0.2, 32).rotateX(-Math.PI / 2);
  const markMat = new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, opacity: 0.35, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  const marks = Array.from({ length: 32 }, () => { const m = new THREE.Mesh(markGeo, markMat); m.visible = false; parent.add(m); return m; });
  let hintsOn = true;
  try { hintsOn = localStorage.getItem('tableHints') !== 'off'; } catch (e) {}
  let animUntil = 0;   // (a move still playing out: no marks till it's done)
  function refreshMarks() {
    marks.forEach(m => { m.visible = false; });
    if (!G.shown || !hintsOn || !myTurn() || performance.now() < animUntil) return;
    legalMoves(gridOf(G.st.board), PIECE(G.st.turn)).forEach((mv, i) => {
      if (!marks[i]) return;
      const [x, z] = cellPos(mv.c, mv.r);
      marks[i].position.set(x, top + 0.0015, z); marks[i].visible = true;
    });
  }

  // clicking on the board: an invisible sheet over the squares
  const pick = new THREE.Mesh(new THREE.PlaneGeometry(cell * 9, cell * 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(center.x, top + 0.002, center.z);
  pick.userData.boardPick = true;
  pick.visible = false;
  parent.add(pick);
  function squareAt(point) {
    const c = Math.floor((point.x - center.x + HALF) / cell), r = Math.floor((point.z - center.z + HALF) / cell);
    return c >= 0 && c < 8 && r >= 0 && r < 8 ? { c, r } : null;
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

  const tx = f => runTransaction(G.ref, st => f(st || { ...fresh(), moveNo: 0, p1: '', p2: '' })).catch(e => console.warn('othello', e));
  const othersIn = st => (here(st.p1) && st.p1 !== myId) || (here(st.p2) && st.p2 !== myId);
  function players(n) {   // 1: straight into the game against the computer; 2: you take Black and wait for someone to join
    if (n === 1) { tx(st => (othersIn(st) ? undefined : { ...st, ...fresh(), p1: myId, p2: myId, cpu: 1, go: 1, moveNo: (st.moveNo || 0) + 1 })); release(); onStart(); }
    else tx(st => (othersIn(st) ? undefined : { ...st, ...fresh(), p1: myId, p2: '', cpu: 0, go: 0, moveNo: (st.moveNo || 0) + 1 }));
    panelOpen = false;
  }
  function join() {
    tx(st => {
      const open = here(st.p1) && !here(st.p2) ? 2 : here(st.p2) && !here(st.p1) ? 1 : 0;
      if (!open || st.p1 === myId || st.p2 === myId) return;
      return { ...st, ['p' + open]: myId, go: 0 };
    });
  }
  function begin() {
    tx(st => (st.p1 === myId && here(st.p1) && here(st.p2) ? { ...st, go: 1 } : undefined));
    release(); onStart();
  }
  function watch() { if (viewing) return; viewing = watching = true; panelOpen = false; onView(1, true); refreshPanel(); }
  function leave() {
    if (viewing) { viewing = false; onView(0); }
    if (watching) { watching = false; refreshPanel(); return; }
    release();
    tx(st => {
      if (st.p1 === myId && st.p2 === myId) return { ...st, p1: '', p2: '', cpu: 0 };
      if (st.p1 === myId) return { ...st, p1: '' };
      if (st.p2 === myId) return { ...st, p2: '' };
      return;
    });
    refreshMarks(); panelOpen = false; refreshPanel();
  }
  function enter() { const side = mySide(); if (!side || !bothIn() || viewing) return; viewing = true; panelOpen = false; if (holding()) release(); onView(side, false); refreshPanel(); }

  // ---------- Moves ----------
  function sendMove(c, r, asCpu) {
    tx(st => {
      if (st.over || !here(st.p1) || !here(st.p2)) return;
      if (asCpu ? !(st.cpu && st.turn === 2 && st.p1 === myId) : (st['p' + st.turn] !== myId || (st.cpu && st.turn === 2))) return;
      st = play({ ...st }, c, r);
      if (!st) return;
      st.moveNo = (st.moveNo || 0) + 1;
      return st;
    });
  }
  function cpuMove() {   // (the computer's move, made by the one playing against it)
    const st = G.st;
    if (!st || !st.cpu || st.over || st.turn !== 2 || st.p1 !== myId || G.cpuFor === st.moveNo) return;
    G.cpuFor = st.moveNo;
    const wait = Math.max(animUntil - performance.now(), 0) + 900;
    setTimeout(() => {
      const now = G.st;
      if (!now || now.moveNo !== st.moveNo) return;
      const list = legalMoves(gridOf(now.board), PIECE(2));
      if (list.length) { const m = cpuPick(list); sendMove(m.c, m.r, true); }
    }, wait);
  }
  function tap(point) {
    if (!viewing) { boardClicked(); return; }
    if (!G.st || !myTurn() || performance.now() < animUntil) return;
    const sq = squareAt(point);
    if (!sq) return;
    if (captures(gridOf(G.st.board), sq.c, sq.r, PIECE(G.st.turn)).length) sendMove(sq.c, sq.r, false);
    else if (hooks.banner) hooks.banner("You can't play there", 1.4);
  }
  function boardClicked() {
    const say = t => { if (hooks.banner) hooks.banner(t, 2); };
    if (!seated()) { say('Sit at the table to play'); return; }
    const st = G.st;
    if (!st) return;
    if (mySide()) { panelOpen = true; refreshPanel(); return; }
    if (bothIn() && st.go) { watch(); return; }
    if (here(st.p1) || here(st.p2)) { panelOpen = true; refreshPanel(); return; }
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
    return !!(sq && captures(gridOf(G.st.board), sq.c, sq.r, PIECE(G.st.turn)).length);
  }
  function deselect() {
    if (panelOpen && !viewing) { closePanel(); return true; }
    return false;
  }

  // ---------- Shared state arrives: play the move out, or set the discs out ----------
  function ending(st, after) {   // (the game's won: the loser's discs taken over, the board's squares the winner's crystal)
    clearTimeout(G.endTimer);
    G.endTimer = setTimeout(() => {
      if (!G.st || !G.st.over || !G.shown) return;
      if (st.winner) {
        playOut.takeAll(st.winner === 1);   // (the loser's discs: white if Black won)
        setTimeout(() => { if (G.st && G.st.over && board) board.flood(st.winner === 1 ? 'black' : 'white'); }, 1300);
      }
    }, after * 1000);
  }
  function applyState(st) {
    st.last = st.last || { c: -1, r: -1, side: 0 };
    const prev = G.st;
    G.st = st;
    if (!G.shown) { refreshPanel(); return; }
    const next = prev && st.moveNo === (prev.moveNo || 0) + 1 && st.last.c >= 0 && prev.board !== st.board && !prev.over;
    if (next) {
      const lines = captures(gridOf(prev.board), st.last.c, st.last.r, PIECE(st.last.side));
      const took = playOut.move(st.last.c, st.last.r, PIECE(st.last.side) === 1, lines);
      animUntil = performance.now() + took * 1000;
      setTimeout(refreshMarks, took * 1000 + 50);
      if (st.over && !prev.over) ending(st, took + 0.4);
    } else if (!prev || prev.board !== st.board || prev.moveNo !== st.moveNo) {
      clearTimeout(G.endTimer);
      if (board) board.restore();
      playOut.set(gridOf(st.board), true);
      animUntil = performance.now() + 1200;
      setTimeout(refreshMarks, 1250);
      if (st.over) ending(st, 1.5);
    }
    refreshMarks();
    if (prev && st.moveNo !== prev.moveNo && !st.over) {
      if (st.passed && hooks.banner) hooks.banner(`${SIDES[st.passed]} has no move and passes`, 2.2);
      else if (myTurn() && hooks.banner) hooks.banner('Your turn!', 1.8);
    }
    if (prev && st.over && !prev.over) {
      const b = count(st.board, 1), w = count(st.board, 2);
      const text = (st.winner ? `${SIDES[st.winner]} wins ${Math.max(b, w)} to ${Math.min(b, w)}!` : `A draw, ${b} all!`) +
        (st.winner && !solo() && name(st.winner) ? ` (${name(st.winner)})` : '');
      if (hooks.banner) hooks.banner(text, 4);
      if (hooks.addSys) hooks.addSys('Othello: ' + text);
    }
    if (viewing && !watching && !mySide()) { viewing = false; onView(0); }
    if (watching && !(bothIn() && st.go)) { viewing = watching = false; onView(0); }
    cpuMove();
    refreshPanel();
  }

  // ---------- The panel: over the board, bottom middle (the same look as checkers': its styles are checkers.js's) ----------
  const panel = document.createElement('div');
  panel.id = 'othelloPanel'; panel.className = 'panel';
  panel.style.cssText = 'left:50%; bottom:16px; transform:translateX(-50%); min-width:280px; max-width:92vw; text-align:center; display:none;' +
    'background:rgba(14,11,20,0.82); backdrop-filter:blur(6px); box-shadow:0 4px 18px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(201,162,39,0.55);';
  panel.innerHTML = `<div style="font-size:19px; color:#ffe0a8; margin-bottom:4px; font-style:italic; letter-spacing:1px;">Othello</div>
    <div class="gpStatus" style="font-size:15px; margin-bottom:4px;"></div><div class="gpPlayers" style="font-size:13px; opacity:0.8; margin-bottom:8px;"></div><div class="gpButtons"></div>`;
  document.body.appendChild(panel);
  const el = { status: panel.querySelector('.gpStatus'), players: panel.querySelector('.gpPlayers'), buttons: panel.querySelector('.gpButtons') };
  let panelOpen = false;
  function openPanel() { boardClicked(); }
  function closePanel() { panelOpen = false; if (holding() && !mySide()) release(); refreshPanel(); }
  const offer = document.createElement('div');
  offer.id = 'othelloOffer'; offer.className = 'panel';
  offer.style.cssText = 'left:50%; top:22%; transform:translateX(-50%); min-width:260px; max-width:92vw; text-align:center; display:none;' +
    'background:rgba(14,11,20,0.88); backdrop-filter:blur(6px); box-shadow:0 4px 18px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(201,162,39,0.7);';
  document.body.appendChild(offer);
  const said = {};
  function refreshOffer() {
    const st = G.st;
    const open = st && !st.cpu ? (here(st.p1) && !here(st.p2) ? 2 : here(st.p2) && !here(st.p1) ? 1 : 0) : 0;
    const key = st ? `${st.p1}|${st.p2}|${st.moveNo}` : '';
    const show = !!(G.shown && st && open && !mySide() && seated() && !viewing && !panelOpen && !said[key]);
    offer.style.display = show ? 'block' : 'none';
    if (!show) return;
    offer.textContent = '';
    const t = document.createElement('div');
    t.style.cssText = 'font-size:17px; color:#ffe0a8; margin-bottom:10px;';
    t.textContent = `${name(3 - open)} wants to play Othello`;
    offer.appendChild(t);
    const yes = document.createElement('button'); yes.className = 'big'; yes.textContent = 'Join';
    yes.style.cssText = 'font-size:16px; padding:8px 22px; margin:0 4px 6px;';
    yes.addEventListener('click', () => { yes.blur(); join(); });
    const no = document.createElement('button'); no.textContent = 'No thanks'; no.style.margin = '0 4px 6px';
    no.addEventListener('click', () => { no.blur(); said[key] = true; refreshOffer(); });
    offer.append(yes, no);
  }
  const armed = {};
  function button(label, action, big = false, ask = false) {
    const b = document.createElement('button');
    b.textContent = armed[label] ? 'Sure? Click again' : label;
    b.style.margin = '0 4px 6px';
    if (big) { b.className = 'big'; b.style.fontSize = '16px'; b.style.padding = '8px 18px'; }
    b.addEventListener('click', () => {
      b.blur();
      if (ask && !armed[label]) { armed[label] = true; setTimeout(() => { armed[label] = false; refreshPanel(); }, 3000); refreshPanel(); return; }
      armed[label] = false; action();
    });
    el.buttons.appendChild(b);
  }
  function refreshPanel() {
    if (!viewing && G.shown && G.st && G.st.go && mySide() && bothIn()) { enter(); return; }
    refreshOffer();
    const show = G.shown && G.st && (panelOpen || viewing || (mySide() && !viewing));
    panel.style.display = show ? 'block' : 'none';
    if (!show) return;
    const st = G.st, side = mySide(), alone = solo();
    el.buttons.textContent = '';
    let s = '';
    const result = () => (st.winner ? `${SIDES[st.winner]} wins!` : 'A draw!');
    if (watching) {
      s = st.over ? result() : `Watching · ${SIDES[st.turn]} to move`;
    } else if (!side) {
      const open = !st.cpu && (here(st.p1) && !here(st.p2) ? 2 : here(st.p2) && !here(st.p1) ? 1 : 0);
      if (!here(st.p1) && !here(st.p2)) {
        s = 'How many players?';
        for (let n = 1; n <= MAX_PLAYERS; n++) button(`${n} Player${n > 1 ? 's' : ''}`, () => players(n), true);
      }
      else if (open) { s = `${name(3 - open)} is waiting for a partner`; button(`Join as ${SIDES[open]}`, join, true); }
      else s = st.cpu ? `${name(1)} is playing the computer` : `${name(1)} and ${name(2)} are playing`;
      button('Close', closePanel);
    } else if (!bothIn()) {
      s = 'Waiting for someone to join…';
      button('Cancel', leave);
    } else if (!viewing) {
      if (st.p1 === myId) { s = `${name(2)} joined! Start?`; button('Start', begin, true); button('Cancel', leave); }
      else { s = `Waiting for ${name(1)} to start…`; button('Leave', leave); }
    } else {
      if (st.over) s = result();
      else if (st.cpu) s = cpuTurn() ? 'The computer is thinking…' : 'Your move!';
      else s = myTurn() ? 'Your move!' : `${SIDES[st.turn]}'s turn (${name(st.turn)})`;
      button(hintsOn ? '💡 Hints: on' : '💡 Hints: off', () => {
        hintsOn = !hintsOn; try { localStorage.setItem('tableHints', hintsOn ? 'on' : 'off'); } catch (e) {}
        refreshMarks(); refreshPanel();
      });
      button('New game', () => tx(st2 => ({ ...st2, ...fresh(), moveNo: (st2.moveNo || 0) + 1 })), false, active());
      if (!alone && !st.over) button('Resign', () => tx(st2 => (st2.over || st2['p' + side] !== myId ? undefined : { ...st2, over: 1, winner: 3 - side, moveNo: (st2.moveNo || 0) + 1 })), false, true);
    }
    el.status.textContent = s;
    el.players.textContent = (st.cpu ? `Black: ${name(1)} · White: Computer` : `Black: ${name(1) || 'open'} · White: ${name(2) || 'open'}`) +
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
    show(on) {
      if (G.shown === on) return;
      G.shown = on; pick.visible = on; playOut.group.visible = on;
      if (on && G.st) { if (board) board.restore(); playOut.set(gridOf(G.st.board), true); if (G.st.over) ending(G.st, 1.5); }
      if (!on) { playOut.clear(); clearTimeout(G.endTimer); panelOpen = false; if (holding()) release(); if (viewing) leave(); }
      refreshMarks(); refreshPanel();
    },
    refresh: refreshPanel,
    update() {}
  };
}
// >>>>> END OF FILE: HangoutRoom/checkers/othello.js <<<<<
