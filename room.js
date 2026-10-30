// =====================================================================
// room.js — the room itself, people, chat, sitting, camera and the main loop
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, remove, push, onValue, onDisconnect,
         query, orderByChild, startAt, endAt, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, ROOM, HEIGHT, SEATS, CHAIR_R, TABLE_Y, seatAngle, rnd,
         renderer, scene, camera, controls, canvas, BASE_FOV,
         paintTexture, box, std, easeInOut, RAINBOW, RAINBOW_CSS, colorIndex, makeLabel, FONT, PHONE } from './core.js';
import { othelloGroup, validPlayer, felt, HALF, CELL, BOARD_TOP, canPlayAt, play, refreshPanel, refreshCounters,
         othelloSeatChanged, startOthello, updateOthello } from './othello.js';
import { trailGroup, trailInUse, hideTrail, mountainMesh, spotMeshes, MTN_TARGET, showSpotInfo, refreshTrail,
         trailSeatChanged, startTrail, updateTrail, trailFullChanged } from './trail.js';
import { stackGroup, stackInUse, hideStack, STACK_TARGET, stackPickables, stackHover, stackGrab, stackDrag,
         stackRelease, stackTap, refreshStack, stackSeatChanged, startStack, updateStack } from './stack.js';
import { slotsGroup, slotPickables, slotViewPose, slotEnter, slotLeave, slotSpin, slotOccupantOf, slotStandSpot, slotName,
         chipsOf, startSlots, updateSlots, refreshSlotUI } from './slots.js';
import { arcadeGroup, arcadePickables, arcadeViewPose, arcadeEnter, arcadeLeave, arcadeCabOf, arcadeFocus, arcadeStandSpot,
         arcadeTap, arcadeKey, startArcade, updateArcade, refreshArcadeUI, ARCADE_NAME } from './arcade.js';
import { checkersGroup, chessGroup, boardGamesInUse, boardGameTap, boardGameCanTap, boardGamePickables, refreshBoardGames,
         hideBoardGames, startBoardGames, updateBoardGames } from './boardgames.js';
import { sketchPickables, sketchViewPose, sketchEnter, sketchLeave, startSketch, updateSketch, SKETCH_NAME } from './sketch.js';
import { sfx, setupMute } from './sounds.js';

// ---------- Painted textures ----------
const floorTex = paintTexture(512, 512, (g, w, h) => {
  const rows = 8, ph = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -(r % 2) * w / 4;
    while (x < w) {
      const len = w / 2;
      g.fillStyle = `hsl(28, 45%, ${30 + rnd() * 18}%)`;
      g.fillRect(x, r * ph, len, ph);
      g.strokeStyle = 'rgba(0,0,0,0.08)';
      for (let i = 0; i < 6; i++) {
        const y = r * ph + rnd() * ph;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (rnd() - 0.5) * 4); g.stroke();
      }
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
      g.strokeRect(x, r * ph, len, ph); g.lineWidth = 1;
      x += len;
    }
  }
}, 3, 3);

const wallTex = paintTexture(512, 256, (g, w, h) => {
  g.fillStyle = '#c9a77c'; g.fillRect(0, 0, w, h);                // warm wallpaper
  for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(255,240,210,0.12)'; g.fillRect(x, 0, 6, h); }
  const panelTop = h * 0.7;
  g.fillStyle = '#4a2f1d'; g.fillRect(0, panelTop, w, h - panelTop); // wood wainscot
  g.fillStyle = '#5a3a24';
  for (let x = 8; x < w; x += 64) g.fillRect(x, panelTop + 10, 48, h - panelTop - 24);
  g.fillStyle = '#2e1d12'; g.fillRect(0, panelTop - 4, w, 6);         // chair rail
  g.fillRect(0, h - 8, w, 8);                                          // baseboard
}, 4, 1);

const tableTex = paintTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#5b3a22'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '30,15,5' : '120,80,45'},0.25)`;
    const y = rnd() * h;
    g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 20, w * 0.7, y + (rnd() - 0.5) * 20, w, y + (rnd() - 0.5) * 10);
    g.stroke();
  }
});

const rugTex = paintTexture(512, 512, (g, w, h) => {
  const cx = w / 2, cy = h / 2;
  const rings = ['#6e2a20', '#e8d5b0', '#9c3b2a', '#d9b56f', '#7a2e22', '#e8d5b0', '#5c2a1e'];
  rings.forEach((col, i) => {
    g.fillStyle = col; g.beginPath();
    g.arc(cx, cy, (w / 2) * (1 - i / rings.length), 0, Math.PI * 2); g.fill();
  });
  g.fillStyle = '#e8d5b0';
  for (let a = 0; a < 48; a++) {
    const ang = (a / 48) * Math.PI * 2;
    g.beginPath(); g.arc(cx + Math.cos(ang) * w * 0.43, cy + Math.sin(ang) * h * 0.43, 5, 0, Math.PI * 2); g.fill();
  }
});

// ---------- Room shell ----------
const wallMat = std(0xffffff, 0.9, { map: wallTex, side: THREE.BackSide });
const roomMats = [
  wallMat, wallMat,
  std(0xe9dcc4, 0.95, { side: THREE.BackSide }),             // ceiling
  std(0xffffff, 0.7, { map: floorTex, side: THREE.BackSide }), // floor
  wallMat, wallMat
];
const room = new THREE.Mesh(new THREE.BoxGeometry(ROOM, HEIGHT, ROOM), roomMats);
room.position.y = HEIGHT / 2;
room.receiveShadow = true;
scene.add(room);

// Round rug
const rug = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), std(0xffffff, 1, { map: rugTex }));
rug.rotation.x = -Math.PI / 2; rug.position.y = 0.005; rug.receiveShadow = true;
scene.add(rug);

// ---------- Round table ----------
const tableMat = std(0xffffff, 0.55, { map: tableTex });
const table = new THREE.Group(); scene.add(table);
const top = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.06, 64), tableMat);
top.position.y = TABLE_Y - 0.03;
const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.7, 24), tableMat);
leg.position.y = 0.38;
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.06, 32), tableMat);
base.position.y = 0.03;
[top, leg, base].forEach(m => { m.castShadow = true; m.receiveShadow = true; table.add(m); });

// Yellow neon strip around the side of the table edge: a bright tube with layered glow
function neonLayer(tube, color, opacity) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(1.004, tube, 12, 160),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false }));
  m.rotation.x = Math.PI / 2;
  m.position.y = TABLE_Y - 0.03;     // middle of the table's edge
  table.add(m);
}
neonLayer(0.004, 0xfff3b0, 1.0);    // hot white-yellow core
neonLayer(0.009, 0xffd23a, 0.55);   // inner glow
neonLayer(0.02, 0xffb81e, 0.18);    // soft outer glow
neonLayer(0.04, 0xff9f10, 0.06);    // faint haze

