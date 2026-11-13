// =====================================================================
// boardgames.js — the three games in the Table Room: Checkers, Chess and Othello
// Each table has two chairs: sit in one and you're playing that side. Everyone else can walk up and watch.
// Alone at a table? "Play alone" lets you play both sides; someone who sits across from you can "Join game" and take one.
// Click one of your pieces to see where it can go (the squares light up), then click a square to move.
// The rules for Checkers and Chess come from the old room; the boards and pieces are new, polished and glossy.
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, scene, std, easeInOut } from './core.js';
import { sfx } from './sounds.js';
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) {} }

export const TABLE_Y = 0.76;                 // the table top
const CELL = 0.07, HALF = CELL * 4;          // one square, and half the board
const SCALE = CELL / 0.1;                    // the piece shapes were made for 10 cm squares
const TOP = TABLE_Y + 0.022;                 // the board's playing surface
const rc = sq => [Math.floor(sq / 8), sq % 8];
const at = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1);
function cellPos(sq, y = TOP) { const [r, c] = rc(sq); return new THREE.Vector3(-HALF + CELL * (c + 0.5), y, -HALF + CELL * (r + 0.5)); }   // on the table, around its middle

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
// Othello rules: Black moves first; place a disc so it traps a line of the other color and they all flip.
// No move? You pass. Nobody can move? Most discs wins.
// Board: 64 letters, '.' empty, 'b' black, 'w' white
// =====================================================================
const OT_START = (() => { const b = Array(64).fill('.'); b[27] = 'w'; b[36] = 'w'; b[28] = 'b'; b[35] = 'b'; return b.join(''); })();
function otOwner(ch) { return ch === 'b' ? 1 : ch === 'w' ? 2 : 0; }
function otFlips(b, sq, who) {   // the discs a move here would flip
  if (b[sq] !== '.') return [];
  const [r, c] = rc(sq), out = [];
  for (const [dr, dc] of KG) {
    const line = [];
    let rr = r + dr, cc = c + dc;
    while (at(rr, cc) >= 0 && otOwner(b[at(rr, cc)]) === 3 - who) { line.push(at(rr, cc)); rr += dr; cc += dc; }
    if (line.length && at(rr, cc) >= 0 && otOwner(b[at(rr, cc)]) === who) out.push(...line);
  }
  return out;
}
function otMoves(st, who) {
  const out = [];
  for (let sq = 0; sq < 64; sq++) if (otFlips(st.board, sq, who).length) out.push({ f: -1, t: sq });
  return out;
}
function otCount(b, who) { let n = 0; for (const ch of b) if (otOwner(ch) === who) n++; return n; }
function otPlay(st, m) {
  const who = st.turn, b = [...st.board], flips = otFlips(st.board, m.t, who);
  b[m.t] = who === 1 ? 'b' : 'w';
  for (const f of flips) b[f] = b[m.t];
  st.board = b.join('');
  st.last = { f: -1, t: m.t };
  st.pass = 0;
  if (otMoves(st, 3 - who).length) st.turn = 3 - who;
  else if (otMoves(st, who).length) { st.turn = who; st.pass = 3 - who; }   // the other side can't move, so they pass
  else {
    const a = otCount(st.board, 1), z = otCount(st.board, 2);
    st.over = 1; st.winner = a > z ? 1 : z > a ? 2 : 3; st.result = 'count';
  }
  return st;
}

// =====================================================================
// The 3D pieces (shared shapes, so they're light to draw)
// =====================================================================
const V2 = (r, y) => new THREE.Vector2(r, y);
function lathe(pts) { return new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), 32); }
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

const ckGeo = new THREE.CylinderGeometry(0.038, 0.04, 0.014, 40);
const ckRidge = new THREE.TorusGeometry(0.03, 0.0025, 8, 40);
const DISC_R = CELL * 0.42, DISC_H = 0.006;          // a disc fits inside its square, with a little gap to the next one
const discGeo = new THREE.CylinderGeometry(DISC_R, DISC_R, DISC_H, 40);

// Everything glossy here takes the room's reflection (tables.js hands it over with setRoomEnv)
const shiny = [];
function gloss(color, rough, extra = {}) { const m = std(color, rough, { envMapIntensity: 1, ...extra }); shiny.push(m); return m; }
export function setRoomEnv(tex) { for (const m of shiny) { m.envMap = tex; m.needsUpdate = true; } }
export function addShiny(m) { shiny.push(m); return m; }

