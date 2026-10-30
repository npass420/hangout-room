// =====================================================================
// pool.js — LittlePool, the game room behind the 🎱 door: a pool table, its own lights and switch
// Casual 8-ball for two (or practice alone). Drag back from the cue ball to aim; the farther you
// drag, the harder the shot. Everyone in the game room watches each shot roll out.
// Every computer runs the same shot with the same math, so the balls roll the same way for everyone.
// Rules: the first ball pocketed decides solids or stripes. A scratch, missing everything, or hitting
// the wrong ball first gives the other player ball in hand. Sinking the 8 early loses.
// =====================================================================
import * as THREE from 'three';
import { ref, set, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, camera, canvas, renderer, paintTexture, std, box, RAINBOW, RAINBOW_CSS,
         colorIndex, makeLabel, PHONE, BASE_FOV } from './core.js';
import { sfx } from './sounds.js';
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) { console.warn('Pool sound', e); } }

export const POOL_NAME = 'LittlePool';

// ---------- Sizes (meters) ----------
const RW = 7, RD = 6, RH = 3.2;                 // the game room
const L = 2.24, W = 1.12, HX = L / 2, HZ = W / 2; // the playing surface
const R = 0.0286;                                // ball radius
const TY = 0.8;                                  // felt height
const BALL_Y = TY + R;

// ---------- The physics (only + − × ÷ and square roots, so every computer gets exactly the same result) ----------
const DT = 1 / 300, DECEL = 0.2, DRAG = 0.12, E_BALL = 0.95, E_RAIL = 0.75, STOP = 0.004;
const CJ = 0.07, MJ = 0.058;                     // how wide the corner and side pocket mouths are
const POCKETS = [[-HX - 0.012, -HZ - 0.012, 0.062], [HX + 0.012, -HZ - 0.012, 0.062], [-HX - 0.012, HZ + 0.012, 0.062],
                 [HX + 0.012, HZ + 0.012, 0.062], [0, -HZ - 0.03, 0.056], [0, HZ + 0.03, 0.056]];
const HEAD = [-L / 4, 0];                        // where the cue ball starts
function sgn(v) { return v < 0 ? -1 : 1; }
function makeSim(balls, cue, shot) {
  const b = [];
  for (let i = 0; i < 16; i++) {
    const p = balls[i];
    b.push(p ? { x: p[0], z: p[1], vx: 0, vz: 0, on: true } : { x: 0, z: 0, vx: 0, vz: 0, on: false });
  }
  if (cue) { b[0].x = cue[0]; b[0].z = cue[1]; b[0].on = true; }
  b[0].vx = shot.dx * shot.sp; b[0].vz = shot.dz * shot.sp;
  return { b, t: 0, done: false, first: -1, pocketed: [], hits: 0, drops: 0 };
}
function stepSim(s) {
  const b = s.b;
  let moving = false;
  for (const p of b) {
    if (!p.on || (p.vx === 0 && p.vz === 0)) continue;
    const sp = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    const ns = Math.max(0, sp - DECEL * DT - DRAG * sp * DT);
    if (ns < STOP) { p.vx = 0; p.vz = 0; continue; }
    const k = ns / sp;
    p.vx *= k; p.vz *= k;
    p.x += p.vx * DT; p.z += p.vz * DT;
    moving = true;
  }
  for (let i = 0; i < 16; i++) {           // ball against ball
    const a = b[i];
    if (!a.on) continue;
    for (let j = i + 1; j < 16; j++) {
      const c = b[j];
      if (!c.on) continue;
      const dx = c.x - a.x, dz = c.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 >= 4 * R * R || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, push = (2 * R - d) / 2;
      a.x -= nx * push; a.z -= nz * push; c.x += nx * push; c.z += nz * push;
      const rel = (a.vx - c.vx) * nx + (a.vz - c.vz) * nz;
      if (rel > 0) {
        const imp = rel * (1 + E_BALL) / 2;
        a.vx -= imp * nx; a.vz -= imp * nz; c.vx += imp * nx; c.vz += imp * nz;
        if (s.first < 0 && (i === 0 || j === 0)) s.first = i === 0 ? j : i;
        s.hits = Math.max(s.hits, rel);
        moving = true;
      }
    }
  }
  for (let i = 0; i < 16; i++) {           // pockets and cushions
    const p = b[i];
    if (!p.on) continue;
    let gone = false;
    for (const pk of POCKETS) {
      const dx = p.x - pk[0], dz = p.z - pk[1];
      if (dx * dx + dz * dz < pk[2] * pk[2]) { gone = true; break; }
    }
    const ax = Math.abs(p.x), az = Math.abs(p.z);
    if (!gone && (ax > HX + 0.06 || az > HZ + 0.06)) gone = true;   // slipped out through a pocket mouth
    if (gone) { p.on = false; p.vx = 0; p.vz = 0; s.pocketed.push(i); s.drops++; continue; }
    if (az > HZ - R && ax < HX - CJ && ax > MJ) {
      p.z = sgn(p.z) * (HZ - R);
      if (p.z * p.vz > 0) { s.hits = Math.max(s.hits, Math.abs(p.vz) * 0.6); p.vz = -p.vz * E_RAIL; }
    }
    if (ax > HX - R && az < HZ - CJ) {
      p.x = sgn(p.x) * (HX - R);
      if (p.x * p.vx > 0) { s.hits = Math.max(s.hits, Math.abs(p.vx) * 0.6); p.vx = -p.vx * E_RAIL; }
    }
  }
  s.t += DT;
  if (!moving || s.t > 30) s.done = true;
}
function finalBalls(s) { return s.b.map(p => (p.on ? [Math.round(p.x * 1e5) / 1e5, Math.round(p.z * 1e5) / 1e5] : 0)); }