// ---------- Chairs ----------
const chairs = [];
function makeChair(i) {
  const g = new THREE.Group();
  const wood = std(0x6b4226, 0.7);
  const cushion = std(0x8c2f2f, 0.95);
  box(0.46, 0.05, 0.46, wood, 0, 0.46, 0, g);       // seat
  box(0.42, 0.05, 0.42, cushion, 0, 0.51, 0, g);    // cushion
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.04, 0.46, 0.04, wood, sx * 0.19, 0.23, sz * 0.19, g); // legs
  for (const sx of [-1, 1]) box(0.04, 0.5, 0.04, wood, sx * 0.19, 0.73, -0.21, g); // back posts
  box(0.42, 0.1, 0.03, wood, 0, 0.92, -0.21, g);    // top rail
  box(0.42, 0.05, 0.03, wood, 0, 0.7, -0.21, g);    // middle rail

  const a = seatAngle(i);
  g.position.set(Math.sin(a) * CHAIR_R, 0, Math.cos(a) * CHAIR_R);
  g.lookAt(0, 0, 0); // front of the chair faces the table
  g.userData = { seat: i, mats: [wood, cushion] };
  g.traverse(o => { if (o.isMesh) o.userData.chair = g; });
  scene.add(g);
  chairs.push(g);
}
for (let i = 0; i < SEATS; i++) makeChair(i);

// ---------- Two windows whose sky follows your own clock (sky colors and stars only, no sun or moon) ----------
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 256; skyCanvas.height = 192;
const skyCtx = skyCanvas.getContext('2d');
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
const STARS = Array.from({ length: 45 }, () => [rnd(), rnd() * 0.8, rnd()]);
const windowLights = [];
for (const side of [-1, 1]) {                      // light coming in through each window
  const l = new THREE.DirectionalLight(0x8fa8ff, 0.35);
  l.position.set(side * 8, 4, 0);
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
  const frame = std(0xe8dcc4, 0.6);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({ map: skyTex }));
  g.add(glass);
  box(1.75, 0.08, 0.06, frame, 0, 0.64, 0, g);
  box(1.75, 0.08, 0.06, frame, 0, -0.64, 0, g);
  box(0.08, 1.36, 0.06, frame, -0.84, 0, 0, g);
  box(0.08, 1.36, 0.06, frame, 0.84, 0, 0, g);
  box(0.05, 1.2, 0.05, frame, 0, 0, 0, g);
  box(1.6, 0.05, 0.05, frame, 0, 0, 0, g);
  box(1.9, 0.06, 0.18, frame, 0, -0.7, 0.06, g); // sill
  g.position.set(x, 1.7, z);
  g.rotation.y = rotY;
  scene.add(g);
}
makeWindow(-ROOM / 2 + 0.02, 0, Math.PI / 2);     // left wall, centered
makeWindow(ROOM / 2 - 0.02, 0, -Math.PI / 2);     // right wall, centered

// ---------- Two green dot-matrix wall clocks (your local time, with A or P) ----------
const CLK_FONT = {
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
  box(w + 0.05, h + 0.05, 0.05, std(0x1c1f1d, 0.7), 0, 0, 0, g);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: clockTex, toneMapped: false }));
  face.position.z = 0.026;
  g.add(face);
  g.position.set(x, 2.0, z);
  g.rotation.y = rotY;
  scene.add(g);
}
makeWallClock(-ROOM / 2 + 0.03, -1.5, Math.PI / 2);   // left wall, beside the window on the side away from the lamp
makeWallClock(ROOM / 2 - 0.03, 1.5, -Math.PI / 2);     // right wall, beside the window on the side away from the lamp

function updateClock() {
  const d = new Date();
  const h12 = d.getHours() % 12 || 12;
  const text = (h12 + ':' + String(d.getMinutes()).padStart(2, '0') + (d.getHours() < 12 ? 'A' : 'P')).padStart(6, ' ');
  if (text === clockShown) return;               // only redraw when the minute changes
  clockShown = text;
  const lit = new Set();
  [...text].forEach((ch, i) => {
    const glyph = FONT[ch] || CLK_FONT[ch] || CLK_FONT[' '];
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

// ---------- Door on the front wall (click it twice to leave the room) ----------
const doorGroup = (function door() {
  const g = new THREE.Group();
  const trim = std(0xe8dcc4, 0.6);
  const wood = std(0x5a3a24, 0.65);
  box(0.9, 2.05, 0.05, wood, 0, 1.025, 0, g);                 // door
  for (const y of [0.55, 1.45]) box(0.66, 0.62, 0.02, std(0x4a2f1d, 0.7), 0, y, 0.03, g);   // raised panels
  box(0.08, 2.15, 0.07, trim, -0.49, 1.075, 0, g);             // frame
  box(0.08, 2.15, 0.07, trim, 0.49, 1.075, 0, g);
  box(1.06, 0.08, 0.07, trim, 0, 2.15, 0, g);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), std(0xc9a227, 0.3, { metalness: 0.8 }));
  knob.position.set(0.34, 1.0, 0.06);
  g.add(knob);
  g.position.set(1.5, 0, ROOM / 2 - 0.03);
  g.rotation.y = Math.PI;
  g.traverse(o => { if (o.isMesh) o.userData.door = true; });
  scene.add(g);
  return g;
})();

// ---------- The Lucky Corner: red carpet, rope posts and a neon sign around the slot machines ----------
const luckySign = (function luckyCorner() {
  const CX = -2.7, WALL = -ROOM / 2;
  // Red carpet with a gold border
  const carpetTex = paintTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#7a1424'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,120,140' : '40,0,10'},0.08)`; g.fillRect(rnd() * w, rnd() * h, 3, 3); }
    g.strokeStyle = '#d4a63c'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    g.strokeStyle = '#a3192e'; g.lineWidth = 4; g.strokeRect(30, 30, w - 60, h - 60);
  });
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), std(0xffffff, 1, { map: carpetTex }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.set(CX, 0.008, WALL + 0.85); carpet.receiveShadow = true;
  scene.add(carpet);
  // Brass posts with velvet rope along the front, with a gap in the middle to walk through
  const brass = std(0xd4a63c, 0.25, { metalness: 0.9 });
  const velvet = std(0x9c1530, 0.8);
  const postAt = (x, z) => {
    const p = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.04, 20), brass); base.position.y = 0.02;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.86, 12), brass); pole.position.y = 0.45;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), brass); ball.position.y = 0.9;
    [base, pole, ball].forEach(m => { m.castShadow = true; p.add(m); });
    p.position.set(x, 0, z); scene.add(p);
    return new THREE.Vector3(x, 0.84, z);
  };
  const rope = (a, b) => {
    const mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= 0.18;   // a gentle sag
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.018, 8, false), velvet);
    m.castShadow = true; scene.add(m);
  };
  const FZ = WALL + 1.75;   // front line of the corner
  const p1 = postAt(-4.3, FZ), p2 = postAt(-3.3, FZ), p3 = postAt(-2.1, FZ), p4 = postAt(-1.1, FZ), p5 = postAt(-1.1, WALL + 0.9);
  rope(p1, p2); rope(p3, p4); rope(p4, p5);   // the gap between posts 2 and 3 is the way in
  // Neon "Lucky Corner" sign on the wall above the machines
  const signTex = paintTexture(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'italic bold 120px Georgia';
    g.shadowColor = '#ff3d7f'; g.shadowBlur = 40;
    g.strokeStyle = '#ff7aa8'; g.lineWidth = 10; g.strokeText('Lucky Corner', w / 2, h / 2 + 6);
    g.shadowBlur = 12; g.fillStyle = '#ffe3ee'; g.fillText('Lucky Corner', w / 2, h / 2 + 6);
    g.font = '80px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.shadowBlur = 20; g.shadowColor = '#ffd54f';
    g.fillText('🍀', 70, h / 2 + 6); g.fillText('🍀', w - 70, h / 2 + 6);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false, depthWrite: false }));
  sign.position.set(CX, 2.62, WALL + 0.02);
  scene.add(sign);
  return { sign };
})();
function updateLuckySign() {   // the neon hums along and blinks off for a moment now and then
  const t = performance.now() / 1000;
  const blink = (Math.sin(t * 0.37) > 0.995 || Math.sin(t * 0.91 + 2) > 0.997) ? 0.25 : 1;
  const hum = 0.92 + 0.08 * Math.sin(t * 9);
  luckySign.sign.material.color.setScalar(blink * hum);
}

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xffe2b8, 0x3a2618, 0.75));

