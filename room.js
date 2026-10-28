// =====================================================================
// room.js — the room itself, people, chat, sitting, camera and the main loop
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, remove, push, onValue, onDisconnect,
         query, orderByChild, startAt, endAt, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, ROOM, HEIGHT, SEATS, CHAIR_R, TABLE_Y, seatAngle, rnd,
         renderer, scene, camera, controls, canvas, BASE_FOV,
         paintTexture, box, std, easeInOut, RAINBOW, RAINBOW_CSS, colorIndex, makeLabel, FONT } from './core.js';
import { othelloGroup, validPlayer, felt, HALF, CELL, BOARD_TOP, canPlayAt, play, refreshPanel, refreshCounters,
         othelloSeatChanged, startOthello, updateOthello } from './othello.js';
import { trailGroup, trailInUse, hideTrail, mountainMesh, spotMeshes, MTN_TARGET, showSpotInfo, refreshTrail,
         trailSeatChanged, startTrail, updateTrail } from './trail.js';
import { stackGroup, stackInUse, hideStack, STACK_TARGET, stackPickables, stackHover, stackGrab, stackDrag,
         stackRelease, stackPlace, refreshStack, stackSeatChanged, startStack, updateStack } from './stack.js';
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

// ---------- Bookshelf full of board games ----------
(function bookshelf() {
  const shelf = new THREE.Group();
  const wood = std(0x3e2716, 0.75);
  const W = 2.2, H = 2.2, D = 0.4;
  box(0.05, H, D, wood, -W / 2, H / 2, 0, shelf);
  box(0.05, H, D, wood, W / 2, H / 2, 0, shelf);
  box(W, 0.05, D, wood, 0, H, 0, shelf);
  box(W, H, 0.03, wood, 0, H / 2, -D / 2 + 0.015, shelf);
  const palette = [0x2a5d8f, 0x8f2a2a, 0xd9a521, 0x2f7a4a, 0x6a3d8f, 0xe07b39, 0x1d1d1d, 0xe8d5b0, 0x3aa0a0];
  const levels = 4;
  for (let l = 0; l < levels; l++) {
    const y = 0.08 + l * (H / levels);
    box(W, 0.04, D, wood, 0, y, 0, shelf);
    let x = -W / 2 + 0.1;
    while (x < W / 2 - 0.35) {
      const w = 0.25 + rnd() * 0.12;
      let stackY = y + 0.02;
      const count = 1 + Math.floor(rnd() * 4);
      for (let s = 0; s < count; s++) {
        const bh = 0.05 + rnd() * 0.05;
        const b = box(w, bh, 0.3, std(palette[Math.floor(rnd() * palette.length)], 0.6), x + w / 2, stackY + bh / 2, 0.02, shelf);
        b.rotation.y = (rnd() - 0.5) * 0.08;
        stackY += bh;
      }
      x += w + 0.06;
    }
  }
  shelf.position.set(-2, 0, -ROOM / 2 + 0.22);
  scene.add(shelf);
})();

