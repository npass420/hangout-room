// =====================================================================
// studio.js — the Doodle Gallery room: black and gold marble, the big doodle board, the picture walls,
// walking around, the people in the room, chat, and the main loop. Leaving by the door whooshes you back to the Cave.
// You walk in through grand black and gold doors (sdoor.jpg, a Kindroid picture) that swing open in front of you.
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, remove, push, onValue, onDisconnect,
         query, orderByChild, startAt, endAt, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, ROOM, HEIGHT, EYE, rnd, renderer, scene, camera, canvas, BASE_FOV,
         box, std, easeInOut, envMap, goldMat, RAINBOW, RAINBOW_CSS, colorIndex, makeLabel, PHONE } from '../core.js';
import { sketchViewPose, sketchEnter, sketchLeave, startSketch, updateSketch, SKETCH_NAME, BOARD_SPOT } from './sketch.js';
import { sfx, setupMute } from '../sounds.js';
import { travelHome } from '../portal.js';
import { makeEntrance, doorSpan } from '../entrance.js';

// ---------- Black and gold marble (marble.jpg, a Kindroid image) ----------
// The picture is big enough to use once per surface, so nothing repeats: each wall shows a different part of it,
// the floor gets thin gold seams drawn on so it reads as big polished tiles, and the ceiling is a darker copy.
// Until the picture has loaded, everything is plain black stone.
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
// All polished: their reflections come from a snapshot of this room (below), so they shine with the real neon
const wallMats = [0, 1, 2, 3].map(() => std(0x0b0a0c, 0.32, { envMapIntensity: 0.45 }));
const floorMat = std(0x0b0a0c, 0.25, { envMapIntensity: 0.7 });
const ceilMat = std(0x0b0a0c, 0.38, { envMapIntensity: 0.35 });
function stoneTex(src) {
  const t = new THREE.Texture(src);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  t.needsUpdate = true;
  return t;
}
const marbleImg = new Image();
let marbleDone;
const marbleLoaded = new Promise(r => { marbleDone = r; });
marbleImg.onload = () => {
  // Phones get a smaller copy, so the picture fits in their memory
  let src = marbleImg;
  const maxSize = PHONE ? 1536 : 3072;
  if (marbleImg.width > maxSize) {
    const c = document.createElement('canvas');
    c.width = c.height = maxSize;
    c.getContext('2d').drawImage(marbleImg, 0, 0, maxSize, maxSize);
    src = c;
  }
  // Walls: 9 wide by 4 tall, so each one uses a strip of the picture, a different strip (and some flipped) per wall
  const strips = [[0, false], [0.19, true], [0.37, false], [0.556, true]];
  wallMats.forEach((m, i) => {
    const t = stoneTex(src);
    const [y, flip] = strips[i];
    t.repeat.set(flip ? -1 : 1, HEIGHT / ROOM);
    t.offset.set(flip ? 1 : 0, y);
    m.map = t; m.color.setHex(0xffffff); m.needsUpdate = true;
  });
  // Floor: the whole picture, with thin gold seams every 1.5 meters (6 by 6 tiles)
  const SZ = src.width, fc = document.createElement('canvas');
  fc.width = fc.height = SZ;
  const g = fc.getContext('2d');
  g.drawImage(src, 0, 0, SZ, SZ);
  const step = SZ / 6, lw = Math.max(2, SZ / 900);
  for (let i = 0; i <= 6; i++) {
    const p = Math.round(i * step);
    g.fillStyle = 'rgba(0,0,0,0.55)';          // a dark groove
    g.fillRect(p - lw, 0, lw * 2, SZ); g.fillRect(0, p - lw, SZ, lw * 2);
    g.fillStyle = 'rgba(205,165,70,0.75)';     // with a thin gold line in it
    g.fillRect(p - lw / 2, 0, lw, SZ); g.fillRect(0, p - lw / 2, SZ, lw);
  }
  floorMat.map = stoneTex(fc); floorMat.color.setHex(0xffffff); floorMat.needsUpdate = true;
  // Ceiling: the picture again, turned and darker
  const ct = stoneTex(src);
  ct.rotation = Math.PI / 2; ct.center.set(0.5, 0.5);
  ceilMat.map = ct; ceilMat.color.setHex(0x6a6a6a); ceilMat.needsUpdate = true;
  snapRoom();
  marbleDone();
};
marbleImg.onerror = () => { console.warn('marble.jpg did not load; the room stays plain black'); marbleDone(); };
marbleImg.src = new URL('marble.jpg', import.meta.url).href;   // the picture sits next to this file

// ---------- The room: four walls, the floor and the ceiling ----------
function plane(w, h, mat, x, y, z, rx, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true;
  scene.add(m);
  return m;
}
const H2 = HEIGHT / 2, R2 = ROOM / 2;
// The way in: grand black and gold gallery doors, cut out of their picture (where they sit in it, as parts of its size)
const DOOR_X = 1.6;
const ENTRANCE = { file: new URL('sdoor.jpg', import.meta.url).href, x: DOOR_X, z: R2, height: 2.35, roomHalf: R2, roomHeight: HEIGHT,
  door: { x0: 0.256, x1: 0.740, top: 0.137, bottom: 0.923 }, casing: { side: 0.2, top: 0.127 }, edge: 0x0c0b0b };
