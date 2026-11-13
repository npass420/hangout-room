// =====================================================================
// skeeball.js — two skee-ball machines side by side against the back wall of the Game Room, on the right.
// Holographic Tetris cabinets (holo.jpg), a purple velvet lane with fine gold stitching up its sides (lane.jpg), a hump
// that launches the ball onto a target board, and your orb (skeeorb.png) set in the backboard above the rings, flaring
// whenever a ball drops. The board: a cluster of neon cups worth 10 to 50 that slides to a new spot after every ball,
// a small circle worth 75 in each lower corner and 100 in each upper corner. Twenty wooden balls (wood.jpg) wait in two
// rows in the tray under Tetris covers that slide open when a game starts.
// Click a machine to play. Each roll is three clicks: where on the lane the ball goes, then stop the spin bar (the
// middle rolls straight, the ends curl hard), then stop the power tachometer (twenty segments; the top few slam it into
// the back). Everyone in the room sees every roll (each ball's path is worked out the same way on every screen), and the
// best scores go up on the board on the back wall.
// =====================================================================
import * as THREE from 'three';
import { ref, set, update, onValue, onDisconnect, push, query, orderByChild, limitToLast, runTransaction }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, renderer, scene, camera, serverNow, BASE_FOV } from '../core.js';
import { sfx } from '../sounds.js';

// ---------- The shape of a machine and how a ball moves on it (meters and seconds) ----------
// u runs across the lane (right is plus), v runs down it from your end, y is up.
// Every screen runs these same steps from the same start, so everyone sees the same ball end up in the same hole.
const W = 1.2, HALF = W / 2, R = 0.03;                   // lane width, and a ball's radius
const Y0 = 0.80, SLOPE = 0.12, L = 2.2;                  // how high the lane starts, how much it climbs a meter, how long it is
const HU = 0.30, KICK = 0.75;                            // the hump: how long, and how steep it is at the lip (the launch)
const HUMP_TOP = Y0 + SLOPE * L + HU * (SLOPE + (KICK - SLOPE) / 2);
const B0 = L + HU + 0.24, BL = 1.75, B1 = B0 + BL, TILT = 0.55;    // the target board: where it starts, how long, how steep
const YB = HUMP_TOP - 0.06, TROUGH = HUMP_TOP - 0.34;    // its bottom edge, and the gutter in front of it
const LIP = 0.045, OPEN = 0.3;                           // how tall the ring lips stand; each ring is a cup, open across its top
// The board: the ring cluster in the middle (10 to 50, outside in), a big circle in each lower corner (75) and a small
// one in each upper corner (100). Each ring is [across, down the machine, radius]; each hole [across, down, radius, points].
// The cluster slides to a new spot after every ball; the corner circles stay put.
const SC = 1.35;                                         // the board's layout, drawn at one size and scaled up to fill it
const CLUSTER = [[0, 0.55, 0.27], [0, 0.595, 0.20], [0, 0.64, 0.135], [0, 0.675, 0.09], [0, 0.705, 0.045]].map(a => a.map(x => x * SC));
const CLUSTER_HOLES = [[0, 0.3375, 0.052, 10], [0, 0.45, 0.048, 20], [0, 0.55, 0.043, 30], [0, 0.6225, 0.036, 40], [0, 0.705, 0.036, 50]]
  .map(([u, v, r, p]) => [u * SC, v * SC, r * SC, p]);
const CORNERS = [[-0.31, 0.27, 0.062], [0.31, 0.27, 0.062], [-0.30, 1.15, 0.07], [0.30, 1.15, 0.07]].map(a => a.map(x => x * SC));
const CORNER_HOLES = [[-0.31, 0.24, 0.034, 75], [0.31, 0.24, 0.034, 75], [-0.30, 1.12, 0.037, 100], [0.30, 1.12, 0.037, 100]]
  .map(([u, v, r, p]) => [u * SC, v * SC, r * SC, p]);
