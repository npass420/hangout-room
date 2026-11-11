// =====================================================================
// room.js — the Doodle Gallery room: black and gold marble, the big doodle board, the picture walls,
// walking around, the people in the room, chat, and the main loop
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, remove, push, onValue, onDisconnect,
         query, orderByChild, startAt, endAt, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, ROOM, HEIGHT, EYE, rnd, renderer, scene, camera, canvas, BASE_FOV,
         paintTexture, box, std, easeInOut, envMap, goldMat, RAINBOW, RAINBOW_CSS, colorIndex, makeLabel, PHONE } from './core.js';
import { sketchViewPose, sketchEnter, sketchLeave, startSketch, updateSketch, SKETCH_NAME, BOARD_SPOT } from './sketch.js';
import { sfx, setupMute } from './sounds.js';

// ---------- Black marble with gold veins (painted in code, the same for everyone) ----------
// Everything is drawn wrapped around the edges, so the texture tiles with no seams.
function wrapped(g, w, h, draw) { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { g.save(); g.translate(dx, dy); draw(); g.restore(); } }
function vein(x, y, ang, steps, step, bend, pull = 0) {   // a wandering line, as a list of points (pull keeps it near its first heading)
  const pts = [[x, y]], a0 = ang;
  for (let i = 0; i < steps; i++) {
    ang += (rnd() - 0.5) * bend + (a0 - ang) * pull;
    x += Math.cos(ang) * step; y += Math.sin(ang) * step;
    pts.push([x, y]);
  }
  return pts;
}
function strokePts(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) g.lineTo(x, y); g.stroke(); }
function paintMarble(g, w, h, opts = {}) {
  const sc = w / 1024;                                   // everything is sized for a 1024 texture, then scaled
  g.fillStyle = opts.base || '#0b0a0c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {                         // soft dark clouds in the stone
    const x = rnd() * w, y = rnd() * h, r = (60 + rnd() * 220) * sc;
    const light = rnd() < 0.5;
    wrapped(g, w, h, () => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, light ? 'rgba(48,44,52,0.22)' : 'rgba(0,0,0,0.35)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 4000 * sc * sc; i++) {             // fine grain
    g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.04})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  g.lineJoin = 'round'; g.lineCap = 'round';
  const flow = -0.55;                                    // the veins mostly run one way, like real stone
  for (let i = 0; i < 14; i++) {                         // faint pale veins
    const pts = vein(rnd() * w, rnd() * h, flow + (rnd() - 0.5) * 0.9, 110, 6 * sc, 0.22, 0.06);
    const lw = (0.8 + rnd() * 1.6) * sc;
    wrapped(g, w, h, () => { g.strokeStyle = 'rgba(170,165,175,0.09)'; g.lineWidth = lw; strokePts(g, pts); });
  }
  const golds = opts.golds == null ? 7 : opts.golds;
  for (let i = 0; i < golds; i++) {                      // gold veins: long and flowing, with a soft haze and a few thin offshoots
    const main = vein(rnd() * w, rnd() * h, flow + (rnd() - 0.5) * 0.6, 100 + Math.floor(rnd() * 45), 7 * sc, 0.2, 0.05);   // never longer than the texture, so it wraps cleanly
    const branches = [];
    const nb = Math.floor(rnd() * 3);
    for (let b = 0; b < nb; b++) {
      const at = main[Math.floor(rnd() * main.length)];
      branches.push(vein(at[0], at[1], flow + (rnd() < 0.5 ? 0.7 : -0.7), 15 + Math.floor(rnd() * 30), 5 * sc, 0.3));
    }
    const thick = (0.5 + rnd() * 1.6) * Math.max(sc, 0.75);
    wrapped(g, w, h, () => {
      g.strokeStyle = 'rgba(200,160,60,0.05)'; g.lineWidth = 22 * thick; strokePts(g, main);
      g.strokeStyle = 'rgba(212,170,60,0.12)'; g.lineWidth = 7 * thick; strokePts(g, main);
      g.strokeStyle = 'rgba(222,180,70,0.45)'; g.lineWidth = 2.6 * thick; strokePts(g, main);
      g.strokeStyle = 'rgba(255,226,145,0.85)'; g.lineWidth = 1 * thick; strokePts(g, main);
      for (const br of branches) {
        g.strokeStyle = 'rgba(212,170,60,0.3)'; g.lineWidth = 1.2 * thick; strokePts(g, br);
        g.strokeStyle = 'rgba(255,224,140,0.5)'; g.lineWidth = 0.45 * thick; strokePts(g, br);
      }
    });
  }
  if (opts.tiles) {                                      // floor tiles: thin gold seams, 2 by 2 per texture
    g.fillStyle = 'rgba(190,150,60,0.55)';
    for (const p of [0, w / 2]) { g.fillRect(p - 1, 0, 2, h); g.fillRect(0, p - 1, w, 2); }
    g.fillRect(w - 1, 0, 1, h); g.fillRect(0, h - 1, w, 1);   // the other half of the seam at the texture's edge
  }
}
const SIZE = PHONE ? 512 : 1024;
const wallTex = paintTexture(SIZE, SIZE, (g, w, h) => paintMarble(g, w, h), ROOM / 3, HEIGHT / 3);   // one texture covers 3 meters
const floorTex = paintTexture(SIZE, SIZE, (g, w, h) => paintMarble(g, w, h, { tiles: true, golds: 6 }), ROOM / 3, ROOM / 3);
const ceilTex = paintTexture(SIZE, SIZE, (g, w, h) => paintMarble(g, w, h, { base: '#08080a', golds: 4 }), ROOM / 3, ROOM / 3);