// Two floor lamps in opposite corners (no overhead light)
function floorLamp(x, z, shadows) {
  const g = new THREE.Group();
  const metal = std(0x2a2a2a, 0.4, { metalness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 12), metal);
  pole.position.y = 0.8; pole.castShadow = true; g.add(pole);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 24), metal);
  foot.position.y = 0.02; g.add(foot);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.35, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xf2e2c2, emissive: 0xffc982, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
  shade.position.y = 1.65; g.add(shade);
  const light = new THREE.PointLight(0xffc982, 5, 0, 1);   // softer falloff so it reaches the table
  light.position.y = 1.6;
  light.castShadow = shadows;
  light.shadow.mapSize.set(PHONE ? 512 : 1024, PHONE ? 512 : 1024);
  light.shadow.bias = -0.002;
  g.add(light);
  g.position.set(x, 0, z);
  scene.add(g);
}
floorLamp(ROOM / 2 - 0.6, -ROOM / 2 + 0.6, true);
floorLamp(-ROOM / 2 + 0.6, ROOM / 2 - 0.6, !PHONE);   // phones: only one lamp casts shadows (much lighter to draw)

// ---------- Other people: a snowman in their chair with a name tag ----------
const avatars = {};   // id -> { g, name, c }
function makeAvatar(name, c) {
  const g = new THREE.Group();
  const mat = std(new THREE.Color(RAINBOW[c]), 0.75);
  // Three stacked snowballs: big bottom, middle, small head
  const balls = [[0.2, 0.72], [0.15, 1.02], [0.11, 1.25]];
  for (const [r, y] of balls) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat);
    b.position.y = y;
    b.castShadow = true;
    g.add(b);
  }
  // Solid arms in the body color, reaching forward so the hands rest on the table
  for (const side of [-1, 1]) {
    const from = new THREE.Vector3(side * 0.15, 1.06, -0.03);   // shoulder on the middle ball
    const to = new THREE.Vector3(side * 0.2, 0.825, -(CHAIR_R + 0.03 - 0.92));   // hand resting just inside the table edge
    const dir = new THREE.Vector3().subVectors(to, from);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, dir.length(), 6, 12), mat);
    arm.position.copy(from).add(to).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    arm.castShadow = true;
    g.add(arm);
  }
  const label = makeLabel(name, RAINBOW_CSS[c]);
  label.position.y = 1.56;
  g.add(label);
  scene.add(g);
  return { g, name, c };
}
function refreshAvatars() {
  for (const id of Object.keys(avatars)) {
    const p = S.presence[id];
    if (!p || (p.seat < 0 && slotOccupantOf(id) < 0 && arcadeCabOf(id) < 0) || id === myId || p.name !== avatars[id].name || colorIndex(p) !== avatars[id].c) {
      scene.remove(avatars[id].g);
      delete avatars[id];
    }
  }
  for (const [id, p] of Object.entries(S.presence)) {
    if (id === myId) continue;
    const slot = p.seat < 0 ? slotOccupantOf(id) : -1;
    const cab = p.seat < 0 ? arcadeCabOf(id) : -1, atCab = cab >= 0;
    if (p.seat < 0 && slot < 0 && !atCab) continue;
    if (!avatars[id]) avatars[id] = makeAvatar(p.name, colorIndex(p));
    const g = avatars[id].g;
    g.visible = !S.trailFull;   // the big board hides the room
    if (slot >= 0 || atCab) {   // standing at a slot machine or the arcade, facing it
      const spot = atCab ? arcadeStandSpot(cab) : slotStandSpot(slot);
      g.position.set(spot.x, -0.52, spot.z);
      g.rotation.y = 0;
      g.children[3].visible = g.children[4].visible = false;   // arms down (hidden) while standing
      continue;
    }
    g.children[3].visible = g.children[4].visible = true;
    const a = seatAngle(p.seat);
    g.position.set(Math.sin(a) * (CHAIR_R + 0.03), 0, Math.cos(a) * (CHAIR_R + 0.03));
    g.rotation.y = a;   // turned so the arms reach toward the table
  }
}
function seatTakenByOther(s) {
  return Object.entries(S.presence).some(([id, p]) => id !== myId && p.seat === s);
}