plane(ROOM, HEIGHT, wallMats[0], 0, H2, -R2, 0, 0);              // the far wall (the doodle board)
plane(ROOM, HEIGHT, wallMats[1], 0, H2, R2, 0, Math.PI);         // the entry wall (door, window, clock)
plane(ROOM, HEIGHT, wallMats[2], -R2, H2, 0, 0, Math.PI / 2);    // the left wall (pictures)
plane(ROOM, HEIGHT, wallMats[3], R2, H2, 0, 0, -Math.PI / 2);    // the right wall (pictures)
const floor = plane(ROOM, ROOM, floorMat, 0, 0, 0, -Math.PI / 2, 0);
floor.userData.floor = true;
plane(ROOM, ROOM, ceilMat, 0, HEIGHT, 0, Math.PI / 2, 0);
// The marble's reflections: a snapshot of this very room, so the polish on the floor, walls and ceiling shows the
// real ring, neon and window (and nothing that isn't here). It's retaken when the marble loads and when the neon changes color.
const pmrem = new THREE.PMREMGenerator(renderer);
let roomEnv = null, snapTimer = 0;
function snapRoom() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const hide = [floor, marker, ...Object.values(avatars).map(a => a.g)];   // not the floor itself, or people (they'd freeze in it)
    const was = hide.map(o => o.visible);
    hide.forEach(o => { o.visible = false; });
    const env = pmrem.fromScene(scene, 0.02, 0.05, 30);
    hide.forEach((o, i) => { o.visible = was[i]; });
    if (roomEnv) roomEnv.dispose();
    roomEnv = env;
    for (const m of [floorMat, ceilMat, ...wallMats]) { m.envMap = env.texture; m.needsUpdate = true; }
  }, 100);
}
// Gold baseboards along the bottom of every wall (tucking in under the door's surround)
{
  const a = DOOR_X - doorSpan(ENTRANCE) * 0.8, b = DOOR_X + doorSpan(ENTRANCE) * 0.8;
  for (const [x, z, w, d] of [[0, -R2 + 0.01, ROOM, 0.02], [(a - R2) / 2, R2 - 0.01, a + R2, 0.02], [(b + R2) / 2, R2 - 0.01, R2 - b, 0.02],
                              [-R2 + 0.01, 0, 0.02, ROOM], [R2 - 0.01, 0, 0.02, ROOM]]) {
    box(w, 0.09, d, goldMat, x, 0.045, z, scene).castShadow = false;
  }
}

// ---------- A window whose sky follows your own clock (sky colors and stars only, no sun or moon) ----------
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 256; skyCanvas.height = 192;
const skyCtx = skyCanvas.getContext('2d');
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
const STARS = Array.from({ length: 45 }, () => [rnd(), rnd() * 0.8, rnd()]);
const windowLights = [];
{                                                  // light falling in through the window onto the floor in front of it
  const l = new THREE.SpotLight(0x8fa8ff, 0.8, 7, 0.75, 1, 0);
  l.position.set(-1.6, 2.3, ROOM / 2 - 0.1);
  l.target.position.set(-1.6, 0, ROOM / 2 - 3.2);
  scene.add(l, l.target);
  windowLights.push(l);
}

const SKY = {
  night: { top: '#050b1f', bottom: '#0d1d45', light: 0x8fa8ff, power: 0.3 },
  dawn:  { top: '#2b4f8f', bottom: '#ff9e6b', light: 0xffb27a, power: 0.4 },
  day:   { top: '#3d8fe0', bottom: '#a9d8ff', light: 0xfff4e0, power: 0.6 },
  dusk:  { top: '#3a2a6b', bottom: '#ff7a45', light: 0xff9a6a, power: 0.4 }
};
let lastSkyMinute = -1;
function updateSky() {
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute === lastSkyMinute) return;          // only redraw once a minute
  lastSkyMinute = minute;
  const h = minute / 60;
  const phase = (h < 5 || h >= 21) ? 'night' : h < 7 ? 'dawn' : h < 17.5 ? 'day' : 'dusk';
  const s = SKY[phase], g = skyCtx, W = 256, H = 192;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, s.top); grad.addColorStop(1, s.bottom);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  if (phase === 'night') {                        // just stars at night
    g.fillStyle = '#ffffff';
    for (const [x, y, b] of STARS) { g.globalAlpha = 0.35 + b * 0.65; g.fillRect(x * W, y * H, 1 + b * 1.5, 1 + b * 1.5); }
    g.globalAlpha = 1;
  }
  skyTex.needsUpdate = true;
  for (const l of windowLights) { l.color.setHex(s.light); l.intensity = s.power * 2.5; }
}
updateSky();

function makeWindow(x, z, rotY) {
  const g = new THREE.Group();
  const frame = goldMat;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({ map: skyTex }));
  g.add(glass);
  box(1.75, 0.08, 0.06, frame, 0, 0.64, 0, g);
  box(1.75, 0.08, 0.06, frame, 0, -0.64, 0, g);
  box(0.08, 1.36, 0.06, frame, -0.84, 0, 0, g);
  box(0.08, 1.36, 0.06, frame, 0.84, 0, 0, g);
  box(0.05, 1.2, 0.05, frame, 0, 0, 0, g);
  box(1.6, 0.05, 0.05, frame, 0, 0, 0, g);
  box(1.9, 0.06, 0.18, frame, 0, -0.7, 0.06, g); // sill
  g.position.set(x, 1.8, z);
  g.rotation.y = rotY;
  scene.add(g);
}
makeWindow(-1.6, ROOM / 2 - 0.02, Math.PI);      // on the entry wall, left of the door