// ---------- The room: four walls, the floor and the ceiling ----------
const wallMat = std(0xffffff, 0.35, { map: wallTex, envMap, envMapIntensity: 0.08 });
const floorMat = std(0xffffff, 0.22, { map: floorTex, envMap, envMapIntensity: 0.18 });
const ceilMat = std(0xffffff, 0.6, { map: ceilTex });
function plane(w, h, mat, x, y, z, rx, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true;
  scene.add(m);
  return m;
}
const H2 = HEIGHT / 2, R2 = ROOM / 2;
plane(ROOM, HEIGHT, wallMat, 0, H2, -R2, 0, 0);              // the far wall (the doodle board)
plane(ROOM, HEIGHT, wallMat, 0, H2, R2, 0, Math.PI);         // the entry wall (door, window, clock)
plane(ROOM, HEIGHT, wallMat, -R2, H2, 0, 0, Math.PI / 2);    // the left wall (pictures)
plane(ROOM, HEIGHT, wallMat, R2, H2, 0, 0, -Math.PI / 2);    // the right wall (pictures)
const floor = plane(ROOM, ROOM, floorMat, 0, 0, 0, -Math.PI / 2, 0);
floor.userData.floor = true;
plane(ROOM, ROOM, ceilMat, 0, HEIGHT, 0, Math.PI / 2, 0);
// Gold baseboards along the bottom of every wall
for (const [x, z, w, d] of [[0, -R2 + 0.01, ROOM, 0.02], [0, R2 - 0.01, ROOM, 0.02], [-R2 + 0.01, 0, 0.02, ROOM], [R2 - 0.01, 0, 0.02, ROOM]]) {
  box(w, 0.09, d, goldMat, x, 0.045, z, scene).castShadow = false;
}