function layoutFor(g, n) {                               // where the cluster sits for ball n of game g (the same on every screen)
  let s = (Math.floor(g / 1000) ^ (n * 2654435761)) >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const du = n === 0 ? 0 : (rnd() * 2 - 1) * 0.09, ds = n === 0 ? 0 : (rnd() * 2 - 1) * 0.06;
  return {
    du, ds,
    rings: [...CLUSTER.map(([u, v, r]) => [u + du, B0 + v + ds, r, OPEN]), ...CORNERS.map(([u, v, r]) => [u, B0 + v, r, 9])],   // corner circles are closed all round
    holes: [...CLUSTER_HOLES.map(([u, v, r, p]) => [u + du, B0 + v + ds, r, p]), ...CORNER_HOLES.map(([u, v, r, p]) => [u, B0 + v, r, p])]
  };
}
const G_FLY = 9.8, G_ROLL = 7.0;                         // a rolling ball speeds up and slows down a bit slower than a falling one
function H(v) {                                          // how high the surface is, this far down the machine
  if (v < L) return Y0 + SLOPE * Math.max(v, -0.3);
  if (v < L + HU) { const x = (v - L) / HU; return Y0 + SLOPE * L + HU * (SLOPE * x + (KICK - SLOPE) * x * x / 2); }
  if (v < B0) return TROUGH;
  return YB + (v - B0) * TILT;
}
function slopeAt(v) { if (v < L) return SLOPE; if (v < L + HU) return SLOPE + (KICK - SLOPE) * (v - L) / HU; if (v < B0) return 0; return TILT; }
const SP0 = 2.4, SP1 = 6.0;                              // the slowest roll, and how much faster a full pull goes (hard enough to slam the back)
function newBall(u, power, aim, spin, lay) {             // power 0..1, aim in radians (right is plus), spin -1..1, lay: the board's layout
  const sp = SP0 + power * SP1, v = 0.08, s = SLOPE;
  return { u, v, y: H(v) + R * Math.sqrt(1 + s * s), vu: sp * Math.sin(aim), vv: sp * Math.cos(aim), vy: sp * Math.cos(aim) * s,
           spin: spin * 1.6, on: true, t: 0, onT: 0, res: null, lay };
}
const STEP = 1 / 240;
function stepBall(b, hit) {                              // one tiny step of a ball's life; hit(kind, strength) for sounds
  const h = STEP, pu = b.u, pv = b.v;
  b.t += h;
  b.vy -= (b.on ? G_ROLL : G_FLY) * h;
  if (b.on && b.v < L + HU) { b.vu += b.spin * h; b.spin *= 1 - 0.25 * h; }   // spin: it hooks sideways as it rolls up the lane
  b.u += b.vu * h; b.v += b.vv * h; b.y += b.vy * h;
  // the walls: both sides, the back, the net over the board, the hump's back face and the board's front edge
  if (b.u > HALF - R) { b.u = HALF - R; if (b.vu > 0) { hit('wall', b.vu); b.vu *= -0.5; } }
  if (b.u < -HALF + R) { b.u = -HALF + R; if (b.vu < 0) { hit('wall', -b.vu); b.vu *= -0.5; } }
  if (b.v > B1 - R) { b.v = B1 - R; if (b.vv > 0) { hit('back', b.vv); b.vv *= -0.4; } }
  if (b.v > L && b.y > H(b.v) + 0.85) { b.y = H(b.v) + 0.85; if (b.vy > 0) b.vy *= -0.3; }
  if (pv + R <= B0 && b.v + R > B0 && b.y < YB) { b.v = B0 - R; if (b.vv > 0) { hit('wall', b.vv); b.vv *= -0.4; } }
  if (pv - R >= L + HU && b.v - R < L + HU && b.y < HUMP_TOP) { b.v = L + HU + R; if (b.vv < 0) { hit('wall', -b.vv); b.vv *= -0.4; } }
  // the surface under it
  const s = slopeAt(b.v), need = R * Math.sqrt(1 + s * s), hs = H(b.v);
  if (b.y < hs + need + 0.002) {
    if (b.y < hs + need) b.y = hs + need;
    const n = 1 / Math.sqrt(1 + s * s), nv = -s * n, ny = n;
    const vn = b.vv * nv + b.vy * ny;
    if (vn < 0) {
      const e = vn < -0.6 ? (b.v > B0 ? 0.2 : 0.32) : 0;   // the velvet board soaks up more of a bounce
      if (vn < -0.6) hit(b.v > B0 ? 'land' : 'thump', -vn);
      b.vv -= (1 + e) * vn * nv; b.vy -= (1 + e) * vn * ny;
    }
    b.on = true; b.onT += h;
    const k = Math.max(0, 1 - (b.v > B0 ? 0.9 : b.v > L + HU ? 2.5 : 0.16) * h);   // velvet drag: light on the lane, heavier on the board
    b.vu *= k; b.vv *= k; b.vy *= k;
  } else { b.on = false; b.onT = 0; }
  // the ring lips on the board: only a ball down low touches them (a flying one sails over)
  if (b.v > B0 - 0.05 && b.y - hs < need + LIP) {
    for (const [cu, c, r, open] of b.lay.rings) {
      const du = b.u - cu, dv = b.v - c, d = Math.hypot(du, dv);
      if (d < 1e-6 || Math.abs(d - r) >= R + 0.006 || dv > r * open) continue;   // (the open top lets a ball roll in from above)
      const side = Math.hypot(pu - cu, pv - c) >= r ? 1 : -1;   // the side it was on a moment ago
      const nu = du / d, nvv = dv / d, to = r + side * (R + 0.006);
      b.u = cu + nu * to; b.v = c + nvv * to;
      const vr = b.vu * nu + b.vv * nvv;
      if (vr * side < 0) { hit('rim', Math.abs(vr)); b.vu -= 1.45 * vr * nu; b.vv -= 1.45 * vr * nvv; }
      if (side > 0 && dv > 0) b.vu += (du >= 0 ? 1 : -1) * 0.6 * h;   // perched on top of a lip: it always tips off one way or the other
    }
  }
  // where it ends up: down a hole, in the gutter, or rolled back to you
  if (b.on && b.v > B0) {
    const sp = Math.hypot(b.vu, b.vv);
    for (const [hu, hv, hr, pts] of b.lay.holes)
      if (sp < 3 && Math.hypot(b.u - hu, b.v - hv) < hr - R * 0.3) { b.res = { pts, u: hu, v: hv }; return; }
  }
  if (b.on && b.v > L + HU && b.v < B0 && b.onT > 0.25) { b.res = { pts: 0, gutter: true }; return; }
  if (b.on && b.v < 0.5 && b.vv < 0) { b.res = { pts: 0, back: true }; return; }
  b.still = b.on && Math.hypot(b.vu, b.vv) < 0.05 ? (b.still || 0) + h : 0;
  if (b.t > 14 || b.still > 1) b.res = { pts: 0, gutter: true };   // stuck somewhere (it never should be): it's out
}

// ---------- Where the machines stand: side by side, their backs against the back wall ----------
const MACHINES = [6.15, 7.5];             // their middles, across the room
const BALLS = 20;
const VF = -0.25, VB = B1 + 0.06;         // the very front (the tray) and back of a machine
const FRONT_Z = -11 + VB + 0.02;          // the end you stand at (the back wall is at -11)
const BACK_H = 1.3;                       // how tall the backboard stands over the top of the board
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
const COL = { 10: '#ff3fa8', 20: '#b36bff', 30: '#29e6ff', 40: '#ffd36a', 50: '#ffffff', 75: '#ff8a3d', 100: '#9dff4a' };
const TILT_ROT = -Math.PI / 2 + Math.atan(TILT), STRETCH = Math.sqrt(1 + TILT * TILT);   // lying flat on the board

function loadTex(file, setup) {   // a promise that's done once the picture is on, or has failed
  return new Promise(done => {
    new THREE.TextureLoader().load(new URL(file, import.meta.url).href, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; setup(t); done(); },
      undefined, () => { console.warn(file + ' did not load'); done(); });
  });
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  return t;
}

