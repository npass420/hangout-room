// =====================================================================
// boardgames.js — Checkers and Chess on the table
// Two players sit, join and take a side; everyone else at the table can watch.
// Click one of your pieces to see where it can go (the squares light up), then click a square to move.
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, scene, TABLE_Y, RAINBOW, paintTexture, std, easeInOut } from './core.js';
import { sfx } from './sounds.js';
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) {} }

const CELL = 0.1, HALF = CELL * 4;           // the same size board as Othello
const TOP = TABLE_Y + 0.025;                 // the playing surface
const rc = sq => [Math.floor(sq / 8), sq % 8];
const at = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1);
function cellPos(sq, y = TOP) { const [r, c] = rc(sq); return new THREE.Vector3(-HALF + CELL * (c + 0.5), y, -HALF + CELL * (r + 0.5)); }

// =====================================================================
// Checkers rules (American): Red moves first, from the rows nearest z = +; captures are a must,
// keep jumping while you can, a piece that reaches the far row is crowned (and that ends the move)
// Board: 64 letters, '.' empty, 'r' red, 'R' red king, 'w' white, 'W' white king
// =====================================================================
const CK_START = (() => {
  let b = '';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) b += (r + c) % 2 === 1 ? (r < 3 ? 'w' : r > 4 ? 'r' : '.') : '.';
  return b;
})();
function ckOwner(ch) { return ch === 'r' || ch === 'R' ? 1 : ch === 'w' || ch === 'W' ? 2 : 0; }
function ckDirs(ch) {
  if (ch === 'R' || ch === 'W') return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return ch === 'r' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}
function ckJumps(b, sq) {
  const ch = b[sq], me = ckOwner(ch), out = [];
  const [r, c] = rc(sq);
  for (const [dr, dc] of ckDirs(ch)) {
    const mid = at(r + dr, c + dc), land = at(r + 2 * dr, c + 2 * dc);
    if (land >= 0 && b[land] === '.' && ckOwner(b[mid]) === 3 - me) out.push({ f: sq, t: land, cap: mid });
  }
  return out;
}
function ckSteps(b, sq) {
  const [r, c] = rc(sq), out = [];
  for (const [dr, dc] of ckDirs(b[sq])) { const t = at(r + dr, c + dc); if (t >= 0 && b[t] === '.') out.push({ f: sq, t }); }
  return out;
}
function ckMoves(st, who) {   // every legal move for a side (only jumps if any jump exists)
  const b = st.board;
  if (st.chain >= 0) return ckJumps(b, st.chain);
  let jumps = [], steps = [];
  for (let sq = 0; sq < 64; sq++) {
    if (ckOwner(b[sq]) !== who) continue;
    jumps = jumps.concat(ckJumps(b, sq));
    if (!jumps.length) steps = steps.concat(ckSteps(b, sq));
  }
  return jumps.length ? jumps : steps;
}
function ckPlay(st, m) {   // returns the next state (st is a copy we may change)
  const b = [...st.board], who = st.turn, ch = b[m.f];
  b[m.t] = ch; b[m.f] = '.';
  if (m.cap !== undefined) b[m.cap] = '.';
  const [r] = rc(m.t);
  let crowned = false;
  if (ch === 'r' && r === 0) { b[m.t] = 'R'; crowned = true; }
  if (ch === 'w' && r === 7) { b[m.t] = 'W'; crowned = true; }
  st.board = b.join('');
  st.last = { f: m.f, t: m.t };
  if (m.cap !== undefined && !crowned && ckJumps(st.board, m.t).length) { st.chain = m.t; return st; }   // keep jumping
  st.chain = -1;
  st.turn = 3 - who;
  if (!ckMoves(st, st.turn).length) { st.over = 1; st.winner = who; st.result = 'nomoves'; }
  return st;
}
function ckCount(b, who) { let n = 0; for (const ch of b) if (ckOwner(ch) === who) n++; return n; }