// ---------- Who's here list ----------
const whoList = document.getElementById('whoList');
const connEl = document.getElementById('conn');
const whoBtn = document.getElementById('whoBtn');
function refreshWho() {
  whoList.textContent = '';
  const people = Object.entries(S.presence);
  document.querySelector('#who h2').textContent = `In the room (${people.length})`;
  whoBtn.textContent = `👥 ${people.length}`;
  for (const [id, p] of people) {
    const div = document.createElement('div');
    const dot = document.createElement('span');
    dot.textContent = '● ';
    dot.style.color = RAINBOW_CSS[colorIndex(p)];
    div.appendChild(dot);
    const slot = slotOccupantOf(id);
    const where = p.seat >= 0 ? 'seat ' + (p.seat + 1) : slot >= 0 ? '🎰 ' + slotName(slot) : arcadeCabOf(id) >= 0 ? `🕹️ ${ARCADE_NAME} ${arcadeCabOf(id) + 1}` : 'standing';
    div.appendChild(document.createTextNode(`${p.name}${id === myId ? ' (you)' : ''} · ${where}`));
    const chipSpan = document.createElement('span');
    chipSpan.style.opacity = '0.7';
    chipSpan.textContent = ` · 🪙 ${chipsOf(p.name).toLocaleString()}`;
    div.appendChild(chipSpan);
    whoList.appendChild(div);
  }
}
hooks.refreshWho = refreshWho;

function refreshAll() {
  refreshPanel();
  refreshCounters();
  refreshAvatars();
  refreshWho();
  refreshTrail();
  refreshStack();
  refreshBoardGames();
  refreshSwitch();
}
hooks.refreshAll = refreshAll;

// ---------- Switching which game is on the table ----------
const GAMES = {
  othello: { group: othelloGroup, ui: 'othelloUI', btn: 'swOthello', hide() {} },
  checkers: { group: checkersGroup, ui: 'checkersUI', btn: 'swCheckers', hide: hideBoardGames },
  chess:   { group: chessGroup,   ui: 'chessUI',   btn: 'swChess',   hide: hideBoardGames },
  trail:   { group: trailGroup,   ui: 'trailUI',   btn: 'swTrail',   hide: hideTrail },
  stack:   { group: stackGroup,   ui: 'stackUI',   btn: 'swStack',   hide: hideStack }
};
function tableIsFree() {   // you can only switch games when nobody is playing one
  return !(validPlayer(1) || validPlayer(2)) && !trailInUse() && !stackInUse() && !boardGamesInUse();
}
function refreshSwitch() {
  const free = tableIsFree();
  for (const [name, g] of Object.entries(GAMES)) {
    const b = document.getElementById(g.btn);
    b.classList.toggle('on', S.activeGame === name);
    b.disabled = S.activeGame !== name && !free;
  }
}
hooks.refreshSwitch = refreshSwitch;
function applyActive(name) {
  S.activeGame = GAMES[name] ? name : 'othello';
  if (S.trailFull && S.activeGame !== 'trail') setTrailFull(false);
  document.body.dataset.game = S.activeGame;   // lets the page show only this game's ⋯ button
  for (const [n, g] of Object.entries(GAMES)) {
    g.group.visible = S.activeGame === n;
    document.getElementById(g.ui).style.display = S.activeGame === n ? '' : 'none';
    if (S.activeGame !== n) g.hide();
  }
  refreshAll();
}
for (const [name, g] of Object.entries(GAMES)) {
  document.getElementById(g.btn).addEventListener('click', () => {
    if (name === S.activeGame || !tableIsFree()) return;
    set(ref(db, 'room/active'), name);
  });
}

// ---------- Chat ----------
const msgs = document.getElementById('msgs');
const chatInput = document.getElementById('chatInput');
const newDot = document.getElementById('newDot');
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
function addSys(text, c) {   // grey line in chat, like "Sam joined the room"
  const div = document.createElement('div');
  div.className = 'sys';
  const dot = document.createElement('span');
  dot.textContent = '● ';
  if (Number.isInteger(c) && c >= 0 && c < 7) dot.style.color = RAINBOW_CSS[c];
  div.appendChild(dot);
  div.appendChild(document.createTextNode(text));
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}
hooks.addSys = addSys;

// ---------- Big on-screen messages, like "Your turn!" ----------
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

// Phones: the ▾ button shrinks the game panel to just its status line
const collapseBtn = document.getElementById('collapse');
function setPanelSmall(small) {
  document.body.classList.toggle('panelSmall', small);
  collapseBtn.textContent = small ? '▴' : '▾';
  collapseBtn.title = small ? 'Show the whole panel' : 'Shrink the panel';
  try { localStorage.setItem('hangoutPanelSmall', small ? '1' : '0'); } catch (e) {}
}
let startSmall = false;
try { startSmall = localStorage.getItem('hangoutPanelSmall') === '1'; } catch (e) {}
setPanelSmall(startSmall);
collapseBtn.addEventListener('click', () => setPanelSmall(!document.body.classList.contains('panelSmall')));

// Keep the action buttons just above the game panel on phones, however tall the panel gets
const gamePanel = document.getElementById('game');
function trackPanelHeight() { document.documentElement.style.setProperty('--panelH', gamePanel.offsetHeight + 'px'); }
if (window.ResizeObserver) new ResizeObserver(trackPanelHeight).observe(gamePanel);
trackPanelHeight();

// ---------- Leaving the room: the 🚪 button or the door, clicked twice ----------
const leaveBtn = document.getElementById('leaveRoom');
let leaveArmed = 0;
function leaveRoom() {
  if (!S.myName) return;
  if (Date.now() - leaveArmed > 3000) {   // first click: ask to be sure
    leaveArmed = Date.now();
    leaveBtn.textContent = 'Sure? Click again';
    showBanner('🚪 Click again to leave the room', 3);
    setTimeout(() => { if (Date.now() - leaveArmed >= 3000) leaveBtn.textContent = '🚪 Leave room'; }, 3100);
    return;
  }
  // Leaving frees your chair and drops you out of any game; the page reloads to the name screen
  slotLeave();
  arcadeLeave();
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
        set(meRef, { name: S.myName, seat: S.seated, c: S.myHue, t: Date.now() });
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

  onValue(ref(db, 'room/active'), s => applyActive(s.val()));   // which game is on the table
  startOthello();   // the Othello game
  startTrail();     // LittleTrail
  startStack();     // LittleStack
  startBoardGames(); // Checkers and Chess
  startSlots();     // the slot machines
  startArcade();    // the arcade cabinet
  startSketch();    // LittleSketch, the drawing board by the door

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

function setMySeat(seat) {
  if (S.myName) update(ref(db, 'room/presence/' + myId), { seat });
}

// ---------- Sitting, standing, board view, zoom ----------
const hint = document.getElementById('hint');
const standBtn = document.getElementById('stand');
const boardBtn = document.getElementById('boardView');
const TABLE_CENTER = new THREE.Vector3(0, TABLE_Y, 0);

let anim = null;      // camera move in progress
let yaw = 0, pitch = 0;
const baseQuat = new THREE.Quaternion();
const savedView = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
const boardSaved = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const mtnView = { flat: new THREE.Vector3(), dist: 1, yaw: 0, tilt: 0.5, minTilt: 0.1, target: MTN_TARGET };

function seatEye(i) {
  const a = seatAngle(i);
  const r = CHAIR_R - 0.05;
  return new THREE.Vector3(Math.sin(a) * r, 1.18, Math.cos(a) * r);
}
function lookQuat(pos, target, up = new THREE.Vector3(0, 1, 0)) {
  const m = new THREE.Matrix4().lookAt(pos, target, up);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
function mtnViewPos() {   // where the camera sits while circling the hill or tower
  const flat = mtnView.flat.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), mtnView.yaw);
  return mtnView.target.clone()
    .addScaledVector(flat, mtnView.dist * Math.cos(mtnView.tilt))
    .add(new THREE.Vector3(0, mtnView.dist * Math.sin(mtnView.tilt), 0));
}
function moveCamera(toPos, toQuat, done) {
  anim = { fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(), toPos, toQuat, t: 0, dur: 0.8, done };
}
function setFov(f) {
  camera.fov = Math.max(20, Math.min(BASE_FOV, f));
  camera.updateProjectionMatrix();
}