// ---------- Racking ----------
function rack() {
  const balls = Array(16).fill(0);
  balls[0] = HEAD.slice();
  const slots = [], gap = 2 * R + 0.0004, row = gap * Math.sqrt(3) / 2;
  for (let k = 0; k < 5; k++) for (let j = 0; j <= k; j++) slots.push([L / 4 + k * row, (j - k / 2) * gap]);
  const solids = [1, 2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
  const shuffle = a => { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
  shuffle(solids); shuffle(stripes);
  const order = Array(15).fill(0);
  order[4] = 8;                                     // the 8 in the middle of the third row
  const back = Math.random() < 0.5;                 // one solid and one stripe in the back corners
  order[10] = back ? solids.pop() : stripes.pop();
  order[14] = back ? stripes.pop() : solids.pop();
  const rest = shuffle([...solids, ...stripes]);
  for (let k = 0; k < 15; k++) if (!order[k]) order[k] = rest.pop();
  slots.forEach((p, k) => { balls[order[k]] = [p[0], p[1]]; });
  return balls;
}
function groupOf(id) { return id >= 1 && id <= 7 ? 'solid' : id >= 9 ? 'stripe' : id === 8 ? 'eight' : 'cue'; }
function left(balls, group) { let n = 0; for (let i = 1; i < 16; i++) if (balls[i] && groupOf(i) === group) n++; return n; }

// ---------- Shared state ----------
const gameRef = ref(db, 'room/pool/game');
let game = {};
let wins = {};
let neonIndex = -1;
function chipKey(name) { return String(name || '?').replace(/[.#$\[\]\/]/g, '_').slice(0, 20) || '?'; }
function here(id) { return !!(id && S.presence[id]); }
function players(g = game) { return Array.isArray(g.players) ? g.players.filter(Boolean) : []; }
function seatOf(id, g = game) { return players(g).findIndex(p => p.id === id); }
function myTurn() {
  if (game.st !== 'play') return false;
  const ps = players();
  return game.mode === 'practice' ? ps[0] && ps[0].id === myId : ps[game.turn || 0] && ps[game.turn || 0].id === myId;
}
function shotPending() { return !!(game.shot && game.shot.n > (game.sn || 0)); }
function banner(text, secs = 3) { if (hooks.banner) hooks.banner(text, secs); }

// ---------- The game room scene ----------
export const poolScene = new THREE.Scene();
poolScene.background = new THREE.Color(0x120a08);
let seed = 11;
function prand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }   // its own random numbers, so the main room looks the same as before
const wallTex = paintTexture(512, 256, (g, w, h) => {
  g.fillStyle = '#5a1a1e'; g.fillRect(0, 0, w, h);                    // dark red wallpaper
  for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(255,200,180,0.06)'; g.fillRect(x, 0, 6, h); }
  const top = h * 0.68;
  g.fillStyle = '#3a1a10'; g.fillRect(0, top, w, h - top);            // mahogany wainscot
  g.fillStyle = '#4a2214';
  for (let x = 8; x < w; x += 64) g.fillRect(x, top + 10, 48, h - top - 24);
  g.fillStyle = '#22100a'; g.fillRect(0, top - 4, w, 6); g.fillRect(0, h - 8, w, 8);
}, 4, 1);
const floorTex = paintTexture(512, 512, (g, w, h) => {
  const rows = 8, ph = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -(r % 2) * w / 4;
    while (x < w) {
      g.fillStyle = `hsl(18, 40%, ${16 + prand() * 10}%)`;               // dark wood planks
      g.fillRect(x, r * ph, w / 2, ph);
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 2; g.strokeRect(x, r * ph, w / 2, ph);
      x += w / 2;
    }
  }
}, 3, 3);
(function shell() {
  const wallMat = std(0xffffff, 0.9, { map: wallTex, side: THREE.BackSide });
  const room = new THREE.Mesh(new THREE.BoxGeometry(RW, RH, RD), [wallMat, wallMat, std(0x3a2620, 0.95, { side: THREE.BackSide }),
    std(0xffffff, 0.75, { map: floorTex, side: THREE.BackSide }), wallMat, wallMat]);
  room.position.y = RH / 2; room.receiveShadow = true;
  poolScene.add(room);
})();

// The door back to the main room, and the light switch beside it
const doorGroup = new THREE.Group();
(function door() {
  const g = doorGroup, trim = std(0x8a5a3a, 0.6), wood = std(0x3a1a10, 0.65);
  box(0.9, 2.05, 0.05, wood, 0, 1.025, 0, g);
  for (const y of [0.55, 1.45]) box(0.66, 0.62, 0.02, std(0x2e140c, 0.7), 0, y, 0.03, g);
  box(0.08, 2.15, 0.07, trim, -0.49, 1.075, 0, g); box(0.08, 2.15, 0.07, trim, 0.49, 1.075, 0, g); box(1.06, 0.08, 0.07, trim, 0, 2.15, 0, g);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), std(0xc9a227, 0.3, { metalness: 0.8 }));
  knob.position.set(0.34, 1.0, 0.06); g.add(knob);
  g.position.set(1.5, 0, RD / 2 - 0.03); g.rotation.y = Math.PI;
  g.traverse(o => { if (o.isMesh) o.userData.poolDoor = true; });
  poolScene.add(g);
})();
const switchGlow = new THREE.MeshBasicMaterial({ color: 0x3dff8a, toneMapped: false });
const switchGroup = new THREE.Group();
(function lightSwitch() {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.015), std(0xf2ead8, 0.5));
  const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.05, 0.02), switchGlow);
  toggle.position.z = 0.015;
  switchGroup.add(plate, toggle);
  switchGroup.position.set(2.45, 1.25, RD / 2 - 0.015); switchGroup.rotation.y = Math.PI;
  switchGroup.traverse(o => { if (o.isMesh) o.userData.poolSwitch = true; });
  poolScene.add(switchGroup);
})();

// Three bar stools along the left wall for anyone watching
(function stools() {
  const wood = std(0x3a1a10, 0.5), metal = std(0x222222, 0.4, { metalness: 0.7 }), seatMat = std(0x7a1f22, 0.9);
  for (const z of [-1.3, 0, 1.3]) {
    const g = new THREE.Group();
    const seatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 24), seatMat); seatTop.position.y = 0.72;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 24), wood); ring.position.y = 0.68;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.66, 10), metal); pole.position.y = 0.34;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 24), metal); foot.position.y = 0.015;
    [seatTop, ring, pole, foot].forEach(m => { m.castShadow = true; m.receiveShadow = true; g.add(m); });
    g.position.set(-RW / 2 + 0.45, 0, z);
    poolScene.add(g);
  }
})();