// =====================================================================
// The three games
// =====================================================================
const DEFS = {
  checkers: {
    title: 'Checkers', sides: { 1: 'Red', 2: 'Black' }, squares: ['#9e1620', '#0f0f12'],
    owner: ckOwner, allMoves: ckMoves, movesFrom: (st, sq) => ckMoves(st, st.turn).filter(m => m.f === sq), play: ckPlay,
    fresh: () => ({ board: CK_START, chain: -1 }),
    mats: () => [null, gloss(0xa3121c, 0.2), gloss(0x131316, 0.16)]
  },
  chess: {
    title: 'Chess', sides: { 1: 'White', 2: 'Black' }, squares: ['#ebe6dc', '#111114'],
    owner: chOwner, allMoves: chMoves, movesFrom: chMovesFrom, play: chPlay,
    fresh: () => ({ board: CH_START, castle: 'KQkq', ep: -1, half: 0, check: 0 }),
    mats: () => [null, gloss(0xf1ece2, 0.18), gloss(0x131316, 0.15)]
  },
  othello: {
    title: 'Othello', sides: { 1: 'Black', 2: 'White' }, squares: null,
    owner: otOwner, allMoves: otMoves, movesFrom: (st, sq) => otMoves(st, st.turn).filter(m => m.t === sq), play: otPlay,
    fresh: () => ({ board: OT_START, pass: 0 }),
    mats: () => [null, gloss(0x121214, 0.18), gloss(0xf2efe6, 0.2)]
  }
};
const GAMES = {};

function boardTexture(d) {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d'), s = 128;
  if (d.squares) {
    for (let r = 0; r < 8; r++) for (let k = 0; k < 8; k++) { g.fillStyle = d.squares[(r + k) % 2]; g.fillRect(k * s, r * s, s, s); }
  } else {   // Othello: polished black with gold lines and four gold dots
    g.fillStyle = '#0c0c0f'; g.fillRect(0, 0, 1024, 1024);
    g.strokeStyle = '#c9a227'; g.lineWidth = 5;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 1024); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(1024, i * s); g.stroke(); }
    g.fillStyle = '#c9a227';
    for (const [x, y] of [[2, 2], [2, 6], [6, 2], [6, 6]]) { g.beginPath(); g.arc(x * s, y * s, 10, 0, Math.PI * 2); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function makeGame(key, x, z, frameMat, goldMat) {
  const d = DEFS[key];
  const G = { key, ...d, st: null, sel: -1, targets: [], pendingPromo: null, anim: null, prevTurnMine: false, flips: [],
              group: new THREE.Group(), pieceLayer: new THREE.Group(), pickMeshes: [] };
  G.ref = ref(db, 'tables/' + key);
  G.group.position.set(x, 0, z);
  scene.add(G.group);
  G.pieceMats = d.mats();
  // The board: a dark wood frame, a thin gold edge, and the polished squares
  const frame = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.05, 0.02, HALF * 2 + 0.05), frameMat);
  frame.position.y = TABLE_Y + 0.01; frame.castShadow = true;
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 0.01, HALF * 2 + 0.01), goldMat);
  edge.rotation.x = -Math.PI / 2; edge.position.y = TOP - 0.0006;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), gloss(0xffffff, 0.1, { map: boardTexture(d) }));
  board.rotation.x = -Math.PI / 2; board.position.y = TOP;
  board.userData.game = key;
  G.board = board;
  G.group.add(frame, edge, board, G.pieceLayer);
  // Highlights: the last move, your selected piece, a king in check, and dots where you can go
  const flat = (color, opacity) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.visible = false; G.group.add(m); return m;
  };
  G.lastMarks = [flat(0xffc23a, 0.45), flat(0xffc23a, 0.45)];
  G.selMark = flat(0x5cff9a, 0.4);
  G.checkMark = flat(0xff3b30, 0.5);
  const dotGeo = new THREE.CircleGeometry(CELL * 0.14, 24), capGeo = new THREE.RingGeometry(CELL * 0.36, CELL * 0.45, 32);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x5cff9a, transparent: true, opacity: 0.55, depthWrite: false });
  G.dots = [];
  for (let i = 0; i < 64; i++) {
    const dot = new THREE.Mesh(dotGeo, dotMat), ring = new THREE.Mesh(capGeo, dotMat);
    for (const m of [dot, ring]) { m.rotation.x = -Math.PI / 2; m.position.copy(cellPos(i, TOP + 0.0015)); m.visible = false; G.group.add(m); }
    G.dots.push({ dot, ring });
  }
  // Othello keeps 64 discs that flip over, instead of rebuilding pieces
  if (key === 'othello') {
    G.discs = [];
    for (let i = 0; i < 64; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(discGeo, G.pieceMats[1]); b.position.y = DISC_H / 2;
      const w = new THREE.Mesh(discGeo, G.pieceMats[2]); w.position.y = -DISC_H / 2;
      b.castShadow = w.castShadow = true;
      g.add(b, w);
      g.position.copy(cellPos(i, TOP + DISC_H + 0.0005));
      g.visible = false;
      g.traverse(o => { if (o.isMesh) { o.userData.game = key; o.userData.sq = i; } });
      G.group.add(g);
      G.discs.push({ g, rot: 0, to: 0, t: 1, delay: 0, color: 0 });
    }
  }
  GAMES[key] = G;
  return G;
}