// ---------- The materials ----------
const laneMat = new THREE.MeshPhysicalMaterial({ color: 0x5a2a9a, roughness: 0.9, sheen: 1, sheenRoughness: 0.4, sheenColor: 0xc8a0ff });
const boardMat = new THREE.MeshPhysicalMaterial({ color: 0x5a2a9a, roughness: 0.9, sheen: 1, sheenRoughness: 0.45, sheenColor: 0xc8a0ff });
const holoMat = new THREE.MeshStandardMaterial({ color: 0x4a3a8a, roughness: 0.35, metalness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 });
const coverMat = new THREE.MeshStandardMaterial({ color: 0x4a3a8a, roughness: 0.3, metalness: 0.4, emissive: 0xffffff, emissiveIntensity: 0 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x14062a, roughness: 0.95 });
const woodMat = new THREE.MeshPhysicalMaterial({ color: 0xb07a45, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.15 });
const orbMat = new THREE.MeshBasicMaterial({ color: 0x8a6bff, transparent: true, toneMapped: false });
const trimMat = new THREE.MeshBasicMaterial({ color: 0xff3fa8, toneMapped: false });
const ringMat = {}, holeMat = {};
for (const [p, c] of Object.entries(COL)) {
  ringMat[p] = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, emissive: new THREE.Color(c), emissiveIntensity: 1.6 });
  holeMat[p] = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, map: canvasTex(256, 256, (x, w) => {
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);   // a deep dark well with its number glowing in it
    g.addColorStop(0, '#000000'); g.addColorStop(0.75, '#07010f'); g.addColorStop(0.92, '#2a0d4a'); g.addColorStop(1, 'rgba(42,13,74,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.font = `bold ${p === '100' ? 92 : 110}px "Trebuchet MS", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = c; x.shadowBlur = 26; x.fillStyle = c; x.fillText(p, 128, 136);
    x.shadowBlur = 6; x.fillStyle = '#ffffff'; x.globalAlpha = 0.7; x.fillText(p, 128, 136);
  }) });
}
const glowTex = canvasTex(128, 128, x => {   // a soft round glow, for behind the orb
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
});

const loaded = Promise.all([
  loadTex('lane.jpg', t => {   // the stitched velvet: one copy is a lane's width, repeating down its length (and up the board)
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    for (const m of [laneMat, boardMat]) { m.map = t; m.color.setHex(0xffffff); m.needsUpdate = true; }
  }),
  loadTex('holo.jpg', t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.4, 1.4);
    holoMat.map = t; holoMat.emissiveMap = t; holoMat.color.setHex(0xffffff); holoMat.emissiveIntensity = 0.55; holoMat.needsUpdate = true;
    const c = t.clone(); c.needsUpdate = true; c.repeat.set(3, 0.3);   // the tray covers: a strip of the same Tetris holo
    coverMat.map = c; coverMat.emissiveMap = c; coverMat.color.setHex(0xffffff); coverMat.emissiveIntensity = 0.7; coverMat.needsUpdate = true;
  }),
  loadTex('skeeorb.png', t => { orbMat.map = t; orbMat.color.setHex(0xffffff); orbMat.needsUpdate = true; }),
  loadTex('wood.jpg', t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    woodMat.map = t; woodMat.color.setHex(0xffffff); woodMat.needsUpdate = true;
  })
]);