// ---------- Neon (the ring over the table and the rim around the rails share one color) ----------
const neonMats = [];
function neonTubeAlong(points, radius, opacity, core) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 240, radius, 8, true), mat);
  poolScene.add(m);
  neonMats.push({ mat, core });
}
function roundedRect(ax, az, r, y) {   // points around a rectangle with rounded corners
  const pts = [];
  const corners = [[ax - r, az - r, 0], [-(ax - r), az - r, Math.PI / 2], [-(ax - r), -(az - r), Math.PI], [ax - r, -(az - r), Math.PI * 1.5]];
  for (const [cx, cz, a0] of corners) for (let k = 0; k <= 6; k++) {
    const a = a0 + (k / 6) * Math.PI / 2;
    pts.push(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
  }
  return pts;
}
function ellipse(rx, rz, y) {
  const pts = [];
  for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * rx, y, Math.sin(a) * rz)); }
  return pts;
}
const FRAME = 0.17;   // how far the wooden frame reaches past the playing surface
const rimPts = roundedRect(HX + FRAME + 0.004, HZ + FRAME + 0.004, 0.06, TY + 0.005);
neonTubeAlong(rimPts, 0.004, 1.0, true);
neonTubeAlong(rimPts, 0.009, 0.55, false);
neonTubeAlong(rimPts, 0.02, 0.18, false);
neonTubeAlong(rimPts, 0.04, 0.06, false);
const RING_Y = 2.45;
const ringPts = ellipse(1.5, 0.85, RING_Y);
(function ringFrame() {
  const dark = std(0x2a2a2a, 0.5, { metalness: 0.6 });
  const base = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ellipse(1.5, 0.85, RING_Y + 0.03), true), 160, 0.03, 8, true), dark);
  poolScene.add(base);
  for (const [x, z] of [[1.5, 0], [-1.5, 0], [0, 0.85], [0, -0.85]]) {
    const len = RH - RING_Y - 0.03;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 6), dark);
    c.position.set(x, RING_Y + 0.03 + len / 2, z);
    poolScene.add(c);
  }
})();
neonTubeAlong(ringPts, 0.014, 1.0, true);
neonTubeAlong(ringPts, 0.03, 0.5, false);
neonTubeAlong(ringPts, 0.07, 0.15, false);
neonTubeAlong(ringPts, 0.14, 0.05, false);

// Lights: a gentle warm light over the table (nothing glares white) and a little of the neon color
poolScene.add(new THREE.HemisphereLight(0xffe2b8, 0x2a1410, 0.7));
const lampLight = new THREE.PointLight(0xfff0dc, 4.5, 0, 1);
lampLight.position.set(0, 2.4, 0);
lampLight.castShadow = true;
lampLight.shadow.mapSize.set(PHONE ? 512 : 1024, PHONE ? 512 : 1024);
lampLight.shadow.bias = -0.002;
poolScene.add(lampLight);
const tintLight = new THREE.PointLight(0x3dff8a, 1.8, 0, 1.2);
tintLight.position.set(0, RING_Y, 0);
poolScene.add(tintLight);
const NEON_COLORS = [['Warm white', 0xffe8c4], ['Yellow', 0xffd23a], ['Orange', 0xff9a2e], ['Pink', 0xff5fa8],
                     ['Purple', 0xb05cff], ['Blue', 0x3d8bff], ['Green', 0x3dff8a], ['Red', 0xff3b3b]];
const DEFAULT_NEON = 6;   // green
function setNeon(i) {
  i = Number.isInteger(i) && i >= 0 && i < NEON_COLORS.length ? i : DEFAULT_NEON;
  if (i === neonIndex) return;
  neonIndex = i;
  const col = new THREE.Color(NEON_COLORS[i][1]);
  const hot = col.clone().lerp(new THREE.Color(0xffffff), 0.65);
  for (const n of neonMats) n.mat.color.copy(n.core ? hot : col);
  tintLight.color.copy(col);
  switchGlow.color.copy(col);
}
setNeon(DEFAULT_NEON);
function nextNeon() {
  if (!S.myName) return;
  const i = (neonIndex + 1) % NEON_COLORS.length;
  set(ref(db, 'room/decor/poolNeon'), i).catch(e => console.warn('Pool switch', e));
  setNeon(i);
  banner(`💡 ${NEON_COLORS[i][0]}`, 1.5);
  sound('ping');
}

// ---------- The table ----------
const tableGroup = new THREE.Group();
poolScene.add(tableGroup);
const felt = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.1, W + 0.1), std(0x1d6b3a, 1.0));
felt.rotation.x = -Math.PI / 2; felt.position.y = TY; felt.receiveShadow = true;
felt.userData.felt = true;
tableGroup.add(felt);
(function tableBody() {
  const mahogany = std(0x4a1f12, 0.5), cushion = std(0x17552e, 1.0), black = std(0x050505, 0.9);
  const g = tableGroup;
  // cushions, with gaps at the pockets
  const longLen = HX - CJ - MJ;
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) box(longLen, 0.04, 0.05, cushion, sx * (MJ + longLen / 2), TY + 0.02, sz * (HZ + 0.025), g);
  for (const sx of [-1, 1]) box(0.05, 0.04, W - 2 * CJ, cushion, sx * (HX + 0.025), TY + 0.02, 0, g);
  // the wooden frame around the top
  box(L + 2 * FRAME, 0.07, FRAME - 0.05, mahogany, 0, TY + 0.015, HZ + 0.05 + (FRAME - 0.05) / 2, g);
  box(L + 2 * FRAME, 0.07, FRAME - 0.05, mahogany, 0, TY + 0.015, -(HZ + 0.05 + (FRAME - 0.05) / 2), g);
  box(FRAME - 0.05, 0.07, W + 0.1, mahogany, HX + 0.05 + (FRAME - 0.05) / 2, TY + 0.015, 0, g);
  box(FRAME - 0.05, 0.07, W + 0.1, mahogany, -(HX + 0.05 + (FRAME - 0.05) / 2), TY + 0.015, 0, g);
  // pockets: dark holes on the felt
  for (const [x, z, r] of POCKETS) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.004, r - 0.004, 0.012, 24), black);
    hole.position.set(x, TY + 0.001, z);
    g.add(hole);
  }
  // body and legs
  box(L + 2 * FRAME - 0.04, 0.24, W + 2 * FRAME - 0.04, mahogany, 0, TY - 0.13, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.14, 0.6, 0.14, mahogany, sx * (HX + 0.02), 0.3, sz * (HZ + 0.02), g);
  // little diamond sights along the frame
  const pearl = std(0xf2ead8, 0.4);
  for (let k = 1; k < 8; k++) if (k !== 4) for (const sz of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), pearl);
    d.position.set(-HX + (k / 8) * L, TY + 0.051, sz * (HZ + 0.11)); g.add(d);
  }
  for (let k = 1; k < 4; k++) for (const sx of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), pearl);
    d.position.set(sx * (HX + 0.11), TY + 0.051, -HZ + (k / 4) * W); g.add(d);
  }
})();