function sit(i) {
  if (anim || S.boardView || !S.myName || seatTakenByOther(i)) return;
  if (S.seated < 0) { savedView.pos.copy(camera.position); savedView.target.copy(controls.target); }
  controls.enabled = false;
  S.seated = i; yaw = 0; pitch = 0;
  setFov(BASE_FOV);
  const pos = seatEye(i);
  baseQuat.copy(lookQuat(pos, TABLE_CENTER));
  moveCamera(pos, baseQuat.clone(), null);
  hint.textContent = `You're in seat ${i + 1} · drag to look · scroll to zoom · B for board view`;
  standBtn.style.display = 'block';
  setMySeat(i);
  othelloSeatChanged(i);
  trailSeatChanged(i);
  stackSeatChanged(i);
  refreshAll();
}

function stand() {
  if (S.seated < 0 || anim || S.boardView || S.atSlot >= 0 || S.atArcade || S.atSketch || S.trailFull) return;
  S.seated = -1;
  setFov(BASE_FOV);
  moveCamera(savedView.pos.clone(), lookQuat(savedView.pos, savedView.target), () => {
    controls.target.copy(savedView.target);
    controls.enabled = true;
    controls.update();
  });
  hint.textContent = 'Drag to look around · scroll to zoom · click a chair to sit';
  standBtn.style.display = 'none';
  setMySeat(-1);
  refreshAll();
}

// ---------- Walking up to a slot machine or the arcade (to play, or to watch someone else play) ----------
const slotSaved = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
// A little "watching" bar with a Back button, shown instead of the game buttons while you watch
const watchStyle = document.createElement('style');
watchStyle.textContent = `#watchBar { display: none; position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); text-align: center; white-space: nowrap; }
  body.watching #watchBar { display: block; }
  body.watching #actionBar { display: none !important; }
  #watchBar span { display: inline-block; font-size: 16px; color: #ffe9a0; background: rgba(30,20,12,0.88); padding: 8px 14px; border-radius: 16px; margin: 4px; vertical-align: middle; }
  #watchBar button { font-family: inherit; font-size: 16px; padding: 9px 18px; margin: 4px; border: none; border-radius: 20px; background: #e9c98f; color: #2a1c10; cursor: pointer; box-shadow: 0 3px 10px rgba(0,0,0,0.5); }`;
document.head.appendChild(watchStyle);
const watchBar = document.createElement('div');
watchBar.id = 'watchBar';
const watchInfo = document.createElement('span');
const watchBack = document.createElement('button');
watchBack.textContent = '← Back';
watchBar.append(watchInfo, watchBack);
document.body.appendChild(watchBar);
watchBack.addEventListener('click', () => { if (S.atArcade) leaveArcade(); else leaveSlot(); });
function whoIsAt(kind, i) {   // the name of whoever is playing the slot machine or that arcade cabinet
  const id = Object.keys(S.presence).find(k => k !== myId && (kind === 'arcade' ? arcadeCabOf(k) === i : slotOccupantOf(k) >= 0));
  return id ? S.presence[id].name : '';
}
function stepUp(kind, i, watch) {   // move the camera up to the machine
  if (S.seated >= 0) {   // get up from your chair first; when you step back you'll be standing
    slotSaved.pos.copy(savedView.pos); slotSaved.target.copy(savedView.target);
    S.seated = -1; setMySeat(-1); standBtn.style.display = 'none';
  } else {
    slotSaved.pos.copy(camera.position); slotSaved.target.copy(controls.target);
  }
  if (Math.hypot(slotSaved.pos.x, slotSaved.pos.y, slotSaved.pos.z) < 0.1) {   // no saved view yet: use the starting view
    slotSaved.pos.set(2.6, 2.6, 2.6); slotSaved.target.set(0, 0.8, 0);
  }
  controls.enabled = false;
  if (kind === 'arcade') { S.atArcade = true; arcadeFocus(i); } else S.atSlot = i;
  setFov(BASE_FOV);
  const v = kind === 'arcade' ? arcadeViewPose(i, camera.aspect) : slotViewPose(i, camera.aspect);
  if (watch) { v.pos.x += 0.35; v.pos.z += 0.3; }   // watchers stand just behind the player's shoulder
  moveCamera(v.pos, lookQuat(v.pos, v.target), null);
  document.body.classList.add(kind === 'arcade' ? 'atArcade' : 'atSlot');
  document.body.classList.toggle('watching', !!watch);
  const game = kind === 'arcade' ? `${ARCADE_NAME} ${i + 1}` : slotName(i);
  if (watch) {
    watchInfo.textContent = `👀 Watching ${whoIsAt(kind, i) || 'someone'} play ${game}`;
    hint.textContent = `Watching ${game} · Esc or Back to step away`;
  } else {
    hint.textContent = kind === 'arcade' ? `Playing ${game} · tap the screen or use the arrows · Esc to step back`
      : `Playing ${game} · press Spin or pull the lever · Esc to step back`;
  }
  if (kind === 'arcade') refreshArcadeUI(); else refreshSlotUI();
  refreshAll();
}
function enterSlot(i) {
  if (anim || S.boardView || S.atSlot >= 0 || S.atArcade || S.atSketch || !S.myName) return;
  slotEnter(i).then(ok => {
    if (anim) { if (ok) slotLeave(); return; }
    if (ok) stepUp('slot', i, false);
    else if (whoIsAt('slot')) stepUp('slot', i, true);   // someone's playing: watch them up close
  });
}
function leaveSlot() {
  if (S.atSlot < 0 || anim) return;
  slotLeave();
  S.atSlot = -1;
  document.body.classList.remove('atSlot', 'watching');
  moveCamera(slotSaved.pos.clone(), lookQuat(slotSaved.pos, slotSaved.target), () => {
    controls.target.copy(slotSaved.target);
    controls.enabled = true;
    controls.update();
  });
  hint.textContent = 'Drag to look around · scroll to zoom · click a chair to sit';
  refreshAll();
}
hooks.slotKicked = () => { if (S.atSlot >= 0) { S.atSlot = -1; leaveSlotCamera(); } };
function leaveSlotCamera() {
  document.body.classList.remove('atSlot');
  moveCamera(slotSaved.pos.clone(), lookQuat(slotSaved.pos, slotSaved.target), () => { controls.target.copy(slotSaved.target); controls.enabled = true; controls.update(); });
}
document.getElementById('slotBack').addEventListener('click', leaveSlot);