// =====================================================================
// Chess rules: castling, en passant, promotion, check, checkmate, stalemate,
// the 50-move rule and "not enough pieces left to win" draws
// Board: 64 letters from Black's back row (z = −) to White's (z = +); capitals are White
// =====================================================================
const CH_START = 'rnbqkbnr' + 'pppppppp' + '.'.repeat(32) + 'PPPPPPPP' + 'RNBQKBNR';
function chOwner(ch) { return ch === '.' ? 0 : ch === ch.toUpperCase() ? 1 : 2; }
const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOKD = [[-1, 0], [1, 0], [0, -1], [0, 1]], BISHD = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
function attacked(b, sq, by) {   // is this square attacked by side "by"?
  const [r, c] = rc(sq);
  const P = by === 1 ? 'P' : 'p', N = by === 1 ? 'N' : 'n', B = by === 1 ? 'B' : 'b', R = by === 1 ? 'R' : 'r', Q = by === 1 ? 'Q' : 'q', K = by === 1 ? 'K' : 'k';
  const pr = by === 1 ? r + 1 : r - 1;   // a white pawn attacks from the row below
  for (const dc of [-1, 1]) { const s = at(pr, c + dc); if (s >= 0 && b[s] === P) return true; }
  for (const [dr, dc] of KN) { const s = at(r + dr, c + dc); if (s >= 0 && b[s] === N) return true; }
  for (const [dr, dc] of KG) { const s = at(r + dr, c + dc); if (s >= 0 && b[s] === K) return true; }
  for (const [dirs, a, q] of [[ROOKD, R, Q], [BISHD, B, Q]]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (at(rr, cc) >= 0) {
        const p = b[at(rr, cc)];
        if (p !== '.') { if (p === a || p === q) return true; break; }
        rr += dr; cc += dc;
      }
    }
  }
  return false;
}
function kingSq(b, who) { return b.indexOf(who === 1 ? 'K' : 'k'); }
function inCheck(b, who) { const k = kingSq(b, who); return k >= 0 && attacked(b, k, 3 - who); }
function chPseudo(st, sq) {
  const b = st.board, ch = b[sq], me = chOwner(ch), up = ch.toUpperCase(), [r, c] = rc(sq), out = [];
  const add = (t, extra = {}) => out.push({ f: sq, t, ...extra });
  if (up === 'P') {
    const dir = me === 1 ? -1 : 1, startRow = me === 1 ? 6 : 1, lastRow = me === 1 ? 0 : 7;
    const push = (t, extra) => { if (rc(t)[0] === lastRow) for (const pr of 'QRBN') add(t, { ...extra, promo: pr }); else add(t, extra); };
    const one = at(r + dir, c);
    if (one >= 0 && b[one] === '.') {
      push(one, {});
      const two = at(r + 2 * dir, c);
      if (r === startRow && b[two] === '.') add(two, { dbl: 1 });
    }
    for (const dc of [-1, 1]) {
      const t = at(r + dir, c + dc);
      if (t < 0) continue;
      if (chOwner(b[t]) === 3 - me) push(t, {});
      else if (t === st.ep) add(t, { ep: 1 });
    }
  } else if (up === 'N' || up === 'K') {
    for (const [dr, dc] of up === 'N' ? KN : KG) { const t = at(r + dr, c + dc); if (t >= 0 && chOwner(b[t]) !== me) add(t); }
    if (up === 'K') {   // castling: neither piece has moved, the squares between are empty, and the king doesn't pass through check
      const row = me === 1 ? 7 : 0, rights = st.castle || '';
      const k = me === 1 ? 'K' : 'k', q = me === 1 ? 'Q' : 'q', rk = me === 1 ? 'R' : 'r';
      if (sq === at(row, 4) && !attacked(b, sq, 3 - me)) {
        if (rights.includes(k) && b[at(row, 7)] === rk && b[at(row, 5)] === '.' && b[at(row, 6)] === '.' &&
            !attacked(b, at(row, 5), 3 - me) && !attacked(b, at(row, 6), 3 - me)) add(at(row, 6), { castle: 'k' });
        if (rights.includes(q) && b[at(row, 0)] === rk && b[at(row, 1)] === '.' && b[at(row, 2)] === '.' && b[at(row, 3)] === '.' &&
            !attacked(b, at(row, 3), 3 - me) && !attacked(b, at(row, 2), 3 - me)) add(at(row, 2), { castle: 'q' });
      }
    }
  } else {
    const dirs = up === 'R' ? ROOKD : up === 'B' ? BISHD : ROOKD.concat(BISHD);
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (at(rr, cc) >= 0) {
        const t = at(rr, cc), o = chOwner(b[t]);
        if (o === me) break;
        add(t);
        if (o) break;
        rr += dr; cc += dc;
      }
    }
  }
  return out;
}
function chBoardAfter(st, m) {   // just the board after a move (used to test for check)
  const b = [...st.board], ch = b[m.f], me = chOwner(ch);
  b[m.t] = m.promo ? (me === 1 ? m.promo : m.promo.toLowerCase()) : ch; b[m.f] = '.';
  if (m.ep) b[at(rc(m.f)[0], rc(m.t)[1])] = '.';
  if (m.castle) {
    const row = rc(m.f)[0];
    if (m.castle === 'k') { b[at(row, 5)] = b[at(row, 7)]; b[at(row, 7)] = '.'; }
    else { b[at(row, 3)] = b[at(row, 0)]; b[at(row, 0)] = '.'; }
  }
  return b.join('');
}
function chMovesFrom(st, sq) { const me = chOwner(st.board[sq]); return chPseudo(st, sq).filter(m => !inCheck(chBoardAfter(st, m), me)); }
function chMoves(st, who) { let out = []; for (let sq = 0; sq < 64; sq++) if (chOwner(st.board[sq]) === who) out = out.concat(chMovesFrom(st, sq)); return out; }
function notEnough(b) {   // only kings, or a king with one bishop or knight, can't checkmate
  const rest = [...b].filter(ch => ch !== '.' && ch.toUpperCase() !== 'K');
  return rest.length === 0 || (rest.length === 1 && 'BN'.includes(rest[0].toUpperCase()));
}
function chPlay(st, m) {
  const b0 = st.board, ch = b0[m.f], me = chOwner(ch), captured = b0[m.t] !== '.' || m.ep;
  st.board = chBoardAfter(st, m);
  // castling rights go away once a king or rook moves (or a rook is taken)
  let rights = st.castle || '';
  const drop = s => { rights = rights.split('').filter(x => !s.includes(x)).join(''); };
  if (ch === 'K') drop('KQ'); if (ch === 'k') drop('kq');
  for (const s of [m.f, m.t]) { if (s === 63) drop('K'); if (s === 56) drop('Q'); if (s === 7) drop('k'); if (s === 0) drop('q'); }
  st.castle = rights;
  st.ep = m.dbl ? (m.f + m.t) / 2 : -1;
  st.half = ch.toUpperCase() === 'P' || captured ? 0 : (st.half || 0) + 1;
  st.last = { f: m.f, t: m.t };
  st.turn = 3 - me;
  st.check = inCheck(st.board, st.turn) ? 1 : 0;
  if (!chMoves(st, st.turn).length) { st.over = 1; st.winner = st.check ? me : 3; st.result = st.check ? 'mate' : 'stalemate'; }
  else if (st.half >= 100) { st.over = 1; st.winner = 3; st.result = 'fifty'; }
  else if (notEnough(st.board)) { st.over = 1; st.winner = 3; st.result = 'material'; }
  return st;
}
const SQNAME = sq => 'abcdefgh'[rc(sq)[1]] + (8 - rc(sq)[0]);