// ---------- A green dot-matrix wall clock (your local time, with A or P) ----------
const CLK_FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
};
const CLK_COLS = 37, CLK_ROWS = 9, CLK_DOT = 12;
const clockCanvas = document.createElement('canvas');
clockCanvas.width = CLK_COLS * CLK_DOT; clockCanvas.height = CLK_ROWS * CLK_DOT;
const clockCtx = clockCanvas.getContext('2d');
const clockTex = new THREE.CanvasTexture(clockCanvas);
clockTex.colorSpace = THREE.SRGBColorSpace;
let clockShown = '';

function makeWallClock(x, z, rotY) {
  const g = new THREE.Group();
  const w = 0.74, h = w * CLK_ROWS / CLK_COLS;
  box(w + 0.05, h + 0.05, 0.05, goldMat, 0, 0, 0, g);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: clockTex, toneMapped: false }));
  face.position.z = 0.026;
  g.add(face);
  g.position.set(x, 2.65, z);
  g.rotation.y = rotY;
  scene.add(g);
}
makeWallClock(-1.6, ROOM / 2 - 0.03, Math.PI);   // above the window

function updateClock() {
  const d = new Date();
  const h12 = d.getHours() % 12 || 12;
  const text = (h12 + ':' + String(d.getMinutes()).padStart(2, '0') + (d.getHours() < 12 ? 'A' : 'P')).padStart(6, ' ');
  if (text === clockShown) return;               // only redraw when the minute changes
  clockShown = text;
  const lit = new Set();
  [...text].forEach((ch, i) => {
    const glyph = CLK_FONT[ch] || CLK_FONT[' '];
    glyph.forEach((row, r) => [...row].forEach((bit, c) => {
      if (bit === '1') lit.add((r + 1) * CLK_COLS + (1 + i * 6 + c));
    }));
  });
  const g = clockCtx;
  g.fillStyle = '#0c0b0a'; g.fillRect(0, 0, clockCanvas.width, clockCanvas.height);
  for (let r = 0; r < CLK_ROWS; r++) for (let c = 0; c < CLK_COLS; c++) {
    const on = lit.has(r * CLK_COLS + c);
    g.fillStyle = on ? '#3dff6a' : '#2b332d';     // green lit dots, dim unlit dots
    g.beginPath(); g.arc(c * CLK_DOT + CLK_DOT / 2, r * CLK_DOT + CLK_DOT / 2, CLK_DOT * 0.42, 0, Math.PI * 2); g.fill();
  }
  clockTex.needsUpdate = true;
}

// ---------- The way in: the front of the building outside, and its doors (click them twice to leave) ----------
// You come in through them: the room fades in with you a few steps outside, the doors swing open, you walk in and they
// shut behind you. Outside, everything but the picture is dark, so the room only shows through the doorway.
const entrance = makeEntrance(ENTRANCE);


// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xffe2b8, 0x2a2018, 1.0));   // soft, even light everywhere

// ---------- Neon: a ring floating under the middle of the ceiling, and a tube all the way around the top corners of the room ----------
const NEON_COLORS = [['Warm white', 0xffe8c4], ['Yellow', 0xffd23a], ['Orange', 0xff9a2e], ['Pink', 0xff5fa8],
                     ['Purple', 0xb05cff], ['Blue', 0x3d8bff], ['Green', 0x3dff8a], ['Red', 0xff3b3b]];
const neonMats = [];   // { mat, core } for every neon layer in the room
// A neon tube is a thin bright core with layers of colored glow around it. The layers are kept faint so they add up
// to the color itself instead of washing out to white.
const GLOW = [[1, 1.0, true], [2.2, 0.42, false], [4.5, 0.16, false], [9, 0.06, false]];   // [size, opacity, is the core]
function neonMat(opacity, core, map) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: map || null, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  neonMats.push({ mat, core });
  return mat;
}
// The ring: floats on its own (no cables), with a lid over the tube like a real ring light, so it shines down and out
const RING_R = 1.3, RING_Y = HEIGHT - 0.7;
const ring = new THREE.Group();
scene.add(ring);
const LID_W = 0.075;                                   // how far the lid reaches past the tube on each side
const lidMat = std(0x0d0c0b, 0.35, { envMap, envMapIntensity: 0.25, side: THREE.DoubleSide });
const lid = new THREE.Mesh(new THREE.RingGeometry(RING_R - LID_W, RING_R + LID_W, 180), lidMat);   // the flat top
lid.rotation.x = -Math.PI / 2; lid.position.y = RING_Y + 0.05;
ring.add(lid);
const rimMat = std(0xc9a227, 0.3, { metalness: 0.9, envMap, envMapIntensity: 0.8, side: THREE.DoubleSide });   // gold, seen from both sides
for (const r of [RING_R - LID_W, RING_R + LID_W]) {   // a gold rim down the inside and outside edges
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.07, 180, 1, true), rimMat);
  rim.position.y = RING_Y + 0.015;
  ring.add(rim);
}
for (const [k, op, core] of GLOW) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.011 * k, 12, 180), neonMat(op, core));
  m.rotation.x = Math.PI / 2; m.position.y = RING_Y;
  ring.add(m);
}
// The corner tube: runs around the room right where the walls meet the ceiling, with its glow washing
// onto the ceiling and down the wall, like real cove lighting
function fadeTex(brightAtTop) {   // white fading to black, for the glow wash (black adds nothing when glowing)
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 256);
  const stops = [[0, 1], [0.25, 0.45], [0.55, 0.14], [1, 0]];
  for (const [at, v] of stops) grd.addColorStop(brightAtTop ? at : 1 - at, `rgb(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)})`);
  g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const COVE_Y = HEIGHT - 0.06, IN = 0.06;   // how high the tube runs, and how far out from the wall