// ---------- Walking up to an arcade cabinet (it uses the same saved view as the slots) ----------
function enterArcade(i) {
  if (anim || S.boardView || S.atSlot >= 0 || S.atArcade || S.atSketch || !S.myName) return;
  arcadeEnter(i).then(ok => {
    if (anim) { if (ok) arcadeLeave(); return; }
    if (ok) stepUp('arcade', i, false);
    else if (whoIsAt('arcade', i)) stepUp('arcade', i, true);   // someone's playing that one: watch them up close
  });
}
function leaveArcade() {
  if (!S.atArcade || anim) return;
  arcadeLeave();
  S.atArcade = false; arcadeFocus(-1);
  document.body.classList.remove('atArcade', 'watching');
  moveCamera(slotSaved.pos.clone(), lookQuat(slotSaved.pos, slotSaved.target), () => {
    controls.target.copy(slotSaved.target);
    controls.enabled = true;
    controls.update();
  });
  hint.textContent = 'Drag to look around · scroll to zoom · click a chair to sit';
  refreshAll();
}
hooks.arcadeKicked = () => { if (S.atArcade) { S.atArcade = false; arcadeFocus(-1); document.body.classList.remove('atArcade'); leaveSlotCamera(); } };
document.getElementById('aBack').addEventListener('click', leaveArcade);

// ---------- Walking up to the LittleSketch board by the door (it uses the same saved view as the slots) ----------
function enterSketch() {
  if (anim || S.boardView || S.atSlot >= 0 || S.atArcade || S.atSketch || S.trailFull || !S.myName) return;
  if (S.seated >= 0) {   // get up from your chair first; when you step back you'll be standing
    slotSaved.pos.copy(savedView.pos); slotSaved.target.copy(savedView.target);
    S.seated = -1; setMySeat(-1); standBtn.style.display = 'none';
  } else {
    slotSaved.pos.copy(camera.position); slotSaved.target.copy(controls.target);
  }
  if (Math.hypot(slotSaved.pos.x, slotSaved.pos.y, slotSaved.pos.z) < 0.1) {   // no saved view yet: use the starting view
    slotSaved.pos.set(2.6, 2.6, 2.6); slotSaved.target.set(0, 0.8, 0);
  }
  controls.enabled = false;
  S.atSketch = true;
  setFov(BASE_FOV);
  const v = sketchViewPose(camera.aspect);
  moveCamera(v.pos, lookQuat(v.pos, v.target), null);
  document.body.classList.add('atSketch');
  hint.textContent = `${SKETCH_NAME} · Esc or Back to step away`;
  sketchEnter();
  refreshAll();
}
function leaveSketch() {
  if (!S.atSketch || anim) return;
  S.atSketch = false;
  document.body.classList.remove('atSketch');
  sketchLeave();
  moveCamera(slotSaved.pos.clone(), lookQuat(slotSaved.pos, slotSaved.target), () => {
    controls.target.copy(slotSaved.target);
    controls.enabled = true;
    controls.update();
  });
  hint.textContent = 'Drag to look around · scroll to zoom · click a chair to sit';
  refreshAll();
}
hooks.sketchBack = leaveSketch;

// ---------- LittleTrail's big board: the game fills the window and the room is hidden (and not drawn) ----------
const fullSaved = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), target: new THREE.Vector3(), hidden: [], bg: null };
const fullLight = new THREE.DirectionalLight(0xfff4e0, 0);   // the lamps are hidden too, so the board gets its own light
fullLight.position.set(1.2, 3, 1.6);
scene.add(fullLight);
const FULL_BG = new THREE.Color(0x141826);
function fullDist() {   // far enough back to see the whole board
  const halfH = Math.tan(Math.PI / 6);
  return Math.max(1.7, Math.min(4.2, Math.max(1.2 / halfH, 1.2 / (halfH * Math.max(0.3, camera.aspect)))));
}
function setTrailFull(on) {
  if (on === !!S.trailFull || anim) return;
  if (on) {
    if (S.activeGame !== 'trail' || S.atSlot >= 0 || S.atArcade || S.atSketch || !S.myName) return;
    if (S.boardView) { S.boardView = false; boardBtn.textContent = 'Board view'; }
    fullSaved.pos.copy(camera.position); fullSaved.quat.copy(camera.quaternion); fullSaved.target.copy(controls.target);
    fullSaved.hidden = scene.children.filter(c => c !== trailGroup && c !== fullLight && !c.isLight && c.visible);
    fullSaved.hidden.forEach(c => { c.visible = false; });
    fullSaved.bg = scene.background; scene.background = FULL_BG;
    fullLight.intensity = 1.2;
    controls.enabled = false;
    S.trailFull = true;
    document.body.classList.add('trailFull');
    const side = new THREE.Vector3();
    if (S.seated >= 0) { const a = seatAngle(S.seated); side.set(Math.sin(a), 0, Math.cos(a)); }
    else { camera.getWorldDirection(side); side.y = 0; side.normalize().negate(); }
    mtnView.target = MTN_TARGET; mtnView.flat.copy(side); mtnView.yaw = 0;
    mtnView.tilt = 0.95; mtnView.minTilt = 0.35; mtnView.dist = fullDist();
    setFov(BASE_FOV);
    const pos = mtnViewPos();
    moveCamera(pos, lookQuat(pos, mtnView.target), null);
    hint.textContent = 'LittleTrail · drag to turn the board · scroll to zoom · Esc for the room';
  } else {
    S.trailFull = false;
    fullSaved.hidden.forEach(c => { c.visible = true; });
    fullSaved.hidden = [];
    scene.background = fullSaved.bg; fullLight.intensity = 0;
    document.body.classList.remove('trailFull');
    setFov(BASE_FOV);
    if (S.seated >= 0) {   // back to your chair
      yaw = 0; pitch = 0;
      const pos = seatEye(S.seated);
      baseQuat.copy(lookQuat(pos, TABLE_CENTER));
      moveCamera(pos, baseQuat.clone(), null);
      standBtn.style.display = 'block';
      hint.textContent = `You're in seat ${S.seated + 1} · drag to look · scroll to zoom · B for board view`;
    } else {
      moveCamera(fullSaved.pos.clone(), fullSaved.quat.clone(), () => { controls.target.copy(fullSaved.target); controls.enabled = true; controls.update(); });
      hint.textContent = 'Drag to look around · scroll to zoom · click a chair to sit';
    }
  }
  trailFullChanged();
  refreshAll();
}
hooks.setTrailFull = setTrailFull;
hooks.quietSit = () => {   // joining from the big board: take the first free chair without moving the camera
  if (S.seated >= 0) return S.seated;
  for (let i = 0; i < SEATS; i++) {
    if (seatTakenByOther(i)) continue;
    savedView.pos.copy(fullSaved.pos); savedView.target.copy(fullSaved.target);
    S.seated = i; yaw = 0; pitch = 0;
    setMySeat(i);
    othelloSeatChanged(i); trailSeatChanged(i); stackSeatChanged(i);
    refreshAll();
    return i;
  }
  return -1;
};