// =====================================================================
// The 3D pieces (shared shapes, so they're light to draw)
// =====================================================================
const V2 = (r, y) => new THREE.Vector2(r, y);
function lathe(pts) { return new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), 18); }
const BASE = [[0, 0], [0.034, 0], [0.034, 0.005], [0.029, 0.009], [0.025, 0.011]];
const GEO = {
  P: lathe([...BASE, [0.015, 0.016], [0.011, 0.03], [0.017, 0.032], [0.011, 0.035], [0.013, 0.039], [0.0145, 0.044], [0.013, 0.049], [0.009, 0.053], [0, 0.055]]),
  R: lathe([...BASE, [0.02, 0.016], [0.018, 0.048], [0.024, 0.05], [0.024, 0.064], [0.017, 0.064], [0.017, 0.059], [0, 0.059]]),
  B: lathe([...BASE, [0.016, 0.016], [0.012, 0.042], [0.019, 0.045], [0.012, 0.048], [0.016, 0.056], [0.015, 0.066], [0.009, 0.074], [0.004, 0.077], [0.006, 0.081], [0, 0.084]]),
  Q: lathe([...BASE, [0.018, 0.016], [0.012, 0.052], [0.02, 0.055], [0.013, 0.058], [0.015, 0.066], [0.022, 0.076], [0.016, 0.078], [0.009, 0.081], [0.008, 0.085], [0, 0.088]]),
  K: lathe([...BASE, [0.019, 0.016], [0.013, 0.056], [0.021, 0.059], [0.014, 0.062], [0.016, 0.07], [0.02, 0.08], [0.014, 0.082], [0, 0.083]]),
  Nb: lathe([...BASE, [0.02, 0.016], [0.018, 0.022], [0, 0.022]])
};
const kingCross = [new THREE.BoxGeometry(0.006, 0.022, 0.006), new THREE.BoxGeometry(0.016, 0.006, 0.006)];
const queenBall = new THREE.SphereGeometry(0.006, 10, 8);
const knightHead = (() => {   // a horse's head, cut out and given some thickness
  const s = new THREE.Shape();
  const pts = [[-0.012, 0], [0.016, 0], [0.014, 0.018], [0.008, 0.03], [0.01, 0.04], [0.004, 0.05], [-0.002, 0.048], [-0.01, 0.042],
               [-0.026, 0.03], [-0.028, 0.022], [-0.022, 0.018], [-0.01, 0.024], [-0.012, 0.012]];
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
  g.translate(0, 0, -0.008);
  return g;
})();
const ckGeo = new THREE.CylinderGeometry(CELL * 0.38, CELL * 0.4, 0.014, 28);
const ckRidge = new THREE.TorusGeometry(CELL * 0.3, 0.0025, 6, 28);
const ringGeo = new THREE.TorusGeometry(0.03, 0.003, 6, 24);
const ckRingGeo = new THREE.TorusGeometry(CELL * 0.41, 0.0028, 6, 28);
const ringMats = RAINBOW.map(c => new THREE.MeshBasicMaterial({ color: c }));
const greyRing = new THREE.MeshBasicMaterial({ color: 0x777777 });