// ---------- Players ----------
function validPlayer(G, c) { const id = G.st && G.st['p' + c]; return id && S.presence[id] ? id : ''; }
// Playing alone: the same person holds both sides (p1 and p2 are both them). They only sit in one of the chairs, so the
// other chair is still free to sit in; whoever sits there can join and take that side.
function solo(G) { return !!(G.st && G.st.p1 && G.st.p1 === G.st.p2 && S.presence[G.st.p1]); }
function chairHolder(G, side) {   // who is actually sitting in this chair
  const id = validPlayer(G, side);
  if (id && solo(G) && S.presence[id].s !== `${G.key}:${side}`) return '';   // the solo player is in the other chair
  return id;
}
function playerName(G, c) { const id = validPlayer(G, c); return id ? S.presence[id].name : ''; }
function bothSeated(G) { return !!(validPlayer(G, 1) && validPlayer(G, 2)); }
function gameActive(G) { return !!G.st && bothSeated(G) && !G.st.over; }
function mySide(G) { return G.st ? (G.st.p1 === myId ? 1 : G.st.p2 === myId ? 2 : 0) : 0; }
function myTurn(G) { return gameActive(G) && G.st['p' + G.st.turn] === myId; }
export function seatTaken(key, side) { const G = GAMES[key]; const id = G && chairHolder(G, side); return !!id && id !== myId; }
export function seatHolder(key, side) { const G = GAMES[key]; return G ? chairHolder(G, side) : ''; }

// Sitting down claims that side of the board; standing up gives it back
export function sit(key, side) {
  const G = GAMES[key];
  if (solo(G) && G.st.p1 !== myId && !chairHolder(G, side)) return Promise.resolve(true);   // the empty chair at someone's solo game: sit and watch (or join)
  return runTransaction(G.ref, st => {
    if (!st) return st;
    const id = st['p' + side];
    if (id && id !== myId && S.presence[id]) return;   // someone's already there
    st['p' + side] = myId;
    return st;
  }).then(r => r.committed && r.snapshot.val() && r.snapshot.val()['p' + side] === myId).catch(() => false);
}
export function stand(key, side) {
  const G = GAMES[key];
  if (G && G.st && G.st.p1 === myId && G.st.p2 === myId) update(G.ref, { p1: '', p2: '' }).catch(() => {});   // done playing alone
  else if (G && G.st && G.st['p' + side] === myId) update(G.ref, { ['p' + side]: '' }).catch(() => {});
  if (G) { G.sel = -1; G.targets = []; G.pendingPromo = null; refreshMarks(G); }
}