// ---------- The balls ----------
const BALL_COLORS = ['#f5f1e6', '#f4c20d', '#1f4fd1', '#d32f2f', '#5b2a86', '#f57c00', '#1b7a3a', '#7a1c1c', '#111111'];
function ballTexture(i) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const col = BALL_COLORS[i <= 8 ? i : i - 8];
  g.fillStyle = i >= 9 ? '#f5f1e6' : col; g.fillRect(0, 0, 256, 128);
  if (i >= 9) { g.fillStyle = col; g.fillRect(0, 34, 256, 60); }
  if (i > 0) for (const x of [64, 192]) {
    g.fillStyle = '#f5f1e6'; g.beginPath(); g.ellipse(x, 64, 22, 20, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(i), x, 66);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ballMeshes = [];
for (let i = 0; i < 16; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), new THREE.MeshStandardMaterial({ map: ballTexture(i), roughness: 0.3, metalness: 0 }));
  m.castShadow = true;
  m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  m.visible = false;
  poolScene.add(m);
  ballMeshes.push(m);
}
const rollAxis = new THREE.Vector3(), rollQ = new THREE.Quaternion();
function placeBall(i, x, z) {   // move a ball and roll it the right amount
  const m = ballMeshes[i];
  const dx = x - m.position.x, dz = z - m.position.z, d = Math.sqrt(dx * dx + dz * dz);
  if (m.visible && d > 1e-6 && d < 0.5) {
    rollAxis.set(dz, 0, -dx).normalize();
    rollQ.setFromAxisAngle(rollAxis, d / R);
    m.quaternion.premultiply(rollQ);
  }
  m.position.set(x, BALL_Y, z);
}
function showBalls(balls) {
  for (let i = 0; i < 16; i++) {
    const p = balls && balls[i];
    if (p) { placeBall(i, p[0], p[1]); ballMeshes[i].visible = true; } else ballMeshes[i].visible = false;
  }
}

// ---------- Aiming: the cue stick, the guide line and a ghost ball ----------
const cueStick = new THREE.Group();
(function stick() {
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.013, 1.3, 12), std(0xd9b77c, 0.5));
  shaft.rotation.z = Math.PI / 2; shaft.position.x = -0.65;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.012, 12), std(0x3b6fd1, 0.8));
  tip.rotation.z = Math.PI / 2; tip.position.x = -0.006;
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.0132, 0.0135, 0.35, 12), std(0x2a120a, 0.5));
  butt.rotation.z = Math.PI / 2; butt.position.x = -1.13;
  cueStick.add(shaft, tip, butt);
  cueStick.visible = false;
  poolScene.add(cueStick);
})();
const guideMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, toneMapped: false });
const guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), guideMat);
const guide2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), guideMat);
const ghostPts = [];
for (let k = 0; k <= 32; k++) { const a = (k / 32) * Math.PI * 2; ghostPts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)); }
const ghost = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ghostPts), guideMat);
[guide, guide2, ghost].forEach(o => { o.visible = false; o.renderOrder = 5; poolScene.add(o); });
function setLine(line, a, b) {
  const p = line.geometry.attributes.position;
  p.setXYZ(0, a[0], BALL_Y, a[1]); p.setXYZ(1, b[0], BALL_Y, b[1]); p.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  line.visible = true;
}
function hideAim() { cueStick.visible = guide.visible = guide2.visible = ghost.visible = false; }
function showAim(cue, dir, power, balls) {
  // where the cue ball goes first: the first ball it would touch, or the cushion
  let best = Infinity, hitId = -1;
  for (let i = 1; i < 16; i++) {
    const p = balls[i];
    if (!p) continue;
    const ox = p[0] - cue[0], oz = p[1] - cue[1];
    const t = ox * dir[0] + oz * dir[1];
    if (t <= 0) continue;
    const perp2 = ox * ox + oz * oz - t * t, rr = 4 * R * R;
    if (perp2 > rr) continue;
    const tt = t - Math.sqrt(rr - perp2);
    if (tt < best) { best = tt; hitId = i; }
  }
  const wallT = Math.min(dir[0] ? ((dir[0] > 0 ? HX - R : -HX + R) - cue[0]) / dir[0] : Infinity,
                         dir[1] ? ((dir[1] > 0 ? HZ - R : -HZ + R) - cue[1]) / dir[1] : Infinity);
  const t = Math.min(best, Math.max(0, wallT));
  const end = [cue[0] + dir[0] * t, cue[1] + dir[1] * t];
  setLine(guide, cue, end);
  ghost.position.set(end[0], BALL_Y, end[1]); ghost.visible = true;
  if (hitId > 0 && best <= wallT) {
    const p = balls[hitId], nx = p[0] - end[0], nz = p[1] - end[1], n = Math.sqrt(nx * nx + nz * nz) || 1;
    setLine(guide2, p, [p[0] + nx / n * 0.3, p[1] + nz / n * 0.3]);
  } else guide2.visible = false;
  cueStick.visible = true;
  const back = 0.035 + power * 0.25;
  cueStick.position.set(cue[0] - dir[0] * back, BALL_Y + 0.01, cue[1] - dir[1] * back);
  cueStick.rotation.set(0, Math.atan2(-dir[1], dir[0]), 0.06);
}