// =====================================================================
// One table game (Checkers or Chess): its board, pieces, panel and shared state
// =====================================================================
function makeGame(cfg) {
  const G = { ...cfg, st: null, sel: -1, targets: [], pendingPromo: null, group: new THREE.Group(), pieceLayer: new THREE.Group(),
              pickMeshes: [], anim: null, prevTurnMine: false };
  G.ref = ref(db, 'room/' + cfg.key);
  G.group.visible = false;
  scene.add(G.group);
  // Board: a wooden frame and the squares
  const frame = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.06, 0.025, HALF * 2 + 0.06), std(cfg.frameColor, 0.55));
  frame.position.y = TABLE_Y + 0.0125; frame.castShadow = true; frame.receiveShadow = true;
  const tex = paintTexture(512, 512, (g, w, h) => {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      g.fillStyle = (r + c) % 2 ? cfg.dark : cfg.light; g.fillRect(c * w / 8, r * h / 8, w / 8, h / 8);
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), std(0xffffff, 0.6, { map: tex }));
  board.rotation.x = -Math.PI / 2; board.position.y = TOP + 0.0005; board.receiveShadow = true;
  board.userData.isBoard = true;
  G.board = board;
  G.group.add(frame, board, G.pieceLayer);
  // Highlights: the last move, your selected piece, a king in check, and dots where you can move
  const flat = (color, opacity, size = CELL) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.visible = false; G.group.add(m); return m;
  };
  G.lastMarks = [flat(0xffe066, 0.35), flat(0xffe066, 0.35)];
  G.selMark = flat(0x66ff99, 0.45);
  G.checkMark = flat(0xff3b30, 0.5);
  const dotGeo = new THREE.CircleGeometry(CELL * 0.14, 20), capGeo = new THREE.RingGeometry(CELL * 0.36, CELL * 0.45, 28);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x1a7f3c, transparent: true, opacity: 0.6, depthWrite: false });
  G.dots = [];
  for (let i = 0; i < 64; i++) {
    const d = new THREE.Mesh(dotGeo, dotMat), ring = new THREE.Mesh(capGeo, dotMat);
    for (const m of [d, ring]) { m.rotation.x = -Math.PI / 2; m.position.copy(cellPos(i, TOP + 0.003)); m.visible = false; G.group.add(m); }
    G.dots.push({ d, ring });
  }
  G.pieceMats = [null, std(cfg.color1, 0.45), std(cfg.color2, 0.45)];
  // The panel: status, players, join, new game, and a ⋯ menu with resign and draw
  const ui = document.getElementById(cfg.key + 'UI');
  ui.innerHTML = `<div class="bgStatus">Connecting…</div><div class="bgPlayers"></div><div class="bgPromo" style="display:none"></div>` +
    `<button class="bgJoin">Join game</button><button class="bgAccept" style="display:none">🤝 Accept draw</button><button class="bgNew">New game</button><button class="bgMore" title="More">⋯</button>` +
    `<div class="bgMenu" style="display:none"><button class="bgResign">Resign</button><button class="bgDraw">Offer draw</button></div>`;
  const q = s => ui.querySelector(s);
  G.el = { status: q('.bgStatus'), players: q('.bgPlayers'), promo: q('.bgPromo'), join: q('.bgJoin'), accept: q('.bgAccept'),
           newG: q('.bgNew'), more: q('.bgMore'), menu: q('.bgMenu'), resign: q('.bgResign'), draw: q('.bgDraw') };
  G.menuOpen = false;
  G.el.more.addEventListener('click', () => { G.menuOpen = !G.menuOpen; refreshUI(G); });
  G.el.join.addEventListener('click', () => joinOrLeave(G));
  G.el.accept.addEventListener('click', () => answerDraw(G, true));
  armButton(G, G.el.newG, 'New game', () => newGame(G), () => gameActive(G));
  armButton(G, G.el.resign, 'Resign', () => resign(G), () => true);
  G.el.draw.addEventListener('click', () => offerDraw(G));
  if (cfg.key === 'chess') {
    for (const [p, label] of [['Q', '♛ Queen'], ['R', '♜ Rook'], ['B', '♝ Bishop'], ['N', '♞ Knight']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => { const m = G.pendingPromo; G.pendingPromo = null; if (m) sendMove(G, { ...m, promo: p }); });
      G.el.promo.appendChild(b);
    }
  }
  return G;
}
// Buttons that end or restart a game ask you to click twice
function armButton(G, btn, label, action, needsConfirm) {
  let armed = false, timer = 0;
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    if (needsConfirm() && !armed) {
      armed = true; btn.textContent = 'Sure? Click again';
      timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000);
      return;
    }
    clearTimeout(timer); armed = false; btn.textContent = label;
    G.menuOpen = false;
    action();
  });
}