const SIDE = ROOM - IN * 2;                // each run of tube, so the four meet at the corners
const washDown = fadeTex(true), washOut = fadeTex(false);
const ceilWashMat = neonMat(0.55, false, washOut), wallWashMat = neonMat(0.5, false, washDown);
const tubeMats = GLOW.map(([, op, core]) => neonMat(op, core));
for (const turn of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {   // the far wall, then turned around to the other three
  const side = new THREE.Group();
  side.rotation.y = turn;
  scene.add(side);
  GLOW.forEach(([k], i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.009 * k, 0.009 * k, SIDE, 10), tubeMats[i]);
    m.rotation.z = Math.PI / 2;   // lying along the wall
    m.position.set(0, COVE_Y, -R2 + IN);
    side.add(m);
  });
  const ceilWash = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, 0.8), ceilWashMat);   // glow on the ceiling, brightest at the wall
  ceilWash.rotation.x = Math.PI / 2;
  ceilWash.position.set(0, HEIGHT - 0.004, -R2 + 0.4);
  side.add(ceilWash);
  const wallWash = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, 0.6), wallWashMat);   // and down the top of the wall
  wallWash.position.set(0, HEIGHT - 0.3, -R2 + 0.004);
  side.add(wallWash);
}
let neonIndex = -1;
function setNeon(i) {
  i = Number.isInteger(i) && i >= 0 && i < NEON_COLORS.length ? i : 0;
  if (i === neonIndex) return;
  neonIndex = i;
  const col = new THREE.Color(NEON_COLORS[i][1]);
  const hot = col.clone().lerp(new THREE.Color(0xffffff), 0.3);    // the core is a little white-hot, but clearly the color
  for (const n of neonMats) n.mat.color.copy(n.core ? hot : col);
  switchGlow.color.copy(col);
  snapRoom();   // the marble's reflections change color too
}

// The light switch on the wall beside the entry door: click it to change the neon color for everyone
const switchGroup = new THREE.Group();
const switchGlow = new THREE.MeshBasicMaterial({ color: 0xffe8c4, toneMapped: false });
(function lightSwitch() {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.015), goldMat);
  const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.05, 0.02), switchGlow);
  toggle.position.z = 0.015;
  switchGroup.add(plate, toggle);
  switchGroup.position.set(DOOR_X + doorSpan(ENTRANCE) + 0.25, 1.25, R2 - 0.015);   // just past the door's surround
  switchGroup.rotation.y = Math.PI;
  switchGroup.traverse(o => { if (o.isMesh) o.userData.lightSwitch = true; });
  scene.add(switchGroup);
})();
setNeon(0);
onValue(ref(db, 'room/decor/neon'), s => setNeon(s.val()));
const neonLoaded = get(ref(db, 'room/decor/neon'));
function nextNeon() {
  if (!S.myName) return;
  const i = (Math.max(0, neonIndex) + 1) % NEON_COLORS.length;
  set(ref(db, 'room/decor/neon'), i).catch(e => console.warn('Light switch', e));
  setNeon(i);
  showBanner(`💡 ${NEON_COLORS[i][0]}`, 1.5);
  sfx.ping();
}

// ---------- Other people: a standing snowman with a name tag, gliding to wherever they walk ----------
const WALK = 2.2;     // walking speed, meters a second
const avatars = {};   // id -> { g, name, c }
const footShadow = (() => {   // a soft dark spot on the floor under each snowman
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.6)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.3)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
})();
function makeAvatar(name, c) {
  const g = new THREE.Group();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), footShadow);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.003;
  g.add(shadow);
  const mat = std(new THREE.Color(RAINBOW[c]), 0.75);
  for (const [r, y] of [[0.28, 0.28], [0.21, 0.74], [0.15, 1.1]]) {   // three stacked snowballs: big bottom, middle, small head
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat);
    b.position.y = y;
    b.castShadow = true;
    g.add(b);
  }
  const label = makeLabel(name, RAINBOW_CSS[c]);
  label.position.y = 1.47;
  g.add(label);
  g.traverse(o => { o.userData.avatar = true; });
  scene.add(g);
  return { g, name, c };
}
function spotOf(p) {   // where someone is standing (kept inside the room)
  const lim = R2 - 0.5;
  const x = Number.isFinite(p.x) ? p.x : 0, z = Number.isFinite(p.z) ? p.z : R2 - 1.3;
  return { x: Math.max(-lim, Math.min(lim, x)), z: Math.max(-lim, Math.min(lim, z)) };
}
function refreshAvatars() {
  for (const id of Object.keys(avatars)) {
    const p = S.presence[id];
    if (!p || id === myId || p.name !== avatars[id].name || colorIndex(p) !== avatars[id].c) {
      scene.remove(avatars[id].g);
      delete avatars[id];
    }
  }
  for (const [id, p] of Object.entries(S.presence)) {
    if (id === myId) continue;
    const fresh = !avatars[id];
    if (fresh) avatars[id] = makeAvatar(p.name, colorIndex(p));
    const a = avatars[id], to = spotOf(p);
    a.tx = to.x; a.tz = to.z;
    if (fresh) a.g.position.set(to.x, 0, to.z);   // someone new just appears where they are
  }
}
function moveAvatars(dt) {   // everyone else glides toward where they're walking
  for (const a of Object.values(avatars)) {
    const p = a.g.position, dx = a.tx - p.x, dz = a.tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.001) continue;
    const step = Math.min(d, WALK * dt);
    p.x += dx / d * step; p.z += dz / d * step;
  }
}