// ---------- Other people in the game room (snowmen on the stools, players at their end of the table) ----------
const avatars = {};
function makeAvatar(name, c) {
  const g = new THREE.Group();
  const mat = std(new THREE.Color(RAINBOW[c]), 0.75);
  for (const [r, y] of [[0.2, 0.2], [0.15, 0.5], [0.11, 0.73]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat);
    b.position.y = y; b.castShadow = true; g.add(b);
  }
  const label = makeLabel(name, RAINBOW_CSS[c]);
  label.position.y = 1.02; g.add(label);
  poolScene.add(g);
  return { g, name, c };
}
function refreshAvatars() {
  const inRoom = Object.entries(S.presence).filter(([id, p]) => id !== myId && p && p.pool);
  for (const id of Object.keys(avatars)) {
    const p = S.presence[id];
    if (!p || !p.pool || p.name !== avatars[id].name || colorIndex(p) !== avatars[id].c) { poolScene.remove(avatars[id].g); delete avatars[id]; }
  }
  const stoolZ = [-1.3, 0, 1.3];
  let k = 0;
  for (const [id, p] of inRoom) {
    if (!avatars[id]) avatars[id] = makeAvatar(p.name, colorIndex(p));
    const g = avatars[id].g, seat = game.st === 'play' ? seatOf(id) : -1;
    if (seat >= 0 && game.mode !== 'practice') g.position.set(seat === 0 ? -HX - 0.75 : HX + 0.75, 0, 0.4);   // players at their end
    else if (seat === 0) g.position.set(-HX - 0.75, 0, 0.4);
    else { g.position.set(-RW / 2 + 0.45, k < 3 ? 0.75 : 0, k < 3 ? stoolZ[k] : -1.8 + (k - 3) * 0.6); k++; }   // on a stool, or standing nearby
    g.lookAt(0, g.position.y, 0);
  }
}

// ---------- The camera (drag to walk around the table, scroll or pinch to zoom) ----------
const orbit = { yaw: 0, tilt: 0.85, dist: 2.7, top: false };
const target = new THREE.Vector3(0, TY, 0);
function cameraPos() {
  const tilt = orbit.top ? 1.45 : orbit.tilt;
  const dist = Math.min(orbit.dist, (RH - 0.25 - TY) / Math.sin(tilt));   // stay under the ceiling
  const flat = Math.min(dist * Math.cos(tilt), 2.6);                      // and inside the walls
  return new THREE.Vector3(Math.sin(orbit.yaw) * flat, TY + Math.sin(tilt) * dist, Math.cos(orbit.yaw) * flat);
}

// ---------- Playing ----------
let sim = null, simN = 0, simBy = '', simDoneAt = 0;
let place = null, placed = false;     // ball in hand: where I've put the cue ball
let aiming = null;                    // { dir, power } while I'm dragging
function cuePos() {
  if (place) return place;
  const b = game.balls && game.balls[0];
  return b ? b : HEAD;
}
function needsPlace() { return myTurn() && !!game.hand && !placed; }
function canShoot() { return myTurn() && !shotPending() && !sim && (!game.hand || placed); }
function validSpot(x, z) {
  if (Math.abs(x) > HX - R || Math.abs(z) > HZ - R) return false;
  const balls = game.balls || [];
  for (let i = 1; i < 16; i++) { const p = balls[i]; if (p && (p[0] - x) ** 2 + (p[1] - z) ** 2 < (2 * R + 0.002) ** 2) return false; }
  return true;
}
function shoot(dir, power) {
  const n = (game.sn || 0) + 1, sp = 0.25 + power * 4.0, cue = game.hand ? cuePos() : null;
  runTransaction(gameRef, g => {
    if (!g || g.st !== 'play' || (g.sn || 0) !== n - 1 || (g.shot && g.shot.n >= n)) return;
    const ps = players(g), who = g.mode === 'practice' ? ps[0] : ps[g.turn || 0];
    if (!who || who.id !== myId) return;
    g.shot = { n, by: myId, dx: dir[0], dz: dir[1], sp };
    if (cue) { g.shot.cx = cue[0]; g.shot.cz = cue[1]; }
    return g;
  }).catch(e => console.warn('Pool shot', e));
}
function outcome(g, s) {   // what the shot means: who's next, groups, fouls, the end of the game
  const balls = finalBalls(s), ps = players(g), out = { balls, shot: g.shot, sn: g.shot.n, hand: false, msg: '' };
  const pk = s.pocketed, scratch = pk.includes(0), objPk = pk.filter(i => i !== 0);
  if (g.mode === 'practice') {
    out.hand = scratch;
    out.msg = scratch ? 'Scratch! Place the cue ball anywhere' : objPk.length ? `Sank ${objPk.length > 1 ? objPk.length + ' balls' : 'the ' + objPk[0]}!` : '';
    if (!balls.slice(1).some(Boolean)) out.msg = '🎉 Table cleared! Press Rack again';
    return out;
  }
  const me = g.turn || 0, opp = 1 - me, groups = [g.g0 || '', g.g1 || ''], mine = groups[me];
  const pre = g.balls || [];
  const clearedBefore = !!mine && left(pre, mine) === 0;
  let foul = scratch || s.first < 0, why = scratch ? 'Scratch' : s.first < 0 ? 'Missed everything' : '';
  if (!foul) {
    if (mine && (clearedBefore ? s.first !== 8 : groupOf(s.first) !== mine)) { foul = true; why = 'Hit the wrong ball first'; }
    if (!mine && s.first === 8) { foul = true; why = 'Hit the 8 first'; }
  }
  const name = i => (ps[i] ? ps[i].name : 'Someone');
  if (pk.includes(8)) {
    const win = !foul && clearedBefore;
    out.st = 'over'; out.winner = name(win ? me : opp);
    out.msg = win ? `🎱 ${name(me)} sank the 8 and wins!` : `🎱 ${name(me)} sank the 8 too early. ${name(opp)} wins!`;
    return out;
  }
  if (!mine && !foul) {
    const first = objPk.find(i => i !== 8);
    if (first) { groups[me] = groupOf(first); groups[opp] = groups[me] === 'solid' ? 'stripe' : 'solid'; }
  }
  out.g0 = groups[0]; out.g1 = groups[1];
  const potMine = !!groups[me] && objPk.some(i => groupOf(i) === groups[me]);
  out.turn = !foul && potMine ? me : opp;
  out.hand = foul;
  if (foul) out.msg = `${why}! ${name(opp)} has ball in hand`;
  else if (groups[me] && !mine) out.msg = `${name(me)} is ${groups[me]}s`;
  else if (potMine) out.msg = `${name(me)} sank one, shoot again`;
  else out.msg = `${name(opp)}'s turn`;
  return out;
}
function commit(n, s) {   // save the result of shot n (done by the shooter, or by anyone if the shooter left)
  let winner = '';
  runTransaction(gameRef, g => {
    winner = '';
    if (!g || g.st !== 'play' || !g.shot || g.shot.n !== n || (g.sn || 0) !== n - 1) return;
    const o = outcome(g, s);
    Object.assign(g, o);
    if (o.st === 'over') winner = o.winner;
    return g;
  }).then(r => {
    if (r && r.committed && winner) runTransaction(ref(db, 'room/pool/wins/' + chipKey(winner)), v => (v || 0) + 1).catch(() => {});
  }).catch(e => console.warn('Pool result', e));
}