// ---------- Building one machine ----------
function surface(v0, v1, n, mat) {   // the lane, the hump or the board: a sheet following the height H(v)
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const v = v0 + (v1 - v0) * i / n;
    for (let j = 0; j <= 1; j++) { const u = (j - 0.5) * W; pos.push(u, H(v), -v); uv.push(j, v / W); }
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
function topEdge(v) {   // how high the side walls come up: tall along the lane, rising to a taller cage round the board
  if (v < L) return H(Math.max(v, 0)) + 0.3;
  if (v < B0) return H(L) + 0.3 + (YB + 1.0 - H(L) - 0.3) * (v - L) / (B0 - L);
  if (v <= B1) return H(v) + 1.0;
  return H(B1) + BACK_H;
}
function sidePanel() {
  const sh = new THREE.Shape();
  sh.moveTo(VF, 0); sh.lineTo(VB, 0);
  for (let i = 60; i >= 0; i--) { const v = VF + (VB - VF) * i / 60; sh.lineTo(v, topEdge(Math.min(v, B1))); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 4 });
  const m = new THREE.Mesh(g, holoMat);
  m.rotation.y = Math.PI / 2;   // the shape's x runs down the machine, and it's 4cm thick across
  return m;
}
function tube(points, radius, mat, closed) {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), points.length * 2, radius, 8, closed), mat);
}
function ringMesh(u, v, r, open, mat) {   // a ring lip lying on the board; a cluster cup is open across its top
  const pts = [], a0 = open < 1 ? Math.asin(open) : 0, span = open < 1 ? Math.PI + 2 * a0 : Math.PI * 2;
  const n = 64;
  for (let k = 0; k <= n; k++) {
    if (open >= 1 && k === n) break;
    const a = (open < 1 ? Math.PI - a0 : 0) + span * k / n;   // round the bottom, from one side of the open top to the other
    const ru = u + r * Math.cos(a), rv = v + r * Math.sin(a);
    pts.push(new THREE.Vector3(ru, H(rv) + LIP * 0.45, -rv));
  }
  return tube(pts, LIP * 0.5, mat, open >= 1);
}
function holeMesh(u, v, r, pts) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r * 1.05, 40), holeMat[pts]);
  m.position.set(u, H(v) + 0.003, -v);
  m.rotation.x = TILT_ROT; m.scale.y = STRETCH;
  return m;
}
const TRAY_ROWS = [-0.08, -0.18], ROW = BALLS / 2;   // two rows of ten in the tray
const trayFloor = () => H(-0.02) - 0.07;
const trayU = k => (k - (ROW - 1) / 2) * (W - 0.12) / (ROW - 1);
function buildMachine(i) {
  const g = new THREE.Group();
  g.position.set(MACHINES[i], 0, FRONT_Z);
  scene.add(g);
  // the lane, its hump, the gutter in front of the board and the drops into it
  g.add(surface(-0.02, L, 60, laneMat), surface(L, L + HU, 24, laneMat));
  const gut = new THREE.Mesh(new THREE.PlaneGeometry(W, B0 - L - HU), darkMat);
  gut.rotation.x = -Math.PI / 2; gut.position.set(0, TROUGH, -(L + HU + B0) / 2); g.add(gut);
  for (const [v, top] of [[L + HU, HUMP_TOP], [B0, YB]]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(W, top - TROUGH), darkMat);
    f.position.set(0, (top + TROUGH) / 2, -v); f.rotation.y = v === B0 ? 0 : Math.PI; g.add(f);
  }
  // the target board: the corner circles stay put; the cluster of cups is its own group, so it can slide
  g.add(surface(B0, B1, 12, boardMat));
  CORNERS.forEach(([u, v, r], k) => g.add(ringMesh(u, B0 + v, r, 9, ringMat[CORNER_HOLES[k][3]])));
  CORNER_HOLES.forEach(([u, v, r, p]) => g.add(holeMesh(u, B0 + v, r, p)));
  const cluster = new THREE.Group(); g.add(cluster);
  CLUSTER.forEach(([u, v, r], k) => cluster.add(ringMesh(u, B0 + v, r, OPEN, ringMat[CLUSTER_HOLES[k][3]])));
  CLUSTER_HOLES.forEach(([u, v, r, p]) => cluster.add(holeMesh(u, B0 + v, r, p)));
  // the cabinet: tall holo side walls, the backboard, the front under the tray, the tray and its two sliding covers
  const right = sidePanel(); right.position.x = HALF; g.add(right);
  const left = sidePanel(); left.position.x = -HALF - 0.04; g.add(left);
  const backH = topEdge(VB);
  const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, backH, 0.06), holoMat);
  back.position.set(0, backH / 2, -(B1 + 0.03)); g.add(back);
  const under = new THREE.Mesh(new THREE.BoxGeometry(W, trayFloor() - 0.015, 0.03), holoMat);
  under.position.set(0, (trayFloor() - 0.015) / 2, -VF - 0.015); g.add(under);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(W, 0.03, -VF), darkMat);
  tray.position.set(0, trayFloor() - 0.015, -VF / 2); g.add(tray);
  const lipF = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, 0.05, 0.03), trimMat);
  lipF.position.set(0, trayFloor() + 0.02, -VF); g.add(lipF);
  const covers = [];   // one cover over each row: each half slides away into its side wall
  for (const v of TRAY_ROWS) for (const side of [-1, 1]) {
    const geo = new THREE.BoxGeometry(HALF, 0.014, 0.095); geo.translate(-side * HALF / 2, 0, 0);   // anchored at the wall
    const c = new THREE.Mesh(geo, coverMat);
    c.position.set(side * HALF, trayFloor() + 2 * R + 0.012, -v);
    g.add(c); covers.push(c);
  }
  // neon along the tops of the side walls
  for (const x of [HALF + 0.02, -HALF - 0.02]) {
    const pts = [];
    for (let k = 0; k <= 60; k++) { const v = VF + (VB - VF) * k / 60; pts.push(new THREE.Vector3(x, topEdge(Math.min(v, B1)) + 0.012, -v)); }
    g.add(tube(pts, 0.011, trimMat, false));
  }
  // your orb, set in the backboard above the rings, slowly turning, with a glow round it and a neon rim
  const ORB_R = 0.3, ORB_Y = H(B1) + 0.4, ORB_Z = -(B1 - 0.004);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(ORB_R * 4, ORB_R * 4), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x9a6bff,
    transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.position.set(0, ORB_Y, ORB_Z - 0.002); g.add(glow);
  const orb = new THREE.Mesh(new THREE.CircleGeometry(ORB_R, 64), orbMat);
  orb.position.set(0, ORB_Y, ORB_Z); g.add(orb);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(ORB_R + 0.008, 0.016, 10, 72), trimMat);
  rim.position.copy(orb.position); g.add(rim);
  const orbLight = new THREE.PointLight(0x9a6bff, 1.5, 3, 1.6); orbLight.position.set(0, ORB_Y, ORB_Z + 0.4); g.add(orbLight);
  // light over the board, so the rings and the balls shine
  const boardLight = new THREE.PointLight(0x9fe8ff, 4, 4, 1.5); boardLight.position.set(0, YB + 1.2, -(B0 + 0.7)); g.add(boardLight);
  // the sign at the top of the backboard: SKEE·BALL, the score and the balls left
  const sc = document.createElement('canvas'); sc.width = 1024; sc.height = 420;
  const sTex = new THREE.CanvasTexture(sc); sTex.colorSpace = THREE.SRGBColorSpace; sTex.anisotropy = MAX_ANISO;
  const SIGN_H = W * 420 / 1024;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(W, SIGN_H), new THREE.MeshBasicMaterial({ map: sTex, toneMapped: false }));
  sign.position.set(0, backH - 0.03 - SIGN_H / 2, ORB_Z); g.add(sign);
  g.traverse(o => { if (o.isMesh) o.userData.skee = i; });   // clicking any part of it means "play this one"
  // the balls
  const balls = [];
  for (let k = 0; k < BALLS; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), woodMat);
    b.visible = false; b.userData.skee = i; g.add(b); balls.push(b);
  }
  return { i, g, cluster, covers, orb, glow, orbLight, sc, sTex, balls,
           data: null, tray: 0, live: [], seen: null, signKey: '', score: 0, cov: 0, lay: null, slide: null };
}

// ---------- The best scores, up on the back wall over the machines ----------
const hc = document.createElement('canvas'); hc.width = 1024; hc.height = 640;
const hTex = new THREE.CanvasTexture(hc); hTex.colorSpace = THREE.SRGBColorSpace; hTex.anisotropy = MAX_ANISO;
const hiBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ map: hTex, toneMapped: false }));
hiBoard.position.set((MACHINES[0] + MACHINES[1]) / 2, 4.15, -10.94);
scene.add(hiBoard);
function neonText(x, text, px, py, size, col, align = 'center', font = '"Trebuchet MS", sans-serif') {
  x.save();
  x.font = `bold ${size}px ${font}`; x.textAlign = align; x.textBaseline = 'middle';
  x.shadowColor = col; x.shadowBlur = size * 0.45; x.fillStyle = col; x.fillText(text, px, py);
  x.shadowBlur = size * 0.12; x.fillStyle = '#ffffff'; x.globalAlpha = 0.85; x.fillText(text, px, py);
  x.restore();
}
function frame(x, w, h, col) {   // a dark panel with a double neon border
  x.fillStyle = '#07030f'; x.fillRect(0, 0, w, h);
  x.save(); x.strokeStyle = col; x.shadowColor = col; x.shadowBlur = 18;
  x.lineWidth = 6; x.strokeRect(14, 14, w - 28, h - 28); x.lineWidth = 2; x.strokeRect(30, 30, w - 60, h - 60); x.restore();
}
let best = [];
function paintBest() {
  const x = hc.getContext('2d');
  frame(x, 1024, 640, '#29e6ff');
  neonText(x, 'SKEE·BALL HIGH SCORES', 512, 90, 60, '#ff3fa8');
  if (!best.length) neonText(x, 'nobody yet · be the first', 512, 340, 44, '#b36bff');
  best.forEach((b, k) => {
    const y = 170 + k * 58, col = k === 0 ? '#ffd36a' : k < 3 ? '#29e6ff' : '#cdb8ff';
    neonText(x, String(k + 1), 110, y, 42, col, 'center');
    neonText(x, b.name, 170, y, 42, col, 'left');
    neonText(x, String(b.score), 900, y, 46, col, 'right', '"Courier New", monospace');
  });
  hTex.needsUpdate = true;
}
paintBest();
onValue(query(ref(db, 'game/skee/best'), orderByChild('score'), limitToLast(8)), s => {
  const list = [];
  s.forEach(c => { const v = c.val(); if (v && typeof v.score === 'number' && typeof v.name === 'string') list.push(v); });
  best = list.sort((a, b) => b.score - a.score || a.t - b.t);
  paintBest();
}, () => {});