// ---------- Who's here list ----------
const whoList = document.getElementById('whoList');
const connEl = document.getElementById('conn');
const whoBtn = document.getElementById('whoBtn');
function refreshWho() {
  whoList.textContent = '';
  const people = Object.entries(S.presence);
  document.querySelector('#who h2').textContent = `In the gallery (${people.length})`;
  whoBtn.textContent = `👥 ${people.length}`;
  for (const [id, p] of people) {
    const div = document.createElement('div');
    const dot = document.createElement('span');
    dot.textContent = '● ';
    dot.style.color = RAINBOW_CSS[colorIndex(p)];
    div.appendChild(dot);
    div.appendChild(document.createTextNode(`${p.name}${id === myId ? ' (you)' : ''}${p.b ? ' · 🖍 at the board' : ''}`));
    whoList.appendChild(div);
  }
}
hooks.refreshWho = refreshWho;

function refreshAll() {
  refreshAvatars();
  refreshWho();
}
hooks.refreshAll = refreshAll;

// ---------- Chat ----------
const msgs = document.getElementById('msgs');
const chatInput = document.getElementById('chatInput');
const newDot = document.getElementById('newDot');

// Two tabs on the chat box: 💬 Chat is only what people type, 🔔 Room is joins, leaves and gallery news
const tabStyle = document.createElement('style');
tabStyle.textContent = `#chatTabs { display: flex; gap: 6px; margin-bottom: 6px; }
  #chatTabs button { position: relative; margin: 0; font-size: 13px; padding: 4px 12px; background: rgba(233,201,143,0.25); color: #f3e6cf; }
  #chatTabs button.on { background: #e9c98f; color: #2a1c10; }
  #roomDot { display: none; position: absolute; top: 1px; right: 1px; width: 8px; height: 8px; border-radius: 50%; background: #ff3b2f; }
  #roomLog { display: none; height: 150px; overflow-y: auto; font-size: 14px; margin-bottom: 8px; word-wrap: break-word; }
  #roomLog .sys { font-style: italic; opacity: 0.75; font-size: 13px; }
  body.roomTab #msgs { display: none; }
  body.roomTab #roomLog { display: block; }
  @media (max-width: 700px) { #roomLog { height: 110px; } }`;
document.head.appendChild(tabStyle);
const chatTabs = document.createElement('div');
chatTabs.id = 'chatTabs';
const chatTabBtn = document.createElement('button');
chatTabBtn.textContent = '💬 Chat';
const roomTabBtn = document.createElement('button');
roomTabBtn.textContent = '🔔 Room';
const roomDot = document.createElement('span');
roomDot.id = 'roomDot';
roomTabBtn.appendChild(roomDot);
chatTabs.append(chatTabBtn, roomTabBtn);
const roomLog = document.createElement('div');
roomLog.id = 'roomLog';
msgs.parentNode.insertBefore(chatTabs, msgs);
msgs.parentNode.insertBefore(roomLog, msgs.nextSibling);
function showTab(room) {
  document.body.classList.toggle('roomTab', room);
  chatTabBtn.classList.toggle('on', !room);
  roomTabBtn.classList.toggle('on', room);
  if (room) { roomDot.style.display = 'none'; roomLog.scrollTop = roomLog.scrollHeight; }
  else msgs.scrollTop = msgs.scrollHeight;
}
chatTabBtn.addEventListener('click', () => showTab(false));
roomTabBtn.addEventListener('click', () => showTab(true));
showTab(false);
function addMsg(name, text, mine, c) {
  const div = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = (mine ? 'You' : name) + ': ';
  if (Number.isInteger(c) && c >= 0 && c < 7) b.style.color = RAINBOW_CSS[c];   // name in their rainbow color
  div.appendChild(b);
  div.appendChild(document.createTextNode(text));
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  if (!mine) {
    sfx.ping();
    if (!document.body.classList.contains('chatOpen')) newDot.style.display = 'block';
  }
}
function addSys(text, c) {   // grey line in the Room tab, like "Sam joined the room"
  const div = document.createElement('div');
  div.className = 'sys';
  const dot = document.createElement('span');
  dot.textContent = '● ';
  if (Number.isInteger(c) && c >= 0 && c < 7) dot.style.color = RAINBOW_CSS[c];
  div.appendChild(dot);
  div.appendChild(document.createTextNode(text));
  roomLog.appendChild(div);
  while (roomLog.children.length > 100) roomLog.removeChild(roomLog.firstChild);   // keep only the latest 100
  roomLog.scrollTop = roomLog.scrollHeight;
  if (!document.body.classList.contains('roomTab')) roomDot.style.display = 'block';
}
hooks.addSys = addSys;

// ---------- Big on-screen messages, like "Saved to the Doodle Gallery!" ----------
const banner = document.getElementById('banner');
let bannerTimer = 0;
function showBanner(text, secs = 3) {
  banner.textContent = text;
  banner.classList.remove('show');
  void banner.offsetWidth;   // restart the pop-in animation
  banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove('show'), secs * 1000);
}
hooks.banner = showBanner;
function logJoinsLeaves(before, after) {
  for (const [id, p] of Object.entries(after)) {
    if (id !== myId && !before[id]) { addSys(`${p.name} joined the room`, colorIndex(p)); sfx.join(); }
  }
  for (const [id, p] of Object.entries(before)) {
    if (id !== myId && !after[id]) { addSys(`${p.name} left the room`, colorIndex(p)); sfx.leave(); }
  }
}
function sendChat() {
  const text = chatInput.value.trim();
  if (!text || !S.myName) return;
  push(ref(db, 'room/chat'), { name: S.myName, text: text.slice(0, 200), t: Date.now(), id: myId, c: S.myHue });
  chatInput.value = '';
  showTab(false);   // back to the chat to see your message
}
document.getElementById('send').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