// Starting, joining and leaving
function playDuel() {
  if (!S.myName) return;
  runTransaction(gameRef, g => {
    g = g || {};
    const ps = players(g);
    const stale = g.st === 'play' && !ps.some(p => here(p.id));
    if (g.st === 'wait' && ps[0] && ps[0].id !== myId && here(ps[0].id)) {   // someone's waiting: join them and start
      return { st: 'play', mode: 'duel', players: [ps[0], { id: myId, name: S.myName, c: S.myHue }], turn: 0, balls: rack(), sn: 0, shot: null,
               g0: '', g1: '', hand: false, msg: `${ps[0].name} breaks`, winner: '' };
    }
    if (g.st === 'play' && !stale && !(g.mode === 'practice' && ps[0] && ps[0].id === myId)) return;   // a game is on
    return { st: 'wait', mode: 'duel', players: [{ id: myId, name: S.myName, c: S.myHue }], msg: '' };
  }).catch(e => console.warn('Pool join', e));
}
function practice() {
  if (!S.myName) return;
  runTransaction(gameRef, g => {
    g = g || {};
    const ps = players(g);
    if (g.st === 'play' && ps.some(p => here(p.id) && p.id !== myId)) return;   // someone else is playing
    return { st: 'play', mode: 'practice', players: [{ id: myId, name: S.myName, c: S.myHue }], turn: 0, balls: rack(), sn: 0, shot: null, hand: false, msg: 'Practice: shoot around!', winner: '' };
  }).catch(e => console.warn('Pool practice', e));
}
function rackAgain() {
  runTransaction(gameRef, g => {
    if (!g || g.mode !== 'practice' || seatOf(myId, g) !== 0 || shotPending()) return;
    g.balls = rack(); g.hand = false; g.msg = 'Racked!'; g.sn = (g.sn || 0) + 1; g.shot = null;
    return g;
  }).catch(() => {});
}
function leaveGame() {
  runTransaction(gameRef, g => {
    if (!g || seatOf(myId, g) < 0) return;
    const ps = players(g);
    if (g.st === 'play' && g.mode === 'duel') {
      const other = ps.find(p => p.id !== myId);
      return { ...g, st: 'over', winner: other ? other.name : '', msg: `${S.myName} left the game${other ? `. ${other.name} wins` : ''}`, shot: g.shot || null };
    }
    return { st: 'idle', msg: '' };
  }).catch(() => {});
}

// ---------- The panel while you're in the game room ----------
const css = document.createElement('style');
css.textContent = `
  #plPanel { display: none; left: 16px; bottom: 16px; width: 300px; max-height: calc(100vh - 120px); overflow-y: auto; }
  body.inPool #plPanel { display: block; }
  body.inPool #game, body.inPool #actionBar, body.inPool #stand { display: none !important; }
  #plPanel h3 { margin: 0 0 4px; font-size: 17px; font-weight: normal; color: #ffe9a0; }
  .plStatus { font-size: 15px; margin-bottom: 6px; }
  .plMsg { font-size: 13px; color: #ffd88a; margin-bottom: 6px; }
  .plPlayers div { font-size: 14px; margin: 2px 0; }
  .plButtons { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(243,230,207,0.2); }
  #plFade { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none; transition: opacity 0.35s; z-index: 9; }
  #plFade.on { opacity: 1; transition: none; }
  @media (max-width: 700px) { #plPanel { left: 8px; right: 8px; width: auto; bottom: 8px; max-height: 36vh; padding: 8px 10px; } }`;
