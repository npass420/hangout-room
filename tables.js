// =====================================================================
// tables.js — the Table Room: dark polished wood, three tables (Checkers, Chess, Othello), a neon ring light,
// a window and a big red dot-matrix clock. Sit in a chair to play that side; everyone else can walk up and watch.
// The games live in boardgames.js. Chat is shared with the other rooms.
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, remove, push, onValue, onDisconnect,
         query, orderByChild, startAt, endAt, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, ROOM, HEIGHT, EYE, rnd, renderer, scene, camera, canvas, BASE_FOV,
         box, std, easeInOut, envMap, goldMat, RAINBOW, RAINBOW_CSS, colorIndex, makeLabel, PHONE } from './core.js';
import { sfx, setupMute } from './sounds.js';
import { TABLE_Y, startGames, updateGames, refreshGames, setRoomEnv, addShiny, showPanel, sit, stand, seatTaken, seatHolder,
         tap, canTap, pickables, squareAt } from './boardgames.js';

document.querySelector('#ui h1').textContent = 'Table Room';
document.title = 'Table Room';

// ---------- Dark wood (Wood.jpg from Kindroid if it's in the folder, otherwise wood grain drawn here) ----------
// The floor is long planks, the walls are upright boards, the ceiling is a darker copy. Everything polished
// takes its reflections from a snapshot of this room (below), so the shine shows the real ring light and window.
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
const TEX = PHONE ? 1024 : 2048;
const floorMat = std(0xffffff, 0.24, { envMapIntensity: 0.8 });
const wallMat = std(0xffffff, 0.42, { envMapIntensity: 0.3 });
const ceilMat = std(0x8a8a8a, 0.6, { envMapIntensity: 0.15 });
const tableMat = addShiny(std(0xffffff, 0.16, { envMapIntensity: 1 }));    // the table tops and the board frames
const trimMat = std(0x2a170c, 0.35, { envMapIntensity: 0.4 });            // rails, baseboards and chairs
const velvet = std(0x5a1018, 0.85);                                        // the chair cushions
function drawGrain(g, S, r) {   // dark wood grain, made from scratch
  g.fillStyle = '#3d2615'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < S * 0.5; i++) {
    const y = r() * S, amp = 2 + r() * 10, f = (0.002 + r() * 0.006) * (2048 / S), ph = r() * 7, dark = r() < 0.55;
    g.strokeStyle = dark ? `rgba(10,5,2,${0.06 + r() * 0.16})` : `rgba(120,70,35,${0.04 + r() * 0.1})`;
    g.lineWidth = (0.6 + r() * 2.4) * S / 2048;
    g.beginPath();
    for (let x = -10; x <= S + 10; x += 12) { const yy = y + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.25; x < 0 ? g.moveTo(x, yy) : g.lineTo(x, yy); }
    g.stroke();
  }
  for (let i = 0; i < 6; i++) {   // a few knots
    const x = r() * S, y = r() * S, w = (8 + r() * 14) * S / 2048;
    for (let k = 5; k > 0; k--) { g.strokeStyle = `rgba(15,7,3,${0.12 + k * 0.04})`; g.lineWidth = 1.5 * S / 2048; g.beginPath(); g.ellipse(x, y, w * k * 0.7, w * k * 0.25, 0, 0, Math.PI * 2); g.stroke(); }
  }
}
// Wood.jpg is one solid slab with its grain running up and down. Each board gets its own strip of it, turned to lie
// along the board, so no two boards look alike. The corner with the Kindroid mark is left out.
function slabStrip(g, img, r, x, y, w, h) {   // fill a w by h board (grain running along w) with a random strip of the slab
  const sw = img.width * 0.93, sh = img.height * 0.94, stripW = sw * 0.16;
  g.save(); g.translate(x, y + h); g.rotate(-Math.PI / 2);
  g.drawImage(img, r() * (sw * 0.48 - stripW), 0, stripW, sh, 0, 0, h, w);   // from the left side of the slab, where there are no knots
  g.restore();
}
function woodTex(kind, img) {
  const c = document.createElement('canvas'); c.width = c.height = TEX;
  const g = c.getContext('2d'), r = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(kind === 'floor' ? 11 : kind === 'wall' ? 23 : 37);
  if (kind === 'wall') { g.translate(TEX, 0); g.rotate(Math.PI / 2); }   // the walls' boards stand upright
  const rows = kind === 'slab' ? 1 : 8, h = TEX / rows;
  if (img) for (let i = 0; i < rows; i++) slabStrip(g, img, r, 0, i * h, TEX, h);
  else drawGrain(g, TEX, r);
  if (kind === 'slab') {   // a table top: one solid piece, no seams
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
    return t;
  }
  for (let i = 0; i <= rows; i++) {   // the seams between boards
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, i * h - 2, TEX, 4);
    g.fillStyle = 'rgba(255,200,150,0.06)'; g.fillRect(0, i * h + 2, TEX, 2);
    if (kind === 'floor' && i < rows) {   // plank ends, staggered
      for (let x = r() * TEX * 0.5; x < TEX; x += TEX * (0.45 + r() * 0.3)) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, i * h, 3, h); }
    }
    if (i < rows) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '90,50,20'},${r() * 0.18})`; g.fillRect(0, i * h, TEX, h); }   // boards a shade apart
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAX_ANISO;
  return t;
}
function dressWood(img) {
  const f = woodTex('floor', img), w = woodTex('wall', img);
  f.repeat.set(4, 4);
  w.repeat.set(5, HEIGHT / ROOM * 5);
  const c = w.clone(); c.repeat.set(4, 4); c.needsUpdate = true;
  floorMat.map = f; wallMat.map = w; ceilMat.map = c; tableMat.map = woodTex('slab', img);
  if (img) {   // the photo is brighter than the drawn grain, so tone it down to a deep walnut
    floorMat.color.setHex(0xa89488); wallMat.color.setHex(0x8a7a70); ceilMat.color.setHex(0x4a4440); tableMat.color.setHex(0xb2a294);
  }
  for (const m of [floorMat, wallMat, ceilMat, tableMat]) m.needsUpdate = true;
  snapRoom();
}

// ---------- The room: four walls, the floor and the ceiling ----------
function plane(w, h, mat, x, y, z, rx, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true;
  scene.add(m);
  return m;
}
const H2 = HEIGHT / 2, R2 = ROOM / 2;
plane(ROOM, HEIGHT, wallMat, 0, H2, -R2, 0, 0);              // the far wall
plane(ROOM, HEIGHT, wallMat, 0, H2, R2, 0, Math.PI);         // the entry wall (door, window, clock)
plane(ROOM, HEIGHT, wallMat, -R2, H2, 0, 0, Math.PI / 2);    // the left wall
plane(ROOM, HEIGHT, wallMat, R2, H2, 0, 0, -Math.PI / 2);    // the right wall
const floor = plane(ROOM, ROOM, floorMat, 0, 0, 0, -Math.PI / 2, 0);
floor.userData.floor = true;
plane(ROOM, ROOM, ceilMat, 0, HEIGHT, 0, Math.PI / 2, 0);
// Baseboards, a chair rail and a crown along every wall
for (const [y, h, d] of [[0.07, 0.14, 0.03], [1.0, 0.06, 0.035], [HEIGHT - 0.08, 0.16, 0.06]]) {
  for (const [x, z, w, dd] of [[0, -R2 + d / 2, ROOM, d], [0, R2 - d / 2, ROOM, d], [-R2 + d / 2, 0, d, ROOM], [R2 - d / 2, 0, d, ROOM]]) {
    box(w, h, dd, trimMat, x, y, z, scene).castShadow = false;
  }
}
// The polish: a snapshot of this very room, taken from about table height, used for every reflection in here.
// It's retaken when the wood loads and when the ring light changes color.
const pmrem = new THREE.PMREMGenerator(renderer);
let roomEnv = null, snapTimer = 0;
const reflective = [floorMat, wallMat, ceilMat, trimMat];
function snapRoom() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const hide = [marker, ...Object.values(avatars).map(a => a.g)];   // not people (they'd freeze in it)
    const was = hide.map(o => o.visible);
    hide.forEach(o => { o.visible = false; });
    scene.position.y = -1.0;
    const env = pmrem.fromScene(scene, 0.02, 0.05, 30);
    scene.position.y = 0;
    hide.forEach((o, i) => { o.visible = was[i]; });
    if (roomEnv) roomEnv.dispose();
    roomEnv = env;
    for (const m of reflective) { m.envMap = env.texture; m.needsUpdate = true; }
    setRoomEnv(env.texture);
  }, 150);
}
dressWood(null);
const woodImg = new Image();
woodImg.onload = () => dressWood(woodImg);
woodImg.src = 'Wood.jpg';   // the capital W matters on the website

// ---------- Warm wall lamps: a small gold sconce with a soft pool of light up and down the wall ----------
const poolCv = document.createElement('canvas'); poolCv.width = 128; poolCv.height = 256;
{
  const g = poolCv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256);
  g.save(); g.scale(0.5, 1);
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgb(255,190,120)'); grd.addColorStop(0.4, 'rgb(110,70,35)'); grd.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  g.restore();
}
const poolTex = new THREE.CanvasTexture(poolCv); poolTex.colorSpace = THREE.SRGBColorSpace;
const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
for (const [x, z, ry] of [[-2.2, -R2, 0], [2.2, -R2, 0], [-R2, -1.8, Math.PI / 2], [-R2, 1.8, Math.PI / 2], [R2, -1.8, -Math.PI / 2], [R2, 1.8, -Math.PI / 2]]) {
  const s = new THREE.Group();
  s.position.set(x, 0, z); s.rotation.y = ry;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.02), goldMat); plate.position.set(0, 2.05, 0.01);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 10), goldMat); arm.rotation.x = Math.PI / 2; arm.position.set(0, 2.05, 0.08);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.12, 24, 1, true), goldMat); shade.position.set(0, 2.08, 0.15);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), bulbMat); bulb.position.set(0, 2.06, 0.15);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), poolMat); pool.position.set(0, 2.05, 0.005);
  s.add(plate, arm, shade, bulb, pool);
  scene.add(s);
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

// ---------- A big red dot-matrix wall clock (your local time, with A or P) ----------
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
  const w = 1.25, h = w * CLK_ROWS / CLK_COLS;
  box(w + 0.05, h + 0.05, 0.05, goldMat, 0, 0, 0, g);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: clockTex, toneMapped: false }));
  face.position.z = 0.026;
  g.add(face);
  g.position.set(x, 2.45, z);
  g.rotation.y = rotY;
  scene.add(g);
}
makeWallClock(0, ROOM / 2 - 0.03, Math.PI);   // between the window and the door

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
    g.fillStyle = on ? '#ff2a1f' : '#3a1613';     // red lit dots, dim unlit dots
    g.beginPath(); g.arc(c * CLK_DOT + CLK_DOT / 2, r * CLK_DOT + CLK_DOT / 2, CLK_DOT * 0.42, 0, Math.PI * 2); g.fill();
  }
  clockTex.needsUpdate = true;
}

// ---------- The door on the entry wall (click it twice to leave) ----------
function makeDoor(x, z, rotY, tag) {
  const g = new THREE.Group();
  const wood = std(0x1c0f07, 0.4, { envMap, envMapIntensity: 0.2 });
  box(0.9, 2.05, 0.05, wood, 0, 1.025, 0, g);                 // door
  for (const y of [0.55, 1.45]) box(0.66, 0.62, 0.02, std(0x1e130b, 0.6), 0, y, 0.03, g);   // raised panels
  box(0.08, 2.15, 0.07, goldMat, -0.49, 1.075, 0, g);          // frame
  box(0.08, 2.15, 0.07, goldMat, 0.49, 1.075, 0, g);
  box(1.06, 0.08, 0.07, goldMat, 0, 2.15, 0, g);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), goldMat);
  knob.position.set(0.34, 1.0, 0.06);
  g.add(knob);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  g.traverse(o => { if (o.isMesh) o.userData[tag] = true; });
  scene.add(g);
  return g;
}
makeDoor(1.6, R2 - 0.03, Math.PI, 'door');

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xffe2c0, 0x3a2414, 2.3));   // soft, warm light everywhere

// ---------- Neon: a ring floating over the middle table ----------
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
const RING_R = 1.3, RING_Y = HEIGHT - 0.8;
const ring = new THREE.Group();
ring.position.z = -0.4;   // right over the chess table
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
let neonIndex = -1;
function setNeon(i) {
  i = Number.isInteger(i) && i >= 0 && i < NEON_COLORS.length ? i : 0;
  if (i === neonIndex) return;
  neonIndex = i;
  const col = new THREE.Color(NEON_COLORS[i][1]);
  const hot = col.clone().lerp(new THREE.Color(0xffffff), 0.3);    // the core is a little white-hot, but clearly the color
  for (const n of neonMats) n.mat.color.copy(n.core ? hot : col);
  switchGlow.color.copy(col);
  snapRoom();   // the reflections change color too
}

// The light switch on the wall beside the entry door: click it to change the neon color for everyone
const switchGroup = new THREE.Group();
const switchGlow = new THREE.MeshBasicMaterial({ color: 0xffe8c4, toneMapped: false });
(function lightSwitch() {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.015), goldMat);
  const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.05, 0.02), switchGlow);
  toggle.position.z = 0.015;
  switchGroup.add(plate, toggle);
  switchGroup.position.set(2.5, 1.25, R2 - 0.015);
  switchGroup.rotation.y = Math.PI;
  switchGroup.traverse(o => { if (o.isMesh) o.userData.lightSwitch = true; });
  scene.add(switchGroup);
})();
setNeon(0);
onValue(ref(db, 'tables/decor/neon'), s => setNeon(s.val()));
function nextNeon() {
  if (!S.myName) return;
  const i = (Math.max(0, neonIndex) + 1) % NEON_COLORS.length;
  set(ref(db, 'tables/decor/neon'), i).catch(e => console.warn('Light switch', e));
  setNeon(i);
  showBanner(`💡 ${NEON_COLORS[i][0]}`, 1.5);
  sfx.ping();
}

// ---------- The three tables, each with a chair on either side ----------
const TABLES = { checkers: [-3, -0.4], chess: [0, -0.4], othello: [3, -0.4] };
const TABLE_R = 0.62, CHAIR_D = 0.95;   // the table top's size, and how far out the chairs sit
const chairSpot = (key, side) => { const [x, z] = TABLES[key]; return [x, z + (side === 1 ? 1 : -1) * CHAIR_D]; };   // side 1 sits toward the door
const shadowTex = (() => {   // a soft dark spot for under the furniture
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
function softShadow(x, z, size, parent) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), shadowMat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.002, z); parent.add(m); return m;
}
const tableGold = std(0xc9a227, 0.3, { metalness: 0.9, envMap, envMapIntensity: 0.8 });
for (const [key, [tx, tz]] of Object.entries(TABLES)) {
  const t = new THREE.Group();
  t.position.set(tx, 0, tz);
  scene.add(t);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R, TABLE_R, 0.045, 64), tableMat);
  top.position.y = TABLE_Y - 0.0225; top.castShadow = true;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R + 0.002, TABLE_R + 0.002, 0.008, 64, 1, true), tableGold);   // a thin gold edge
  band.position.y = TABLE_Y - 0.012;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, TABLE_Y - 0.1, 24), trimMat);
  column.position.y = (TABLE_Y - 0.1) / 2 + 0.05;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.32, 0.07, 48), trimMat);
  foot.position.y = 0.035;
  t.add(top, band, column, foot);
  softShadow(0, 0, 1.9, t);
  for (const side of [1, 2]) {   // the chairs, facing the table
    const s = side === 1 ? 1 : -1, c = new THREE.Group();
    c.position.set(0, 0, s * CHAIR_D);
    c.rotation.y = side === 1 ? 0 : Math.PI;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.44), trimMat); seat.position.y = 0.44;
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.4), velvet); cushion.position.y = 0.485;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.045), trimMat); back.position.set(0, 0.72, 0.2);
    const backPad = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.02), velvet); backPad.position.set(0, 0.74, 0.17);
    c.add(seat, cushion, back, backPad);
    for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.04), trimMat); leg.position.set(lx, 0.21, lz); c.add(leg);
    }
    c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.chair = { key, side }; } });
    softShadow(0, 0, 0.8, c);
    t.add(c);
  }
}
startGames(TABLES, tableMat, tableGold);

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
  const x = Number.isFinite(p.x) ? p.x : 1.6, z = Number.isFinite(p.z) ? p.z : R2 - 1.3;
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
    a.g.position.y = p.s ? -0.3 : 0;   // sitting down at a table
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

const GAME_NAMES = { checkers: 'Checkers', chess: 'Chess', othello: 'Othello' };
function seatText(s) { const k = typeof s === 'string' ? s.split(':')[0] : ''; return GAME_NAMES[k] ? ` · playing ${GAME_NAMES[k]}` : ''; }
// ---------- Who's here list ----------
const whoList = document.getElementById('whoList');
const connEl = document.getElementById('conn');
const whoBtn = document.getElementById('whoBtn');
function refreshWho() {
  whoList.textContent = '';
  const people = Object.entries(S.presence);
  document.querySelector('#who h2').textContent = `In the Table Room (${people.length})`;
  whoBtn.textContent = `👥 ${people.length}`;
  for (const [id, p] of people) {
    const div = document.createElement('div');
    const dot = document.createElement('span');
    dot.textContent = '● ';
    dot.style.color = RAINBOW_CSS[colorIndex(p)];
    div.appendChild(dot);
    div.appendChild(document.createTextNode(`${p.name}${id === myId ? ' (you)' : ''}${seatText(p.s)}`));
    whoList.appendChild(div);
  }
}
hooks.refreshWho = refreshWho;

function refreshAll() {
  refreshAvatars();
  refreshWho();
  refreshGames();
  checkMySeat();
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

// ---------- Leaving the room: the 🚪 button or the door, clicked twice ----------
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
  // Leaving gives up your seat; the page reloads to the Cave
  if (S.seat) stand(S.seat.key, S.seat.side);
  remove(ref(db, 'tables/presence/' + myId)).finally(() => location.reload());
}
leaveBtn.addEventListener('click', leaveRoom);


// ---------- Entering the room ----------
const nameBox = document.getElementById('nameBox');
const nameInput = document.getElementById('nameInput');
try { nameInput.value = localStorage.getItem('hangoutName') || ''; } catch (e) {}
nameInput.focus();

function enterRoom() {
  const name = nameInput.value.trim().slice(0, 20);
  if (!name) { nameInput.focus(); return; }
  S.myName = name;
  try { localStorage.setItem('hangoutName', name); } catch (e) {}
  nameBox.style.display = 'none';

  // Say we're here, and have the room remove us automatically if we close the tab or lose connection
  const meRef = ref(db, 'tables/presence/' + myId);
  onValue(ref(db, '.info/connected'), s => {
    if (s.val() === true) {
      onDisconnect(meRef).remove();
      get(ref(db, 'tables/presence')).then(ps => {
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
  onValue(ref(db, 'tables/presence'), s => {
    const next = s.val() || {};
    if (!firstPresence) logJoinsLeaves(S.presence, next);   // the first list is just who's already here
    firstPresence = false;
    S.presence = next;
    refreshAll();
  });

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
const HINT_WALK = PHONE ? 'Drag to look · tap the floor to walk · tap a chair to sit and play'
                        : 'Drag to look · click the floor to walk (or W A S D) · click a chair to sit and play';
const HINT_SEAT = PHONE ? 'Tap your pieces to move · Stand up when you\'re done' : 'Click your pieces to move · Esc or Stand up to leave the table';
hint.textContent = HINT_WALK;
const LIMIT = R2 - 0.5;                       // how close to the walls you can walk
const me = { x: 1.6 + (Math.random() - 0.5) * 1.2, z: R2 - 1.4, tx: null, tz: null };   // you start just inside the door
let yaw = 0, pitch = -0.12;                   // facing the tables
let anim = null;                              // a camera move in progress (sitting down and standing up)
S.seat = null;                                // { key, side } while you're sitting at a table
function clampSpot(x, z) { return [Math.max(-LIMIT, Math.min(LIMIT, x)), Math.max(-LIMIT, Math.min(LIMIT, z))]; }
function mySpot() {   // what everyone else sees: where you're standing (or walking to), or the chair you're in
  if (S.seat) { const [x, z] = chairSpot(S.seat.key, S.seat.side); return { x, z, s: S.seat.key + ':' + S.seat.side }; }
  const x = me.tx != null ? me.tx : me.x, z = me.tz != null ? me.tz : me.z;
  return { x: +x.toFixed(2), z: +z.toFixed(2), s: null };
}
let sentAt = 0, sendTimer = 0;
function sendSpot(now) {   // tell everyone where you're going (a few times a second at most)
  if (!S.myName) return;
  clearTimeout(sendTimer); sendTimer = 0;
  if (!now && performance.now() - sentAt < 250) { sendTimer = setTimeout(() => sendSpot(true), 250); return; }
  sentAt = performance.now();
  update(ref(db, 'tables/presence/' + myId), mySpot()).catch(() => {});
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

// ---------- Sitting down at a table, and standing up ----------
function seatView(key, side) {   // where your eyes are in the chair, looking down at the board
  const [x, z] = TABLES[key], s = side === 1 ? 1 : -1;
  const pos = new THREE.Vector3(x, 1.3, z + s * 0.8);
  return { pos, quat: lookQuat(pos, new THREE.Vector3(x, TABLE_Y, z + s * 0.06)) };
}
let sitting = false;
function sitDown(key, side) {
  if (anim || S.seat || sitting || !S.myName) return;
  if (seatTaken(key, side)) { showBanner('Someone is already sitting there', 1.8); return; }
  sitting = true;
  sit(key, side).then(ok => {
    sitting = false;
    if (!ok) { showBanner('Someone is already sitting there', 1.8); return; }
    S.seat = { key, side };
    me.tx = me.tz = null; marker.visible = false;
    setFov(BASE_FOV);
    const v = seatView(key, side);
    moveCamera(v.pos, v.quat, null);
    hint.textContent = HINT_SEAT;
    showPanel(key);
    sendSpot(true);
  });
}
function standUp() {
  if (!S.seat || anim) return;
  const { key, side } = S.seat;
  stand(key, side);
  S.seat = null;
  const [cx, cz] = chairSpot(key, side), [tx, tz] = TABLES[key], s = side === 1 ? 1 : -1;
  [me.x, me.z] = clampSpot(cx, cz + s * 0.55);   // step back from the chair, still facing the table
  yaw = Math.atan2(-(tx - me.x), -(tz - me.z)); pitch = -0.35;
  moveCamera(new THREE.Vector3(me.x, EYE, me.z), viewQuat(yaw, pitch), null);
  hint.textContent = HINT_WALK;
  sendSpot(true);
}
hooks.standUp = standUp;
function checkMySeat() {   // if your seat was taken from you (say you lost connection for a while), stand up
  if (S.seat && !anim && seatHolder(S.seat.key, S.seat.side) && seatHolder(S.seat.key, S.seat.side) !== myId) standUp();
}
// The panel shows the table you're sitting at, or the one you're standing next to
let panelKey = null, nearCheck = 0;
function nearestTable() {
  if (S.seat) return S.seat.key;
  let best = null, bestD = 2.3;
  for (const [key, [x, z]] of Object.entries(TABLES)) { const d = Math.hypot(me.x - x, me.z - z); if (d < bestD) { best = key; bestD = d; } }
  return best;
}

// ---------- Keys ----------
const keys = new Set();
function typing() { const a = document.activeElement; return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')); }
window.addEventListener('keydown', e => {
  if (typing() || !S.myName) return;
  if (e.key === 'Escape') { if (S.seat) standUp(); return; }
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    keys.add(k);
    if (k.startsWith('arrow')) e.preventDefault();   // don't scroll the page
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
function keyWalk(dt) {   // W/S or up/down walk, A/D step sideways, left/right turn
  if (!keys.size || S.seat || anim || typing()) return;
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
  e.preventDefault();
  setFov(camera.fov + e.deltaY * 0.03);
}, { passive: false });

// ---------- Mouse / touch ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let down = null;
let lastX = 0, lastY = 0;
function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
function aim(e) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
function pickUnder(e) {   // the first real thing under the pointer (not the neon glow, the marker or other people)
  aim(e);
  if (S.seat) {   // sitting: only the board in front of you
    const hit = raycaster.intersectObjects(pickables(S.seat.key), true)[0];
    return hit ? { square: squareAt(S.seat.key, hit) } : null;
  }
  const hit = raycaster.intersectObjects(scene.children, true).find(h => shown(h.object) && !h.object.userData.avatar
    && h.object !== marker && !(h.object.material && h.object.material.blending === THREE.AdditiveBlending));
  if (!hit) return null;
  const u = hit.object.userData;
  if (u.chair) return { chair: u.chair };
  if (u.door) return { door: true };
  if (u.lightSwitch) return { lightSwitch: true };
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
    if (d > 0) setFov(camera.fov * pinchDist / d);
    pinchDist = d;
    return;
  }
  if (down && !S.seat && !anim) {   // drag to look around: the view follows the mouse (drag right to turn right, up to look up)
    const k = 0.004 * (camera.fov / BASE_FOV);   // slower when zoomed in
    yaw -= (e.clientX - lastX) * k;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - lastY) * k));
  }
  lastX = e.clientX; lastY = e.clientY;
  if (!down && e.target === canvas && !PHONE) {   // show where a click would take you
    const p = anim ? null : pickUnder(e);
    const live = p && (p.square !== undefined ? canTap(S.seat.key, p.square) : p.chair ? !seatTaken(p.chair.key, p.chair.side) : true);
    canvas.style.cursor = live ? 'pointer' : S.seat ? 'default' : 'grab';
  }
});
window.addEventListener('pointerup', e => {
  const wasTap = down && e.target === canvas && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
  down = null;
  endTouch(e);
  if (!wasTap || !S.myName || anim) return;
  const p = pickUnder(e);
  if (!p) return;
  if (p.square !== undefined) tap(S.seat.key, p.square);
  else if (p.chair) sitDown(p.chair.key, p.chair.side);
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
  if (anim) {
    anim.t += dt;
    const e = easeInOut(Math.min(anim.t / anim.dur, 1));
    camera.position.lerpVectors(anim.fromPos, anim.toPos, e);
    camera.quaternion.slerpQuaternions(anim.fromQuat, anim.toQuat, e);
    if (anim.t >= anim.dur) { const done = anim.done; anim = null; if (done) done(); }
  } else if (!S.seat) {
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
  if ((nearCheck -= dt) <= 0) {   // a few times a second: which table's panel to show
    nearCheck = 0.25;
    const k = S.myName ? nearestTable() : null;
    if (k !== panelKey) { panelKey = k; showPanel(k); }
  }
  moveAvatars(dt);
  updateGames(dt);
  updateClock();
  updateSky();
  renderer.render(scene, camera);
});