// ---------- A machine's sign ----------
function stale(d) { return !d || d.done || serverNow() - (d.t || 0) > 120000; }   // nobody's playing it (or they vanished)
function paintSign(m, blink) {
  const d = m.data, free = stale(d), over = d && d.done && serverNow() - d.t < 8000;
  const key = [free, over, d && d.name, d && d.score, d && d.left, blink, best[0] && best[0].score].join('|');
  if (key === m.signKey) return;
  m.signKey = key;
  const x = m.sc.getContext('2d');
  frame(x, 1024, 420, '#b36bff');
  neonText(x, 'SKEE·BALL', 512, 95, 92, '#ff3fa8');
  if (over) {
    neonText(x, blink ? 'GAME OVER' : '', 300, 230, 56, '#ffd36a');
    neonText(x, String(d.score), 740, 250, 130, '#29e6ff', 'center', '"Courier New", monospace');
    neonText(x, d.name, 300, 320, 44, '#cdb8ff');
  } else if (free) {
    neonText(x, blink ? 'PLAY ME' : '', 512, 235, 100, '#29e6ff');
    const bits = [d && d.name ? `last: ${d.name} ${d.score}` : '', best[0] ? `best: ${best[0].score}` : ''].filter(Boolean).join('   ·   ');
    if (bits) neonText(x, bits, 512, 340, 40, '#ffd36a');
  } else {
    neonText(x, d.name, 290, 215, 48, '#cdb8ff');
    neonText(x, `balls ${d.left}`, 290, 300, 52, '#ffd36a');
    neonText(x, String(d.score).padStart(4, '0'), 730, 255, 150, '#29e6ff', 'center', '"Courier New", monospace');
  }
  m.sTex.needsUpdate = true;
}

// ---------- The board's cluster sliding to its new spot ----------
function showLayout(m, g, n, slide) {   // the cluster where ball n of game g will find it
  const lay = layoutFor(g, n);
  if (slide && m.lay) m.slide = { from: { du: m.lay.du, ds: m.lay.ds }, t: 0 };
  else { m.slide = null; placeCluster(m, lay.du, lay.ds); }
  m.lay = lay;
  if (slide) sfx.skeePour(4, near(m) * 0.6);
}
function placeCluster(m, du, ds) { m.cluster.position.set(du, ds * TILT, -ds); }

// ---------- The balls: waiting in the tray, rolling, sinking ----------
function busySet(m) { return new Set([...m.live.map(l => l.mesh), m.hand && m.hand.mesh].filter(Boolean)); }
function placeTray(m) {   // the balls waiting in the tray, the row nearest you first; the rest are hidden (or busy)
  let k = 0;
  const busy = busySet(m);
  for (const b of m.balls) {
    if (busy.has(b)) continue;
    if (k < m.tray) {
      b.visible = true; b.scale.setScalar(1);
      b.position.set(trayU(k % ROW), trayFloor() + R, -TRAY_ROWS[k < ROW ? 1 : 0]);
      k++;
    } else b.visible = false;
  }
}
function freeBall(m) { const busy = busySet(m); return m.balls.find(b => !busy.has(b) && b.visible) || m.balls.find(b => !busy.has(b)); }
function near(m) {   // how loud this machine should be where you are
  const d = camera.position.distanceTo(m.g.position) + 0.5;
  return Math.min(1, 3 / d);
}
function launch(m, roll) {   // a ball leaves the tray and rolls (yours or anyone's: the same on every screen)
  let mesh = m.hand && m.hand.mesh;
  if (mesh) m.hand = null;                // yours: it's already out of the tray, in your hand
  else { mesh = freeBall(m); if (m.tray > 0) m.tray--; }
  if (!mesh) return null;
  if (!m.lay || m.layN !== roll.n) { showLayout(m, roll.g, roll.n, false); m.layN = roll.n; }
  const l = { mesh, n: roll.n, g: roll.g, b: newBall(roll.u, roll.p, roll.a, roll.s, m.lay), acc: 0, sink: 0, sounds: {} };
  m.live.push(l);
  mesh.visible = true; mesh.scale.setScalar(1);
  sfx.skeeRelease(near(m));
  placeTray(m);
  return l;
}
const ax = new THREE.Vector3(), q = new THREE.Quaternion();
function updateLive(m, dt) {
  let fastest = 0;
  for (const l of m.live) {
    if (l.b.res) {   // dropping into its hole, or out of sight into the gutter
      l.sink += dt;
      if (l.b.res.pts && l.sink < 0.35) l.mesh.position.y -= dt * 0.35;
      l.mesh.scale.setScalar(Math.max(0, 1 - l.sink * 2.5));
      if (l.sink > 0.4 && !l.gone) {
        l.mesh.visible = false; l.gone = true;
        if (l.n + 1 < BALLS && m.data && m.data.g === l.g) { showLayout(m, l.g, l.n + 1, true); m.layN = l.n + 1; }   // the cluster moves on
      }
      continue;
    }
    const k = near(m), last = l.sounds;
    l.acc += dt;
    const pu = l.b.u, pv = l.b.v;
    while (l.acc >= STEP && !l.b.res) {
      l.acc -= STEP;
      stepBall(l.b, (kind, s) => {   // sounds, a few a second at most each kind
        const now = performance.now();
        if (now - (last[kind] || 0) < 45) return;
        last[kind] = now;
        if (kind === 'rim') sfx.skeeRim(Math.min(1, s / 1.5) * k);
        else if (kind === 'land' || kind === 'thump') sfx.skeeThump(Math.min(1, s / 2.5) * k);
        else sfx.skeeWall(Math.min(1, s / 2.5) * k);
      });
    }
    const b = l.b;
    l.mesh.position.set(b.u, b.y, -b.v);
    const du = b.u - pu, dv = b.v - pv, dist = Math.hypot(du, dv);   // turn the ball the way it rolled
    if (dist > 1e-6) { ax.set(-dv, 0, -du).normalize(); q.setFromAxisAngle(ax, dist / R); l.mesh.quaternion.premultiply(q); }
    if (b.on && b.v < B0) fastest = Math.max(fastest, Math.hypot(b.vu, b.vv) / 6);
    if (b.res) {
      if (b.res.pts) { l.mesh.position.set(b.res.u, H(b.res.v) + R * 0.6, -b.res.v); sfx.skeeDrop(b.res.pts, k); m.flash = 1; }   // the orb flares
      else sfx.skeeGutter(k);
      if (l.mine) mineDone(m, b.res.pts);
    }
  }
  m.live = m.live.filter(l => !(l.gone && l.sink > 0.4));
  return fastest * near(m);
}