// ---------- Drawing the pieces ----------
function makePiece(G, ch, sq) {
  const who = G.owner(ch), mat = G.pieceMats[who], g = new THREE.Group();
  const add = (geo, m, y = 0) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.castShadow = true; g.add(o); return o; };
  if (G.key === 'checkers') {
    const king = ch === 'R' || ch === 'W';
    for (let i = 0; i < (king ? 2 : 1); i++) {
      add(ckGeo, mat, 0.007 + i * 0.0145);
      const ridge = add(ckRidge, who === 2 ? ridgeMat : mat, 0.0142 + i * 0.0145); ridge.rotation.x = Math.PI / 2; ridge.castShadow = false;
    }
  } else {
    const up = ch.toUpperCase();
    if (up === 'N') {
      add(GEO.Nb, mat);
      const head = add(knightHead, mat, 0.02);
      head.rotation.y = who === 1 ? -Math.PI / 2 : Math.PI / 2;   // facing the other player
    } else add(GEO[up], mat);
    if (up === 'K') { add(kingCross[0], mat, 0.092); add(kingCross[1], mat, 0.093); }
    if (up === 'Q') add(queenBall, mat, 0.091);
  }
  g.scale.setScalar(SCALE);
  g.position.copy(cellPos(sq));
  g.traverse(o => { if (o.isMesh) { o.userData.game = G.key; o.userData.sq = sq; } });
  return g;
}
const ridgeMat = std(0x8d8d96, 0.25, { metalness: 0.6 });   // a silvery ring so black checkers show on black squares
function rebuildPieces(G) {
  if (G.key === 'othello') return;
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
  // Taken pieces line up on the table beside the board, on the side of the player who lost them
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
      p.traverse(o => { if (o.isMesh) { delete o.userData.sq; delete o.userData.game; } });
      const side = who === 1 ? 1 : -1, col = Math.floor(i / 8), row = i % 8;
      p.scale.setScalar(SCALE * 0.6);
      p.position.set(side * (HALF + 0.07 + col * 0.045), TABLE_Y, side * (HALF - 0.035 - row * 0.07));
      G.pieceLayer.add(p);
    });
  }
}
function showDiscs(G, prev) {   // Othello: new discs drop in, flipped ones turn over one after another
  const b = G.st.board;
  const placed = G.st.last && G.st.last.t >= 0 ? G.st.last.t : -1;
  let n = 0;
  for (let i = 0; i < 64; i++) {
    const d = G.discs[i], who = otOwner(b[i]);
    if (!who) { d.g.visible = false; d.color = 0; continue; }
    const target = who === 1 ? 0 : Math.PI;
    if (!prev || !d.color) {   // a new disc: show it the right way up
      d.g.visible = true; d.rot = d.to = target; d.t = 1; d.g.rotation.x = target;
      if (prev && i === placed) { d.drop = 0; }
    } else if (d.color !== who) {   // flip it
      d.to = target; d.from = d.rot; d.t = 0; d.delay = 0.12 + n * 0.06; n++;
      sound('flip', d.delay);
    }
    d.color = who;
  }
}
function refreshMarks(G) {
  const st = G.st;
  if (!st) return;
  const last = st.last && st.last.t >= 0 ? st.last : null;
  G.lastMarks[0].visible = !!(last && last.f >= 0);
  if (last && last.f >= 0) G.lastMarks[0].position.copy(cellPos(last.f, TOP + 0.001));
  G.lastMarks[1].visible = !!last;
  if (last) G.lastMarks[1].position.copy(cellPos(last.t, TOP + 0.001));
  const mine = myTurn(G);
  if (!mine) { G.sel = -1; G.targets = []; }
  if (mine && G.key === 'checkers' && st.chain >= 0) { G.sel = st.chain; G.targets = G.movesFrom(st, st.chain); }
  if (mine && G.key === 'othello') G.targets = G.allMoves(st, st.turn);
  G.selMark.visible = G.sel >= 0;
  if (G.sel >= 0) G.selMark.position.copy(cellPos(G.sel, TOP + 0.0012));
  const tset = new Map(G.targets.map(m => [m.t, m]));
  G.dots.forEach((d, i) => {
    const m = tset.get(i);
    const cap = !!m && G.key !== 'othello' && (m.cap !== undefined || m.ep || st.board[i] !== '.');
    d.dot.visible = !!m && !cap; d.ring.visible = cap;
  });
  const chk = G.key === 'chess' && st.check && !st.over ? kingSq(st.board, st.turn) : -1;
  G.checkMark.visible = chk >= 0;
  if (chk >= 0) G.checkMark.position.copy(cellPos(chk, TOP + 0.0011));
}