// Phone buttons: open and close chat and the room list
document.getElementById('chatBtn').addEventListener('click', () => {
  document.body.classList.toggle('chatOpen');
  document.body.classList.remove('whoOpen');
  newDot.style.display = 'none';
  msgs.scrollTop = msgs.scrollHeight;
});
whoBtn.addEventListener('click', () => {
  document.body.classList.toggle('whoOpen');
  document.body.classList.remove('chatOpen');
});
setupMute(document.getElementById('mute'));

// ---------- Leaving the room: the 🚪 button or the door (clicked twice), then the portal whoosh back to the Cave ----------
const leaveBtn = document.getElementById('leaveRoom');
let leaveArmed = 0;
function leaveRoom() {
  if (!S.myName) return;
  if (Date.now() - leaveArmed > 3000) {   // first click: ask to be sure
    leaveArmed = Date.now();
    leaveBtn.textContent = 'Sure? Click again';
    showBanner('🚪 Click again to leave the room', 3);
    setTimeout(() => { if (Date.now() - leaveArmed >= 3000) leaveBtn.textContent = '🚪 Leave'; }, 3100);
    return;
  }
  goHome();
}
function goHome() {   // the whoosh back to the Cave; leaving drops the pen if you have it
  if (!S.myName) return;
  travelHome(() => { sketchLeave(); return remove(ref(db, 'room/presence/' + myId)); });
}
leaveBtn.addEventListener('click', leaveRoom);

// ---------- Entering the room ----------
const nameBox = document.getElementById('nameBox');
const nameInput = document.getElementById('nameInput');
try { nameInput.value = localStorage.getItem('hangoutName') || ''; } catch (e) {}

function enterRoom() {
  const name = nameInput.value.trim().slice(0, 20);
  if (!name) { nameInput.focus(); return; }
  S.myName = name;
  try { localStorage.setItem('hangoutName', name); } catch (e) {}
  nameBox.style.display = 'none';

  // Say we're here, and have the room remove us automatically if we close the tab or lose connection
  const meRef = ref(db, 'room/presence/' + myId);
  onValue(ref(db, '.info/connected'), s => {
    if (s.val() === true) {
      onDisconnect(meRef).remove();
      get(ref(db, 'room/presence')).then(ps => {
        if (S.myHue < 0) {
          const used = new Set(Object.entries(ps.val() || {}).filter(([id]) => id !== myId).map(([, p]) => colorIndex(p)));
          let hue = 0;
          while (hue < 7 && used.has(hue)) hue++;
          if (hue >= 7) hue = Object.keys(ps.val() || {}).length % 7;   // more than 7 people: colors repeat
          S.myHue = hue;
        }
        set(meRef, { name: S.myName, c: S.myHue, t: Date.now(), ...mySpot() });
      });
      connEl.textContent = 'Online';
    } else {
      connEl.textContent = 'Reconnecting…';
    }
  });
  let firstPresence = true;
  onValue(ref(db, 'room/presence'), s => {
    const next = s.val() || {};
    if (!firstPresence) logJoinsLeaves(S.presence, next);   // the first list is just who's already here
    firstPresence = false;
    S.presence = next;
    refreshAll();
  });

  startSketch();    // LittleSketch, the big doodle board

  // Chat: show messages from about now on, and tidy away anything older than an hour
  const joinTime = Date.now() - 60000;
  onChildAdded(query(ref(db, 'room/chat'), orderByChild('t'), startAt(joinTime)), s => {
    const m = s.val();
    if (m && m.name && m.text) addMsg(m.name, m.text, m.id === myId, m.c);
  });
  get(query(ref(db, 'room/chat'), orderByChild('t'), endAt(Date.now() - 3600000))).then(s => {
    s.forEach(ch => { remove(ch.ref); });
  });
}
document.getElementById('enter').addEventListener('click', enterRoom);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') enterRoom(); });

// ---------- Walking around: drag to look, click the floor to walk there (or W A S D / arrow keys) ----------
const hint = document.getElementById('hint');
const HINT_WALK = PHONE ? 'Drag to look · tap the floor to walk · tap the board to doodle · tap a picture to see it'
                        : 'Drag to look · click the floor to walk (or W A S D) · click the board to doodle · click a picture to see it';