// ---------- Playing: walking up to a machine and taking your turns ----------
let my = null;             // the machine you're playing, or null
let opts = {};
let view = null;           // the camera gliding to (or sitting at) the playing spot
const ui = document.createElement('div');
ui.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:25;display:none;gap:10px;align-items:center;' +
  'padding:8px 12px;border-radius:14px;background:rgba(10,4,24,0.72);border:1px solid rgba(179,107,255,0.6);color:#efe6ff;' +
  'font:14px "Trebuchet MS",sans-serif;box-shadow:0 0 16px rgba(179,107,255,0.4)';
const uiText = document.createElement('span');
const againBtn = document.createElement('button'); againBtn.textContent = '🎳 Play again';
const quitBtn = document.createElement('button'); quitBtn.textContent = '✕ Done';
for (const b of [againBtn, quitBtn]) b.style.cssText = 'font:bold 14px "Trebuchet MS",sans-serif;padding:7px 12px;border-radius:10px;cursor:pointer;' +
  'background:rgba(255,63,168,0.25);color:#fff;border:1px solid rgba(255,63,168,0.8)';
ui.append(uiText, againBtn, quitBtn);
document.body.appendChild(ui);
againBtn.addEventListener('click', () => { if (my) claim(my); });
quitBtn.addEventListener('click', () => leave());
window.addEventListener('keydown', e => { if (e.key === 'Escape' && my) leave(); });
function mine(m) { const d = m && m.data; return !!(d && d.id === myId && !d.done); }
function rolling(m) { return m.live.some(l => !l.gone) || (m.slide && m.slide.t < 1); }
function showUi(live) {
  if (!my) { ui.style.display = 'none'; return; }
  ui.style.display = 'flex';
  const d = my.data;
  againBtn.style.display = mine(my) ? 'none' : '';
  if (live) uiText.textContent = live;
  else if (!mine(my)) uiText.textContent = d && d.id === myId && d.done ? `Game over: ${d.score}` : 'Ready';
  else if (my.hand) uiText.textContent = { place: 'Click the lane where you want your ball', spin: 'Click to stop the spin bar',
                                            power: 'Click to stop the power' }[my.hand.stage];
  else uiText.textContent = rolling(my) ? 'Rolling…' : my.tray ? 'Get ready…' : 'Last ball rolling…';
}

// ---------- The three clicks of a roll: where the ball goes, its spin (a timing bar), its power (a tachometer) ----------
// Each one is stopped with a click: the spin bar slides slowly back and forth (the middle is straight, the ends curl
// hard), and the tachometer's twenty segments fill up and drop back again; wherever they are when you click is what you get.
const gauge = document.createElement('canvas');
gauge.width = 440; gauge.height = 250;
gauge.style.cssText = 'position:fixed;left:50%;bottom:76px;transform:translateX(-50%);width:330px;height:188px;z-index:25;display:none;pointer-events:none';
document.body.appendChild(gauge);
const SPIN_TIME = 3.2, POWER_TIME = 2.4, SEGS = 20;   // seconds for the spin bar to go across and back, and the tach to fill and fall
function drawGauge(h) {
  const x = gauge.getContext('2d'), W2 = gauge.width;
  x.clearRect(0, 0, W2, gauge.height);
  if (!h || h.stage === 'place') { gauge.style.display = 'none'; return; }
  gauge.style.display = 'block';
  // the spin bar, across the top
  const bx = 40, bw = W2 - 80, by = 14, bh = 30;
  x.fillStyle = 'rgba(10,4,24,0.8)'; x.fillRect(bx - 8, by - 6, bw + 16, bh + 12);
  const g = x.createLinearGradient(bx, 0, bx + bw, 0);
  g.addColorStop(0, '#29e6ff'); g.addColorStop(0.45, '#2a1a40'); g.addColorStop(0.55, '#2a1a40'); g.addColorStop(1, '#ff3fa8');
  x.fillStyle = g; x.fillRect(bx, by, bw, bh);
  x.fillStyle = '#ffffff'; x.fillRect(bx + bw / 2 - 1, by - 4, 2, bh + 8);
  x.font = 'bold 22px "Trebuchet MS", sans-serif'; x.textBaseline = 'middle'; x.textAlign = 'center';
  x.fillStyle = '#29e6ff'; x.fillText('↺', bx - 22, by + bh / 2); x.fillStyle = '#ff3fa8'; x.fillText('↻', bx + bw + 22, by + bh / 2);
  const sx = bx + (h.spin + 1) / 2 * bw;
  x.save(); x.shadowColor = '#ffd36a'; x.shadowBlur = 14; x.fillStyle = h.stage === 'spin' ? '#ffd36a' : '#fff4d8';
  x.beginPath(); x.moveTo(sx, by - 8); x.lineTo(sx + 9, by - 18); x.lineTo(sx - 9, by - 18); x.fill();
  x.fillRect(sx - 3, by - 4, 6, bh + 8); x.restore();
  // the tachometer: twenty segments round a half circle, green through gold to red, and a needle
  const cx = W2 / 2, cy = 236, r0 = 110, r1 = 168;
  x.fillStyle = 'rgba(10,4,24,0.8)'; x.beginPath(); x.arc(cx, cy, r1 + 12, Math.PI, 0); x.fill();
  const lit = h.stage === 'spin' ? 0 : h.seg;
  for (let k = 0; k < SEGS; k++) {
    const a0 = Math.PI + k / SEGS * Math.PI + 0.012, a1 = Math.PI + (k + 1) / SEGS * Math.PI - 0.012;
    const hue = 120 - k / (SEGS - 1) * 120, on = k < lit;
    x.fillStyle = on ? `hsl(${hue},100%,55%)` : `hsla(${hue},60%,30%,0.45)`;
    x.save(); if (on) { x.shadowColor = x.fillStyle; x.shadowBlur = 12; }
    x.beginPath(); x.arc(cx, cy, r1, a0, a1); x.arc(cx, cy, r0, a1, a0, true); x.closePath(); x.fill(); x.restore();
  }
  const na = Math.PI + (lit / SEGS) * Math.PI;
  x.strokeStyle = '#ffffff'; x.lineWidth = 4; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(na) * (r1 + 6), cy + Math.sin(na) * (r1 + 6)); x.stroke();
  x.fillStyle = '#ffffff'; x.beginPath(); x.arc(cx, cy, 9, 0, Math.PI * 2); x.fill();
  if (h.stage === 'power') {
    x.font = 'bold 54px "Courier New", monospace'; x.fillStyle = '#ffffff'; x.save(); x.shadowColor = '#ff3fa8'; x.shadowBlur = 16;
    x.fillText(String(lit), cx, cy - 52); x.restore();
  }
}
function stepGauge(h, dt) {   // the spin bar sliding, or the tach filling and falling
  if (!h) return;
  h.t += dt;
  if (h.stage === 'spin') h.spin = Math.sin(h.t / SPIN_TIME * Math.PI * 2);
  else if (h.stage === 'power') {
    const k = (h.t % POWER_TIME) / POWER_TIME, level = k < 0.5 ? k * 2 : 2 - k * 2;
    h.seg = Math.max(1, Math.ceil(level * SEGS));
    const v = 0.08 - h.seg / SEGS * 0.2;   // the ball draws back as the power builds
    h.mesh.position.set(h.u, Math.max(H(v), trayFloor()) + R, -v);
  }
}