const checkers = makeGame({
  key: 'checkers', title: 'Checkers', sides: { 1: 'Red', 2: 'White' }, light: '#e8d6a8', dark: '#3f6b3a', frameColor: 0x2e1d12,
  color1: 0xa3201c, color2: 0xf1ead8, start: CK_START,
  owner: ckOwner, movesFrom: (st, sq) => ckMoves(st, st.turn).filter(m => m.f === sq), allMoves: ckMoves, play: ckPlay,
  fresh: () => ({ board: CK_START, chain: -1 })
});
const chess = makeGame({
  key: 'chess', title: 'Chess', sides: { 1: 'White', 2: 'Black' }, light: '#ecd7ad', dark: '#8a5a35', frameColor: 0x3b2414,
  color1: 0xefe6d2, color2: 0x2a2420, start: CH_START,
  owner: chOwner, movesFrom: chMovesFrom, allMoves: chMoves, play: chPlay,
  fresh: () => ({ board: CH_START, castle: 'KQkq', ep: -1, half: 0, check: 0 })
});
const GAMES = [checkers, chess];
export const checkersGroup = checkers.group, chessGroup = chess.group;

// ---------- Players ----------
function validPlayer(G, c) { const id = G.st && G.st['p' + c]; return id && S.presence[id] ? id : ''; }
function playerName(G, c) { const id = validPlayer(G, c); return id ? S.presence[id].name : ''; }
function playerHue(G, c) { const id = validPlayer(G, c); const p = id && S.presence[id]; return p && Number.isInteger(p.c) && p.c >= 0 && p.c < 7 ? p.c : -1; }
function bothJoined(G) { return !!(validPlayer(G, 1) && validPlayer(G, 2)); }
function gameActive(G) { return !!G.st && bothJoined(G) && !G.st.over; }
function myColor(G) { return G.st ? (G.st.p1 === myId ? 1 : G.st.p2 === myId ? 2 : 0) : 0; }
function myTurn(G) { return gameActive(G) && G.st['p' + G.st.turn] === myId; }
export function boardGamesInUse() { return GAMES.some(G => validPlayer(G, 1) || validPlayer(G, 2)); }
function activeGame() { return S.activeGame === 'checkers' ? checkers : S.activeGame === 'chess' ? chess : null; }
function copyState(st) { return JSON.parse(JSON.stringify(st)); }