hint.textContent = HINT_WALK;
const LIMIT = R2 - 0.5;                       // how close to the walls you can walk
const me = { x: 1.6 + (Math.random() - 0.5) * 1.2, z: R2 - 1.4, tx: null, tz: null };   // you start just inside the door
let yaw = 0, pitch = -0.05;                   // facing the doodle board
let anim = null;                              // a camera move in progress (walking up to the board and back)
const boardSaved = { x: 0, z: 0, yaw: 0, pitch: 0 };
const boardSpot = { x: 0, z: 0 };            // where your snowman stands while you're at the board
function clampSpot(x, z) { return [Math.max(-LIMIT, Math.min(LIMIT, x)), Math.max(-LIMIT, Math.min(LIMIT, z))]; }
function mySpot() {   // what everyone else sees: where you're standing (or walking to), and whether you're at the board
  if (S.atSketch) return { x: +boardSpot.x.toFixed(2), z: +boardSpot.z.toFixed(2), b: true };
  const x = me.tx != null ? me.tx : me.x, z = me.tz != null ? me.tz : me.z;
  return { x: +x.toFixed(2), z: +z.toFixed(2), b: null };
}
let sentAt = 0, sendTimer = 0;
function sendSpot(now) {   // tell everyone where you're going (a few times a second at most)
  if (!S.myName) return;
  clearTimeout(sendTimer); sendTimer = 0;
  if (!now && performance.now() - sentAt < 250) { sendTimer = setTimeout(() => sendSpot(true), 250); return; }
  sentAt = performance.now();
  update(ref(db, 'room/presence/' + myId), mySpot()).catch(() => {});
}
function walkTo(x, z) {
  [me.tx, me.tz] = clampSpot(x, z);
  marker.position.set(me.tx, 0.012, me.tz);
  marker.visible = true; markerFade = 1;
  sendSpot(true);
}
function setFov(f) {
  camera.fov = Math.max(20, Math.min(BASE_FOV, f));
  camera.updateProjectionMatrix();
}
function lookQuat(pos, target) {
  const m = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
function viewQuat(y, p) { return new THREE.Quaternion().setFromEuler(new THREE.Euler(p, y, 0, 'YXZ')); }
function moveCamera(toPos, toQuat, done) {
  anim = { fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(), toPos, toQuat, t: 0, dur: 0.9, done };
}
camera.position.set(me.x, EYE, me.z);
camera.rotation.set(pitch, yaw, 0);

// A soft gold ring on the floor showing where you'll walk
const marker = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.22, 40),
  new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
scene.add(marker);
let markerFade = 0;

// ---------- Walking up to the doodle board, and stepping back ----------
function enterSketch() {
  if (anim || S.atSketch || !S.myName) return;
  boardSaved.x = me.x; boardSaved.z = me.z; boardSaved.yaw = yaw; boardSaved.pitch = pitch;
  me.tx = me.tz = null;
  const others = Object.entries(S.presence).filter(([id, p]) => id !== myId && p.b).length;
  const side = others % 2 ? 1 : -1, row = Math.floor(others / 2);   // off to the sides of the board, so nobody blocks the view
  boardSpot.x = BOARD_SPOT.x + side * Math.min(LIMIT, BOARD_SPOT.side + row * 0.7);
  boardSpot.z = BOARD_SPOT.z;
  S.atSketch = true;
  setFov(BASE_FOV);
  const v = sketchViewPose(camera.aspect);
  moveCamera(v.pos, lookQuat(v.pos, v.target), null);
  document.body.classList.add('atSketch');
  hint.textContent = `${SKETCH_NAME} · Esc or Back to step away`;
  sketchEnter();
  sendSpot(true);
}
function leaveSketch() {
  if (!S.atSketch || anim) return;
  S.atSketch = false;
  document.body.classList.remove('atSketch');
  sketchLeave();
  me.x = boardSaved.x; me.z = boardSaved.z; yaw = boardSaved.yaw; pitch = boardSaved.pitch;
  moveCamera(new THREE.Vector3(me.x, EYE, me.z), viewQuat(yaw, pitch), null);
  hint.textContent = HINT_WALK;
  sendSpot(true);
}
hooks.sketchBack = leaveSketch;

// ---------- Keys ----------
const keys = new Set();
function typing() { const a = document.activeElement; return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')); }
window.addEventListener('keydown', e => {
  if (typing() || !S.myName) return;
  if (e.key === 'Escape') { if (S.atSketch) leaveSketch(); return; }
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    keys.add(k);
    if (k.startsWith('arrow')) e.preventDefault();   // don't scroll the page
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
function keyWalk(dt) {   // W/S or up/down walk, A/D step sideways, left/right turn
  if (!keys.size || S.atSketch || anim || S.galleryOpen || typing()) return;
  if (keys.has('arrowleft')) yaw += 1.8 * dt;
  if (keys.has('arrowright')) yaw -= 1.8 * dt;
  const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const sdir = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  if (!f && !sdir) return;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // the way you're facing, flat on the floor
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // to your right
  let mx = fx * f + rx * sdir, mz = fz * f + rz * sdir;
  const len = Math.hypot(mx, mz);
  mx /= len; mz /= len;
  me.tx = me.tz = null; marker.visible = false;
  [me.x, me.z] = clampSpot(me.x + mx * WALK * dt, me.z + mz * WALK * dt);
  sendSpot(false);
}

// Scroll to zoom
canvas.addEventListener('wheel', e => {
  if (S.atSketch) return;
  e.preventDefault();
  setFov(camera.fov + e.deltaY * 0.03);
}, { passive: false });

// ---------- Mouse / touch ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let down = null;
let lastX = 0, lastY = 0;
function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
function pickUnder(e) {   // the first real thing under the pointer (not the neon glow, the marker or other people)
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(scene.children, true).find(h => shown(h.object) && !h.object.userData.avatar
    && h.object !== marker && !(h.object.material && h.object.material.blending === THREE.AdditiveBlending));
  if (!hit) return null;
  const u = hit.object.userData;
  if (u.sketch) return { sketch: true };
  if (u.door) return { door: true };
  if (u.lightSwitch) return { lightSwitch: true };
  if (u.gallery) return { gallery: true };   // the gallery opens its own viewer
  if (u.floor) return { floor: hit.point };
  return null;
}
// Two-finger pinch zooms (phones)
const touchPts = new Map();
let pinchDist = 0;
function pinchSpread() { const [a, b] = [...touchPts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
canvas.addEventListener('pointerdown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPts.size === 2) { pinchDist = pinchSpread(); down = null; return; }   // a pinch, not a tap
  down = { x: e.clientX, y: e.clientY };
  lastX = e.clientX; lastY = e.clientY;
});
function endTouch(e) { touchPts.delete(e.pointerId); if (touchPts.size < 2) pinchDist = 0; }
window.addEventListener('pointercancel', e => { down = null; endTouch(e); });
window.addEventListener('pointermove', e => {
  if (touchPts.has(e.pointerId)) touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPts.size === 2 && pinchDist > 0) {
    const d = pinchSpread();
    if (!S.atSketch && d > 0) setFov(camera.fov * pinchDist / d);
    pinchDist = d;
    return;
  }
  if (down && !intro && !S.atSketch && !anim) {   // drag to look around: the view follows the mouse (drag right to turn right, up to look up)
    const k = 0.004 * (camera.fov / BASE_FOV);   // slower when zoomed in
    yaw -= (e.clientX - lastX) * k;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - lastY) * k));
  }
  lastX = e.clientX; lastY = e.clientY;
  if (!down && e.target === canvas && !PHONE) {   // show where a click would take you
    const p = S.atSketch || anim ? null : pickUnder(e);
    canvas.style.cursor = p && (p.sketch || p.door || p.lightSwitch || p.gallery || p.floor) ? 'pointer' : 'grab';
  }
});
window.addEventListener('pointerup', e => {
  const wasTap = down && e.target === canvas && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
  down = null;
  endTouch(e);
  if (!wasTap || intro || !S.myName || S.atSketch || anim || S.galleryOpen) return;
  const p = pickUnder(e);
  if (!p) return;
  if (p.sketch) enterSketch();
  else if (p.lightSwitch) nextNeon();
  else if (p.door) leaveRoom();
  else if (p.floor) walkTo(p.floor.x, p.floor.z);
});