function toggleBoardView() {
  if (anim || S.atSlot >= 0 || S.atArcade || S.atSketch || S.trailFull) return;
  if (!S.boardView) {
    boardSaved.pos.copy(camera.position);
    boardSaved.quat.copy(camera.quaternion);
    controls.enabled = false;
    // Angled view from behind your side of the table, looking down
    const side = new THREE.Vector3();
    if (S.seated >= 0) { const a = seatAngle(S.seated); side.set(Math.sin(a), 0, Math.cos(a)); }
    else { camera.getWorldDirection(side); side.y = 0; side.normalize().negate(); }
    setFov(BASE_FOV);
    if (S.activeGame === 'trail' || S.activeGame === 'stack') {
      // Up above the hill or tower: drag left and right to walk around it, up and down to tilt
      const stack = S.activeGame === 'stack';
      mtnView.target = stack ? STACK_TARGET : MTN_TARGET;
      const across = stack ? 0.95 : 1.15, upBy = TABLE_Y + (stack ? 0.75 : 1.3) - mtnView.target.y;
      mtnView.flat.copy(side);
      mtnView.dist = Math.hypot(across, upBy);
      mtnView.tilt = Math.atan2(upBy, across);
      mtnView.minTilt = stack ? 0.05 : 0.25;
      mtnView.yaw = 0;
      const pos = mtnViewPos();
      moveCamera(pos, lookQuat(pos, mtnView.target), null);
    } else {
      const pos = side.clone().multiplyScalar(0.85);
      pos.y = BOARD_TOP + 1.0;
      moveCamera(pos, lookQuat(pos, new THREE.Vector3(0, BOARD_TOP, 0)), null);
    }
    S.boardView = true;
    boardBtn.textContent = S.seated >= 0 ? 'Back to seat' : 'Back';
    standBtn.style.display = 'none';
  } else {
    setFov(BASE_FOV);
    moveCamera(boardSaved.pos.clone(), boardSaved.quat.clone(), () => {
      if (S.seated < 0) { controls.enabled = true; controls.update(); }
    });
    S.boardView = false;
    boardBtn.textContent = 'Board view';
    if (S.seated >= 0) standBtn.style.display = 'block';
  }
  refreshAll();
}

standBtn.addEventListener('click', stand);
boardBtn.addEventListener('click', toggleBoardView);
window.addEventListener('keydown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;   // typing in chat or name box
  if (e.key === 'Escape') { if (S.trailFull) setTrailFull(false); else if (S.atArcade) leaveArcade(); else if (S.atSlot >= 0) leaveSlot(); else if (S.atSketch) leaveSketch(); else if (S.boardView) toggleBoardView(); else stand(); }
  if (S.atArcade) { if (arcadeKey(e.key)) e.preventDefault(); return; }   // at the cabinet, keys play the game
  if ((e.key === ' ' || e.key === 'Enter') && S.atSlot >= 0) { e.preventDefault(); slotSpin(); }
  if (e.key === 'b' || e.key === 'B') toggleBoardView();
});

// Scroll to zoom while seated or in board view (standing uses the normal zoom)
canvas.addEventListener('wheel', e => {
  if (S.trailFull) { e.preventDefault(); mtnView.dist = Math.max(0.9, Math.min(4.5, mtnView.dist * (1 + e.deltaY * 0.001))); return; }   // big board: zoom in and out
  if (S.seated < 0 && !S.boardView) return;
  e.preventDefault();
  setFov(camera.fov + e.deltaY * 0.03);
}, { passive: false });

// ---------- Mouse / touch ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
let down = null;
let lastX = 0, lastY = 0;

// Aim the pointer ray at where the mouse or finger is
function aim(e) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray;
}
// What's under the pointer: a chair, a square on the board, a trail stone, or a tower block
function pickUnder(e) {
  aim(e);
  if (S.atSketch) return null;   // at the LittleSketch board, its own pad and buttons handle everything
  if (S.trailFull) {   // on the big board only the trail can be pointed at
    const hit = raycaster.intersectObjects([mountainMesh, ...spotMeshes], true)[0];
    return hit && hit.object.userData.spot !== undefined ? { spot: hit.object.userData.spot } : null;
  }
  const targets = S.atSlot >= 0 ? [] : S.activeGame === 'trail' ? [...chairs, mountainMesh, ...spotMeshes]
    : S.activeGame === 'stack' ? [...chairs, ...stackPickables()]
    : S.activeGame === 'checkers' || S.activeGame === 'chess' ? [...chairs, ...boardGamePickables()] : [...chairs, felt];
  const hits = raycaster.intersectObjects(S.atArcade ? arcadePickables() : S.atSlot >= 0 ? slotPickables()
    : [...targets, ...slotPickables(), ...arcadePickables(), ...sketchPickables(), doorGroup], true);
  if (!hits.length) return null;
  const h = hits[0];
  if (h.object.userData.arcade) return S.boardView ? null : { arcade: true, cab: h.object.userData.cab || 0, screen: !!h.object.userData.arcadeScreen, point: h.point };
  if (h.object.userData.machine !== undefined) return S.boardView ? null : { machine: h.object.userData.machine, lever: !!h.object.userData.lever };
  if (h.object.userData.door) return S.boardView ? null : { door: true };
  if (h.object.userData.sketch) return S.boardView ? null : { sketch: true };
  if (h.object.userData.slot !== undefined) return { slot: h.object.userData.slot };
  if (h.object.userData.block !== undefined) return { block: h.object.userData.block };
  if (h.object.userData.sq !== undefined) return { cell: h.object.userData.sq };   // a checkers or chess piece
  if (h.object.userData.spot !== undefined) return { spot: h.object.userData.spot };
  if (h.object.userData.mountain) return null;
  if (h.object.userData.isBoard) {
    const c = Math.floor((h.point.x + HALF) / CELL);
    const r = Math.floor((h.point.z + HALF) / CELL);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return { cell: r * 8 + c };
  }
  if (S.boardView) return null;
  return { chair: h.object.userData.chair };
}
function setHover(chair) {
  if (hovered === chair) return;
  if (hovered) hovered.userData.mats.forEach(m => m.emissive.setHex(0x000000));
  hovered = chair;
  if (hovered) hovered.userData.mats.forEach(m => m.emissive.setHex(0x3a2a10));
}