function laneX(m, u) {   // where a spot across the front of the lane is on the screen (in pixels)
  const p = new THREE.Vector3(u, H(0.1), -0.1).applyMatrix4(m.g.matrixWorld).project(camera);
  return (p.x + 1) / 2 * window.innerWidth;
}
function uFromScreen(m, px) {
  const a = laneX(m, -HALF), b = laneX(m, HALF);
  return Math.max(-HALF + R + 0.01, Math.min(HALF - R - 0.01, -HALF + (px - a) / (b - a) * W));
}
function setBall(m, u) {   // your ball sitting at the front of the lane
  const h = m.hand;
  h.u = u;
  h.mesh.visible = true;
  h.mesh.position.set(u, H(0.08) + R, -0.08);
}
function readyBall(m) {   // your turn and nothing rolling: the next ball comes up out of the tray, ready to place
  if (m.hand || m.tray <= 0 || rolling(m) || !mine(m) || (view && view.t < 1)) return;
  const mesh = freeBall(m);
  if (!mesh) return;
  m.hand = { mesh, stage: 'place', t: 0, spin: 0, seg: 1, u: 0 };
  m.tray--; placeTray(m);
  setBall(m, 0);
  showUi();
}
function down(e) {   // each click moves the roll on a step
  const h = my && my.hand;
  if (!h || !mine(my)) return;
  if (h.stage === 'place') { setBall(my, uFromScreen(my, e.clientX)); h.stage = 'spin'; h.t = 0; sfx.skeeThump(0.5); }
  else if (h.stage === 'spin') { h.stage = 'power'; h.t = 0; sfx.skeeRim(0.8); }
  else if (h.stage === 'power') { roll(my, h); return; }
  showUi();
}
function move(e) {   // before you click, the ball follows the pointer across the lane
  const h = my && my.hand;
  if (h && h.stage === 'place' && e.pointerType !== 'touch') setBall(my, uFromScreen(my, e.clientX));
}
function up() {}
function roll(m, h) {
  const d = m.data, n = BALLS - d.left;
  // everyone uses exactly the numbers that are sent, so their ball rolls the same as yours
  const r = { n, g: d.g, by: myId, u: +h.u.toFixed(4), p: +(h.seg / SEGS).toFixed(4), a: 0, s: +h.spin.toFixed(4), t: Date.now() };
  const l = launch(m, r);
  if (!l) return;
  l.mine = true;
  m.myLeft = d.left - 1;
  m.rolling = (m.rolling || 0) + 1;
  update(ref(db, 'game/skee/m' + m.i), { left: m.myLeft, t: serverNow() }).catch(() => {});
  set(ref(db, 'game/skee/r' + m.i), r).catch(() => {});
  m.seen = d.g + ':' + n;
  drawGauge(null);
  showUi();
}
function mineDone(m, pts) {   // one of your balls finished: add up the score, and end the game after the last one
  m.score += pts;
  m.rolling--;
  const d = m.data;
  if (!d || d.id !== myId) return;
  const fields = { score: m.score, t: serverNow() };
  const over = m.myLeft <= 0 && m.rolling <= 0;
  if (over) fields.done = true;
  update(ref(db, 'game/skee/m' + m.i), fields).catch(() => {});
  if (pts >= 75) opts.banner && opts.banner(pts === 100 ? '💯 100!' : '🔥 75!', 2);
  if (over) {
    onDisconnect(ref(db, 'game/skee/m' + m.i)).cancel();
    if (m.score > 0) push(ref(db, 'game/skee/best'), { name: S.myName, score: m.score, t: Date.now() }).catch(() => {});
    const place = best.filter(b => b.score >= m.score).length;
    sfx.skeeOver(m.score >= (best[0] ? best[0].score : 1));
    opts.banner && opts.banner(place < 8 && m.score > 0 ? `🏆 ${m.score}! That's on the high score board` : `Game over: ${m.score}`, 4);
  }
  setTimeout(() => { if (my === m) showUi(); }, 700);
}
function claim(m) {   // start a game on this machine (if nobody else is playing it)
  if (!S.myName) return;
  const r = ref(db, 'game/skee/m' + m.i);
  runTransaction(r, cur => {
    if (cur && cur.id && cur.id !== myId && !stale(cur)) return;   // someone's playing: leave it alone
    return { id: myId, name: S.myName, score: 0, left: BALLS, g: Date.now(), t: serverNow() };
  }).then(res => {
    if (!res.committed) { opts.banner && opts.banner(`${(res.snapshot.val() || {}).name || 'Someone'} is playing that one`, 3); return; }
    m.score = 0; m.rolling = 0; m.myLeft = BALLS;
    onDisconnect(r).update({ done: true });
    if (my !== m) enter(m);
    showUi();
  }).catch(() => opts.banner && opts.banner('Could not start a game (check the database rules)', 4));
}
const PLAY_EYE = new THREE.Vector3(0, 1.9, 1.5), PLAY_LOOK = new THREE.Vector3(0, 0.95, -2.6), PLAY_FOV = 50;   // standing just back from the tray
function enter(m) {
  my = m;
  m.g.updateMatrixWorld();
  const to = m.g.localToWorld(PLAY_EYE.clone()), look = m.g.localToWorld(PLAY_LOOK.clone());
  const toQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(to, look, new THREE.Vector3(0, 1, 0)));
  view = { t: 0, fromP: camera.position.clone(), fromQ: camera.quaternion.clone(), to, toQ, fromF: camera.fov };
  opts.enter && opts.enter(to.x, to.z);
  showUi();
}
function leave() {
  if (!my) return;
  const m = my, d = m.data;
  if (m.hand) { m.hand = null; m.tray++; placeTray(m); drawGauge(null); }
  if (d && d.id === myId && !d.done) {   // walked away mid-game: the machine is free again (that game doesn't count)
    update(ref(db, 'game/skee/m' + m.i), { done: true, t: serverNow() }).catch(() => {});
    onDisconnect(ref(db, 'game/skee/m' + m.i)).cancel();
  }
  my = null; view = null;
  camera.fov = BASE_FOV; camera.updateProjectionMatrix();
  showUi();
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  opts.leave && opts.leave(camera.position.x, camera.position.z, e.y, e.x);
}

