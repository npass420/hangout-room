// =====================================================================
// checkers.js — Checkers on the game table in the Table Room, played with the checkers made in the Workshop
// (gametable/checkerset.js): black onyx discs with a glowing glass jewel, crimson for the player in the ruby chair,
// violet for the player in the purple chair. Sit in a chair to play that side; everyone else can walk up and watch.
// Alone? "Play alone" lets you play both sides; someone who sits in the other chair can "Join game" and take theirs.
// Click one of your pieces (its square lights up, and so do the squares it can go to, if hints are on), then a square.
// A piece glides to its new square; a capture flies it up and over to hover above the piece below, bobbing, and blast
// it with its laser (leaving glowing burn marks), and the struck piece glows white hot and bursts into sparks. A piece
// that reaches the far side is crowned: it melts into a floating, glowing glass orb (a king), which beams its laser the
// whole time it flies over a capture.
// Rules (classic American checkers): crimson moves first; captures are a must, and you keep jumping while you can; a piece
// that reaches the far row becomes a king (and that ends its move); kings move one square, in any diagonal direction.
// The game is shared through the database (tables/checkers, where the old checkers game kept its board), so everyone in the room sees the same board.
// VERSION 5
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, scene } from '../core.js';
import { makeCheckerSet } from './gametable/checkerset.js';

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