// ---------- Two windows whose sky follows your own clock ----------
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
  if (phase === 'night') {
    g.fillStyle = '#ffffff';
    for (const [x, y, b] of STARS) { g.globalAlpha = 0.35 + b * 0.65; g.fillRect(x * W, y * H, 1 + b * 1.5, 1 + b * 1.5); }
    g.globalAlpha = 1;
    const p = ((h < 5 ? h + 24 : h) - 21) / 8;   // moon crosses the window through the night
    const mx = W * (0.15 + 0.7 * p), my = H * (0.6 - 0.4 * Math.sin(p * Math.PI));
    g.fillStyle = '#f4f1d0'; g.beginPath(); g.arc(mx, my, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = s.top; g.beginPath(); g.arc(mx + 7, my - 4, 13, 0, Math.PI * 2); g.fill();   // crescent
  } else {
    const p = (h - 5) / 16;                       // sun crosses from dawn to dusk
    const sx = W * (0.1 + 0.8 * p), sy = H * (0.85 - 0.6 * Math.sin(p * Math.PI));
    const glow = g.createRadialGradient(sx, sy, 4, sx, sy, 45);
    glow.addColorStop(0, 'rgba(255,240,180,0.9)'); glow.addColorStop(1, 'rgba(255,240,180,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.fillStyle = phase === 'day' ? '#fff6c8' : '#ffcf6b';
    g.beginPath(); g.arc(sx, sy, 16, 0, Math.PI * 2); g.fill();
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
makeWindow(-ROOM / 2 + 0.02, 1.2, Math.PI / 2);    // left wall
makeWindow(ROOM / 2 - 0.02, -0.6, -Math.PI / 2);   // right wall

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
  g.position.set(x, 2.25, z);
  g.rotation.y = rotY;
  scene.add(g);
}
makeWallClock(1.3, -ROOM / 2 + 0.03, 0);         // back wall, beside the bookshelf
makeWallClock(-0.9, ROOM / 2 - 0.03, Math.PI);   // front wall, beside the door

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

// ---------- Door on the front wall ----------
(function door() {
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
  scene.add(g);
})();

// ---------- Pictures ----------
function makePicture(colA, colB, x, z, rotY) {
  const art = paintTexture(128, 160, (g, w, h) => {
    g.fillStyle = colB; g.fillRect(0, 0, w, h);
    g.fillStyle = colA; g.beginPath(); g.arc(w / 2, h / 2, w / 3, 0, Math.PI * 2); g.fill();
  });
  const pic = new THREE.Group();
  box(0.75, 0.95, 0.04, std(0x2e1d12, 0.6), 0, 0, 0, pic);
  const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.82), std(0xffffff, 0.9, { map: art }));
  canvasMesh.position.z = 0.025; pic.add(canvasMesh);
  pic.position.set(x, 1.9, z);
  pic.rotation.y = rotY;
  scene.add(pic);
}
makePicture('#d9a521', '#8f2a2a', ROOM / 2 - 0.03, 1.6, -Math.PI / 2);   // right wall, beside the window
makePicture('#2a5d8f', '#e8d5b0', -2.4, ROOM / 2 - 0.03, Math.PI);       // front wall

// ---------- Plant ----------
(function plant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.18, 0.45, 24), std(0xa0522d, 0.8));
  pot.position.y = 0.225; pot.castShadow = true; g.add(pot);
  const leaf = std(0x2f6b3a, 0.8);
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.16 + rnd() * 0.1, 12, 10), leaf);
    s.position.set((rnd() - 0.5) * 0.4, 0.6 + rnd() * 0.6, (rnd() - 0.5) * 0.4);
    s.castShadow = true; g.add(s);
  }
  g.position.set(-ROOM / 2 + 0.6, 0, -ROOM / 2 + 0.6);
  scene.add(g);
})();

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xffe2b8, 0x3a2618, 0.75));

// Two floor lamps in opposite corners (no overhead light)
function floorLamp(x, z) {
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
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.002;
  g.add(light);
  g.position.set(x, 0, z);
  scene.add(g);
}
floorLamp(ROOM / 2 - 0.6, -ROOM / 2 + 0.6);
floorLamp(-ROOM / 2 + 0.6, ROOM / 2 - 0.6);

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
    if (!p || p.seat < 0 || id === myId || p.name !== avatars[id].name || colorIndex(p) !== avatars[id].c) {
      scene.remove(avatars[id].g);
      delete avatars[id];
    }
  }
  for (const [id, p] of Object.entries(S.presence)) {
    if (id === myId || p.seat < 0) continue;
    if (!avatars[id]) avatars[id] = makeAvatar(p.name, colorIndex(p));
    const a = seatAngle(p.seat);
    avatars[id].g.position.set(Math.sin(a) * (CHAIR_R + 0.03), 0, Math.cos(a) * (CHAIR_R + 0.03));
    avatars[id].g.rotation.y = a;   // turned so the arms reach toward the table
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
    div.appendChild(document.createTextNode(`${p.name}${id === myId ? ' (you)' : ''} · ${p.seat >= 0 ? 'seat ' + (p.seat + 1) : 'standing'}`));
    whoList.appendChild(div);
  }
}