// ---------- Everyone's machines, kept in step with the database ----------
const machines = MACHINES.map((_, i) => buildMachine(i));
machines.forEach(m => {
  showLayout(m, 0, 0, false);
  onValue(ref(db, 'game/skee/m' + m.i), s => {
    const d = s.val(), was = m.data;
    m.data = d && typeof d === 'object' ? d : null;
    const playing = m.data && !stale(m.data);
    if (playing && (!was || was.g !== m.data.g)) {   // a new game: a full tray, and the covers slide open
      for (const l of m.live) l.mesh.visible = false;
      m.live = []; m.hand = null;
      m.tray = m.data.left;
      const n = BALLS - m.data.left;
      showLayout(m, m.data.g, n, false); m.layN = n;
      m.seen = m.data.g + ':' + (n - 1);
      if (m.data.left === BALLS) sfx.skeePour(0, near(m));
    }
    if (!playing && !m.live.length && !m.hand) m.tray = BALLS;   // between games the tray sits full under its covers
    placeTray(m);
    if (my === m) showUi();
  }, () => {});
  let first = true;
  onValue(ref(db, 'game/skee/r' + m.i), s => {
    const r = s.val();
    if (first) { first = false; return; }   // an old roll from before you came in
    if (!r || r.by === myId || !m.data || r.g !== m.data.g) return;
    const key = r.g + ':' + r.n;
    if (key === m.seen) return;
    m.seen = key;
    const num = (x, lo, hi) => Math.max(lo, Math.min(hi, +x || 0));
    launch(m, { n: Math.round(num(r.n, 0, BALLS - 1)), g: r.g, u: num(r.u, -HALF + R, HALF - R), p: num(r.p, 0, 1), a: num(r.a, -0.16, 0.16), s: num(r.s, -1, 1) });
  }, () => {});
});

// ---------- Every frame ----------
let blinkT = 0;
function updateAll(dt) {
  blinkT += dt;
  const blink = Math.floor(blinkT * 1.6) % 2 === 0;
  let roll = 0;
  for (const m of machines) {
    roll = Math.max(roll, updateLive(m, dt));
    if (m.slide) {   // the cluster gliding to its next spot
      m.slide.t = Math.min(1, m.slide.t + dt / 0.7);
      const k = m.slide.t * m.slide.t * (3 - 2 * m.slide.t);
      placeCluster(m, m.slide.from.du + (m.lay.du - m.slide.from.du) * k, m.slide.from.ds + (m.lay.ds - m.slide.from.ds) * k);
      if (m.slide.t >= 1) { m.slide = null; if (my === m) showUi(); }
    }
    const open = m.data && !stale(m.data) ? 1 : 0;   // the tray covers: open while a game's on
    m.cov += (open - m.cov) * Math.min(1, dt * 4);
    for (const c of m.covers) c.scale.x = Math.max(0.02, 1 - m.cov);
    m.orb.rotation.z -= dt * 0.25;                       // the orb's galaxy slowly turns
    m.flash = Math.max(0, (m.flash || 0) - dt * 1.5);    // and flares when a ball drops
    m.glow.material.opacity = 0.45 + 0.1 * Math.sin(blinkT * 2 + m.i) + m.flash * 0.6;
    m.glow.scale.setScalar(1 + m.flash * 0.35);
    m.orbLight.intensity = 1.5 + m.flash * 6;
    paintSign(m, blink);
  }
  if (my) { readyBall(my); stepGauge(my.hand, dt); drawGauge(my.hand); }
  sfx.skeeRoll(roll);
  if (view) {   // glide up to the machine, then stay put
    view.t = Math.min(1, view.t + dt / 0.8);
    const k = view.t * view.t * (3 - 2 * view.t);
    camera.position.lerpVectors(view.fromP, view.to, k);
    camera.quaternion.slerpQuaternions(view.fromQ, view.toQ, k);
    camera.fov = view.fromF + (PLAY_FOV - view.fromF) * k; camera.updateProjectionMatrix();   // zoomed in a little on the board
  }
}

export function makeSkee(o) {
  opts = o || {};
  return {
    loaded,
    get playing() { return !!my; },
    update: updateAll,
    start(i) { const m = machines[i]; if (!m) return; if (my === m) return; claim(m); },
    down, move, up, leave
  };
}