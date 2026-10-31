// =====================================================================
// sketch.js — LittleSketch, a slow, no-timer drawing board by the door, with three modes
// Game mode: one player draws a secret word and everyone else guesses. Every line shows up on the wall
// board as it's drawn. Everyone can keep guessing until they get it: 1st right guess 3 points, 2nd 2,
// then 1 each, and the drawer gets 1 point for every right guess.
// Doodle mode: no word and no points. One person takes the pen and draws while everyone else watches,
// and the drawing stays on the board until someone clears it.
// Guess mode: the board slowly draws a real doodle from Google's "Quick, Draw!" (they live in doodles.js)
// and everyone at the board races to guess it. Letters show up as hints once the drawing is done.
// Tools: 12 colors, a paint bucket (fill), an eraser and three brush sizes. Whiteboard or chalkboard.
// This file adds its own panel, drawing pad and guess box to the page, so index.html needs no changes.
// =====================================================================
import * as THREE from 'three';
import { ref, set, update, remove, push, onValue, onChildAdded, onChildChanged, onChildRemoved,
         runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, scene, ROOM, std, RAINBOW_CSS } from './core.js';
import { sfx } from './sounds.js';
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) { console.warn('Sketch sound', e); } }

export const SKETCH_NAME = 'LittleSketch';
const REVEAL_SECS = 5;            // how long the answer shows before the next turn
const CW = 1200, CH = 800;        // drawing size (3 wide by 2 tall)
const SIZES = [5, 12, 28];        // brush sizes: small, medium, large
const FILL_TOL = 100;             // how different a color can be and still get filled by the bucket
const BOT_SECS = { slow: 25, normal: 14 };   // Guess mode: how long the board takes to draw a doodle
const HINT_SECS = 6;              // Guess mode: a new letter shows up this often once the doodle is drawn
const BOT_WAIT_SECS = 20;         // Guess mode: after the last hint, the answer shows by itself this much later

// ---------- Words ----------
const WORDS = {
  easy: ('apple,banana,cat,dog,fish,bird,tree,flower,house,car,boat,ball,cake,cup,hat,shoe,star,moon,cloud,rain,' +
    'snowman,frog,duck,egg,pizza,ice cream,cookie,door,window,chair,table,lamp,bed,book,pencil,key,clock,phone,heart,' +
    'eye,hand,foot,nose,ear,tooth,bone,spider,snake,worm,bee,butterfly,ladybug,mushroom,leaf,carrot,cherry,grapes,' +
    'lemon,pear,candle,bell,kite,balloon,drum,robot,ghost,crown,sword,rocket,train,bus,bike,truck,airplane,umbrella,' +
    'glasses,sock,shirt,tent,campfire,mountain,river,bridge,rainbow,snowflake,owl,turtle,rabbit,mouse,pig,cow,sheep,' +
    'horse,whale,crab,octopus,sun,cheese,bread,broom,ladder,smile').split(','),
  medium: ('castle,lighthouse,volcano,waterfall,island,cactus,palm tree,pineapple,watermelon,hamburger,hot dog,taco,' +
    'sandwich,popcorn,donut,cupcake,teapot,toaster,bucket,shovel,hammer,scissors,backpack,suitcase,camera,headphones,' +
    'microphone,television,computer,keyboard,guitar,violin,piano,trumpet,skateboard,snowboard,sled,cable car,' +
    'wheelbarrow,scarecrow,windmill,tractor,fence,mailbox,doghouse,birdhouse,treehouse,igloo,pyramid,compass,map,' +
    'treasure chest,pirate,dragon,unicorn,mermaid,wizard,astronaut,alien,penguin,giraffe,elephant,kangaroo,peacock,' +
    'flamingo,jellyfish,starfish,seahorse,shark,squirrel,hedgehog,bat,beaver,moose,bear,fox,raccoon,deer,slot machine,' +
    'dice,playing card,puzzle piece,trophy,anchor,parachute,hot air balloon,ferris wheel,roller coaster,hiking boot,' +
    'lantern,canoe,fishing rod').split(','),
  hard: ('thunderstorm,earthquake,avalanche,sunrise,shadow,reflection,gravity,haircut,sneeze,hiccup,yawn,nightmare,' +
    'birthday,wedding,picnic,sleepover,homework,traffic jam,fireworks,blizzard,snow angel,hide and seek,tug of war,' +
    'high five,piggyback,trampoline,quicksand,tightrope,time machine,black hole,solar eclipse,northern lights,' +
    'constellation,tornado,hibernation,recycling,vacation,tourist,lumberjack,firefighter,lifeguard,chef,dentist,' +
    'magician,juggler,detective,haunted house,family tree,food fight,pillow fight,bubble bath,sunburn,brain freeze,' +
    'sleepwalking,daydream,campfire story,shooting star,echo,scavenger hunt,mountain trail').split(',')
};
function norm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function matches(guess, word) {   // spaces, capitals and a plural "s" don't matter
  const a = norm(guess), b = norm(word);
  return !!b && (a === b || a === b + 's' || a + 's' === b || a === b + 'es');
}