// ---------- The panel (shown for the table you're sitting at, or standing near) ----------
const css = document.createElement('style');
css.textContent = `
  #tablePanel { left: 16px; bottom: 16px; width: 300px; display: none; }
  #tablePanel.on { display: block; }
  #tablePanel .tpTitle { font-size: 17px; color: #ffe0a8; margin-bottom: 4px; }
  #tablePanel .tpStatus { font-size: 15px; margin-bottom: 4px; }
  #tablePanel .tpPlayers { font-size: 13px; opacity: 0.8; margin-bottom: 8px; }
  #tablePanel .tpPromo button { background: #ffd54f; }
  @media (max-width: 700px) { #tablePanel { left: 8px; right: 8px; bottom: 8px; width: auto; } }`;
document.head.appendChild(css);
const panel = document.createElement('div');
panel.id = 'tablePanel'; panel.className = 'panel';
panel.innerHTML = `<div class="tpTitle"></div><div class="tpStatus"></div><div class="tpPlayers"></div><div class="tpPromo"></div>
  <div class="tpBtns"><button class="tpSolo">Play alone</button><button class="tpJoin">Join game</button><button class="tpNew">New game</button><button class="tpAccept">🤝 Accept draw</button><button class="tpDraw">Offer draw</button><button class="tpResign">Resign</button><button class="tpStand">Stand up</button></div>`;
document.body.appendChild(panel);
const q = s => panel.querySelector(s);
const el = { title: q('.tpTitle'), status: q('.tpStatus'), players: q('.tpPlayers'), promo: q('.tpPromo'), newG: q('.tpNew'),
             accept: q('.tpAccept'), draw: q('.tpDraw'), resign: q('.tpResign'), stand: q('.tpStand'), solo: q('.tpSolo'), join: q('.tpJoin') };
let shown = null;   // the game the panel is showing
export function showPanel(key) { shown = key ? GAMES[key] : null; refreshPanel(); }
for (const [p, label] of [['Q', '♛ Queen'], ['R', '♜ Rook'], ['B', '♝ Bishop'], ['N', '♞ Knight']]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { const G = shown, m = G && G.pendingPromo; if (!m) return; G.pendingPromo = null; sendMove(G, { ...m, promo: p }); });
  el.promo.appendChild(b);
}
// Buttons that end or restart a game ask you to click twice
function armButton(btn, label, action, needsConfirm) {
  let armed = false, timer = 0;
  btn.addEventListener('click', () => {
    if (btn.disabled || !shown) return;
    if (needsConfirm() && !armed) {
      armed = true; btn.textContent = 'Sure? Click again';
      timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000);
      return;
    }
    clearTimeout(timer); armed = false; btn.textContent = label;
    action(shown);
  });
}
armButton(el.newG, 'New game', G => newGame(G), () => gameActive(shown));
armButton(el.resign, 'Resign', G => resign(G), () => true);
el.draw.addEventListener('click', () => { if (shown) offerDraw(shown); });
el.accept.addEventListener('click', () => { if (shown) answerDraw(shown); });
el.stand.addEventListener('click', () => { if (hooks.standUp) hooks.standUp(); });
el.solo.addEventListener('click', () => { if (shown) playAlone(shown); });
el.join.addEventListener('click', () => { if (shown) joinGame(shown); });