// ---------- Window resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (intro) playIntro(dt);   // walking in through the door
  else if (anim) {
    anim.t += dt;
    const e = easeInOut(Math.min(anim.t / anim.dur, 1));
    camera.position.lerpVectors(anim.fromPos, anim.toPos, e);
    camera.quaternion.slerpQuaternions(anim.fromQuat, anim.toQuat, e);
    if (anim.t >= anim.dur) { const done = anim.done; anim = null; if (done) done(); }
  } else if (!S.atSketch) {
    keyWalk(dt);
    if (me.tx != null) {   // walking to where you clicked
      const dx = me.tx - me.x, dz = me.tz - me.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, WALK * dt);
      if (d > 0.001) { me.x += dx / d * step; me.z += dz / d * step; }
      if (d - step < 0.001) { me.x = me.tx; me.z = me.tz; me.tx = me.tz = null; }
    }
    camera.position.set(me.x, EYE, me.z);
    camera.rotation.set(pitch, yaw, 0);
  }
  if (marker.visible && me.tx == null) {   // the ring fades once you get there
    markerFade -= dt * 2.5;
    marker.material.opacity = Math.max(0, markerFade) * 0.8;
    if (markerFade <= 0) marker.visible = false;
  } else if (marker.visible) marker.material.opacity = 0.8;
  moveAvatars(dt);
  updateSketch(dt);
  updateClock();
  updateSky();
  renderer.render(scene, camera);
});

// ---------- Coming in: the room gets ready behind the Cave (which is black by now), then you walk in through the door ----------
// The pictures and the first data load, the reflections are taken and everything is drawn once, all while the screen
// is black, so any stutter happens where nobody can see it. Then the Cave fades away and the walk in begins.
const wait = ms => new Promise(r => setTimeout(r, ms));
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : window.requestAnimationFrame(f)); window.requestAnimationFrame(f); });
let intro = { t: -1 };                                // -1 until the Cave says go
const OUTSIDE = new THREE.Vector3(DOOR_X, EYE, R2 + 2.6);   // a few steps back, looking at the front of the building
function easeIO(k) { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); }
function playIntro(dt) {                              // the camera and the doors, moment by moment
  if (intro.t >= 0) intro.t += dt;
  const t = Math.max(0, intro.t);
  entrance.setOpen(easeIO((t - 0.8) / 0.9) - easeIO((t - 3.4) / 0.8));   // the doors swing open, then shut behind you
  if (intro.t >= 0.7 && !intro.whoosh) { intro.whoosh = true; sfx.whooshSoft(); }   // a soft whoosh as they open
  const k = easeIO((t - 1.2) / 2.3);                  // the walk: through the doorway, then over to your spot
  const z = OUTSIDE.z + (me.z - OUTSIDE.z) * k;
  const past = Math.max(0, Math.min(1, (R2 - 0.2 - z) / (R2 - 0.2 - me.z)));   // only drift sideways once you're inside
  camera.position.set(DOOR_X + (me.x - DOOR_X) * past, EYE, z);
  camera.rotation.set(-0.02 + (pitch + 0.02) * k, 0, 0);
  if (t > 4.3) { entrance.setOpen(0); intro = null; camera.position.set(me.x, EYE, me.z); camera.rotation.set(pitch, yaw, 0); }
}
window.addEventListener('room-show', () => { if (intro) intro.t = 0; });
camera.position.copy(OUTSIDE); camera.rotation.set(-0.02, 0, 0);
(async () => {
  await Promise.race([Promise.all([marbleLoaded, neonLoaded, entrance.loaded, get(ref(db, 'room/sketch/doodles')), get(ref(db, 'room/sketch/gallery'))]), wait(8000)]);   // a slow connection doesn't keep you out forever
  await wait(300);                                    // the reflection snapshot is taken just after the pictures land
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  await frames(3);
  window.dispatchEvent(new Event('room-ready'));
})();