// Two-finger pinch zooms while seated or in board view (phones)
const touchPts = new Map();
let pinchDist = 0;
let grabbing = false;   // holding a tower block
function pinchSpread() {
  const [a, b] = [...touchPts.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}
canvas.addEventListener('pointerdown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPts.size === 2) { pinchDist = pinchSpread(); down = null; if (grabbing) { stackRelease(); grabbing = false; } return; }   // a pinch, not a tap
  if (S.activeGame === 'stack') {   // grab a tower block on your turn
    const p = pickUnder(e);
    if (p && p.block !== undefined && stackGrab(p.block, raycaster.ray)) { grabbing = true; down = null; canvas.style.cursor = 'grabbing'; return; }
  }
  down = { x: e.clientX, y: e.clientY };
  lastX = e.clientX; lastY = e.clientY;
});
function endTouch(e) { touchPts.delete(e.pointerId); if (touchPts.size < 2) pinchDist = 0; }
window.addEventListener('pointercancel', endTouch);
window.addEventListener('pointermove', e => {
  if (touchPts.has(e.pointerId)) touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (grabbing) { stackDrag(aim(e)); return; }
  if (touchPts.size === 2 && pinchDist > 0) {
    const d = pinchSpread();
    if (S.trailFull && d > 0) mtnView.dist = Math.max(0.9, Math.min(4.5, mtnView.dist * pinchDist / d));
    else if ((S.seated >= 0 || S.boardView) && d > 0) setFov(camera.fov * pinchDist / d);
    pinchDist = d;
    return;
  }
  if (down && (S.trailFull || (S.boardView && (S.activeGame === 'trail' || S.activeGame === 'stack'))) && !anim) {
    mtnView.yaw -= (e.clientX - lastX) * 0.008;   // walk around the hill or tower
    mtnView.tilt = Math.max(mtnView.minTilt, Math.min(1.45, mtnView.tilt + (e.clientY - lastY) * 0.006));   // and tilt up or down
  }
  if (down && S.seated >= 0 && !S.boardView && !S.trailFull && !anim) {
    const k = 0.004 * (camera.fov / BASE_FOV);   // slower look when zoomed in
    yaw += (e.clientX - lastX) * k;
    pitch += (e.clientY - lastY) * k;
    yaw = Math.max(-1.4, Math.min(1.4, yaw));
    pitch = Math.max(-0.9, Math.min(0.6, pitch));
  }
  lastX = e.clientX; lastY = e.clientY;
  if (!down && e.target === canvas) {
    const p = pickUnder(e);
    const free = p && p.chair && p.chair.userData.seat !== S.seated && !seatTakenByOther(p.chair.userData.seat);
    const chair = free ? p.chair : null;
    setHover(chair);
    const legal = p && p.cell !== undefined && (S.activeGame === 'othello' ? canPlayAt(p.cell) : boardGameCanTap(p.cell));
    const grabbable = S.activeGame === 'stack' && stackHover(p && p.block !== undefined ? p.block : -1);
    const slot = p && p.slot !== undefined;
    const machine = p && p.machine !== undefined && (S.atSlot < 0 || p.lever);
    canvas.style.cursor = (chair || legal || grabbable || slot || machine || (p && p.door) || (p && p.sketch) || (p && p.arcade && (!S.atArcade || p.screen))) ? 'pointer' : 'grab';
    if (S.activeGame === 'trail') showSpotInfo(p && p.spot !== undefined ? p.spot : -1);
  }
});
window.addEventListener('pointerup', e => {
  if (grabbing) { stackRelease(); grabbing = false; canvas.style.cursor = 'grab'; endTouch(e); return; }
  if (down && e.target === canvas && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
    const p = pickUnder(e);
    if (S.trailFull) { if (p && p.spot !== undefined) showSpotInfo(p.spot); }   // big board: tap a stone to read about it
    else if (S.atArcade) { if (p && p.screen) arcadeTap(p.point, p.cab); }   // at the cabinet: tapping the screen hops that way
    else if (S.atSlot >= 0) { if (p && p.machine === S.atSlot) slotSpin(); }   // at a machine: clicking it (or its lever) spins
    else if (p && p.arcade) enterArcade(p.cab);
    else if (p && p.machine !== undefined) enterSlot(p.machine);
    else if (p && p.sketch) enterSketch();
    else if (S.activeGame === 'stack' && stackTap(p ? p.block : undefined, p ? p.slot : undefined, raycaster.ray)) { /* tested or placed a block */ }
    else if (p && p.door) leaveRoom();
    else if (p && p.cell !== undefined) { if (S.activeGame === 'othello') play(p.cell); else boardGameTap(p.cell); }
    else if (p && p.spot !== undefined) showSpotInfo(p.spot);
    else if (p && p.chair && p.chair.userData.seat !== S.seated) { setHover(null); sit(p.chair.userData.seat); }
  }
  down = null;
  endTouch(e);
});

// ---------- Window resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
const look = new THREE.Quaternion();
const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (anim) {
    anim.t += dt;
    const e = easeInOut(Math.min(anim.t / anim.dur, 1));
    camera.position.lerpVectors(anim.fromPos, anim.toPos, e);
    camera.quaternion.slerpQuaternions(anim.fromQuat, anim.toQuat, e);
    if (anim.t >= anim.dur) { const done = anim.done; anim = null; if (done) done(); }
  } else if (S.boardView || S.trailFull) {
    if (S.trailFull || S.activeGame === 'trail' || S.activeGame === 'stack') {   // circle the hill or tower as you drag
      camera.position.copy(mtnViewPos());
      camera.quaternion.copy(lookQuat(camera.position, mtnView.target));
    }
  } else if (S.atSlot >= 0 || S.atArcade || S.atSketch) {
    // standing still in front of the machine or the board
  } else if (S.seated >= 0) {
    lookEuler.set(pitch, yaw, 0);
    look.setFromEuler(lookEuler);
    camera.quaternion.copy(baseQuat).multiply(look);
  } else {
    controls.update();
  }
  updateOthello(dt);
  updateTrail(dt);
  updateStack(dt);
  updateBoardGames(dt);
  updateSlots(dt);
  updateArcade(dt);
  updateSketch(dt);
  updateLuckySign();
  updateClock();
  updateSky();
  renderer.render(scene, camera);
});