function resultText(G) {
  const st = G.st, n = c => `${playerName(G, c) || G.sides[c]} (${G.sides[c]})`;
  if (st.winner === 3) {
    if (G.key === 'othello') return `It's a tie, ${otCount(st.board, 1)} to ${otCount(st.board, 2)}`;
    return { stalemate: 'Stalemate, it\'s a draw', fifty: 'Draw by the 50-move rule', material: 'Draw, not enough pieces left to checkmate', agreed: 'Draw agreed' }[st.result] || 'It\'s a draw';
  }
  const w = n(st.winner);
  if (G.key === 'othello' && st.result === 'count') return `${w} wins, ${otCount(st.board, st.winner)} to ${otCount(st.board, 3 - st.winner)}!`;
  return { mate: `Checkmate! ${w} wins`, resign: `${n(3 - st.winner)} resigned, ${w} wins`, nomoves: `${w} wins!` }[st.result] || `${w} wins!`;
}
function refreshPanel() {
  const G = shown;
  panel.classList.toggle('on', !!G && !!G.st);
  if (!G || !G.st) return;
  const st = G.st, side = mySide(G);
  el.title.textContent = G.title;
  let s;
  const alone = solo(G), watchingSolo = alone && st.p1 !== myId;
  if (!validPlayer(G, 1) && !validPlayer(G, 2)) s = 'Sit in a chair to play';
  else if (!bothSeated(G)) s = side ? 'Waiting for someone to sit across from you, or play alone' : 'One seat open, sit down to play';
  else if (watchingSolo) s = `${playerName(G, 1)} is playing alone` + (st.over ? ` · ${resultText(G)}` : '');
  else if (st.over) s = resultText(G);
  else if (alone) s = (G.key === 'chess' && st.check ? 'Check! ' : '') + (G.key === 'checkers' && st.chain >= 0 ? 'Keep jumping! ' : '') +
        (G.key === 'othello' && st.pass ? `${G.sides[st.pass]} has no move and passes. ` : '') + `Playing alone · ${G.sides[st.turn]} to move`;
  else {
    const who = `${G.sides[st.turn]}'s turn (${playerName(G, st.turn)})`;
    s = (G.key === 'chess' && st.check ? 'Check! ' : '') + (G.key === 'checkers' && st.chain >= 0 ? 'Keep jumping! ' : '') +
        (G.key === 'othello' && st.pass ? `${G.sides[st.pass]} has no move and passes. ` : '') + (myTurn(G) ? 'Your move!' : who);
    if (st.draw && st.draw !== side) s += ` · ${playerName(G, st.draw)} offers a draw`;
    else if (st.draw) s += ' · you offered a draw';
  }
  el.status.textContent = s;
  let pl = alone ? `${G.sides[1]} and ${G.sides[2]}: ${playerName(G, 1)}` : `${G.sides[1]}: ${playerName(G, 1) || 'open'} · ${G.sides[2]}: ${playerName(G, 2) || 'open'}`;
  if (G.key === 'othello') pl += ` · ${otCount(st.board, 1)} – ${otCount(st.board, 2)}`;
  else if (G.key === 'chess' && st.last && st.last.f >= 0) pl += ` · last ${SQNAME(st.last.f)}–${SQNAME(st.last.t)}`;
  el.players.textContent = pl;
  const playing = gameActive(G) && side;
  el.solo.style.display = side && !validPlayer(G, 3 - side) ? '' : 'none';
  el.join.style.display = watchingSolo && S.seat && S.seat.key === G.key ? '' : 'none';
  el.newG.style.display = side && (!gameActive(G) || st.over || playing) ? '' : 'none';
  el.accept.style.display = playing && !alone && st.draw && st.draw !== side ? '' : 'none';
  el.draw.style.display = playing && !alone && G.key !== 'othello' && !st.draw ? '' : 'none';
  el.resign.style.display = playing && !alone ? '' : 'none';
  el.stand.style.display = side ? '' : 'none';
  el.promo.style.display = G.pendingPromo && myTurn(G) ? '' : 'none';
  if (G.pendingPromo && !myTurn(G)) G.pendingPromo = null;
}
export function refreshGames() { for (const G of Object.values(GAMES)) if (G.st) refreshMarks(G); refreshPanel(); }