// ---------- Drawing the pieces ----------
function makePiece(G, ch, sq) {
  const who = G.owner(ch), mat = G.pieceMats[who], g = new THREE.Group();
  const hue = playerHue(G, who), ringMat = hue >= 0 ? ringMats[hue] : greyRing;
  const add = (geo, m, y = 0) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.castShadow = true; g.add(o); return o; };
  if (G.key === 'checkers') {
    const king = ch === 'R' || ch === 'W';
    for (let i = 0; i < (king ? 2 : 1); i++) {
      add(ckGeo, mat, 0.007 + i * 0.0145);
      const ridge = add(ckRidge, mat, 0.0142 + i * 0.0145); ridge.rotation.x = Math.PI / 2; ridge.castShadow = false;
    }
    const ring = add(ckRingGeo, ringMat, 0.0035); ring.rotation.x = Math.PI / 2; ring.castShadow = false;   // the player's own color around the edge
  } else {
    const up = ch.toUpperCase();
    if (up === 'N') {
      add(GEO.Nb, mat);
      const head = add(knightHead, mat, 0.02);
      head.rotation.y = who === 1 ? -Math.PI / 2 : Math.PI / 2;   // facing the other player
    } else add(GEO[up], mat);
    if (up === 'K') { add(kingCross[0], mat, 0.092); add(kingCross[1], mat, 0.093); }
    if (up === 'Q') add(queenBall, mat, 0.091);
    const ring = add(ringGeo, ringMat, 0.0075); ring.rotation.x = Math.PI / 2; ring.castShadow = false;
  }
  g.position.copy(cellPos(sq));
  g.traverse(o => { if (o.isMesh) o.userData.sq = sq; });
  return g;
}
function rebuildPieces(G) {
  G.pieceLayer.clear();
  G.pickMeshes = [];
  if (!G.st) return;
  const b = G.st.board;
  for (let sq = 0; sq < 64; sq++) {
    if (b[sq] === '.') continue;
    const p = makePiece(G, b[sq], sq);
    G.pieceLayer.add(p);
    p.traverse(o => { if (o.isMesh) G.pickMeshes.push(o); });
    if (G.anim && G.anim.t0 === sq) G.anim.obj = p;
  }
  // Taken pieces line up beside the board, on the side of the player who lost them
  const lost = { 1: [], 2: [] };
  if (G.key === 'checkers') {
    for (const who of [1, 2]) for (let i = ckCount(b, who); i < 12; i++) lost[who].push(who === 1 ? 'r' : 'w');
  } else {
    const startCount = {}, nowCount = {};
    for (const ch of CH_START) startCount[ch] = (startCount[ch] || 0) + 1;
    for (const ch of b) nowCount[ch] = (nowCount[ch] || 0) + 1;
    for (const ch of 'QRBNPqrbnp') for (let i = nowCount[ch] || 0; i < startCount[ch]; i++) lost[chOwner(ch)].push(ch);
  }
  for (const who of [1, 2]) {
    lost[who].forEach((ch, i) => {
      const p = makePiece(G, ch, 0);
      p.traverse(o => { if (o.isMesh) delete o.userData.sq; });
      const side = who === 1 ? 1 : -1;   // Red/White lost pieces on the right of the board, the others on the left
      const col = Math.floor(i / 8), row = i % 8;
      p.scale.setScalar(0.62);
      p.position.set(side * (HALF + 0.07 + col * 0.06), TABLE_Y, side * (HALF - 0.05 - row * 0.1));
      G.pieceLayer.add(p);
    });
  }
}
function refreshMarks(G) {
  const st = G.st;
  const last = st && st.last && st.last.f >= 0 ? st.last : null;
  G.lastMarks.forEach((m, i) => { m.visible = !!last; if (last) m.position.copy(cellPos(i ? last.t : last.f, TOP + 0.0015)); });
  const mine = myTurn(G);
  if (!mine) { G.sel = -1; G.targets = []; }
  if (mine && G.key === 'checkers' && st.chain >= 0) { G.sel = st.chain; G.targets = G.movesFrom(st, st.chain); }
  G.selMark.visible = G.sel >= 0;
  if (G.sel >= 0) G.selMark.position.copy(cellPos(G.sel, TOP + 0.002));
  const tset = new Map(G.targets.map(m => [m.t, m]));
  G.dots.forEach((d, i) => {
    const m = tset.get(i);
    const cap = m && (m.cap !== undefined || m.ep || (st.board[i] !== '.'));
    d.d.visible = !!m && !cap; d.ring.visible = !!cap;
  });
  const chk = G.key === 'chess' && st && st.check && !st.over ? kingSq(st.board, st.turn) : -1;
  G.checkMark.visible = chk >= 0;
  if (chk >= 0) G.checkMark.position.copy(cellPos(chk, TOP + 0.0018));
}

// ---------- The panel ----------
function resultText(G) {
  const st = G.st, n = c => `${playerName(G, c) || G.sides[c]} (${G.sides[c]})`;
  if (st.winner === 3) {
    return { stalemate: 'Stalemate, it\'s a draw', fifty: 'Draw by the 50-move rule', material: 'Draw, not enough pieces left to checkmate', agreed: 'Draw agreed' }[st.result] || 'It\'s a draw';
  }
  const w = n(st.winner);
  return { mate: `Checkmate! ${w} wins`, resign: `${n(3 - st.winner)} resigned, ${w} wins`, nomoves: `${w} wins!` }[st.result] || `${w} wins!`;
}
function refreshUI(G) {
  const st = G.st, el = G.el;
  if (!st) return;
  const mine = myColor(G) && validPlayer(G, myColor(G));
  let s;
  if (!validPlayer(G, 1) && !validPlayer(G, 2)) s = 'Sit in a chair and click Join game to play';
  else if (!bothJoined(G)) s = 'Waiting for a second player to sit and join';
  else if (st.over) s = resultText(G);
  else {
    const who = `${G.sides[st.turn]}'s turn (${playerName(G, st.turn)})`;
    s = (G.key === 'chess' && st.check ? 'Check! ' : '') + (G.key === 'checkers' && st.chain >= 0 ? 'Keep jumping! ' : '') + (myTurn(G) ? 'Your move!' : who);
    if (st.draw && st.draw !== myColor(G)) s += ` · ${playerName(G, st.draw)} offers a draw`;
    else if (st.draw) s += ' · you offered a draw';
  }
  el.status.textContent = s;
  let pl = `${G.sides[1]}: ${playerName(G, 1) || 'open'} · ${G.sides[2]}: ${playerName(G, 2) || 'open'}`;
  if (st.last && st.last.f >= 0 && G.key === 'chess') pl += ` · last move ${SQNAME(st.last.f)}–${SQNAME(st.last.t)}`;
  el.players.textContent = pl;
  // Join / Leave
  if ((S.seated < 0 && !mine) || S.boardView) el.join.style.display = 'none';
  else {
    el.join.style.display = '';
    if (mine) { el.join.textContent = 'Leave game'; el.join.disabled = false; }
    else if (bothJoined(G)) { el.join.textContent = 'Game full'; el.join.disabled = true; }
    else { el.join.textContent = 'Join game'; el.join.disabled = false; }
  }
  el.newG.disabled = !mine && !!(validPlayer(G, 1) || validPlayer(G, 2));
  const playing = gameActive(G) && mine;
  el.accept.style.display = playing && st.draw && st.draw !== myColor(G) ? '' : 'none';
  el.more.style.display = playing ? '' : 'none';
  if (!playing) G.menuOpen = false;
  el.menu.style.display = G.menuOpen ? '' : 'none';
  el.draw.disabled = !!st.draw;
  el.draw.textContent = st.draw === myColor(G) ? 'Draw offered' : 'Offer draw';
  el.promo.style.display = G.pendingPromo && myTurn(G) ? '' : 'none';
  if (G.pendingPromo && !myTurn(G)) G.pendingPromo = null;
}
export function refreshBoardGames() {
  for (const G of GAMES) { if (G.st) { refreshUI(G); refreshMarks(G); } }
}