document.head.appendChild(css);
const panel = document.createElement('div');
panel.id = 'plPanel'; panel.className = 'panel';
document.body.appendChild(panel);
const fade = document.createElement('div');
fade.id = 'plFade';
document.body.appendChild(fade);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(text, onClick, disabled) { const b = el('button', '', text); b.addEventListener('click', onClick); if (disabled) b.disabled = true; return b; }
const BALL_DOT = { solid: '●', stripe: '◐' };
let lastSig = '';
export function refreshPoolUI(force) {
  if (!S.inPool) { lastSig = ''; return; }
  const sig = JSON.stringify([game.st, game.mode, game.players, game.turn, game.g0, game.g1, game.hand, game.msg, game.winner,
    game.balls, !!sim, placed, aiming && Math.round(aiming.power * 20), wins, Object.keys(S.presence)]);
  if (!force && sig === lastSig) return;
  lastSig = sig;
  panel.textContent = '';
  panel.appendChild(el('h3', '', '🎱 ' + POOL_NAME));
  const ps = players(), st = game.st || 'idle', me = seatOf(myId);
  const waitingStale = st === 'wait' && !(ps[0] && here(ps[0].id));
  const playStale = st === 'play' && !ps.some(p => here(p.id));
  let status = '';
  if (st === 'idle' || !game.st || waitingStale || playStale) status = 'The table is free. Play 8-ball with someone, or practice alone.';
  else if (st === 'wait') status = me === 0 ? 'Waiting for a second player to join…' : `${ps[0].name} wants to play 8-ball!`;
  else if (st === 'over') status = game.winner ? `🏆 ${game.winner} wins!` : 'Game over';
  else if (sim) status = 'Rolling…';
  else if (myTurn()) status = needsPlace() ? '✋ Ball in hand: tap the table to place the cue ball' : aiming ? `Power ${Math.round(aiming.power * 100)}% · let go to shoot` : 'Your shot! Drag back from the cue ball';
  else status = game.mode === 'practice' ? `${ps[0] ? ps[0].name : 'Someone'} is practicing` : `${ps[game.turn || 0] ? ps[game.turn || 0].name : 'Someone'}'s shot`;
  panel.appendChild(el('div', 'plStatus', status));
  if (game.msg && (st === 'play' || st === 'over')) panel.appendChild(el('div', 'plMsg', game.msg));
  if ((st === 'play' || st === 'over') && game.mode === 'duel') {
    const list = el('div', 'plPlayers');
    ps.forEach((p, i) => {
      const row = el('div');
      const dot = el('span', '', '● '); dot.style.color = RAINBOW_CSS[colorIndex(p)];
      const grp = i === 0 ? game.g0 : game.g1;
      const w = wins[chipKey(p.name)] || 0;
      row.append(dot, document.createTextNode(`${p.name}${p.id === myId ? ' (you)' : ''}${game.st === 'play' && (game.turn || 0) === i ? ' ◀' : ''}` +
        `${grp ? ` · ${BALL_DOT[grp]} ${grp}s, ${left(game.balls || [], grp)} left` : ''}${w ? ` · 🏆${w}` : ''}`));
      list.appendChild(row);
    });
    panel.appendChild(list);
  }
  const row = el('div', 'plButtons');
  const free = st === 'idle' || !game.st || st === 'over' || waitingStale || playStale;
  if (free) { row.appendChild(btn('🎱 Play 8-ball', playDuel)); row.appendChild(btn('Practice', practice)); }
  else if (st === 'wait' && me < 0) row.appendChild(btn('Join game', playDuel));
  if (st === 'play' && game.mode === 'practice' && me === 0) row.appendChild(btn('Rack again', rackAgain, !!sim));
  if (myTurn() && game.hand && placed && !sim) row.appendChild(btn('Move cue ball', () => { placed = false; refreshPoolUI(true); }));
  if (me >= 0 && (st === 'play' || st === 'wait')) row.appendChild(btn('Leave game', leaveGame));
  row.appendChild(btn(orbit.top ? 'Side view' : 'Top view', () => { orbit.top = !orbit.top; refreshPoolUI(true); }));
  row.appendChild(btn('← Back to the room', () => { if (hooks.poolBack) hooks.poolBack(); }));
  panel.appendChild(row);
}

// ---------- Mouse and touch in the game room ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_Y);
function aimRay(e) { ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); }
function tablePoint(e) {
  aimRay(e);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(tablePlane, p) ? [p.x, p.z] : null;
}
function onFelt(p) { return p && Math.abs(p[0]) < HX + 0.12 && Math.abs(p[1]) < HZ + 0.12; }
const touches = new Map();
let drag = null, pinch = 0;
canvas.addEventListener('pointerdown', e => {
  if (!S.inPool) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; aiming = null; hideAim(); return; }
  aimRay(e);
  const hit = ray.intersectObjects([doorGroup, switchGroup], true)[0];
  drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: 'orbit', hit };
  if (hit) return;
  const p = tablePoint(e);
  if (onFelt(p) && myTurn() && !sim && !shotPending()) {
    if (needsPlace()) {
      const x = Math.max(-HX + R, Math.min(HX - R, p[0])), z = Math.max(-HZ + R, Math.min(HZ - R, p[1]));
      if (validSpot(x, z)) { place = [x, z]; placed = true; showBalls(withCue()); sound('disc'); refreshPoolUI(true); }
      else banner('There\'s a ball in the way', 1.5);
      drag.mode = 'none';
      return;
    }
    drag.mode = 'aim';
    updateAim(p);
  }
});
function withCue() { const b = (game.balls || []).slice(); b[0] = cuePos(); return b; }
function updateAim(p) {
  const cue = cuePos(), dx = cue[0] - p[0], dz = cue[1] - p[1], d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-4) return;
  aiming = { dir: [dx / d, dz / d], power: Math.max(0, Math.min(1, (d - 0.06) / 0.6)) };
  showAim(cue, aiming.dir, aiming.power, withCue());
  refreshPoolUI();
}
window.addEventListener('pointermove', e => {
  if (!S.inPool) return;
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2 && pinch > 0) {
    const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0) orbit.dist = Math.max(1.2, Math.min(3.4, orbit.dist * pinch / d));
    pinch = d; return;
  }
  if (!drag) {   // hovering: show a hand over things you can click
    aimRay(e);
    const over = ray.intersectObjects([doorGroup, switchGroup], true).length || (onFelt(tablePoint(e)) && myTurn() && !sim);
    canvas.style.cursor = over ? 'pointer' : 'grab';
    return;
  }
  if (drag.mode === 'aim') { const p = tablePoint(e); if (p) updateAim(p); }
  else if (drag.mode === 'orbit' && !orbit.top) {
    orbit.yaw -= (e.clientX - drag.x) * 0.008;
    orbit.tilt = Math.max(0.3, Math.min(1.45, orbit.tilt + (e.clientY - drag.y) * 0.006));
  } else if (drag.mode === 'orbit') orbit.yaw -= (e.clientX - drag.x) * 0.008;
  drag.x = e.clientX; drag.y = e.clientY;
});
function endPointer(e) {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = 0;
  if (!S.inPool || !drag) return;
  const d = drag;
  drag = null;
  const tap = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6;
  if (d.hit && tap) {
    if (d.hit.object.userData.poolSwitch) nextNeon();
    else if (d.hit.object.userData.poolDoor && hooks.poolBack) hooks.poolBack();
    return;
  }
  if (d.mode === 'aim' && aiming) {
    const a = aiming;
    aiming = null; hideAim();
    if (a.power > 0.01 && canShoot()) shoot(a.dir, a.power);
    refreshPoolUI(true);
  }
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => {
  if (!S.inPool) return;
  e.preventDefault();
  orbit.dist = Math.max(1.2, Math.min(3.4, orbit.dist * (1 + e.deltaY * 0.001)));
}, { passive: false });
window.addEventListener('keydown', e => {
  if (!S.inPool || (document.activeElement && document.activeElement.tagName === 'INPUT')) return;
  if (e.key === 'Escape' && hooks.poolBack) hooks.poolBack();
  if (e.key === 't' || e.key === 'T') { orbit.top = !orbit.top; refreshPoolUI(true); }
});