// ---------- Moves ----------
function sendMove(G, m) {
  runTransaction(G.ref, st => {
    if (!st || st.over || st['p' + st.turn] !== myId || !S.presence[st.p1] || !S.presence[st.p2]) return;
    const legal = (m.f >= 0 ? G.movesFrom(st, m.f) : G.allMoves(st, st.turn)).find(x => x.t === m.t && (x.promo || '') === (m.promo || ''));
    if (!legal) return;
    st = G.play(st, legal);
    st.moveNo = (st.moveNo || 0) + 1;
    st.draw = 0;   // making a move turns down any draw offer
    return st;
  }).catch(e => console.warn(G.key, e));
  G.sel = -1; G.targets = [];
}
// You clicked a square (or a piece standing on it) at the table you're sitting at
export function tap(key, cell) {
  const G = GAMES[key];
  if (!G || !G.st || cell < 0 || cell > 63) return;
  if (!myTurn(G)) { G.sel = -1; G.targets = []; refreshMarks(G); return; }
  const st = G.st;
  if (G.key === 'othello') {
    if (G.allMoves(st, st.turn).some(x => x.t === cell)) sendMove(G, { f: -1, t: cell });
    return;
  }
  const m = G.targets.find(x => x.t === cell);
  if (G.sel >= 0 && m) {
    if (m.promo) { G.pendingPromo = { f: m.f, t: m.t }; refreshPanel(); if (hooks.banner) hooks.banner('Pick a piece for your pawn', 2); return; }
    sendMove(G, m);
  } else if (G.owner(st.board[cell]) === st.turn && !(G.key === 'checkers' && st.chain >= 0)) {
    const moves = G.movesFrom(st, cell);
    G.sel = cell; G.targets = moves;
    if (!moves.length && G.key === 'checkers' && G.allMoves(st, st.turn).some(x => x.cap !== undefined) && hooks.banner) hooks.banner('You have to jump!', 1.8);
  } else { G.sel = -1; G.targets = []; }
  G.pendingPromo = null;
  refreshMarks(G); refreshPanel();
}
export function canTap(key, cell) {   // for the pointer: your own movable piece, or a square you can move to
  const G = GAMES[key];
  if (!G || !myTurn(G) || cell < 0) return false;
  if (G.key === 'othello') return G.allMoves(G.st, G.st.turn).some(x => x.t === cell);
  if (G.targets.some(x => x.t === cell)) return true;
  return G.owner(G.st.board[cell]) === G.st.turn && G.movesFrom(G.st, cell).length > 0;
}
// What you can click at a table, and which square a click on its board lands on
export function pickables(key) { const G = GAMES[key]; return G ? [G.board, ...G.pickMeshes, ...(G.discs ? G.discs.map(d => d.g) : [])] : []; }
const tmp = new THREE.Vector3();
export function squareAt(key, hit) {
  if (hit.object.userData.sq !== undefined) return hit.object.userData.sq;
  const G = GAMES[key];
  G.group.worldToLocal(tmp.copy(hit.point));
  const c = Math.floor((tmp.x + HALF) / CELL), r = Math.floor((tmp.z + HALF) / CELL);
  return at(r, c);
}

function newGame(G) {
  runTransaction(G.ref, st => {
    st = st || {};
    return { ...st, ...G.fresh(), turn: 1, over: 0, winner: 0, result: '', draw: 0, last: { f: -1, t: -1 }, moveNo: (st.moveNo || 0) + 1 };
  });
  G.sel = -1; G.targets = []; G.pendingPromo = null;
}
function playAlone(G) {   // take the empty side too, and start a fresh game
  runTransaction(G.ref, st => {
    if (!st) return;
    const mine = st.p1 === myId ? 1 : st.p2 === myId ? 2 : 0, other = st['p' + (3 - mine)];
    if (!mine || (other && other !== myId && S.presence[other])) return;   // someone sat down after all
    return { ...st, ...G.fresh(), p1: myId, p2: myId, turn: 1, over: 0, winner: 0, result: '', draw: 0, last: { f: -1, t: -1 }, moveNo: (st.moveNo || 0) + 1 };
  });
  G.sel = -1; G.targets = []; G.pendingPromo = null;
}
function joinGame(G) {   // sitting across from someone playing alone: take this chair's side, and the game goes on with two
  const side = S.seat && S.seat.key === G.key ? S.seat.side : 0;
  if (!side) return;
  runTransaction(G.ref, st => {
    if (!st || !st.p1 || st.p1 !== st.p2 || st.p1 === myId) return;
    return { ...st, ['p' + side]: myId, draw: 0 };
  });
}
function resign(G) {
  const me = mySide(G);
  if (!me) return;
  runTransaction(G.ref, st => {
    if (!st || st.over || st['p' + me] !== myId) return;
    return { ...st, over: 1, winner: 3 - me, result: 'resign', draw: 0, moveNo: (st.moveNo || 0) + 1 };
  });
}
function offerDraw(G) {
  const me = mySide(G);
  if (me && gameActive(G) && !G.st.draw) update(G.ref, { draw: me });
}
function answerDraw(G) {
  const me = mySide(G);
  runTransaction(G.ref, st => {
    if (!st || st.over || !st.draw || st.draw === me || st['p' + me] !== myId) return;
    return { ...st, over: 1, winner: 3, result: 'agreed', draw: 0, moveNo: (st.moveNo || 0) + 1 };
  });
}