// ---------- The game: pieces on the board, players, and what everyone sees ----------
// opts: center (the board's middle, on the floor), top (the board's playing surface), cell (one square), and the
// room's glowLayer and listener (the ear on the camera, for sounds);
// addMaterials / dropMaterials(list): so the room can give the pieces its reflections (and stop, once they're gone).
// The board's rows run along x (crimson's end at +x), its columns along z.
export function startCheckers({ center, top, cell, glowLayer, listener, addMaterials = () => {}, dropMaterials = () => {} }) {
  const HALF = cell * 4, SIZE = cell * 0.84;   // (a piece fits well inside its square)
  const cellPos = sq => { const [r, c] = rc(sq); return [center.x - HALF + cell * (r + 0.5), center.z - HALF + cell * ((7 - c) + 0.5)]; };
  const G = { st: null, sel: -1, targets: [], ref: ref(db, 'tables/checkers'), pieces: {}, J: null, queue: Promise.resolve() };

  // the pieces, the Workshop's checkers (a fresh set whenever the board needs setting out again; the old one freed)
  function setOut(st) {
    if (G.J) { scene.remove(G.J.group); dropMaterials(G.mats); G.J.dispose(); }
    G.mats = [];
    G.J = makeCheckerSet(THREE, { materials: G.mats, glowLayer, listener });
    scene.add(G.J.group);
    addMaterials(G.mats);
    G.pieces = {};
    for (let sq = 0; sq < 64; sq++) {
      const ch = st.board[sq];
      if (ch === '.') continue;
      const [x, z] = cellPos(sq);
      const p = G.J.piece(x, z, top, SIZE, owner(ch) === 1 ? 'crimson' : 'violet');
      if (isKing(ch)) p.setKing(true, true);
      G.pieces[sq] = p;
    }
  }

  // the marks on the board: the square you picked (a soft gold glow) and, with hints on, where it can go
  const markGeo = new THREE.PlaneGeometry(cell * 0.92, cell * 0.92).rotateX(-Math.PI / 2);
  const markMat = color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  const selMark = new THREE.Mesh(markGeo, markMat(0xffc860));
  selMark.visible = false; scene.add(selMark);
  const targetMarks = Array.from({ length: 12 }, () => { const m = new THREE.Mesh(markGeo, markMat(0x8affc8)); m.visible = false; scene.add(m); return m; });
  let hintsOn = true;
  try { hintsOn = localStorage.getItem('tableHints') !== 'off'; } catch (e) {}
  function refreshMarks() {
    const put = (m, sq) => { const [x, z] = cellPos(sq); m.position.set(x, top + 0.001, z); m.visible = true; };
    selMark.visible = false; targetMarks.forEach(m => { m.visible = false; });
    if (G.sel >= 0) put(selMark, G.sel);
    if (hintsOn) G.targets.forEach((m, i) => { if (targetMarks[i]) put(targetMarks[i], m.t); });
  }

  // clicking on the board: an invisible sheet over the squares
  const pick = new THREE.Mesh(new THREE.PlaneGeometry(cell * 8, cell * 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(center.x, top + 0.002, center.z);
  scene.add(pick);
  function squareAt(point) {
    const r = Math.floor((point.x - center.x + HALF) / cell), c = 7 - Math.floor((point.z - center.z + HALF) / cell);
    return at(r, c);
  }

  // ---------- Players ----------
  const validPlayer = c => { const id = G.st && G.st['p' + c]; return id && S.presence[id] ? id : ''; };
  const solo = () => !!(G.st && G.st.p1 && G.st.p1 === G.st.p2 && S.presence[G.st.p1]);
  function chairHolder(side) {   // who is actually sitting in this chair
    const id = validPlayer(side);
    if (id && solo() && S.presence[id].s !== 'checkers:' + side) return '';   // the solo player is in the other chair
    return id;
  }
  const name = c => { const id = validPlayer(c); return id ? S.presence[id].name : ''; };
  const bothSeated = () => !!(validPlayer(1) && validPlayer(2));
  const active = () => !!G.st && bothSeated() && !G.st.over;
  const mySide = () => (G.st ? (G.st.p1 === myId ? 1 : G.st.p2 === myId ? 2 : 0) : 0);
  const myTurn = () => active() && G.st['p' + G.st.turn] === myId;

  function sit(side) {
    if (solo() && G.st.p1 !== myId && !chairHolder(side)) return Promise.resolve(true);   // the empty chair at someone's solo game
    return runTransaction(G.ref, st => {
      if (!st) return st;
      const id = st['p' + side];
      if (id && id !== myId && S.presence[id]) return;   // someone's already there
      st['p' + side] = myId;
      return st;
    }).then(r => r.committed && r.snapshot.val() && r.snapshot.val()['p' + side] === myId).catch(() => false);
  }
  function stand(side) {
    if (G.st && G.st.p1 === myId && G.st.p2 === myId) update(G.ref, { p1: '', p2: '' }).catch(() => {});   // done playing alone
    else if (G.st && G.st['p' + side] === myId) update(G.ref, { ['p' + side]: '' }).catch(() => {});
    G.sel = -1; G.targets = []; refreshMarks();
  }

  // ---------- Moves ----------
  function sendMove(m) {
    runTransaction(G.ref, st => {
      if (!st || st.over || st['p' + st.turn] !== myId || !S.presence[st.p1] || !S.presence[st.p2]) return;
      st.chain = st.chain === undefined ? -1 : st.chain;
      const legal = movesFrom(st, m.f).find(x => x.t === m.t);
      if (!legal) return;
      st = play(st, legal);
      st.moveNo = (st.moveNo || 0) + 1;
      return st;
    }).catch(e => console.warn('checkers', e));
    G.sel = -1; G.targets = [];
    refreshMarks();
  }
  function tap(point) {   // you clicked on the board at the table you're sitting at
    if (!G.st) return;
    const sq = squareAt(point);
    if (sq < 0 || !myTurn()) { G.sel = -1; G.targets = []; refreshMarks(); return; }
    const st = G.st, m = G.targets.find(x => x.t === sq);
    if (G.sel >= 0 && m) sendMove(m);
    else if (owner(st.board[sq]) === st.turn && !(st.chain >= 0 && sq !== st.chain)) {
      const moves = movesFrom(st, sq);
      G.sel = sq; G.targets = moves;
      if (!moves.length && allMoves(st, st.turn).some(x => x.cap !== undefined) && hooks.banner) hooks.banner('You have to jump!', 1.8);
    } else { G.sel = -1; G.targets = []; }
    refreshMarks(); refreshPanel();
  }
  function canTap(point) {   // for the pointer: your own movable piece, or a square you can move to
    if (!G.st || !myTurn()) return false;
    const sq = squareAt(point);
    if (sq < 0) return false;
    if (G.targets.some(x => x.t === sq)) return true;
    return owner(G.st.board[sq]) === G.st.turn && movesFrom(G.st, sq).length > 0;
  }

  // ---------- Shared state arrives: animate the move that was made (one move at a time), or set the board out ----------
  function applyState(st) {
    st.last = st.last || { f: -1, t: -1, cap: -1 };
    if (st.chain === undefined) st.chain = -1;
    const prev = G.st;
    const next = prev && st.moveNo === (prev.moveNo || 0) + 1 && prev.board !== st.board && st.last.f >= 0 && G.pieces[st.last.f];
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
    if (myTurn() && st.chain >= 0) { G.sel = st.chain; G.targets = movesFrom(st, st.chain); }   // keep jumping: the same piece, picked for you
    refreshMarks();
    const turnMine = myTurn();
    if (prev && turnMine && st.moveNo !== prev.moveNo && hooks.banner) hooks.banner(st.chain >= 0 ? 'Keep jumping!' : 'Your turn!', 1.8);
    if (prev && st.over && !prev.over) {
      const text = `${SIDES[st.winner]} wins!` + (solo() ? '' : ` (${name(st.winner)})`);
      if (hooks.banner) hooks.banner(text, 3.5);
      if (hooks.addSys) hooks.addSys('Checkers: ' + text);
    }
    refreshPanel();
    if (hooks.refreshAll) hooks.refreshAll();
  }

  // ---------- The panel: what's happening, and the buttons (shown while you're sitting at the table) ----------
  const css = document.createElement('style');
  css.textContent = `
    #gamePanel { left: 16px; bottom: 16px; width: 300px; display: none; }
    #gamePanel.on { display: block; }
    #gamePanel .gpTitle { font-size: 17px; color: #ffe0a8; margin-bottom: 4px; }
    #gamePanel .gpStatus { font-size: 15px; margin-bottom: 4px; }
    #gamePanel .gpPlayers { font-size: 13px; opacity: 0.8; margin-bottom: 8px; }
    @media (max-width: 700px) { #gamePanel { left: 8px; right: 8px; bottom: 8px; width: auto; } }`;
  document.head.appendChild(css);
  const panel = document.createElement('div');
  panel.id = 'gamePanel'; panel.className = 'panel';
  panel.innerHTML = `<div class="gpTitle">Checkers</div><div class="gpStatus"></div><div class="gpPlayers"></div>
    <div><button class="gpSolo">Play alone</button><button class="gpJoin">Join game</button><button class="gpNew">New game</button><button class="gpResign">Resign</button><button class="gpHints"></button><button class="gpStand">Stand up</button></div>`;
  document.body.appendChild(panel);
  const q = s => panel.querySelector(s);
  const el = { status: q('.gpStatus'), players: q('.gpPlayers'), solo: q('.gpSolo'), join: q('.gpJoin'), newG: q('.gpNew'),
               resign: q('.gpResign'), hints: q('.gpHints'), stand: q('.gpStand') };
  let seat = 0;   // the chair you're sitting in (1 ruby: crimson, 2 purple: violet), or 0
  function arm(btn, label, action, ask) {   // buttons that end a game ask you to click twice
    let armed = false, timer = 0;
    btn.addEventListener('click', () => {
      if (ask() && !armed) { armed = true; btn.textContent = 'Sure? Click again'; timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000); return; }
      clearTimeout(timer); armed = false; btn.textContent = label; action();
    });
  }
  arm(el.newG, 'New game', () => runTransaction(G.ref, st => ({ ...(st || {}), ...fresh(), moveNo: ((st && st.moveNo) || 0) + 1 })), () => active());
  arm(el.resign, 'Resign', () => {
    const me = mySide();
    runTransaction(G.ref, st => (!st || st.over || st['p' + me] !== myId ? undefined : { ...st, over: 1, winner: 3 - me, moveNo: (st.moveNo || 0) + 1 }));
  }, () => true);
  el.solo.addEventListener('click', () => runTransaction(G.ref, st => {   // take the empty side too, and start a fresh game
    if (!st) return;
    const mine = st.p1 === myId ? 1 : st.p2 === myId ? 2 : 0, other = st['p' + (3 - mine)];
    if (!mine || (other && other !== myId && S.presence[other])) return;
    return { ...st, ...fresh(), p1: myId, p2: myId, moveNo: (st.moveNo || 0) + 1 };
  }));
  el.join.addEventListener('click', () => runTransaction(G.ref, st => {   // sitting across from someone playing alone: take this side
    if (!st || !seat || !st.p1 || st.p1 !== st.p2 || st.p1 === myId) return;
    return { ...st, ['p' + seat]: myId };
  }));
  el.hints.addEventListener('click', () => {
    hintsOn = !hintsOn;
    try { localStorage.setItem('tableHints', hintsOn ? 'on' : 'off'); } catch (e) {}
    refreshMarks(); refreshPanel();
  });
  el.stand.addEventListener('click', () => { if (hooks.standUp) hooks.standUp(); });
  function refreshPanel() {
    panel.classList.toggle('on', !!seat && !!G.st);
    if (!seat || !G.st) return;
    const st = G.st, side = mySide(), alone = solo(), watchingSolo = alone && st.p1 !== myId;
    let s;
    if (!validPlayer(1) && !validPlayer(2)) s = 'Sit in a chair to play';
    else if (!bothSeated()) s = side ? 'Waiting for someone to sit across from you, or play alone' : 'One seat open: you\'re in it, click Join or wait';
    else if (watchingSolo) s = `${name(1)} is playing alone`;
    else if (st.over) s = `${SIDES[st.winner]} wins!`;
    else if (alone) s = (st.chain >= 0 ? 'Keep jumping! ' : '') + `Playing alone · ${SIDES[st.turn]} to move`;
    else s = (st.chain >= 0 ? 'Keep jumping! ' : '') + (myTurn() ? 'Your move!' : `${SIDES[st.turn]}'s turn (${name(st.turn)})`);
    el.status.textContent = s;
    el.players.textContent = (alone ? `Crimson and Violet: ${name(1)}` : `Crimson: ${name(1) || 'open'} · Violet: ${name(2) || 'open'}`) +
      ` · ${count(st.board, 1)} – ${count(st.board, 2)}`;
    const playing = active() && side;
    el.solo.style.display = side && !validPlayer(3 - side) ? '' : 'none';
    el.join.style.display = watchingSolo ? '' : 'none';
    el.newG.style.display = side ? '' : 'none';
    el.resign.style.display = playing && !alone ? '' : 'none';
    el.hints.style.display = side ? '' : 'none';
    el.hints.textContent = hintsOn ? '💡 Hints: on' : '💡 Hints: off';
  }

  // ---------- Start: make the game the first time anyone ever visits, then listen ----------
  get(G.ref).then(s => { if (!s.exists()) set(G.ref, { ...fresh(), moveNo: 0, p1: '', p2: '' }); });
  const ready = new Promise(done => {
    let first = true;
    onValue(G.ref, s => { if (s.exists()) { applyState(s.val()); if (first) { first = false; done(); } } });
  });

  // the pieces' sounds follow the room's mute button (🔊/🔇)
  let muteCheck = 0;
  return {
    ready, pick,
    pieces: () => (G.J ? G.J.group : null),   // (hidden while the room takes its reflection snapshots)
    tap, canTap,
    sit(side) { return sit(side).then(ok => { if (ok) { seat = side; refreshPanel(); } return ok; }); },
    stand() { const s = seat; seat = 0; stand(s); refreshPanel(); },
    seatTaken: side => { const id = chairHolder(side); return !!id && id !== myId; },
    seatHolder: side => chairHolder(side),
    seated: () => seat,
    refresh() { refreshPanel(); },
    update(t, dt) {
      if (G.J) G.J.update(t);
      if (listener && (muteCheck -= dt) <= 0) {
        muteCheck = 0.5;
        let muted = false;
        try { muted = localStorage.getItem('hangoutMuted') === '1'; } catch (e) {}
        listener.setMasterVolume(muted ? 0 : 1);
      }
    }
  };
}
// =====================================================================
// END OF table/checkers.js
// =====================================================================