// ---------- A window whose sky follows your own clock (sky colors and stars only, no sun or moon) ----------
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 256; skyCanvas.height = 192;
const skyCtx = skyCanvas.getContext('2d');
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
const STARS = Array.from({ length: 45 }, () => [rnd(), rnd() * 0.8, rnd()]);
const windowLights = [];
{                                                  // light coming in through the window
  const l = new THREE.DirectionalLight(0x8fa8ff, 0.35);
  l.position.set(0, 4, 8);
  l.target.position.set(0, 0, 0);
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
  for (const l of windowLights) { l.color.setHex(s.light); l.intensity = s.power; }
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
makeWallClock(1.6, ROOM / 2 - 0.03, Math.PI);   // above the door

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

// ---------- The door on the entry wall (click it twice to leave) ----------
function makeDoor(x, z, rotY, tag) {
  const g = new THREE.Group();
  const wood = std(0x2a1a10, 0.55, { envMap, envMapIntensity: 0.2 });
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
scene.add(new THREE.HemisphereLight(0xffe2b8, 0x2a2018, 0.6));
// The room's main light, a soft warm white from the middle of the ceiling (gentle, so nothing glares white)
const roomLight = new THREE.PointLight(0xfff0dc, 9, 0, 1);
roomLight.position.set(0, HEIGHT - 0.3, 0);
roomLight.castShadow = true;
roomLight.shadow.mapSize.set(PHONE ? 512 : 1024, PHONE ? 512 : 1024);
roomLight.shadow.bias = -0.002;
scene.add(roomLight);

// ---------- Neon: a ring hanging from the middle of the ceiling, and a strip all the way around the top of the walls ----------
const NEON_COLORS = [['Warm white', 0xffe8c4], ['Yellow', 0xffd23a], ['Orange', 0xff9a2e], ['Pink', 0xff5fa8],
                     ['Purple', 0xb05cff], ['Blue', 0x3d8bff], ['Green', 0x3dff8a], ['Red', 0xff3b3b]];
const neonMats = [];   // { mat, core } for every neon layer in the room
const GLOW = [[1, 1.0, true], [2.2, 0.5, false], [5, 0.15, false], [10, 0.05, false]];   // core, inner glow, soft glow, faint haze
function neonMat(opacity, core) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  neonMats.push({ mat, core });
  return mat;
}
// The ring: hangs down from the ceiling on four thin cables
const RING_R = 1.3, RING_Y = HEIGHT - 0.7;
const ring = new THREE.Group();
scene.add(ring);
const ringBase = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.035, 12, 160), goldMat);
ringBase.rotation.x = Math.PI / 2; ringBase.position.y = RING_Y + 0.03;
ring.add(ringBase);
for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
  const len = HEIGHT - RING_Y - 0.03;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 6), goldMat);
  rod.position.set(Math.cos(a) * RING_R, RING_Y + 0.03 + len / 2, Math.sin(a) * RING_R);
  ring.add(rod);
}
for (const [k, op, core] of GLOW) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.014 * k, 12, 160), neonMat(op, core));
  m.rotation.x = Math.PI / 2; m.position.y = RING_Y;
  ring.add(m);
}
// The strip: sits on a little gold ledge just under the ceiling, all the way around the room
const COVE_Y = HEIGHT - 0.1, IN = 0.09;              // how high, and how far out from the walls
const SIDE = ROOM - IN * 2;
for (const [x, z, w, d] of [[0, -R2 + 0.07, ROOM, 0.14], [0, R2 - 0.07, ROOM, 0.14], [-R2 + 0.07, 0, 0.14, ROOM], [R2 - 0.07, 0, 0.14, ROOM]]) {
  box(w, 0.03, d, goldMat, x, COVE_Y - 0.035, z, scene).castShadow = false;   // the ledge
}
for (const [k, op, core] of GLOW) {
  const mat = neonMat(op * 0.9, core);
  for (const [x, z, rotY] of [[0, -R2 + IN, 0], [0, R2 - IN, 0], [-R2 + IN, 0, Math.PI / 2], [R2 - IN, 0, Math.PI / 2]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.01 * k, 0.01 * k, SIDE, 10), mat);
    m.rotation.set(0, rotY, Math.PI / 2);   // lying along the wall
    m.position.set(x, COVE_Y, z);
    scene.add(m);
  }
}
// A little of the neon color spills into the room
const tintLight = new THREE.PointLight(0xffe8c4, 3, 0, 1.2);
tintLight.position.set(0, RING_Y, 0);   // at the ring, so its color washes up onto the ceiling too
scene.add(tintLight);
let neonIndex = -1;
function setNeon(i) {
  i = Number.isInteger(i) && i >= 0 && i < NEON_COLORS.length ? i : 0;
  if (i === neonIndex) return;
  neonIndex = i;
  const col = new THREE.Color(NEON_COLORS[i][1]);
  const hot = col.clone().lerp(new THREE.Color(0xffffff), 0.65);   // the core looks almost white, tinted
  for (const n of neonMats) n.mat.color.copy(n.core ? hot : col);
  tintLight.color.copy(col);
  switchGlow.color.copy(col);
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
onValue(ref(db, 'room/decor/neon'), s => setNeon(s.val()));
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
function makeAvatar(name, c) {
  const g = new THREE.Group();
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
  // Leaving drops the pen if you have it; the page reloads to the name screen
  sketchLeave();
  remove(ref(db, 'room/presence/' + myId)).finally(() => location.reload());
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
  if (down && !S.atSketch && !anim) {   // drag to look around
    const k = 0.004 * (camera.fov / BASE_FOV);   // slower when zoomed in
    yaw += (e.clientX - lastX) * k;
    pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - lastY) * k));
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
  if (!wasTap || !S.myName || S.atSketch || anim || S.galleryOpen) return;
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
  if (anim) {
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