// ---------- Shared state arrives ----------
function applyState(G, st) {
  const prev = G.st;
  st.last = st.last || { f: -1, t: -1 };
  const next = prev && st.moveNo === (prev.moveNo || 0) + 1 && prev.board !== st.board;
  const seatedHere = mySide(G) || (prev && (prev.p1 === myId || prev.p2 === myId));
  G.anim = null;
  if (next && st.last.f >= 0 && prev.board[st.last.f] !== '.') {   // slide (or hop) the piece that moved
    G.anim = { t0: st.last.t, from: cellPos(st.last.f), to: cellPos(st.last.t), t: 0, hop: G.key === 'checkers' || prev.board[st.last.f].toUpperCase() === 'N' };
  }
  if (next && G.key !== 'othello') setTimeout(() => sound('flip'), 300);
  G.st = st;
  if (G.sel >= 0 && !(myTurn(G) && G.owner(st.board[G.sel]) === st.turn)) { G.sel = -1; G.targets = []; }
  else if (G.sel >= 0) G.targets = G.movesFrom(st, G.sel);
  if (G.key === 'othello') showDiscs(G, prev && st.board !== OT_START ? prev : null);
  else rebuildPieces(G);
  if (G.anim && G.anim.obj) G.anim.obj.position.copy(G.anim.from);
  refreshMarks(G);
  // "Your turn!" and the end of the game, for the players at this table
  const turnMine = myTurn(G);
  if (prev && turnMine && (!G.prevTurnMine || st.moveNo !== prev.moveNo) && hooks.banner) {
    hooks.banner(st.chain >= 0 ? 'Keep jumping!' : st.check ? 'Check! Your move' : st.pass ? 'They have no move, go again!' : 'Your turn!', 1.8);
  }
  G.prevTurnMine = turnMine;
  if (prev && st.over && !prev.over && (seatedHere || shown === G)) {
    setTimeout(() => sound(st.winner === 3 ? 'leave' : 'win'), 400);
    if (hooks.banner) hooks.banner(resultText(G), 3.5);
  }
  if (prev && st.over && !prev.over && hooks.addSys) hooks.addSys(`${G.title}: ${resultText(G)}`);
  refreshPanel();
  if (hooks.refreshAll) hooks.refreshAll();
}

// Set up the three tables' games and start listening
export function startGames(spots, frameMat, goldMat) {
  for (const [key, [x, z]] of Object.entries(spots)) makeGame(key, x, z, frameMat, goldMat);
  for (const G of Object.values(GAMES)) {
    get(G.ref).then(s => {   // made the first time anyone ever visits
      if (!s.exists()) set(G.ref, { ...G.fresh(), turn: 1, over: 0, winner: 0, result: '', draw: 0, last: { f: -1, t: -1 }, moveNo: 0, p1: '', p2: '' });
    });
    onValue(G.ref, s => { if (s.exists()) applyState(G, s.val()); });
  }
}
export function gameAt(key) { return GAMES[key]; }

// ---------- Every frame: pieces sliding and discs flipping ----------
export function updateGames(dt) {
  for (const G of Object.values(GAMES)) {
    const a = G.anim;
    if (a && a.obj) {
      a.t += dt;
      const p = Math.min(a.t / 0.34, 1), e = easeInOut(p);
      a.obj.position.lerpVectors(a.from, a.to, e);
      a.obj.position.y = TOP + Math.sin(p * Math.PI) * (a.hop ? 0.045 : 0.012);
      if (p >= 1) { a.obj.position.copy(a.to); G.anim = null; }
    }
    if (G.discs) {
      for (const d of G.discs) {
        if (d.drop !== undefined) {   // a newly placed disc drops in
          d.drop = Math.min(1, d.drop + dt / 0.25);
          d.g.position.y = TOP + DISC_H + 0.0005 + (1 - easeInOut(d.drop)) * 0.06;
          if (d.drop >= 1) delete d.drop;
        }
        if (d.t >= 1) continue;
        if (d.delay > 0) { d.delay -= dt; continue; }
        d.t = Math.min(1, d.t + dt / 0.35);
        const e = easeInOut(d.t);
        d.rot = d.from + (d.to - d.from) * e;
        d.g.rotation.x = d.rot;
        d.g.position.y = TOP + DISC_H + 0.0005 + Math.sin(d.t * Math.PI) * 0.03;
      }
    }
  }
}