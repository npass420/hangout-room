// =====================================================================
// sketch.js — LittleSketch, the big doodle board on the far wall
// One person takes the pen and draws while everyone else watches, then passes the pen so the next person
// keeps working on the same drawing. It stays until someone clears it, and a finished doodle can be saved to
// the Doodle Gallery on the side walls (gallery.js), with everyone who drew on it as artists.
// Tools: 12 colors, pen, paint bucket (fill), line, square and circle (drag to stretch them; hold Shift for an
// exact square or circle), an eraser and three brush sizes. Undo, Clear and Undo clear. Whiteboard or chalkboard.
// This file adds its own panel and drawing pad to the page, so index.html needs no changes for them.
// =====================================================================
import * as THREE from 'three';
import { ref, set, update, remove, push, onValue, onChildAdded, onChildChanged, onChildRemoved,
         runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, scene, ROOM, std, envMap } from './core.js';
import { sfx } from './sounds.js';
import './gallery.js';   // the Doodle Gallery on the side walls
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) { console.warn('Sketch sound', e); } }

export const SKETCH_NAME = 'LittleSketch';
const CW = 1200, CH = 800;        // drawing size (3 wide by 2 tall, the same as the gallery frames)
const SIZES = [5, 12, 28];        // brush sizes: small, medium, large
const FILL_TOL = 100;             // how different a color can be and still get filled by the bucket

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
const DEFAULTS = { style: 'white' };
let settings = { ...DEFAULTS };
let doodles = {};       // room/sketch/doodles: every line on the board (stays until cleared)
let pen = {};           // room/sketch/pen: who holds the pen
let artists = {};       // room/sketch/doodleArt: everyone who has drawn on the doodle (for the gallery)
let dback = null;       // room/sketch/dbackup: the doodle as it was before the last Clear (for Undo clear)
let dirty = true, headDirty = true, lastDraw = 0;
const doodlesRef = ref(db, 'room/sketch/doodles');
const penRef = ref(db, 'room/sketch/pen');
const artRef = ref(db, 'room/sketch/doodleArt');
const dbackRef = ref(db, 'room/sketch/dbackup');
function chipKey(name) { return String(name || '?').replace(/[.#$\[\]\/]/g, '_').slice(0, 20) || '?'; }
function styleOf() { return STYLES[settings.style] ? settings.style : 'white'; }
function here(id) { return !!(id && S.presence[id]); }
function penHolder() { return pen && pen.id && here(pen.id) ? pen.id : ''; }   // the pen is free once its holder leaves the room
function banner(text, secs = 3) { if (hooks.banner) hooks.banner(text, secs); }
function narrow() { return window.innerWidth <= 700 || window.innerWidth < window.innerHeight; }

// ---------- The board on the far wall ----------
export const sketchGroup = new THREE.Group();
scene.add(sketchGroup);
const BW = 4.2, BH = 2.8;                        // board size in meters (3 wide by 2 tall)
const BX = 0, BY = 1.9, BZ = -ROOM / 2 + 0.03;   // centered on the wall across from the door
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
const frameMat = std(0xb8bcc2, 0.35, { metalness: 0.7, envMap, envMapIntensity: 0.6 });
const trayItems = { white: new THREE.Group(), chalk: new THREE.Group() };
(function board() {
  const g = new THREE.Group();
  g.position.set(BX, BY, BZ);   // facing into the room
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  add(new THREE.BoxGeometry(BW + 0.02, BH + 0.02, 0.03), std(0x1c1c1c, 0.8), 0, 0, 0.012);                  // backing
  const surface = add(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: 0xe6e6e6 }), 0, 0, 0.028);
  surface.castShadow = false;
  add(new THREE.BoxGeometry(BW + 0.14, 0.07, 0.06), frameMat, 0, BH / 2 + 0.035, 0.03);                     // frame
  add(new THREE.BoxGeometry(BW + 0.14, 0.07, 0.06), frameMat, 0, -BH / 2 - 0.035, 0.03);
  add(new THREE.BoxGeometry(0.07, BH + 0.14, 0.06), frameMat, -BW / 2 - 0.035, 0, 0.03);
  add(new THREE.BoxGeometry(0.07, BH + 0.14, 0.06), frameMat, BW / 2 + 0.035, 0, 0.03);
  add(new THREE.BoxGeometry(BW * 0.8, 0.03, 0.11), frameMat, 0, -BH / 2 - 0.085, 0.08);                     // tray
  const TY = -BH / 2 - 0.055;
  STYLES.white.tray.forEach((ci, k) => {                                                                     // markers
    const m = add(new THREE.CylinderGeometry(0.014, 0.014, 0.15, 12), std(STYLES.white.ink[ci], 0.5), -1.3 + k * 0.22, TY, 0.08, trayItems.white);
    m.rotation.z = Math.PI / 2;
  });
  add(new THREE.BoxGeometry(0.15, 0.04, 0.06), std(0x333333, 0.9), 1.2, TY + 0.005, 0.08, trayItems.white);   // eraser
  STYLES.chalk.tray.forEach((ci, k) => {                                                                     // chalk sticks
    add(new THREE.BoxGeometry(0.09, 0.017, 0.017), std(STYLES.chalk.ink[ci], 0.95), -1.3 + k * 0.2, TY - 0.005, 0.08, trayItems.chalk);
  });
  add(new THREE.BoxGeometry(0.15, 0.04, 0.06), std(0x8b5a2b, 0.8), 1.2, TY + 0.005, 0.08, trayItems.chalk);    // brush
  g.add(trayItems.white, trayItems.chalk);
  const SW = 2.4, SH = SW * 112 / 1024, SY = BH / 2 + 0.07 + SH / 2 + 0.06;
  add(new THREE.BoxGeometry(SW + 0.04, SH + 0.04, 0.03), std(0x1c1c1c, 0.8), 0, SY, 0.012);                // sign above
  const sign = add(new THREE.PlaneGeometry(SW, SH), new THREE.MeshBasicMaterial({ map: headTex, toneMapped: false }), 0, SY, 0.029);
  sign.castShadow = false;
  g.traverse(o => { if (o.isMesh) o.userData.sketch = true; });
  sketchGroup.add(g);
})();
export function sketchPickables() { return sketchGroup.children; }

// Where you stand to look at the board (the room moves the camera there)
export function sketchViewPose(aspect) {
  const halfH = Math.tan(Math.PI / 6);   // half of the 60° view, up and down
  const fitW = (BW + 0.6) / 2 / (halfH * Math.max(0.3, aspect));
  const fitH = (BH + 0.9) / 2 / halfH;
  const dist = Math.max(2, Math.min(ROOM - 1, Math.max(fitW, fitH)));
  const target = new THREE.Vector3(BX, BY + 0.1, BZ);
  const pos = new THREE.Vector3(BX, BY + 0.1, BZ + dist);
  return { pos, target };
}
// Where snowmen stand while they're at the board (off to its sides, so everyone can see who's drawing)
export const BOARD_SPOT = { x: BX, z: BZ + 0.9, side: BW / 2 + 0.5 };

function applyStyle() {
  const s = styleOf(), st = STYLES[s];
  frameMat.color.setHex(st.frame); frameMat.roughness = st.rough; frameMat.metalness = st.metal;
  trayItems.white.visible = s === 'white';
  trayItems.chalk.visible = s === 'chalk';
  dirty = true; headDirty = true;
}

// ---------- Drawing the board ----------
const patterns = new WeakMap();   // the eraser paints the empty board back on (one pattern per canvas)
function eraserStyle(g, s) {
  let m = patterns.get(g);
  if (!m) { m = {}; patterns.set(g, m); }
  if (!m[s]) m[s] = g.createPattern(BGS[s], 'no-repeat');
  return m[s];
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
function drawShape(g, st, s, line) {   // a line ('l'), square ('r') or circle ('o') from one corner to the other
  const pts = String(line.p || '').split(' ').map(t => t.split(',').map(Number));
  if (pts.length !== 2 || pts.some(a => a.length !== 2 || !isFinite(a[0]) || !isFinite(a[1]))) return;
  const [[x1, y1], [x2, y2]] = pts;
  const color = st.ink[line.k] || st.ink[0];
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = SIZES[line.z] || SIZES[1];
  g.strokeStyle = color;
  if (s === 'chalk') { g.globalAlpha = 0.88; g.shadowColor = color; g.shadowBlur = 2; }
  g.beginPath();
  if (line.sh === 'r') g.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  else if (line.sh === 'o') g.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.max(0.5, Math.abs(x2 - x1) / 2), Math.max(0.5, Math.abs(y2 - y1) / 2), 0, 0, Math.PI * 2);
  else { g.moveTo(x1, y1); g.lineTo(x2, y2); }
  g.stroke();
  g.restore();
}
function paintLine(g, st, s, line) {
  if (line.f) fillAt(g, st, line);
  else if (line.sh) drawShape(g, st, s, line);
  else drawStroke(g, st, s, line);
}
// Paints a saved doodle onto any canvas, at any size (the gallery uses this for its frames and viewer).
// It's painted full size first, so fills land in the right spots, then shrunk to fit.
const artCv = document.createElement('canvas');
artCv.width = CW; artCv.height = CH;
const artG = artCv.getContext('2d', { willReadFrequently: true });
export function renderDoodle(g, w, h, style, lines) {
  const s = STYLES[style] ? style : 'white', st = STYLES[s];
  artG.globalAlpha = 1; artG.shadowBlur = 0;
  artG.drawImage(BGS[s], 0, 0);
  for (const line of lines || []) if (line) paintLine(artG, st, s, line);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.shadowBlur = 0;
  g.drawImage(artCv, 0, 0, w, h);
  g.restore();
}
hooks.renderDoodle = renderDoodle;

// Everything up to the newest fill is kept in the cache; only lines after it are drawn fresh each time
let cacheId = '', cacheSigs = [];
function sigOf(key, l) { return key + '|' + (l.f ? 'f' : '') + (l.e ? 'e' : '') + (l.sh || '') + l.k + '|' + l.z + '|' + l.p; }
function drawLines(list, s, st) {   // list is [key, line] pairs, oldest first
  let lastFill = -1;
  list.forEach(([, l], i) => { if (l.f) lastFill = i; });
  const want = list.slice(0, lastFill + 1).map(([k, l]) => sigOf(k, l));
  const same = cacheId === s && cacheSigs.length <= want.length && cacheSigs.every((x, i) => x === want[i]);
  if (!same) { cacheG.globalAlpha = 1; cacheG.shadowBlur = 0; cacheG.drawImage(BGS[s], 0, 0); cacheSigs = []; cacheId = s; }
  for (let i = cacheSigs.length; i <= lastFill; i++) { paintLine(cacheG, st, s, list[i][1]); cacheSigs.push(want[i]); }
  g2.drawImage(cacheCv, 0, 0);
  for (let i = lastFill + 1; i < list.length; i++) paintLine(g2, st, s, list[i][1]);
}
function doodleList() { return Object.keys(doodles).sort().map(k => [k, doodles[k]]).filter(([, l]) => l); }
function redraw() {
  const s = styleOf(), st = STYLES[s];
  g2.globalAlpha = 1; g2.shadowBlur = 0;
  drawLines(doodleList(), s, st);
  tex.needsUpdate = true;
}
function drawHead() {   // the sign above the board
  const g = headCtx, W = headCv.width, H = headCv.height;
  g.fillStyle = STYLES[styleOf()].head; g.fillRect(0, 0, W, H);
  const text = penHolder() ? `🖍 ${pen.name} is doodling` : '🖍 ' + SKETCH_NAME;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 58;
  g.font = `bold ${size}px Georgia`;
  while (g.measureText(text).width > W - 60 && size > 20) { size -= 3; g.font = `bold ${size}px Georgia`; }
  g.fillStyle = '#ffe9a0'; g.fillText(text, W / 2, H / 2 + 3);
  headTex.needsUpdate = true;
}
function setStyle(val) {
  update(ref(db, 'room/sketch/settings'), { style: val }).catch(e => console.warn('Sketch settings', e));
}

// ---------- The pen: one person draws at a time, then passes it on ----------
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
function artistNames() { return Object.values(artists || {}).map(p => p && p.n).filter(Boolean); }
function addMeAsArtist() {   // everyone who draws on the doodle gets credit in the gallery
  const k = chipKey(S.myName);
  if (artists && artists[k]) return;
  artists = { ...(artists || {}), [k]: { n: S.myName, c: S.myHue } };
  set(ref(db, 'room/sketch/doodleArt/' + k), { n: S.myName, c: S.myHue }).catch(() => {});
}

// ---------- Saving a doodle to the gallery ----------
let savedSig = '';   // the doodle as it was when it was last saved, so the same one isn't saved twice
function doodleSig() { const ks = Object.keys(doodles).filter(k => doodles[k]).sort(); return ks.length + ':' + (ks[ks.length - 1] || ''); }
function saveDoodle() {   // hang a copy of the doodle in the gallery
  endLine();
  const list = doodleList().filter(([, l]) => l.p);
  if (!list.length) { banner('🖍 Draw something first', 2); return; }
  const sig = doodleSig();
  if (sig === savedSig) { banner('📸 This doodle is already in the gallery', 2.5); return; }
  const lines = list.map(([, l]) => {
    const o = { k: l.k || 0, z: l.z == null ? 1 : l.z, e: l.e ? 1 : 0, p: l.p };
    if (l.f) o.f = 1;
    if (l.sh) o.sh = l.sh;
    return o;
  });
  const art = { s: styleOf(), l: lines };
  if (JSON.stringify(art).length > 3000000) { banner('This doodle is too big to save', 3); return; }
  const title = titleInput.value.trim().slice(0, 40) || 'Untitled';
  const by = artists && Object.keys(artists).length ? artists : { [chipKey(S.myName)]: { n: S.myName, c: S.myHue } };
  const id = push(ref(db, 'room/sketch/gallery')).key;
  savedSig = sig;
  set(ref(db, 'room/sketch/galleryArt/' + id), art)   // the lines first, then the label, so the wall never shows an empty picture
    .then(() => set(ref(db, 'room/sketch/gallery/' + id), { t: title, s: art.s, a: by, by: S.myName, at: serverNow() }))
    .then(() => {
      titleInput.value = '';
      banner('📸 Saved to the Doodle Gallery!', 2.5);
      sound('win');
      if (hooks.addSys) hooks.addSys(`🖼️ ${S.myName} hung "${title}" in the Doodle Gallery`, S.myHue);
    })
    .catch(e => { savedSig = ''; console.warn('Gallery save', e); banner('Could not save the doodle', 3); });
}

// ---------- The page: panel and drawing pad ----------
const css = document.createElement('style');
css.textContent = `
  #skPanel { display: none; left: 16px; bottom: 16px; width: 300px; max-height: calc(100vh - 120px); overflow-y: auto; }
  body.atSketch #skPanel { display: block; }
  #skPanel h3 { margin: 0 0 4px; font-size: 17px; font-weight: normal; color: #ffe9a0; }
  .skStatus { font-size: 15px; margin-bottom: 6px; }
  .skLabel { font-size: 12px; opacity: 0.8; margin: 6px 0 3px; }
  .skButtons { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(243,230,207,0.2); }
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
  @media (max-width: 700px) {
    #skPanel { left: 8px; right: 8px; width: auto; bottom: 8px; max-height: 36vh; padding: 8px 10px; }
    #skPad { top: 44px; width: 100vw; }
    #skPadWord { font-size: 15px; padding: 3px 10px; margin-bottom: 4px; }
    #skCanvas { width: min(96vw, calc((100vh - 44px - var(--skPanelH, 200px) - 160px) * 1.5)); }
    #skTools { gap: 4px; margin-top: 5px; }
    #skTools button { font-size: 13px; padding: 5px 9px; }
    #skTools button.dot { width: 24px; height: 24px; }
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

// The tools: 12 colors, pen, bucket, line, square, circle, eraser, brush sizes, undo, clear, undo clear, give up pen and save
let myColor = 0, mySize = 1, tool = 'pen';   // tool is 'pen', 'fill', 'line', 'rect', 'oval' or 'erase'
const SHAPE_OF = { line: 'l', rect: 'r', oval: 'o' };
const colorBtns = [], sizeBtns = [];
for (let k = 0; k < 12; k++) {
  const b = btn('', () => { myColor = k; if (tool === 'erase') tool = 'pen'; refreshTools(); }, 'dot');
  colorBtns.push(b); tools.appendChild(b);
}
tools.appendChild(el('div', 'skBreak'));
function toolBtn(icon, name, title) { const b = btn(icon, () => { tool = name; refreshTools(); }); b.title = title; tools.appendChild(b); return b; }
const toolBtns = {
  pen: toolBtn('✏️', 'pen', 'Pen'),
  fill: toolBtn('🪣', 'fill', 'Fill (paint bucket)'),
  line: toolBtn('📏', 'line', 'Line (drag it out)'),
  rect: toolBtn('⬜', 'rect', 'Square (drag it out; hold Shift for an exact square)'),
  oval: toolBtn('⚪', 'oval', 'Circle (drag it out; hold Shift for a perfect circle)'),
  erase: toolBtn('🧽', 'erase', 'Eraser')
};
['S', 'M', 'L'].forEach((label, k) => { const b = btn(label, () => { mySize = k; if (tool === 'fill') tool = 'pen'; refreshTools(); }); b.title = 'Brush size'; sizeBtns.push(b); tools.appendChild(b); });
tools.appendChild(el('div', 'skBreak'));
const undoBtn = btn('↶ Undo', undo);
const clearBtn = btn('🗑 Clear', clearBoard);
const undoClearBtn = btn('↩ Undo clear', undoClear);
undoClearBtn.title = 'Bring back what was on the board before the last Clear';
const givePenBtn = btn('✋ Give up pen', givePen);
const saveBtn = btn('📸 Save', saveDoodle);
saveBtn.title = 'Save to the Doodle Gallery';
tools.append(undoBtn, clearBtn, undoClearBtn, givePenBtn, saveBtn);
const titleInput = el('input');   // the doodle's title for the gallery (kept between panel redraws)
titleInput.maxLength = 40; titleInput.placeholder = 'Title (optional)';
titleInput.style.cssText = 'width: 100%; box-sizing: border-box; font-size: 15px; padding: 6px 10px; border-radius: 12px; margin-bottom: 4px;';
titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveDoodle(); if (e.key === 'Escape') titleInput.blur(); });
function refreshTools() {
  const st = STYLES[styleOf()];
  colorBtns.forEach((b, k) => { b.style.background = st.ink[k]; b.title = st.names[k]; b.classList.toggle('on', tool !== 'erase' && myColor === k); });
  for (const [name, b] of Object.entries(toolBtns)) b.classList.toggle('on', tool === name);
  sizeBtns.forEach((b, k) => b.classList.toggle('on', tool !== 'fill' && mySize === k));
  document.body.classList.toggle('skFill', tool === 'fill');
  undoBtn.disabled = !myKeys.some(k => doodles[k]);
  undoClearBtn.style.display = canUndoClear() ? '' : 'none';
}

// ---------- Drawing with the mouse or a finger ----------
let live = null, liveKey = '', liveTimer = 0;
let myKeys = [];   // my lines and fills since I took the pen, newest last (for Undo)
function canDraw() { return !!S.atSketch && penHolder() === myId; }
function toPt(e) {
  const r = cv.getBoundingClientRect();
  return [Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * CW), Math.round(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * CH)];
}
function packed(l) {
  const o = { r: 0, k: l.k, z: l.z, e: l.e, p: l.pts.map(a => a[0] + ',' + a[1]).join(' ') };
  if (l.sh) o.sh = l.sh;
  return o;
}
function flush() {
  clearTimeout(liveTimer); liveTimer = 0;
  if (!live || !liveKey) return;
  set(ref(db, 'room/sketch/doodles/' + liveKey), packed(live)).catch(e => console.warn('Sketch line', e));
}
function flushSoon() { if (!liveTimer) liveTimer = setTimeout(flush, 120); }   // send the line a few times a second while drawing
function shapeEnd(start, p, sh, exact) {   // where a shape's far corner goes (Shift makes it exact)
  if (!exact) return p;
  const dx = p[0] - start[0], dy = p[1] - start[1];
  if (sh === 'l') {   // a line snaps to flat, straight up or a 45° slant
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
    return [Math.round(start[0] + Math.cos(ang) * len), Math.round(start[1] + Math.sin(ang) * len)];
  }
  const m = Math.max(Math.abs(dx), Math.abs(dy));   // a square or circle: the same width and height
  return [start[0] + (dx < 0 ? -m : m), start[1] + (dy < 0 ? -m : m)];
}
cv.addEventListener('pointerdown', e => {
  if (!canDraw()) return;
  e.preventDefault();
  endLine();
  const key = push(doodlesRef).key;
  addMeAsArtist();
  if (tool === 'fill') {   // one tap fills; everyone's screen does the filling from just the spot and the color
    const p = toPt(e), rec = { r: 0, k: myColor, z: 0, e: 0, f: 1, p: p[0] + ',' + p[1] };
    doodles[key] = rec; myKeys.push(key); dirty = true;
    set(ref(db, 'room/sketch/doodles/' + key), rec).catch(err => console.warn('Sketch fill', err));
    sound('flip');
    refreshTools();
    return;
  }
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  liveKey = key;
  const p = toPt(e), sh = SHAPE_OF[tool] || '';
  live = { k: myColor, z: mySize, e: tool === 'erase' ? 1 : 0, pts: sh ? [p, p] : [p], sh };
  myKeys.push(liveKey);
  doodles[liveKey] = packed(live); dirty = true;
  if (!sh) flushSoon();   // a shape only goes up for everyone once you let go
});
cv.addEventListener('pointermove', e => {
  if (!live) return;
  const p = toPt(e);
  if (live.sh) {   // stretch the shape from where you started to where you are
    live.pts[1] = shapeEnd(live.pts[0], p, live.sh, e.shiftKey);
    doodles[liveKey] = packed(live); dirty = true;
    return;
  }
  const last = live.pts[live.pts.length - 1];
  if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 3) return;
  live.pts.push(p);
  doodles[liveKey] = packed(live); dirty = true;
  flushSoon();
});
function endLine() {
  if (!live) return;
  if (live.sh) {
    const [a, b] = live.pts;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) {   // just a tap, not a drag: no shape
      delete doodles[liveKey];
      myKeys = myKeys.filter(k => k !== liveKey);
      dirty = true; live = null; liveKey = ''; refreshTools();
      return;
    }
  }
  flush(); live = null; liveKey = ''; refreshTools();
}
cv.addEventListener('pointerup', endLine);
cv.addEventListener('pointercancel', endLine);
cv.addEventListener('lostpointercapture', endLine);
function undo() {
  while (myKeys.length) {
    const k = myKeys.pop();
    if (doodles[k]) { delete doodles[k]; dirty = true; remove(ref(db, 'room/sketch/doodles/' + k)).catch(() => {}); break; }
  }
  refreshTools();
}
let clearArmed = 0;
function clearBoard() {
  if (Date.now() - clearArmed > 2500) { clearArmed = Date.now(); banner('🗑 Press Clear again to wipe the board', 2.5); return; }
  clearArmed = 0;
  endLine();
  if (!doodleList().length) return;   // nothing to clear
  const copy = {};   // keep what was there, so anyone at the board can press Undo clear
  for (const [k, l] of doodleList()) copy[k] = l;
  dback = { l: copy, a: Object.keys(artists || {}).length ? artists : null };
  set(dbackRef, dback).catch(() => {});
  remove(doodlesRef).catch(() => {});
  remove(artRef).catch(() => {});
  doodles = {}; artists = {}; savedSig = '';
  myKeys = []; dirty = true;
  refreshTools(); refreshSketchUI(true);
}
function canUndoClear() { return !!(dback && dback.l); }
function undoClear() {   // put the cleared drawing back (anything drawn since stays on top)
  if (!canUndoClear()) return;
  endLine();
  const back = dback;
  dback = null;
  update(doodlesRef, back.l).catch(e => console.warn('Undo clear', e));
  for (const [k, l] of Object.entries(back.l)) if (!doodles[k]) doodles[k] = l;
  if (back.a) { update(artRef, back.a).catch(() => {}); artists = { ...back.a, ...(artists || {}) }; }
  remove(dbackRef).catch(() => {});
  dirty = true;
  sound('flip');
  refreshTools(); refreshSketchUI(true);
}

// ---------- The side panel ----------
let lastSig = '';
const BOARD_OPTIONS = [['white', 'Whiteboard'], ['chalk', 'Chalkboard']];
export function refreshSketchUI(force) {
  const at = !!S.atSketch, drawing = canDraw(), holder = penHolder();
  document.body.classList.toggle('skDrawing', drawing);
  document.body.classList.toggle('skPadOn', at && (drawing || narrow()));   // phones see the board up close
  padWord.textContent = drawing ? '🖍 Doodle anything · take your time' : holder ? `🖍 ${pen.name} is doodling` : '🖍 ' + SKETCH_NAME;
  if (drawing) refreshTools();
  if (!at) { lastSig = ''; return; }
  const sig = JSON.stringify([settings, pen, holder, artists, doodleList().length > 0, narrow()]);
  if (!force && sig === lastSig) return;
  lastSig = sig;

  const typing = document.activeElement === titleInput;
  panel.textContent = '';
  panel.appendChild(el('h3', '', '🖍 ' + SKETCH_NAME));
  let status;
  if (holder === myId) status = 'You have the pen. Draw anything, take your time!';
  else if (holder) status = `🖍 ${pen.name} is doodling…`;
  else status = 'Nobody has the pen. Take it to draw!';
  panel.appendChild(el('div', 'skStatus', status));
  const names = artistNames();
  panel.appendChild(el('div', 'skLabel', names.length ? 'Drawn by: ' + names.join(', ') : 'Nobody has drawn on it yet.'));
  panel.appendChild(el('div', 'skLabel', 'Save it to the Doodle Gallery on the side walls:'));
  panel.appendChild(titleInput);
  const srow = el('div');
  srow.appendChild(btn('📸 Save to gallery', saveDoodle, '', !doodleList().length));
  panel.appendChild(srow);
  const brow = el('div');
  brow.appendChild(el('div', 'skLabel', 'Board:'));
  for (const [val, text] of BOARD_OPTIONS) brow.appendChild(btn(text, () => setStyle(val), 'sw' + (styleOf() === val ? ' on' : '')));
  panel.appendChild(brow);
  const row = el('div', 'skButtons');
  if (!holder) row.appendChild(btn('🖍 Take the pen', takePen));
  if (holder === myId) row.appendChild(btn('✋ Give up pen', givePen));
  row.appendChild(btn('← Back', () => { if (hooks.sketchBack) hooks.sketchBack(); }));
  panel.appendChild(row);
  if (typing) titleInput.focus();
}
window.addEventListener('resize', () => refreshSketchUI(true));

// The room calls these when you walk up to the board and step away (you keep the pen until you give it up or leave the room)
export function sketchEnter() { refreshSketchUI(true); }
export function sketchLeave() { endLine(); refreshSketchUI(true); }

// ---------- Every frame: redraw the board when something changed ----------
let tickAt = 0;
export function updateSketch(dt) {
  const t = performance.now();
  if (dirty && t - lastDraw > 50) { lastDraw = t; dirty = false; redraw(); }
  if (headDirty) { headDirty = false; drawHead(); }
  if (t - tickAt > 1000) {
    tickAt = t;
    headDirty = true;   // notices when the pen holder leaves the room
    if (S.atSketch) refreshSketchUI();
  }
}

// ---------- Listening ----------
export function startSketch() {
  onValue(ref(db, 'room/sketch/settings'), s => {
    settings = { ...DEFAULTS, ...(s.val() || {}) };
    applyStyle(); refreshSketchUI();
  });
  onValue(penRef, s => {
    pen = s.val() || {};
    if (pen.id !== myId && live) endLine();
    headDirty = true;
    refreshSketchUI();
  });
  // my own line in progress is drawn from here, not echoed back
  const keep = s => { if (s.key !== liveKey) { doodles[s.key] = s.val(); dirty = true; } };
  onChildAdded(doodlesRef, keep);
  onChildChanged(doodlesRef, keep);
  onChildRemoved(doodlesRef, s => { delete doodles[s.key]; dirty = true; });
  onValue(artRef, s => { artists = s.val() || {}; refreshSketchUI(); });
  onValue(dbackRef, s => {
    dback = s.val();
    if (canDraw()) refreshTools();
    refreshSketchUI();
  });
}

// Show the empty board right away, before anyone joins
applyStyle();
redraw();