function refreshAll() {
  refreshPanel();
  refreshCounters();
  refreshAvatars();
  refreshWho();
  refreshTrail();
  refreshStack();
  refreshSwitch();
}
hooks.refreshAll = refreshAll;

// ---------- Switching which game is on the table ----------
const GAMES = {
  othello: { group: othelloGroup, ui: 'othelloUI', btn: 'swOthello', hide() {} },
  trail:   { group: trailGroup,   ui: 'trailUI',   btn: 'swTrail',   hide: hideTrail },
  stack:   { group: stackGroup,   ui: 'stackUI',   btn: 'swStack',   hide: hideStack }
};
function tableIsFree() {   // you can only switch games when nobody is playing one
  return !(validPlayer(1) || validPlayer(2)) && !trailInUse() && !stackInUse();
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
  if (S.seated < 0 || anim || S.boardView) return;
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

function toggleBoardView() {
  if (anim) return;
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
  if (e.key === 'Escape') { if (S.boardView) toggleBoardView(); else stand(); }
  if (e.key === 'b' || e.key === 'B') toggleBoardView();
});

// Scroll to zoom while seated or in board view (standing uses the normal zoom)
canvas.addEventListener('wheel', e => {
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
  const targets = S.activeGame === 'trail' ? [...chairs, mountainMesh, ...spotMeshes]
    : S.activeGame === 'stack' ? [...chairs, ...stackPickables()] : [...chairs, felt];
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return null;
  const h = hits[0];
  if (h.object.userData.slot !== undefined) return { slot: h.object.userData.slot };
  if (h.object.userData.block !== undefined) return { block: h.object.userData.block };
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
    if ((S.seated >= 0 || S.boardView) && d > 0) setFov(camera.fov * pinchDist / d);
    pinchDist = d;
    return;
  }
  if (down && S.boardView && (S.activeGame === 'trail' || S.activeGame === 'stack') && !anim) {
    mtnView.yaw -= (e.clientX - lastX) * 0.008;   // walk around the hill or tower
    mtnView.tilt = Math.max(mtnView.minTilt, Math.min(1.45, mtnView.tilt + (e.clientY - lastY) * 0.006));   // and tilt up or down
  }
  if (down && S.seated >= 0 && !S.boardView && !anim) {
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
    const legal = p && p.cell !== undefined && canPlayAt(p.cell);
    const grabbable = S.activeGame === 'stack' && stackHover(p && p.block !== undefined ? p.block : -1);
    const slot = p && p.slot !== undefined;
    canvas.style.cursor = (chair || legal || grabbable || slot) ? 'pointer' : 'grab';
    if (S.activeGame === 'trail') showSpotInfo(p && p.spot !== undefined ? p.spot : -1);
  }
});
window.addEventListener('pointerup', e => {
  if (grabbing) { stackRelease(); grabbing = false; canvas.style.cursor = 'grab'; endTouch(e); return; }
  if (down && e.target === canvas && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
    const p = pickUnder(e);
    if (p && p.slot !== undefined) stackPlace(p.slot);
    else if (p && p.cell !== undefined) play(p.cell);
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
  } else if (S.boardView) {
    if (S.activeGame === 'trail' || S.activeGame === 'stack') {   // circle the hill or tower as you drag
      camera.position.copy(mtnViewPos());
      camera.quaternion.copy(lookQuat(camera.position, mtnView.target));
    }
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
  updateClock();
  updateSky();
  renderer.render(scene, camera);
});