// ---------- Walking in and out (the room calls these) ----------
export function poolEnter() {
  fade.classList.add('on');
  void fade.offsetWidth;
  fade.classList.remove('on');   // fade in from black
  camera.fov = BASE_FOV; camera.updateProjectionMatrix();
  orbit.yaw = 0; orbit.tilt = 0.85; orbit.dist = 2.7;
  camera.position.copy(cameraPos()); camera.lookAt(target);
  showBalls(game.balls);
  refreshAvatars();
  refreshPoolUI(true);
}
export function poolLeave() {
  fade.classList.add('on');
  void fade.offsetWidth;
  fade.classList.remove('on');
  aiming = null; drag = null; hideAim();
  refreshPoolUI(true);
}

// ---------- Listening ----------
let firstGame = true;
export function startPool() {
  onValue(ref(db, 'room/decor/poolNeon'), s => setNeon(s.val()));
  onValue(ref(db, 'room/pool/wins'), s => { wins = s.val() || {}; refreshPoolUI(); });
  onValue(gameRef, s => {
    const prev = game;
    game = s.val() || {};
    const shot = game.shot;
    if (shot && shot.n > (game.sn || 0) && shot.n !== simN && Array.isArray(game.balls)) {   // a new shot: roll it out
      simN = shot.n; simBy = shot.by;
      const cue = shot.cx !== undefined ? [shot.cx, shot.cz] : null;
      sim = makeSim(game.balls, cue, shot);
      simDoneAt = 0; placed = false; place = null;
      aiming = null; hideAim();
      if (S.inPool) { showBalls(cue ? (() => { const b = game.balls.slice(); b[0] = cue; return b; })() : game.balls); sound('clack', 1); }
    } else if (!sim) {
      if (S.inPool) showBalls(game.balls);
      if ((game.sn || 0) !== (prev.sn || 0) || game.st !== prev.st) { placed = false; place = null; }
    }
    if (!firstGame && S.inPool) {
      if (game.st === 'play' && myTurn() && !shotPending() && (prev.st !== 'play' || (prev.sn || 0) !== (game.sn || 0)) && game.mode === 'duel') banner(game.hand ? '✋ Your shot, with ball in hand!' : '🎱 Your shot!', 2);
      if (game.st === 'wait' && prev.st !== 'wait' && seatOf(myId) < 0) banner(`🎱 ${players()[0] ? players()[0].name : 'Someone'} wants to play 8-ball!`, 3);
      if (game.st === 'over' && prev.st !== 'over' && game.winner) { banner(`🏆 ${game.winner} wins LittlePool!`, 4); sound('win'); }
    }
    if (game.st === 'over' && prev.st === 'play' && game.winner && !firstGame) hooks.addSys(`🎱 ${game.winner} won a game of LittlePool!`);
    firstGame = false;
    refreshAvatars();
    refreshPoolUI();
  });
}

// ---------- Every frame ----------
let acc = 0, lastTick = 0;
export function updatePool(dt) {
  if (sim && !sim.done) {   // roll the shot forward in real time
    acc += dt;
    let steps = 0;
    while (acc >= DT && !sim.done && steps < 2000) { stepSim(sim); acc -= DT; steps++; }
    if (S.inPool) {
      sim.b.forEach((p, i) => { if (p.on) { placeBall(i, p.x, p.z); ballMeshes[i].visible = true; } else ballMeshes[i].visible = false; });
      if (sim.hits > 0.05) { sound('clack', Math.min(1, sim.hits / 2)); sim.hits = 0; }
      if (sim.drops) { sound('disc'); sim.drops = 0; }
    }
    if (sim.done) {
      acc = 0; simDoneAt = performance.now();
      if (simBy === myId) commit(simN, sim);
    }
  }
  if (sim && sim.done && (game.sn || 0) >= simN) { sim = null; if (S.inPool) showBalls(game.balls); refreshPoolUI(true); }
  const t = performance.now();
  if (t - lastTick > 1000) {   // every second: tidy up if the shooter left before saving, or a player walked out of a game
    lastTick = t;
    if (sim && sim.done && t - simDoneAt > 3000 && !here(simBy)) commit(simN, sim);
    if (game.st === 'play' && game.mode === 'duel' && !sim && players().some(p => !here(p.id)) && seatOf(myId) >= 0) {
      const gone = players().find(p => !here(p.id));
      runTransaction(gameRef, g => {
        if (!g || g.st !== 'play' || g.mode !== 'duel' || !players(g).some(p => !here(p.id))) return;
        const stay = players(g).find(p => here(p.id));
        return { ...g, st: 'over', winner: stay ? stay.name : '', msg: `${gone ? gone.name : 'A player'} left the game` };
      }).catch(() => {});
    }
    if (S.inPool) { refreshAvatars(); refreshPoolUI(); }
  }
  if (!S.inPool) return;
  const pos = cameraPos();
  camera.position.lerp(pos, Math.min(1, dt * 10));
  camera.lookAt(target);
  switchGlow.color.copy(new THREE.Color(NEON_COLORS[neonIndex][1])).multiplyScalar(0.85 + 0.15 * Math.sin(t / 300));
}