// ---------- The two board styles (12 colors each; on the chalkboard, black becomes a light chalk gray) ----------
const STYLES = {
  white: { name: 'Whiteboard', bg: '#f6f6f1',
           ink: ['#222222', '#ffffff', '#9e9e9e', '#6d4c41', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#4fc3f7', '#1e88e5', '#8e24aa', '#f06292'],
           names: ['Black', 'White', 'Gray', 'Brown', 'Red', 'Orange', 'Yellow', 'Green', 'Light blue', 'Blue', 'Purple', 'Pink'],
           tray: [0, 4, 9, 7], frame: 0xb8bcc2, rough: 0.35, metal: 0.7, head: '#2b2f36' },
  chalk: { name: 'Chalkboard', bg: '#2e4a37',
           ink: ['#cfd0c8', '#fbfbf6', '#9a9c96', '#c49a6c', '#ff8a80', '#ffbe76', '#fff176', '#a8e6a1', '#b3e5fc', '#6fb8ff', '#d6a8ff', '#f8a5c2'],
           names: ['Light gray', 'White', 'Gray', 'Brown', 'Red', 'Orange', 'Yellow', 'Green', 'Light blue', 'Blue', 'Purple', 'Pink'],
           tray: [1, 6, 11, 9], frame: 0x6b4226, rough: 0.7, metal: 0, head: '#3b2716' }
};
function makeBg(style) {   // the empty board, drawn once
  const c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const g = c.getContext('2d');
  g.fillStyle = STYLES[style].bg; g.fillRect(0, 0, CW, CH);
  if (style === 'chalk') {   // faint old chalk smudges
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(255,255,255,${0.012 + Math.random() * 0.025})`;
      g.beginPath(); g.arc(Math.random() * CW, Math.random() * CH, 20 + Math.random() * 90, 0, Math.PI * 2); g.fill();
    }
  } else {                    // a soft shine across the whiteboard
    const sh = g.createLinearGradient(0, 0, CW, CH);
    sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.4)'); sh.addColorStop(1, 'rgba(0,0,0,0.04)');
    g.fillStyle = sh; g.fillRect(0, 0, CW, CH);
  }
  return c;
}
const BGS = { white: makeBg('white'), chalk: makeBg('chalk') };

// ---------- Shared state ----------
const DEFAULTS = { style: 'white', turns: 1, words: 'mixed', hints: true, mode: 'game', rounds: 10, speed: 'normal' };
let settings = { ...DEFAULTS };
let game = {};          // room/sketch/game: who's playing, whose turn, the word, who has guessed it
let strokes = {};       // room/sketch/strokes: every line on the board in game mode
let doodles = {};       // room/sketch/doodles: every line on the doodle board (stays until cleared)
let pen = {};           // room/sketch/pen: who holds the doodle pen
let guessesRaw = {};    // room/sketch/guesses: wrong guesses and "got it!" lines
let wins = {};          // room/sketch/wins: all-time games won, by name
let bot = {};           // room/sketch/bot: the Guess mode game (which doodle, when it started, who got it, scores)
let botGuessesRaw = {}; // room/sketch/botguesses: wrong guesses and "got it!" lines in Guess mode
let watchers = {};      // room/sketch/watch: who is standing at the board in Guess mode
let dirty = true, headDirty = true, lastDraw = 0;
const gameRef = ref(db, 'room/sketch/game');
const strokesRef = ref(db, 'room/sketch/strokes');
const doodlesRef = ref(db, 'room/sketch/doodles');
const penRef = ref(db, 'room/sketch/pen');
const guessesRef = ref(db, 'room/sketch/guesses');
const botRef = ref(db, 'room/sketch/bot');
const botGuessesRef = ref(db, 'room/sketch/botguesses');
const watchRef = ref(db, 'room/sketch/watch/' + myId);
function chipKey(name) { return String(name || '?').replace(/[.#$\[\]\/]/g, '_').slice(0, 20) || '?'; }
function styleOf() { return STYLES[settings.style] ? settings.style : 'white'; }
function here(id) { return !!(id && S.presence[id]); }
function active(g, id) { return !!(g.players && g.players[id] && !g.players[id].out && here(id)); }
function activeCount(g) { return Object.keys(g.players || {}).filter(id => active(g, id)).length; }
function orderOf(g) { return Array.isArray(g.order) ? g.order.slice() : []; }
function playing(g) { return g.st === 'pick' || g.st === 'draw' || g.st === 'reveal'; }
function doodling() { return settings.mode === 'doodle' && !playing(game); }   // a running game always wins
function guessing() { return settings.mode === 'guess' && !playing(game); }
function botPlaying(b = bot) { return b.st === 'draw' || b.st === 'reveal'; }
function penHolder() { return pen && pen.id && here(pen.id) ? pen.id : ''; }   // the pen is free once its holder leaves the room
function isPlayer(id = myId) { return !!(game.players && game.players[id] && !game.players[id].out); }
function nameOf(id) { const p = game.players && game.players[id]; return p ? p.name : (S.presence[id] ? S.presence[id].name : 'someone'); }
function allGot(g) {
  const got = g.got || {};
  return Object.keys(g.players || {}).filter(id => id !== g.drawer && active(g, id)).every(id => got[id]);
}
function banner(text, secs = 3) { if (hooks.banner) hooks.banner(text, secs); }
function narrow() { return window.innerWidth <= 700 || window.innerWidth < window.innerHeight; }

// ---------- The board on the door wall ----------
export const sketchGroup = new THREE.Group();
scene.add(sketchGroup);
const BW = 2.1, BH = 1.4;                        // board size in meters
const BX = -1.3, BY = 1.5, BZ = ROOM / 2 - 0.03; // between the lamp corner and the door
const cv = document.createElement('canvas');
cv.width = CW; cv.height = CH; cv.id = 'skCanvas';
const g2 = cv.getContext('2d');
const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
const cacheCv = document.createElement('canvas');   // the board with every fill done so far, so fills don't have to be redone each time
cacheCv.width = CW; cacheCv.height = CH;
const cacheG = cacheCv.getContext('2d', { willReadFrequently: true });
const headCv = document.createElement('canvas');
headCv.width = 1024; headCv.height = 112;
const headCtx = headCv.getContext('2d');
const headTex = new THREE.CanvasTexture(headCv); headTex.colorSpace = THREE.SRGBColorSpace;
const frameMat = std(0xb8bcc2, 0.35, { metalness: 0.7 });
const trayItems = { white: new THREE.Group(), chalk: new THREE.Group() };
(function board() {
  const g = new THREE.Group();
  g.position.set(BX, BY, BZ);
  g.rotation.y = Math.PI;   // facing into the room
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  add(new THREE.BoxGeometry(BW + 0.02, BH + 0.02, 0.03), std(0x1c1c1c, 0.8), 0, 0, 0.012);                  // backing
  const surface = add(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: 0xe6e6e6 }), 0, 0, 0.028);
  surface.castShadow = false;
  add(new THREE.BoxGeometry(BW + 0.1, 0.05, 0.05), frameMat, 0, BH / 2 + 0.025, 0.03);                      // frame
  add(new THREE.BoxGeometry(BW + 0.1, 0.05, 0.05), frameMat, 0, -BH / 2 - 0.025, 0.03);
  add(new THREE.BoxGeometry(0.05, BH + 0.1, 0.05), frameMat, -BW / 2 - 0.025, 0, 0.03);
  add(new THREE.BoxGeometry(0.05, BH + 0.1, 0.05), frameMat, BW / 2 + 0.025, 0, 0.03);
  add(new THREE.BoxGeometry(BW * 0.8, 0.025, 0.09), frameMat, 0, -BH / 2 - 0.06, 0.07);                     // tray
  const TY = -BH / 2 - 0.035;
  STYLES.white.tray.forEach((ci, k) => {                                                                     // markers
    const m = add(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 12), std(STYLES.white.ink[ci], 0.5), -0.6 + k * 0.17, TY, 0.07, trayItems.white);
    m.rotation.z = Math.PI / 2;
  });
  add(new THREE.BoxGeometry(0.13, 0.035, 0.05), std(0x333333, 0.9), 0.55, TY + 0.005, 0.07, trayItems.white); // eraser
  STYLES.chalk.tray.forEach((ci, k) => {                                                                     // chalk sticks
    add(new THREE.BoxGeometry(0.08, 0.015, 0.015), std(STYLES.chalk.ink[ci], 0.95), -0.6 + k * 0.15, TY - 0.005, 0.07, trayItems.chalk);
  });
  add(new THREE.BoxGeometry(0.13, 0.035, 0.05), std(0x8b5a2b, 0.8), 0.55, TY + 0.005, 0.07, trayItems.chalk);  // brush
  g.add(trayItems.white, trayItems.chalk);
  add(new THREE.BoxGeometry(1.56, 0.2, 0.03), std(0x1c1c1c, 0.8), 0, BH / 2 + 0.17, 0.012);                  // sign above
  const sign = add(new THREE.PlaneGeometry(1.52, 1.52 * 112 / 1024), new THREE.MeshBasicMaterial({ map: headTex, toneMapped: false }), 0, BH / 2 + 0.17, 0.029);
  sign.castShadow = false;
  g.traverse(o => { if (o.isMesh) o.userData.sketch = true; });
  sketchGroup.add(g);
})();
export function sketchPickables() { return sketchGroup.children; }

// Where you stand to look at the board (the room moves the camera there)
export function sketchViewPose(aspect) {
  const halfH = Math.tan(Math.PI / 6);   // half of the 60° view, up and down
  const fitW = (BW + 0.5) / 2 / (halfH * Math.max(0.3, aspect));
  const fitH = (BH + 0.7) / 2 / halfH;
  const dist = Math.max(1.6, Math.min(3.4, Math.max(fitW, fitH)));
  const target = new THREE.Vector3(BX, BY + 0.05, BZ);
  const pos = new THREE.Vector3(BX, BY + 0.05, BZ - dist);
  return { pos, target };
}

function applyStyle() {
  const s = styleOf(), st = STYLES[s];
  frameMat.color.setHex(st.frame); frameMat.roughness = st.rough; frameMat.metalness = st.metal;
  trayItems.white.visible = s === 'white';
  trayItems.chalk.visible = s === 'chalk';
  dirty = true; headDirty = true;
}

// ---------- Drawing the board ----------
const patterns = {};
function eraserStyle(g, s) {   // the eraser paints the empty board back on
  const key = s + (g === cacheG ? 'c' : 'v');
  if (!patterns[key]) patterns[key] = g.createPattern(BGS[s], 'no-repeat');
  return patterns[key];
}
function drawStroke(g, st, s, line) {
  const pts = String(line.p || '').split(' ').map(t => t.split(',').map(Number)).filter(a => a.length === 2 && isFinite(a[0]) && isFinite(a[1]));
  if (!pts.length) return;
  const w = SIZES[line.z] || SIZES[1];
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = w;
  const color = line.e ? eraserStyle(g, s) : (st.ink[line.k] || st.ink[0]);
  g.strokeStyle = color; g.fillStyle = color;
  if (!line.e && s === 'chalk') { g.globalAlpha = 0.88; g.shadowColor = st.ink[line.k] || st.ink[0]; g.shadowBlur = 2; }
  if (pts.length === 1) {
    g.beginPath(); g.arc(pts[0][0], pts[0][1], w / 2, 0, Math.PI * 2); g.fill();
  } else {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {   // smooth curves through the points
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    g.lineTo(last[0], last[1]);
    g.stroke();
  }
  g.restore();
}
function hexRgb(h) { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function floodFill(g, sx, sy, color) {   // the paint bucket: fill the area you tapped, up to the lines around it
  sx = Math.max(0, Math.min(CW - 1, Math.round(sx))); sy = Math.max(0, Math.min(CH - 1, Math.round(sy)));
  const img = g.getImageData(0, 0, CW, CH), d = img.data, N = CW * CH;
  const [fr, fg, fb] = hexRgb(color);
  const i0 = (sy * CW + sx) * 4, tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 24) return;   // already that color
  const seen = new Uint8Array(N);
  const like = p => { const i = p * 4; return Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= FILL_TOL; };
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop(), row = y * CW;
    if (seen[row + x] || !like(row + x)) continue;
    let lx = x, rx = x;
    while (lx > 0 && !seen[row + lx - 1] && like(row + lx - 1)) lx--;
    while (rx < CW - 1 && !seen[row + rx + 1] && like(row + rx + 1)) rx++;
    let up = false, dn = false;
    for (let xx = lx; xx <= rx; xx++) {
      seen[row + xx] = 1;
      if (y > 0) { const q = row - CW + xx, ok = !seen[q] && like(q); if (ok && !up) stack.push(xx, y - 1); up = ok; }
      if (y < CH - 1) { const q = row + CW + xx, ok = !seen[q] && like(q); if (ok && !dn) stack.push(xx, y + 1); dn = ok; }
    }
  }
  for (let p = 0; p < N; p++) {   // one pixel past the edge too, so no pale ring is left along the lines
    if (seen[p] !== 1) continue;
    const x = p % CW;
    if (x > 0 && !seen[p - 1]) seen[p - 1] = 2;
    if (x < CW - 1 && !seen[p + 1]) seen[p + 1] = 2;
    if (p >= CW && !seen[p - CW]) seen[p - CW] = 2;
    if (p + CW < N && !seen[p + CW]) seen[p + CW] = 2;
  }
  for (let p = 0; p < N; p++) if (seen[p]) { const i = p * 4; d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
}
function fillAt(g, st, line) {
  const a = String(line.p || '').split(',').map(Number);
  if (a.length !== 2 || !isFinite(a[0]) || !isFinite(a[1])) return;
  try { floodFill(g, a[0], a[1], st.ink[line.k] || st.ink[0]); } catch (e) { console.warn('Sketch fill', e); }
}
function paintLine(g, st, s, line) { if (line.f) fillAt(g, st, line); else drawStroke(g, st, s, line); }
// Everything up to the newest fill is kept in the cache; only lines after it are drawn fresh each time
let cacheId = '', cacheSigs = [];
function sigOf(key, l) { return key + '|' + (l.f ? 'f' : '') + (l.e ? 'e' : '') + l.k + '|' + l.z + '|' + l.p; }
function drawLines(list, s, st) {   // list is [key, line] pairs, oldest first
  let lastFill = -1;
  list.forEach(([, l], i) => { if (l.f) lastFill = i; });
  const id = s + '|' + (doodling() ? 'd' : 'g' + (game.rn || 0));
  const want = list.slice(0, lastFill + 1).map(([k, l]) => sigOf(k, l));
  const same = cacheId === id && cacheSigs.length <= want.length && cacheSigs.every((x, i) => x === want[i]);
  if (!same) { cacheG.globalAlpha = 1; cacheG.shadowBlur = 0; cacheG.drawImage(BGS[s], 0, 0); cacheSigs = []; cacheId = id; }
  for (let i = cacheSigs.length; i <= lastFill; i++) { paintLine(cacheG, st, s, list[i][1]); cacheSigs.push(want[i]); }
  g2.drawImage(cacheCv, 0, 0);
  for (let i = lastFill + 1; i < list.length; i++) paintLine(g2, st, s, list[i][1]);
}
function fitText(g, text, size, y, color) {
  let s = size;
  g.font = `bold ${s}px Georgia`;
  while (g.measureText(text).width > CW - 120 && s > 20) { s -= 4; g.font = `bold ${s}px Georgia`; }
  g.fillStyle = color; g.fillText(text, CW / 2, y);
}
function idleScreen(g, st) {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (game.st === 'pick') {
    fitText(g, '✏️', 120, 290, st.ink[0]);
    fitText(g, `${nameOf(game.drawer)} is picking a word…`, 64, 460, st.ink[0]);
  } else if (game.st === 'over') {
    fitText(g, game.winner ? `🏆 ${game.winner} wins!` : 'Game over', 84, 190, st.ink[9]);
    const list = Object.values(game.players || {}).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6);
    list.forEach((p, i) => fitText(g, `${p.name} · ${p.score || 0}`, 48, 320 + i * 66, st.ink[0]));
  } else {
    fitText(g, SKETCH_NAME, 120, 330, st.ink[9]);
    fitText(g, 'Click the board to play', 48, 470, st.ink[0]);
  }
}
function strokeList() {   // this round's lines in game mode
  const rn = game.rn || 0;
  return Object.keys(strokes).sort().map(k => [k, strokes[k]]).filter(([, l]) => l && l.r === rn);
}
function doodleList() { return Object.keys(doodles).sort().map(k => [k, doodles[k]]).filter(([, l]) => l); }

// ---------- Guess mode: the real doodles (loaded only when someone uses Guess mode, so phones don't download them otherwise) ----------
let DOODLES = null, WORDLIST = [], doodlesLoading = false, doodlesFailed = false;
function needDoodles() {
  if (DOODLES || doodlesLoading) return;
  doodlesLoading = true; doodlesFailed = false;
  import('./doodles.js').then(m => {
    DOODLES = m.DOODLES || {}; WORDLIST = Object.keys(DOODLES);
    dirty = true; headDirty = true; refreshSketchUI(true);
  }).catch(e => { console.warn('Sketch doodles', e); doodlesLoading = false; doodlesFailed = true; refreshSketchUI(true); });
}
const decoded = {};
function doodleOf(word, idx) {   // the doodle's strokes as points, centered in a 256 by 256 box
  const key = word + '#' + idx;
  if (decoded[key]) return decoded[key];
  const raw = DOODLES && DOODLES[word] && DOODLES[word][idx];
  if (!raw) return null;
  const strokes = raw.split(' ').map(t => { const pts = []; for (let i = 0; i + 3 < t.length; i += 4) pts.push([parseInt(t.slice(i, i + 2), 16), parseInt(t.slice(i + 2, i + 4), 16)]); return pts; }).filter(s => s.length);
  let minX = 255, maxX = 0, minY = 255, maxY = 0;
  for (const s of strokes) for (const [x, y] of s) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const dx = (255 - (maxX - minX)) / 2 - minX, dy = (255 - (maxY - minY)) / 2 - minY;
  const d = { strokes: strokes.map(s => s.map(([x, y]) => [x + dx, y + dy])), total: strokes.reduce((n, s) => n + s.length, 0) };
  decoded[key] = d;
  return d;
}
function botElapsed(b = bot) { return Math.max(0, (serverNow() - (b.at || 0)) / 1000); }
function botFrac(b = bot) { return b.st === 'reveal' ? 1 : Math.min(1, botElapsed(b) / (b.dur || BOT_SECS.normal)); }
function letterCount(w) { return String(w || '').replace(/ /g, '').length; }
function botHintCount(b = bot) {   // how many letters are showing as hints right now (always at least one stays hidden)
  if (b.st !== 'draw') return 0;
  const after = botElapsed(b) - (b.dur || BOT_SECS.normal);
  return after < 0 ? 0 : Math.max(0, Math.min(letterCount(b.word) - 1, Math.floor(after / HINT_SECS)));
}
function botAutoRevealDue(b = bot) {
  return botElapsed(b) > (b.dur || BOT_SECS.normal) + HINT_SECS * Math.max(0, letterCount(b.word) - 1) + BOT_WAIT_SECS;
}
function hintOrder(word, round) {   // the order letters show up in: the same on everyone's screen
  let h = 7;
  for (const ch of word + '|' + round) h = (h * 31 + ch.charCodeAt(0)) % 2147483647;
  const idx = [...word].map((ch, i) => i).filter(i => word[i] !== ' ');
  for (let k = idx.length - 1; k > 0; k--) { h = (h * 16807) % 2147483647; const j = h % (k + 1); [idx[k], idx[j]] = [idx[j], idx[k]]; }
  return idx;
}
function botBlanks() {
  const w = bot.word || '';
  if (bot.st === 'reveal' || bot.st === 'over') return w;
  const shown = new Set(hintOrder(w, bot.round || 0).slice(0, botHintCount()));
  return [...w].map((ch, i) => ch === ' ' ? ' ' : (shown.has(i) ? ch.toUpperCase() : '_')).join(' ') + `   (${letterCount(w)})`;
}
function drawDoodle(g, st, s, d, frac) {
  const K = 2.6, ox = (CW - 256 * K) / 2, oy = 30;
  let left = Math.max(1, Math.ceil(d.total * frac));
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 9;
  g.strokeStyle = st.ink[0]; g.fillStyle = st.ink[0];
  if (s === 'chalk') { g.globalAlpha = 0.9; g.shadowColor = st.ink[0]; g.shadowBlur = 2; }
  for (const stroke of d.strokes) {
    if (left <= 0) break;
    const n = Math.min(stroke.length, left);
    left -= n;
    if (n === 1) { g.beginPath(); g.arc(ox + stroke[0][0] * K, oy + stroke[0][1] * K, 4.5, 0, Math.PI * 2); g.fill(); continue; }
    g.beginPath(); g.moveTo(ox + stroke[0][0] * K, oy + stroke[0][1] * K);
    for (let i = 1; i < n; i++) g.lineTo(ox + stroke[i][0] * K, oy + stroke[i][1] * K);
    g.stroke();
  }
  g.restore();
}
function drawBot(g, st, s) {   // the board in Guess mode
  g.drawImage(BGS[s], 0, 0);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (!DOODLES) { fitText(g, doodlesFailed ? 'Could not load doodles.js' : 'Loading doodles…', 64, 400, st.ink[0]); return; }
  if (botPlaying()) {
    const d = doodleOf(bot.word, bot.idx);
    if (d) drawDoodle(g, st, s, d, botFrac());
    if (bot.st === 'reveal') fitText(g, `It was: ${bot.word}`, 60, 750, st.ink[9]);
  } else if (bot.st === 'over') {
    fitText(g, bot.winner ? `🏆 ${bot.winner} wins!` : 'Game over', 84, 190, st.ink[9]);
    const list = Object.values(bot.scores || {}).sort((a, b) => (b.s || 0) - (a.s || 0)).slice(0, 6);
    list.forEach((p, i) => fitText(g, `${p.name} · ${p.s || 0}`, 48, 320 + i * 66, st.ink[0]));
  } else {
    fitText(g, '🤖 Guess the doodle', 100, 330, st.ink[9]);
    fitText(g, 'Click the board, then press Start', 48, 470, st.ink[0]);
  }
}
function redraw() {
  const s = styleOf(), st = STYLES[s], g = g2;
  g.globalAlpha = 1; g.shadowBlur = 0;
  if (guessing()) drawBot(g, st, s);
  else if (doodling()) drawLines(doodleList(), s, st);
  else if (game.st === 'draw' || game.st === 'reveal') drawLines(strokeList(), s, st);
  else { g.drawImage(BGS[s], 0, 0); idleScreen(g, st); }
  tex.needsUpdate = true;
}
function blanks() {
  const w = game.word || '', shown = new Set(Array.isArray(game.hint) ? game.hint : []);
  return [...w].map((ch, i) => ch === ' ' ? ' ' : (shown.has(i) ? ch.toUpperCase() : '_')).join(' ') + `   (${w.replace(/ /g, '').length})`;
}
function drawHead() {   // the sign above the board
  const g = headCtx, W = headCv.width, H = headCv.height;
  g.fillStyle = STYLES[styleOf()].head; g.fillRect(0, 0, W, H);
  let text = '✏️ ' + SKETCH_NAME;
  if (guessing()) {
    if (bot.st === 'draw') text = botBlanks();
    else if (bot.st === 'reveal') text = `It was: ${bot.word}`;
    else if (bot.st === 'over') text = bot.winner ? `🏆 ${bot.winner} wins!` : 'Game over';
    else text = '🤖 Guess the doodle';
  }
  else if (doodling()) text = penHolder() ? `🖍 ${pen.name} is doodling` : '🖍 Doodle board';
  else if (game.st === 'pick') text = `✏️ ${nameOf(game.drawer)} is picking…`;
  else if (game.st === 'draw') text = blanks();
  else if (game.st === 'reveal') text = `It was: ${game.word}`;
  else if (game.st === 'over') text = game.winner ? `🏆 ${game.winner} wins!` : 'Game over';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 58;
  g.font = `bold ${size}px Georgia`;
  while (g.measureText(text).width > W - 60 && size > 20) { size -= 3; g.font = `bold ${size}px Georgia`; }
  g.fillStyle = '#ffe9a0'; g.fillText(text, W / 2, H / 2 + 3);
  headTex.needsUpdate = true;
}

// ---------- Moving the game along (every change goes through one shared record) ----------
function pickChoices(g) {   // three words for the drawer to choose from
  const used = new Set(Array.isArray(g.used) ? g.used : []);
  const mode = (g.set && g.set.words) || 'mixed';
  const lists = mode === 'mixed' ? [WORDS.easy, WORDS.medium, WORDS.hard] : [WORDS[mode] || WORDS.easy, WORDS[mode] || WORDS.easy, WORDS[mode] || WORDS.easy];
  const picks = [];
  for (const list of lists) {
    const pool = list.filter(w => !used.has(w) && !picks.includes(w));
    const src = pool.length ? pool : list.filter(w => !picks.includes(w));
    picks.push(src[Math.floor(Math.random() * src.length)]);
  }
  return picks;
}
let wonBy = '';
function finish(g, now) {
  g.st = 'over'; g.at = now; g.drawer = ''; g.choices = null; g.got = null; g.hint = null;
  let best = null, tie = false;
  for (const p of Object.values(g.players || {})) {
    const sc = p.score || 0;
    if (!best || sc > (best.score || 0)) { best = p; tie = false; }
    else if (sc === (best.score || 0)) tie = true;
  }
  g.winner = best && (best.score || 0) > 0 && !tie ? best.name : '';
  wonBy = g.winner;
  return g;
}
function advance(g, now) {   // the next player's turn to draw, or the end of the game
  if (activeCount(g) < 2) return finish(g, now);
  const ord = orderOf(g), total = ord.length * ((g.set && g.set.turns) || 1);
  let tn = typeof g.tn === 'number' ? g.tn : -1;
  do { tn++; } while (tn < total && !active(g, ord[tn % ord.length]));
  if (tn >= total) return finish(g, now);
  g.tn = tn; g.drawer = ord[tn % ord.length];
  g.st = 'pick'; g.choices = pickChoices(g); g.word = ''; g.hint = null; g.got = null;
  g.rn = (g.rn || 0) + 1; g.at = now;
  return g;
}
function txGame(fn) {   // change the game safely, even if several people click at once
  const prevRn = game.rn || 0;
  return runTransaction(gameRef, g => { wonBy = ''; if (!g) return; return fn(g); }).then(r => {
    if (!r.committed) return r;
    const v = r.snapshot.val() || {};
    if ((v.rn || 0) !== prevRn) { remove(strokesRef).catch(() => {}); remove(guessesRef).catch(() => {}); }   // a fresh board for the new round
    if (v.st === 'over' && wonBy) {
      const who = wonBy;
      runTransaction(ref(db, 'room/sketch/wins/' + chipKey(who)), n => (n || 0) + 1).catch(() => {});
    }
    return r;
  }).catch(e => console.warn('Sketch', e));
}

function joinGame() {
  if (!S.myName) return;
  runTransaction(gameRef, g => {
    g = g || { st: 'lobby' };
    if (!g.st) g.st = 'lobby';
    g.players = g.players || {};
    const was = g.players[myId];
    g.players[myId] = { name: S.myName, c: S.myHue, score: was ? (was.score || 0) : 0 };
    if (playing(g)) { const ord = orderOf(g); if (!ord.includes(myId)) ord.push(myId); g.order = ord; }   // joining mid-game: you'll get a turn too
    return g;
  }).then(r => { if (r.committed) sound('join'); }).catch(e => console.warn('Sketch join', e));
}
function startGame() {
  if (settings.mode === 'doodle') return;
  txGame(g => {
    if (g.st !== 'lobby') return;
    const ids = Object.keys(g.players || {}).filter(id => here(id) && !g.players[id].out);
    if (ids.length < 2) return;
    for (let k = ids.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [ids[k], ids[j]] = [ids[j], ids[k]]; }
    const players = {};
    ids.forEach(id => { players[id] = { name: g.players[id].name, c: g.players[id].c, score: 0 }; });
    const fresh = { st: 'lobby', players, order: ids, tn: -1, rn: g.rn || 0, used: [],
                    set: { turns: settings.turns, words: settings.words, hints: !!settings.hints } };
    return advance(fresh, serverNow());
  });
}
function leaveGame() {
  txGame(g => {
    if (!g.players || !g.players[myId]) return;
    if (!playing(g)) { delete g.players[myId]; return g; }
    g.players[myId].out = true;
    const now = serverNow();
    if (activeCount(g) < 2) return finish(g, now);
    if (g.drawer === myId) {
      if (g.st === 'pick') return advance(g, now);
      if (g.st === 'draw') { g.st = 'reveal'; g.at = now; }
      return g;
    }
    if (g.st === 'draw' && allGot(g)) { g.st = 'reveal'; g.at = now; }
    return g;
  });
}
function endGame() { txGame(g => (playing(g) && g.players && g.players[myId] ? finish(g, serverNow()) : undefined)); }
function newGame() {
  txGame(g => {
    if (g.st !== 'over') return;
    const players = {};
    for (const [id, p] of Object.entries(g.players || {})) if (here(id) && !p.out) players[id] = { name: p.name, c: p.c, score: 0 };
    return { st: 'lobby', players, rn: g.rn || 0, winner: '' };
  });
}
function pickWord(w) {
  txGame(g => {
    if (g.st !== 'pick' || g.drawer !== myId || !(g.choices || []).includes(w)) return;
    g.word = w; g.st = 'draw'; g.hint = null; g.got = null; g.at = serverNow();
    g.used = [...(Array.isArray(g.used) ? g.used : []), w].slice(-60);
    return g;
  });
}
function newWords() {   // Skip: three different words, and a clean board
  txGame(g => {
    if (g.drawer !== myId || (g.st !== 'pick' && g.st !== 'draw') || (g.got && Object.keys(g.got).length)) return;
    if (g.word) g.used = [...(Array.isArray(g.used) ? g.used : []), g.word].slice(-60);
    g.used = [...(Array.isArray(g.used) ? g.used : []), ...(g.choices || [])].slice(-60);
    g.st = 'pick'; g.choices = pickChoices(g); g.word = ''; g.hint = null; g.got = null;
    g.rn = (g.rn || 0) + 1; g.at = serverNow();
    return g;
  });
}
function giveHint() {
  txGame(g => {
    if (g.st !== 'draw' || g.drawer !== myId || !(g.set && g.set.hints)) return;
    const shown = new Set(Array.isArray(g.hint) ? g.hint : []);
    const left = [...g.word].map((ch, i) => i).filter(i => g.word[i] !== ' ' && !shown.has(i));
    if (left.length <= 1) return;   // always keep at least one letter hidden
    shown.add(left[Math.floor(Math.random() * left.length)]);
    g.hint = [...shown];
    return g;
  });
}
function doneDrawing() {   // the drawer ends the round and shows the answer
  txGame(g => { if (g.st !== 'draw' || g.drawer !== myId) return; g.st = 'reveal'; g.at = serverNow(); return g; });
}
function skipTheirTurn() {   // if the drawer wandered off, anyone playing can move things along
  txGame(g => (g.st === 'pick' && g.drawer !== myId && g.players && g.players[myId] ? advance(g, serverNow()) : undefined));
}
function setSetting(key, val) {
  if (key === 'mode') {   // the mode can only change when no game is running; going back to Game drops the pen
    if (playing(game)) return;
    if (val === 'game') remove(penRef).catch(() => {});
    if (val !== 'guess' && botPlaying()) set(botRef, { st: 'idle' }).catch(() => {});   // leaving Guess mode ends its game
    if (val === 'guess') needDoodles();
  }
  update(ref(db, 'room/sketch/settings'), { [key]: val }).catch(e => console.warn('Sketch settings', e));
}

// ---------- Guess mode: moving its game along ----------
function botPick(b) {   // a word that hasn't come up lately, and one of its doodles
  const used = new Set(Array.isArray(b.used) ? b.used : []);
  const pool = WORDLIST.filter(w => !used.has(w));
  const list = pool.length ? pool : WORDLIST;
  const word = list[Math.floor(Math.random() * list.length)];
  b.word = word; b.idx = Math.floor(Math.random() * DOODLES[word].length);
  b.used = [...(Array.isArray(b.used) ? b.used : []), word].slice(-120);
  b.st = 'draw'; b.at = serverNow(); b.got = null; b.revealAt = 0;
  return b;
}
function botFinish(b) {
  let best = null, tie = false;
  for (const p of Object.values(b.scores || {})) {
    if (!best || (p.s || 0) > (best.s || 0)) { best = p; tie = false; }
    else if ((p.s || 0) === (best.s || 0)) tie = true;
  }
  b.winner = best && (best.s || 0) > 0 && !tie ? best.name : '';
  b.st = 'over'; b.at = serverNow(); b.got = null;
  return b;
}
function txBot(fn) {   // change the Guess game safely, even if several people click at once
  const prevRound = bot.round || 0;
  return runTransaction(botRef, b => fn(b || {})).then(r => {
    if (!r.committed) return r;
    const v = r.snapshot.val() || {};
    if ((v.round || 0) !== prevRound || v.st === 'idle') remove(botGuessesRef).catch(() => {});   // fresh guesses each round
    return r;
  }).catch(e => console.warn('Sketch guess', e));
}
function botWatching() { return Object.keys(watchers).filter(id => here(id)); }
function botAllGot(b) {
  const ids = botWatching(), got = b.got || {};
  return ids.length > 0 && ids.every(id => got[id]);
}
function startBot() {
  if (!DOODLES || !WORDLIST.length) { needDoodles(); return; }
  txBot(b => {
    if (botPlaying(b)) return;
    const fresh = { round: 1, rounds: settings.rounds || 10, dur: BOT_SECS[settings.speed] || BOT_SECS.normal,
                    scores: {}, used: Array.isArray(b.used) ? b.used : [], winner: '' };
    return botPick(fresh);
  });
}
function botReveal() { txBot(b => (b.st === 'draw' ? { ...b, st: 'reveal', revealAt: serverNow() } : undefined)); }
function botEnd() { txBot(b => (botPlaying(b) ? botFinish(b) : undefined)); }
function botTick() {   // every second: show the answer when everyone has it or it's waited long enough, then the next doodle
  const b = bot;
  if (!S.myName || !botPlaying(b) || !DOODLES) return;
  const now = serverNow();
  const due = (b.st === 'draw' && (botAllGot(b) || botAutoRevealDue(b))) || (b.st === 'reveal' && now - (b.revealAt || 0) > REVEAL_SECS * 1000);
  if (!due) return;
  txBot(x => {
    if (x.st === 'draw' && (botAllGot(x) || botAutoRevealDue(x))) { x.st = 'reveal'; x.revealAt = serverNow(); return x; }
    if (x.st === 'reveal' && serverNow() - (x.revealAt || 0) > REVEAL_SECS * 1000) {
      if ((x.round || 1) >= (x.rounds || 10)) return botFinish(x);
      x.round = (x.round || 1) + 1;
      return botPick(x);
    }
    return;
  });
}
function botGuess(text) {
  if (bot.st !== 'draw' || (bot.got && bot.got[myId])) return;
  if (!matches(text, bot.word)) {
    push(botGuessesRef, { n: S.myName, c: S.myHue, t: text, r: bot.round || 0, at: serverNow() }).catch(() => {});
    return;
  }
  let rank = 0;
  txBot(b => {
    rank = 0;
    if (b.st !== 'draw' || !matches(text, b.word)) return;
    b.got = b.got || {};
    if (b.got[myId]) return;
    rank = Object.keys(b.got).length + 1;
    b.got[myId] = rank;
    b.scores = b.scores || {};
    const was = b.scores[myId] || { s: 0 };
    b.scores[myId] = { name: S.myName, c: S.myHue, s: (was.s || 0) + (rank === 1 ? 3 : rank === 2 ? 2 : 1) };
    if (botAllGot(b)) { b.st = 'reveal'; b.revealAt = serverNow(); }
    return b;
  }).then(r => {
    if (!r || !r.committed || !rank) return;
    push(botGuessesRef, { n: S.myName, c: S.myHue, ok: 1, r: bot.round || 0, at: serverNow() }).catch(() => {});
    sound('win');
    banner(`✓ You got it! +${rank === 1 ? 3 : rank === 2 ? 2 : 1}`, 2.5);
  });
}
let watching = false;
function setWatching(on) {   // tell everyone you're at the board in Guess mode, so a round ends once all of you have it
  if (on === watching || !S.myName) return;
  watching = on;
  if (on) { set(watchRef, { name: S.myName, c: S.myHue }).catch(() => {}); onDisconnect(watchRef).remove(); }
  else { remove(watchRef).catch(() => {}); try { onDisconnect(watchRef).cancel(); } catch (e) {} }
}

// ---------- Doodle mode: one pen, passed around ----------
function takePen() {
  if (!S.myName) return;
  runTransaction(penRef, p => {
    if (p && p.id && p.id !== myId && S.presence[p.id]) return;   // someone else has it
    return { id: myId, name: S.myName, c: S.myHue, at: serverNow() };
  }).then(r => {
    if (!r.committed) { banner('🖍 Someone else has the pen', 2); return; }
    onDisconnect(penRef).remove();
    myKeys = [];
    sound('join');
    banner('🖍 You have the pen! Draw anything', 2.5);
  }).catch(e => console.warn('Sketch pen', e));
}
function givePen() {
  endLine();
  runTransaction(penRef, p => (p && p.id === myId ? null : undefined)).catch(() => {});
  try { onDisconnect(penRef).cancel(); } catch (e) {}
}

// ---------- Guessing ----------
function sendGuess() {
  const text = guessInput.value.trim().slice(0, 40);
  if (!text) return;
  guessInput.value = '';
  if (guessing()) { botGuess(text); return; }
  if (game.st !== 'draw' || !isPlayer() || game.drawer === myId || (game.got && game.got[myId])) return;
  if (!matches(text, game.word)) {
    push(guessesRef, { n: S.myName, c: S.myHue, t: text, r: game.rn || 0, at: serverNow() }).catch(() => {});
    return;
  }
  let rank = 0;
  txGame(g => {
    rank = 0;
    if (g.st !== 'draw' || !g.players || !g.players[myId] || g.drawer === myId || !matches(text, g.word)) return;
    g.got = g.got || {};
    if (g.got[myId]) return;
    rank = Object.keys(g.got).length + 1;
    g.got[myId] = rank;
    g.players[myId].score = (g.players[myId].score || 0) + (rank === 1 ? 3 : rank === 2 ? 2 : 1);
    if (g.players[g.drawer]) g.players[g.drawer].score = (g.players[g.drawer].score || 0) + 1;
    if (allGot(g)) { g.st = 'reveal'; g.at = serverNow(); }
    return g;
  }).then(r => {
    if (!r || !r.committed || !rank) return;
    push(guessesRef, { n: S.myName, c: S.myHue, ok: 1, r: game.rn || 0, at: serverNow() }).catch(() => {});
    sound('win');
    banner(`✓ You got it! +${rank === 1 ? 3 : rank === 2 ? 2 : 1}`, 2.5);
  });
}

// ---------- The page: panel, drawing pad and guess box ----------
const css = document.createElement('style');
css.textContent = `
  #skPanel { display: none; left: 16px; bottom: 16px; width: 300px; max-height: calc(100vh - 120px); overflow-y: auto; }
  body.atSketch #skPanel { display: block; }
  body.atSketch #game, body.atSketch #actionBar, body.atSketch #stand { display: none !important; }
  #skPanel h3 { margin: 0 0 4px; font-size: 17px; font-weight: normal; color: #ffe9a0; }
  .skStatus { font-size: 15px; margin-bottom: 6px; }
  .skLabel { font-size: 12px; opacity: 0.8; margin: 6px 0 3px; }
  .skWord { font-size: 24px; color: #ffe9a0; letter-spacing: 1px; margin: 2px 0 8px; }
  .skPlayers div { font-size: 14px; margin: 2px 0; }
  .skFeed { margin: 6px 0; padding-top: 4px; border-top: 1px solid rgba(243,230,207,0.2); font-size: 13px; }
  .skFeed div { margin: 1px 0; }
  .skFeed .ok { color: #7dff8a; }
  .skButtons { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(243,230,207,0.2); }
  .skCredit { margin-top: 6px; font-size: 11px; opacity: 0.6; }
  #skPad { display: none; position: fixed; left: 50%; top: 56px; transform: translateX(-50%); text-align: center; z-index: 2; }
  body.skPadOn #skPad { display: block; }
  #skPadWord { display: inline-block; font-size: 18px; color: #ffe9a0; background: rgba(30,20,12,0.88); padding: 5px 14px; border-radius: 14px; margin-bottom: 6px; }
  #skCanvas { display: block; margin: 0 auto; width: min(56vw, calc((100vh - 240px) * 1.5)); height: auto; aspect-ratio: 3 / 2;
              border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,0.6); touch-action: none; cursor: crosshair; }
  body:not(.skDrawing) #skCanvas { cursor: default; }
  body.skFill #skCanvas { cursor: cell; }
  #skTools { display: none; margin-top: 8px; flex-wrap: wrap; gap: 6px; justify-content: center; align-items: center; max-width: min(96vw, 760px); margin-left: auto; margin-right: auto; }
  body.skDrawing #skTools { display: flex; }
  #skTools button { font-family: Georgia, serif; font-size: 15px; padding: 6px 12px; border: none; border-radius: 16px; background: #e9c98f; color: #2a1c10; cursor: pointer; box-shadow: 0 3px 10px rgba(0,0,0,0.5); }
  #skTools button:disabled { opacity: 0.45; cursor: default; }
  #skTools button.dot { width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 2px solid rgba(0,0,0,0.25); }
  #skTools button.on { outline: 3px solid #ffd54f; outline-offset: 2px; }
  #skTools .skBreak { flex-basis: 100%; height: 0; }
  #skGuess { display: none; position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); width: min(420px, calc(100vw - 32px)); gap: 6px; z-index: 2; }
  body.skGuessOn #skGuess { display: flex; }
  #skGuess input { flex: 1; min-width: 0; font-size: 16px; padding: 9px 14px; border-radius: 16px; box-shadow: 0 3px 10px rgba(0,0,0,0.5); }
  #skGuess button { font-family: Georgia, serif; font-size: 16px; padding: 9px 18px; border: none; border-radius: 20px; background: #ffb36b; color: #2a1c10; cursor: pointer; box-shadow: 0 3px 10px rgba(0,0,0,0.5); }
  @media (min-width: 701px) { body.skGuessOn #chat { bottom: 16px; } }
  @media (max-width: 700px) {
    #skPanel { left: 8px; right: 8px; width: auto; bottom: 8px; max-height: 36vh; padding: 8px 10px; }
    #skPad { top: 44px; width: 100vw; }
    #skPadWord { font-size: 15px; padding: 3px 10px; margin-bottom: 4px; }
    #skCanvas { width: min(96vw, calc((100vh - 44px - var(--skPanelH, 200px) - 160px) * 1.5)); }
    #skTools { gap: 4px; margin-top: 5px; }
    #skTools button { font-size: 13px; padding: 5px 9px; }
    #skTools button.dot { width: 24px; height: 24px; }
    #skGuess { bottom: calc(var(--skPanelH, 200px) + 16px); }
  }`;
document.head.appendChild(css);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(text, onClick, cls, disabled) { const b = el('button', cls || '', text); b.addEventListener('click', onClick); if (disabled) b.disabled = true; return b; }

const panel = el('div', 'panel'); panel.id = 'skPanel';
document.body.appendChild(panel);
if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--skPanelH', panel.offsetHeight + 'px')).observe(panel);

const pad = el('div'); pad.id = 'skPad';
const padWord = el('div'); padWord.id = 'skPadWord';
const tools = el('div'); tools.id = 'skTools';
pad.append(padWord, cv, tools);
document.body.appendChild(pad);

const guessBox = el('div'); guessBox.id = 'skGuess';
const guessInput = el('input'); guessInput.maxLength = 40; guessInput.placeholder = 'Your guess…';
guessBox.append(guessInput, btn('Guess', sendGuess));
document.body.appendChild(guessBox);
guessInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendGuess(); if (e.key === 'Escape') guessInput.blur(); });

// The drawer's tools: 12 colors, pen, bucket, eraser, brush sizes, undo, clear, hint, done, skip and give up pen
let myColor = 0, mySize = 1, tool = 'pen';   // tool is 'pen', 'fill' or 'erase'
const colorBtns = [], sizeBtns = [];
for (let k = 0; k < 12; k++) {
  const b = btn('', () => { myColor = k; if (tool === 'erase') tool = 'pen'; refreshTools(); }, 'dot');
  colorBtns.push(b); tools.appendChild(b);
}
tools.appendChild(el('div', 'skBreak'));
const penBtn = btn('✏️', () => { tool = 'pen'; refreshTools(); });
penBtn.title = 'Pen';
const fillBtn = btn('🪣', () => { tool = 'fill'; refreshTools(); });
fillBtn.title = 'Fill (paint bucket)';
const eraserBtn = btn('🧽', () => { tool = 'erase'; refreshTools(); });
eraserBtn.title = 'Eraser';
tools.append(penBtn, fillBtn, eraserBtn);
['S', 'M', 'L'].forEach((label, k) => { const b = btn(label, () => { mySize = k; if (tool === 'fill') tool = 'pen'; refreshTools(); }); b.title = 'Brush size'; sizeBtns.push(b); tools.appendChild(b); });
const undoBtn = btn('↶ Undo', undo);
const clearBtn = btn('🗑 Clear', clearBoard);
const hintBtn = btn('💡 Hint', giveHint);
const doneBtn = btn('✓ Done', doneDrawing);
const skipBtn = btn('⏭ New words', newWords);
const givePenBtn = btn('✋ Give up pen', givePen);
tools.append(undoBtn, clearBtn, hintBtn, doneBtn, skipBtn, givePenBtn);
function refreshTools() {
  const st = STYLES[styleOf()], doodle = doodling();
  colorBtns.forEach((b, k) => { b.style.background = st.ink[k]; b.title = st.names[k]; b.classList.toggle('on', tool !== 'erase' && myColor === k); });
  penBtn.classList.toggle('on', tool === 'pen');
  fillBtn.classList.toggle('on', tool === 'fill');
  eraserBtn.classList.toggle('on', tool === 'erase');
  sizeBtns.forEach((b, k) => b.classList.toggle('on', tool !== 'fill' && mySize === k));
  document.body.classList.toggle('skFill', tool === 'fill');
  const shown = new Set(Array.isArray(game.hint) ? game.hint : []);
  const lettersLeft = [...(game.word || '')].filter((ch, i) => ch !== ' ' && !shown.has(i)).length;
  hintBtn.style.display = !doodle && game.set && game.set.hints ? '' : 'none';
  hintBtn.disabled = lettersLeft <= 1;
  doneBtn.style.display = doodle ? 'none' : '';
  skipBtn.style.display = doodle ? 'none' : '';
  skipBtn.disabled = !!(game.got && Object.keys(game.got).length);
  givePenBtn.style.display = doodle ? '' : 'none';
  const store = doodle ? doodles : strokes;
  undoBtn.disabled = !myKeys.some(k => store[k]);
}

// ---------- Drawing with the mouse or a finger ----------
let live = null, liveKey = '', liveDoodle = false, liveTimer = 0;
let myKeys = [];   // my lines and fills this round (or since I took the pen), newest last (for Undo)
function canDraw() { return !!S.atSketch && (doodling() ? penHolder() === myId : (game.st === 'draw' && game.drawer === myId)); }
function linesPath(doodle) { return doodle ? 'room/sketch/doodles/' : 'room/sketch/strokes/'; }
function toPt(e) {
  const r = cv.getBoundingClientRect();
  return [Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * CW), Math.round(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * CH)];
}
function packed(l) { return { r: l.r, k: l.k, z: l.z, e: l.e, p: l.pts.map(a => a[0] + ',' + a[1]).join(' ') }; }
function flush() {
  clearTimeout(liveTimer); liveTimer = 0;
  if (!live || !liveKey) return;
  set(ref(db, linesPath(liveDoodle) + liveKey), packed(live)).catch(e => console.warn('Sketch line', e));
}
function flushSoon() { if (!liveTimer) liveTimer = setTimeout(flush, 120); }   // send the line a few times a second while drawing
cv.addEventListener('pointerdown', e => {
  if (!canDraw()) return;
  e.preventDefault();
  const doodle = doodling(), store = doodle ? doodles : strokes;
  const key = push(doodle ? doodlesRef : strokesRef).key;
  if (tool === 'fill') {   // one tap fills; everyone's screen does the filling from just the spot and the color
    const p = toPt(e), rec = { r: doodle ? 0 : (game.rn || 0), k: myColor, z: 0, e: 0, f: 1, p: p[0] + ',' + p[1] };
    store[key] = rec; myKeys.push(key); dirty = true;
    set(ref(db, linesPath(doodle) + key), rec).catch(err => console.warn('Sketch fill', err));
    sound('flip');
    refreshTools();
    return;
  }
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  liveKey = key; liveDoodle = doodle;
  live = { r: doodle ? 0 : (game.rn || 0), k: myColor, z: mySize, e: tool === 'erase' ? 1 : 0, pts: [toPt(e)] };
  myKeys.push(liveKey);
  store[liveKey] = packed(live); dirty = true;
  flushSoon();
});
cv.addEventListener('pointermove', e => {
  if (!live) return;
  const p = toPt(e), last = live.pts[live.pts.length - 1];
  if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 3) return;
  live.pts.push(p);
  (liveDoodle ? doodles : strokes)[liveKey] = packed(live); dirty = true;
  flushSoon();
});
function endLine() { if (!live) return; flush(); live = null; liveKey = ''; refreshTools(); }
cv.addEventListener('pointerup', endLine);
cv.addEventListener('pointercancel', endLine);
cv.addEventListener('lostpointercapture', endLine);
function undo() {
  const doodle = doodling(), store = doodle ? doodles : strokes;
  while (myKeys.length) {
    const k = myKeys.pop();
    if (store[k]) { delete store[k]; dirty = true; remove(ref(db, linesPath(doodle) + k)).catch(() => {}); break; }
  }
  refreshTools();
}
let clearArmed = 0;
function clearBoard() {
  if (Date.now() - clearArmed > 2500) { clearArmed = Date.now(); banner('🗑 Press Clear again to wipe the board', 2.5); return; }
  clearArmed = 0;
  if (doodling()) { remove(doodlesRef).catch(() => {}); doodles = {}; }
  else { remove(strokesRef).catch(() => {}); strokes = {}; }
  myKeys = []; dirty = true;
  refreshTools();
}

// ---------- The side panel ----------
let lastSig = '';
function settingRow(label, key, options) {
  const row = el('div');
  row.appendChild(el('div', 'skLabel', label));
  for (const [val, text] of options) {
    const b = btn(text, () => setSetting(key, val), 'sw' + (settings[key] === val ? ' on' : ''));
    row.appendChild(b);
  }
  return row;
}
const MODE_OPTIONS = [['game', '🎲 Game'], ['doodle', '🖍 Doodle'], ['guess', '🤖 Guess']];
const BOARD_OPTIONS = [['white', 'Whiteboard'], ['chalk', 'Chalkboard']];
function doodlePanel() {   // the panel in doodle mode
  const holder = penHolder();
  let status;
  if (holder === myId) status = 'You have the pen. Draw anything, take your time!';
  else if (holder) status = `🖍 ${pen.name} is doodling…`;
  else status = 'Nobody has the pen. Take it to draw!';
  panel.appendChild(el('div', 'skStatus', status));
  panel.appendChild(settingRow('Mode:', 'mode', MODE_OPTIONS));
  panel.appendChild(settingRow('Board:', 'style', BOARD_OPTIONS));
  const row = el('div', 'skButtons');
  if (!holder) row.appendChild(btn('🖍 Take the pen', takePen));
  if (holder === myId) row.appendChild(btn('✋ Give up pen', givePen));
  row.appendChild(btn('← Back', () => { if (hooks.sketchBack) hooks.sketchBack(); }));
  panel.appendChild(row);
}
function guessPanel() {   // the panel in Guess mode
  const st = bot.st || 'idle', got = !!(bot.got && bot.got[myId]);
  let status;
  if (!DOODLES) status = doodlesFailed ? 'Could not load doodles.js. Is it uploaded next to sketch.js?' : 'Loading the doodles…';
  else if (st === 'draw') status = got ? 'You got it! ✓ Waiting for the others…' : 'What is it? Type your guess below!';
  else if (st === 'reveal') status = `It was "${bot.word}"!`;
  else if (st === 'over') status = bot.winner ? `🏆 ${bot.winner} wins!` : 'Game over';
  else status = 'The board draws a real doodle. Guess what it is! Press Start when everyone is here.';
  panel.appendChild(el('div', 'skStatus', status));
  if (botPlaying()) panel.appendChild(el('div', 'skLabel', `Doodle ${bot.round || 1} of ${bot.rounds || 10}`));
  if (st === 'draw') panel.appendChild(el('div', 'skWord', botBlanks()));

  // Scores
  const list = el('div', 'skPlayers');
  const rows = Object.entries(bot.scores || {}).sort((a, b) => (b[1].s || 0) - (a[1].s || 0));
  for (const [id, p] of rows) {
    const row = el('div');
    const dot = el('span', '', '● '); dot.style.color = RAINBOW_CSS[Number.isInteger(p.c) && p.c >= 0 && p.c < 7 ? p.c : 0];
    row.appendChild(dot);
    row.appendChild(document.createTextNode(`${p.name}${id === myId ? ' (you)' : ''} · ${p.s || 0}${bot.got && bot.got[id] ? ' ✓' : ''}`));
    list.appendChild(row);
  }
  if (rows.length) panel.appendChild(list);

  // This round's guesses
  const rn = bot.round || 0;
  const guesses = Object.values(botGuessesRaw).filter(x => x && x.r === rn).sort((a, b) => (a.at || 0) - (b.at || 0));
  if (botPlaying() && guesses.length) {
    const feed = el('div', 'skFeed');
    for (const gu of guesses.slice(-6)) {
      const line = el('div', gu.ok ? 'ok' : '');
      if (gu.ok) line.textContent = `✓ ${gu.n} got it!`;
      else {
        const nm = el('b', '', gu.n + ': ');
        if (Number.isInteger(gu.c) && gu.c >= 0 && gu.c < 7) nm.style.color = RAINBOW_CSS[gu.c];
        line.append(nm, document.createTextNode(gu.t));
      }
      feed.appendChild(line);
    }
    panel.appendChild(feed);
  }

  // Settings
  panel.appendChild(settingRow('Mode:', 'mode', MODE_OPTIONS));
  panel.appendChild(settingRow('Board:', 'style', BOARD_OPTIONS));
  if (!botPlaying()) {
    panel.appendChild(settingRow('Doodles:', 'rounds', [[5, '5'], [10, '10'], [20, '20']]));
    panel.appendChild(settingRow('Drawing speed:', 'speed', [['slow', 'Slow'], ['normal', 'Normal']]));
  }

  // Buttons
  const row = el('div', 'skButtons');
  if (!botPlaying()) row.appendChild(btn(st === 'over' ? 'New game' : '▶ Start', startBot, '', !DOODLES));
  if (st === 'draw') row.appendChild(btn('👀 Reveal', botReveal));
  if (botPlaying()) row.appendChild(btn('End game', () => { if (confirm('End this Guess game for everyone?')) botEnd(); }));
  row.appendChild(btn('← Back', () => { if (hooks.sketchBack) hooks.sketchBack(); }));
  panel.appendChild(row);
  panel.appendChild(el('div', 'skCredit', 'Doodles from Google\'s "Quick, Draw!" (CC BY 4.0)'));
}
export function refreshSketchUI(force) {
  const at = !!S.atSketch, doodle = doodling(), guess = guessing();
  const drawing = canDraw();
  const got = !!(game.got && game.got[myId]);
  setWatching(at && guess);
  if (guess) needDoodles();
  document.body.classList.toggle('skDrawing', drawing);
  document.body.classList.toggle('skPadOn', at && (drawing || (narrow() && (doodle || guess || game.st === 'draw' || game.st === 'reveal'))));
  const guessOn = guess ? bot.st === 'draw' && !(bot.got && bot.got[myId])
                        : !doodle && game.st === 'draw' && isPlayer() && game.drawer !== myId && !got;
  document.body.classList.toggle('skGuessOn', at && guessOn);
  if (guess) padWord.textContent = bot.st === 'draw' ? botBlanks() : bot.st === 'reveal' ? `It was: ${bot.word}` : '🤖 Guess the doodle';
  else if (doodle) padWord.textContent = drawing ? '🖍 Doodle anything · take your time' : penHolder() ? `🖍 ${pen.name} is doodling` : '🖍 Doodle board';
  else padWord.textContent = drawing ? `Draw: ${game.word} · take your time` : game.st === 'reveal' ? `It was: ${game.word}` : blanks();
  if (drawing) refreshTools();
  if (!at) { lastSig = ''; return; }
  const rn = game.rn || 0;
  const guesses = Object.values(guessesRaw).filter(x => x && x.r === rn).sort((a, b) => (a.at || 0) - (b.at || 0));   // only this round's
  const botSig = guess ? [bot, botGuessesRaw, botHintCount(), !!DOODLES, doodlesFailed] : 0;
  const sig = JSON.stringify([game, settings, pen, guesses, wins, Object.keys(S.presence), narrow(), botSig]);
  if (!force && sig === lastSig) return;
  lastSig = sig;

  panel.textContent = '';
  panel.appendChild(el('h3', '', '✏️ ' + SKETCH_NAME));
  if (guess) { guessPanel(); return; }
  if (doodle) { doodlePanel(); return; }
  const me = isPlayer(), drawerName = nameOf(game.drawer), st = game.st || 'lobby';
  let status = '';
  if (st === 'lobby') status = activeCount(game) >= 2 ? 'Ready! Press Start when everyone is in.' : 'Join, then start when 2 or more are in.';
  else if (st === 'pick') status = game.drawer === myId ? 'Your turn to draw! Pick a word:' : `${drawerName} is picking a word…`;
  else if (st === 'draw') status = game.drawer === myId ? 'Draw it! Take your time.' : got ? 'You got it! ✓ Waiting for the others…' : me ? `Guess what ${drawerName} is drawing!` : 'Join to guess along.';
  else if (st === 'reveal') status = `It was "${game.word}"!`;
  else if (st === 'over') status = game.winner ? `🏆 ${game.winner} wins!` : 'Game over';
  panel.appendChild(el('div', 'skStatus', status));

  if (st === 'pick' && game.drawer === myId) {
    const row = el('div');
    for (const w of game.choices || []) row.appendChild(btn(w, () => pickWord(w)));
    row.appendChild(btn('⏭ New words', newWords));
    panel.appendChild(row);
  }
  if (st === 'draw' && game.drawer === myId) panel.appendChild(el('div', 'skWord', game.word));
  if (st === 'draw' && game.drawer !== myId) panel.appendChild(el('div', 'skWord', blanks()));

  // Players and scores
  const list = el('div', 'skPlayers');
  const ord = orderOf(game);
  const ids = Object.keys(game.players || {}).filter(id => playing(game) || st === 'over' || here(id))
    .sort((a, b) => (ord.indexOf(a) - ord.indexOf(b)) || nameOf(a).localeCompare(nameOf(b)));
  for (const id of ids) {
    const p = game.players[id], row = el('div');
    const dot = el('span', '', '● '); dot.style.color = RAINBOW_CSS[Number.isInteger(p.c) && p.c >= 0 && p.c < 7 ? p.c : 0];
    row.appendChild(dot);
    const w = wins[chipKey(p.name)] || 0;
    const marks = (game.drawer === id && playing(game) ? ' ✏️' : '') + (game.got && game.got[id] ? ' ✓' : '') + (p.out || !here(id) ? ' (left)' : '');
    row.appendChild(document.createTextNode(`${p.name}${id === myId ? ' (you)' : ''} · ${p.score || 0}${marks}${w ? ` · 🏆${w}` : ''}`));
    list.appendChild(row);
  }
  if (!ids.length) list.appendChild(el('div', '', 'Nobody has joined yet.'));
  panel.appendChild(list);

  // This round's guesses
  if ((st === 'draw' || st === 'reveal') && guesses.length) {
    const feed = el('div', 'skFeed');
    for (const gu of guesses.slice(-6)) {
      const line = el('div', gu.ok ? 'ok' : '');
      if (gu.ok) line.textContent = `✓ ${gu.n} got it!`;
      else {
        const nm = el('b', '', gu.n + ': ');
        if (Number.isInteger(gu.c) && gu.c >= 0 && gu.c < 7) nm.style.color = RAINBOW_CSS[gu.c];
        line.append(nm, document.createTextNode(gu.t));
      }
      feed.appendChild(line);
    }
    panel.appendChild(feed);
  }

  // Settings (the board style can change any time; the mode only when no game is running)
  if (!playing(game)) panel.appendChild(settingRow('Mode:', 'mode', MODE_OPTIONS));
  panel.appendChild(settingRow('Board:', 'style', BOARD_OPTIONS));
  if (st === 'lobby' || st === 'over') {
    panel.appendChild(settingRow('Turns each:', 'turns', [[1, '1'], [2, '2'], [3, '3']]));
    panel.appendChild(settingRow('Words:', 'words', [['easy', 'Easy'], ['mixed', 'Mixed'], ['hard', 'Hard']]));
    panel.appendChild(settingRow('Hints:', 'hints', [[true, 'On'], [false, 'Off']]));
  }

  // Buttons
  const row = el('div', 'skButtons');
  if (!me) row.appendChild(btn(playing(game) ? 'Join game' : 'Join', joinGame));
  if (st === 'lobby' && me) row.appendChild(btn('Start', startGame, '', activeCount(game) < 2));
  if (st === 'over') row.appendChild(btn('New game', newGame));
  if (st === 'pick' && me && game.drawer !== myId) row.appendChild(btn('⏭ Skip their turn', skipTheirTurn));
  if (me) row.appendChild(btn('Leave game', leaveGame));
  if (me && playing(game)) row.appendChild(btn('End game', () => { if (confirm('End this LittleSketch game for everyone?')) endGame(); }));
  row.appendChild(btn('← Back', () => { if (hooks.sketchBack) hooks.sketchBack(); }));
  panel.appendChild(row);
}
window.addEventListener('resize', () => refreshSketchUI(true));

// The room calls these when you walk up to the board and step away (you keep the doodle pen until you give it up or leave the room)
export function sketchEnter() { refreshSketchUI(true); }
export function sketchLeave() { endLine(); setWatching(false); refreshSketchUI(true); }

// ---------- Little heads-ups when the game changes ----------
let firstGame = true;
function notice(prev, g) {
  if (firstGame) { firstGame = false; return; }
  if (g.st === 'pick' && g.drawer === myId && (prev.st !== 'pick' || prev.drawer !== myId)) {
    banner(S.atSketch ? '✏️ Your turn to draw! Pick a word' : '✏️ Your turn to draw in LittleSketch! Click the board by the door', 4);
    sound('ping');
  }
  if (g.st === 'draw' && prev.st !== 'draw') myKeys = [];
  if (g.st === 'reveal' && prev.st === 'draw' && (S.atSketch || isPlayer())) banner(`It was "${g.word}"!`, 3);
  if (g.st === 'over' && prev.st !== 'over' && (S.atSketch || isPlayer())) {
    banner(g.winner ? `🏆 ${g.winner} wins LittleSketch!` : 'LittleSketch game over', 4);
    if (g.winner) sound('win');
  }
  if (g.got && prev.got && Object.keys(g.got).length > Object.keys(prev.got).length && g.drawer === myId) sound('coin');
  if (g.got && !prev.got && g.drawer === myId) sound('coin');
}

// ---------- Every second: keep the game moving if someone left or the answer has shown long enough ----------
function tick() {
  const g = game;
  if (!S.myName || !playing(g)) return;
  const now = serverNow();
  const stuck = activeCount(g) < 2
    || (g.st === 'reveal' && now - (g.at || 0) > REVEAL_SECS * 1000)
    || (g.st === 'pick' && !active(g, g.drawer))
    || (g.st === 'draw' && (!active(g, g.drawer) || allGot(g)));
  if (!stuck) return;
  txGame(x => {
    if (!playing(x)) return;
    const n = serverNow();
    if (activeCount(x) < 2) return finish(x, n);
    if (x.st === 'reveal') return n - (x.at || 0) > REVEAL_SECS * 1000 ? advance(x, n) : undefined;
    if (x.st === 'pick' && !active(x, x.drawer)) return advance(x, n);
    if (x.st === 'draw' && (!active(x, x.drawer) || allGot(x))) { x.st = 'reveal'; x.at = n; return x; }
    return;
  });
}
let tickAt = 0;
export function updateSketch(dt) {
  const t = performance.now();
  if (guessing() && bot.st === 'draw' && DOODLES && botFrac() < 1) dirty = true;   // the doodle is still being drawn
  if (dirty && t - lastDraw > 50) { lastDraw = t; dirty = false; redraw(); }
  if (headDirty) { headDirty = false; drawHead(); }
  if (t - tickAt > 1000) {
    tickAt = t; tick();
    if (guessing()) { botTick(); headDirty = true; dirty = true; }   // hints show up as time passes
    if (doodling()) headDirty = true;   // notices when the pen holder leaves the room
    if (S.atSketch) refreshSketchUI();
  }
}

// ---------- Listening ----------
export function startSketch() {
  let prevMode = settings.mode;
  onValue(ref(db, 'room/sketch/settings'), s => {
    settings = { ...DEFAULTS, ...(s.val() || {}) };
    if (settings.mode !== prevMode) { prevMode = settings.mode; endLine(); myKeys = []; }
    if (settings.mode === 'guess') needDoodles();
    applyStyle(); refreshSketchUI();
  });
  onValue(botRef, s => {
    const prev = bot;
    bot = s.val() || {};
    if (botPlaying()) needDoodles();
    if (guessing() && S.atSketch) {   // little heads-ups for whoever is at the board
      if (bot.st === 'reveal' && prev.st === 'draw') banner(`It was "${bot.word}"!`, 3);
      if (bot.st === 'draw' && (prev.round !== bot.round || prev.st !== 'draw')) sound('flip');
      if (bot.st === 'over' && prev.st !== 'over') { banner(bot.winner ? `🏆 ${bot.winner} wins!` : 'Game over', 4); if (bot.winner) sound('win'); }
    }
    dirty = true; headDirty = true;
    refreshSketchUI();
  });
  onValue(botGuessesRef, s => { botGuessesRaw = s.val() || {}; refreshSketchUI(); });
  onValue(ref(db, 'room/sketch/watch'), s => { watchers = s.val() || {}; });
  onValue(gameRef, s => {
    const prev = game;
    game = s.val() || {};
    notice(prev, game);
    dirty = true; headDirty = true;
    refreshSketchUI();
  });
  onValue(penRef, s => {
    pen = s.val() || {};
    if (pen.id !== myId && live && liveDoodle) endLine();
    headDirty = true;
    refreshSketchUI();
  });
  // my own line in progress is drawn from here, not echoed back
  const keepGame = s => { if (s.key !== liveKey) { strokes[s.key] = s.val(); dirty = true; } };
  const keepDoodle = s => { if (s.key !== liveKey) { doodles[s.key] = s.val(); dirty = true; } };
  onChildAdded(strokesRef, keepGame);
  onChildChanged(strokesRef, keepGame);
  onChildRemoved(strokesRef, s => { delete strokes[s.key]; dirty = true; });
  onChildAdded(doodlesRef, keepDoodle);
  onChildChanged(doodlesRef, keepDoodle);
  onChildRemoved(doodlesRef, s => { delete doodles[s.key]; dirty = true; });
  onValue(guessesRef, s => { guessesRaw = s.val() || {}; refreshSketchUI(); });
  onValue(ref(db, 'room/sketch/wins'), s => { wins = s.val() || {}; refreshSketchUI(); });
}

// Show the empty board right away, before anyone joins
applyStyle();
redraw();
drawHead();