// ---------- Moves ----------
function sendMove(G, m) {
  runTransaction(G.ref, st => {
    if (!st || st.over || st['p' + st.turn] !== myId || !S.presence[st.p1] || !S.presence[st.p2]) return;
    const legal = G.movesFrom(st, m.f).find(x => x.t === m.t && (x.promo || '') === (m.promo || ''));
    if (!legal) return;
    st = G.play(st, legal);
    st.moveNo = (st.moveNo || 0) + 1;
    st.draw = 0;   // making a move turns down any draw offer
    return st;
  }).catch(e => console.warn(G.key, e));
  G.sel = -1; G.targets = [];
}
// You clicked a square (or a piece standing on it)
export function boardGameTap(cell) {
  const G = activeGame();
  if (!G || !G.st || cell < 0 || cell > 63) return;
  if (!myTurn(G)) { G.sel = -1; G.targets = []; refreshMarks(G); return; }
  const st = G.st;
  const m = G.targets.find(x => x.t === cell);
  if (G.sel >= 0 && m) {
    if (m.promo) { G.pendingPromo = { f: m.f, t: m.t }; refreshUI(G); hooks.banner && hooks.banner('Pick a piece for your pawn', 2); return; }
    sendMove(G, m);
  } else if (G.owner(st.board[cell]) === st.turn && !(G.key === 'checkers' && st.chain >= 0)) {
    const moves = G.movesFrom(st, cell);
    G.sel = cell; G.targets = moves;
    if (!moves.length && G.key === 'checkers' && G.allMoves(st, st.turn).some(x => x.cap !== undefined)) hooks.banner && hooks.banner('You have to jump!', 1.8);
    sound('clack', 0.4);
  } else { G.sel = -1; G.targets = []; }
  G.pendingPromo = null;
  refreshMarks(G); refreshUI(G);
}
export function boardGameCanTap(cell) {   // for the pointer: your own movable piece, or a square you can move to
  const G = activeGame();
  if (!G || !myTurn(G) || cell < 0) return false;
  if (G.targets.some(x => x.t === cell)) return true;
  return G.owner(G.st.board[cell]) === G.st.turn && G.movesFrom(G.st, cell).length > 0;
}
export function boardGamePickables() { const G = activeGame(); return G ? [G.board, ...G.pickMeshes] : []; }

function newGame(G) {
  if (G.el.newG.disabled) return;
  runTransaction(G.ref, st => {
    st = st || {};
    return { ...st, ...G.fresh(), turn: 1, over: 0, winner: 0, result: '', draw: 0, last: { f: -1, t: -1 }, moveNo: (st.moveNo || 0) + 1 };
  });
  G.sel = -1; G.targets = []; G.pendingPromo = null;
}
function joinOrLeave(G) {
  if (!G.st) return;
  const mine = myColor(G);
  if (mine) { update(G.ref, { ['p' + mine]: '' }); return; }
  if (S.seated < 0) return;
  runTransaction(G.ref, st => {
    if (!st) return;
    const c = !(st.p1 && S.presence[st.p1]) ? 1 : !(st.p2 && S.presence[st.p2]) ? 2 : 0;
    if (!c) return;
    st['p' + c] = myId;
    return st;
  });
}
function resign(G) {
  const me = myColor(G);
  if (!me) return;
  runTransaction(G.ref, st => {
    if (!st || st.over || st['p' + me] !== myId) return;
    return { ...st, over: 1, winner: 3 - me, result: 'resign', draw: 0, moveNo: (st.moveNo || 0) + 1, last: st.last || { f: -1, t: -1 } };
  });
}
function offerDraw(G) {
  const me = myColor(G);
  if (!me || !gameActive(G) || G.st.draw) return;
  update(G.ref, { draw: me });
  G.menuOpen = false;
}
function answerDraw(G, yes) {
  const me = myColor(G);
  runTransaction(G.ref, st => {
    if (!st || st.over || !st.draw || st.draw === me || st['p' + me] !== myId) return;
    return yes ? { ...st, over: 1, winner: 3, result: 'agreed', draw: 0, moveNo: (st.moveNo || 0) + 1 } : { ...st, draw: 0 };
  });
}

// ---------- Shared state arrives ----------
function applyState(G, st) {
  const prev = G.st;
  st.last = st.last || { f: -1, t: -1 };
  const isNext = prev && st.moveNo === (prev.moveNo || 0) + 1 && st.last.f >= 0 && prev.board !== st.board;
  const here = S.activeGame === G.key;
  G.anim = null;
  if (isNext && prev.board[st.last.f] !== '.') {   // slide (or hop) the piece that moved
    G.anim = { t0: st.last.t, from: cellPos(st.last.f), to: cellPos(st.last.t), t: 0, hop: G.key === 'checkers' || prev.board[st.last.f].toUpperCase() === 'N' };
  }
  if (prev && st.board !== prev.board && st.last.f >= 0 && here) {
    const took = [...prev.board].filter(c => c !== '.').length > [...st.board].filter(c => c !== '.').length;
    setTimeout(() => sound(took ? 'disc' : 'clack', 1), 260);
    if (G.key === 'chess' && st.check && !st.over) setTimeout(() => sound('flip'), 420);
  }
  G.st = st;
  if (G.sel >= 0 && !(myTurn(G) && G.owner(st.board[G.sel]) === st.turn)) { G.sel = -1; G.targets = []; }
  else if (G.sel >= 0) G.targets = G.movesFrom(st, G.sel);
  rebuildPieces(G);
  if (G.anim && G.anim.obj) G.anim.obj.position.copy(G.anim.from);
  // "Your turn!" and the end of the game
  const turnMine = myTurn(G);
  if (here && prev && turnMine && (!G.prevTurnMine || st.moveNo !== prev.moveNo) && hooks.banner) hooks.banner(st.chain >= 0 ? 'Keep jumping!' : st.check ? 'Check! Your move' : 'Your turn!', 1.8);
  G.prevTurnMine = turnMine;
  if (here && prev && st.over && !prev.over) {
    setTimeout(() => sound(st.winner === 3 ? 'card' : 'win'), 400);
    if (hooks.banner) hooks.banner(resultText(G), 3.5);
    if (hooks.addSys) hooks.addSys(`${G.title === 'Chess' ? '♟️' : '⛀'} ${resultText(G)}`);
  }
  hooks.refreshAll();
}
export function startBoardGames() {
  for (const G of GAMES) {
    get(G.ref).then(s => {   // create it the first time anyone ever visits
      if (!s.exists()) set(G.ref, { ...G.fresh(), turn: 1, over: 0, winner: 0, result: '', draw: 0, last: { f: -1, t: -1 }, moveNo: 0, p1: '', p2: '' });
    });
    onValue(G.ref, s => { if (s.exists()) applyState(G, s.val()); });
  }
}
export function hideBoardGames() { for (const G of GAMES) { G.sel = -1; G.targets = []; G.pendingPromo = null; G.menuOpen = false; } }

// ---------- Every frame ----------
export function updateBoardGames(dt) {
  const G = activeGame();
  if (!G || !G.anim || !G.anim.obj) return;
  const a = G.anim;
  a.t += dt;
  const dur = 0.32, p = Math.min(a.t / dur, 1), e = easeInOut(p);
  a.obj.position.lerpVectors(a.from, a.to, e);
  a.obj.position.y = TOP + Math.sin(p * Math.PI) * (a.hop ? 0.05 : 0.015);
  if (p >= 1) { a.obj.position.copy(a.to); G.anim = null; }
}

// Show the starting boards until the room's games arrive
for (const G of GAMES) { G.st = { ...G.fresh(), turn: 1, over: 0, last: { f: -1, t: -1 }, moveNo: -1 }; rebuildPieces(G); }