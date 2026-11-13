// =====================================================================
// skeeball.js — two skee-ball machines side by side against the back wall of the Game Room, on the right.
// Holographic Tetris cabinets (holo.jpg), a wide purple velvet lane with fine gold stitching up its sides (lane.jpg),
// the balls (wood.jpg) waiting in slots down both sides of the lane under Tetris covers that slide open when a game
// starts, a hump that launches the ball onto a big target board, and your orb (skeeorb.png) set in the backboard,
// flaring whenever a ball drops. The board: rings in the middle (10 to 50), and round them 2 to 8 tiny rings (75 low,
// 100 high) that sink away and pop up in a new pattern after every ball. The back of every ring is a ramp, so a ball can
// roll in over the top but not back out.
// Click a machine to play. Each roll is three steps: aim (the arrow follows your mouse; swing it wide to whip it off the
// walls), stop the spin bar (a slow roll curls with it in slight slow motion; a hard one kicks off the walls with it),
// then set the power yourself on the tachometer and click to let it go. Everyone in the room sees every roll (each
// ball's path is worked out the same way on every screen), and the best scores go up on the board on the back wall.
// =====================================================================
import * as THREE from 'three';
import { ref, set, update, onValue, onDisconnect, push, query, orderByChild, limitToLast, runTransaction }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, renderer, scene, camera, serverNow, BASE_FOV } from '../core.js';
import { sfx } from '../sounds.js';

// ---------- The shape of a machine and how a ball moves on it (meters and seconds) ----------
// u runs across the lane (right is plus), v runs down it from your end, y is up.
// Every screen runs these same steps from the same start, so everyone sees the same ball end up in the same hole.
const W = 1.5, HALF = W / 2, R = 0.03;                   // lane width, and a ball's radius
const Y0 = 0.80, SLOPE = 0.12, L = 2.2;                  // how high the lane starts, how much it climbs a meter, how long it is
const HU = 0.30, KICK = 0.75;                            // the hump: how long, and how steep it is at the lip (the launch)
const HUMP_TOP = Y0 + SLOPE * L + HU * (SLOPE + (KICK - SLOPE) / 2);
const B0 = L + HU + 0.24, BL = 2.0, B1 = B0 + BL, TILT = 0.55;    // the target board: where it starts, how long, how steep
const YB = HUMP_TOP - 0.06, TROUGH = HUMP_TOP - 0.34;    // its bottom edge, and the gutter in front of it
const LIP = 0.045;                                       // how tall the ring lips stand
// The board: rings in the middle (10 on the outside to 50 in the little one at the top), and around them, 2 to 8 tiny
// rings that sink away and pop up somewhere new after every ball (75 below the middle, 100 above it).
// Each ring is [across, down the machine, radius]; each hole [across, down, radius, points].
const CC = 0.95, ORBIT = 0.56, TINY = 0.062, TINY_HOLE = 0.036;   // the middle of the rings, and the circle the tiny rings sit on
const CENTER = [[0, CC, 0.36, 10], [0, CC + 0.06, 0.27, 20], [0, CC + 0.12, 0.18, 30], [0, CC + 0.165, 0.12, 40], [0, CC + 0.2, 0.05, 50]];
const CENTER_HOLES = [[0, CC - 0.285, 0.055, 10], [0, CC - 0.135, 0.055, 20], [0, CC - 0.0075, 0.05, 30], [0, CC + 0.0975, 0.045, 40], [0, CC + 0.2, 0.036, 50]];
function layoutFor(g, n) {                               // the tiny rings for ball n of game g (the same on every screen)
  let s = (Math.floor(g / 1000) ^ Math.imul(n + 1, 2654435761)) >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const count = 2 + Math.floor(rnd() * 7), turn = rnd() * Math.PI * 2, slots = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = 7; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }   // a shuffle
  const tiny = slots.slice(0, count).map(k => {
    const a = turn + k * Math.PI / 4, u = Math.cos(a) * ORBIT, v = CC + Math.sin(a) * ORBIT;
    return { u, v: B0 + v, pts: v > CC ? 100 : 75 };
  });
  return {
    tiny,
    rings: [...CENTER.map(([u, v, r]) => [u, B0 + v, r]), ...tiny.map(t => [t.u, t.v, TINY])],
    holes: [...CENTER_HOLES.map(([u, v, r, p]) => [u, B0 + v, r, p]), ...tiny.map(t => [t.u, t.v - TINY + TINY_HOLE + 0.004, TINY_HOLE, t.pts])]
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
const SP0 = 2.2, SP1 = 6.6;                              // the slowest roll, and how much faster a full pull goes (hard enough to slam the back)
function newBall(u, power, aim, spin, lay) {             // power 0..1, aim in radians (right is plus), spin -1..1, lay: the board's layout
  const sp = SP0 + power * SP1, v = 0.08, s = SLOPE;   // (aim swings wide: a sidearm whip banks off the walls)
  return { u, v, y: H(v) + R * Math.sqrt(1 + s * s), vu: sp * Math.sin(aim), vv: sp * Math.cos(aim), vy: sp * Math.cos(aim) * s,
           spin, on: true, t: 0, onT: 0, res: null, lay };
}
const STEP = 1 / 240;
function english(b) {   // spin on a bounce: it kicks the ball off at an angle, the way it's spinning, and uses some of the spin up
  if (!b.spin) return;
  const a = b.spin * 0.35, c = Math.cos(a), s = Math.sin(a), vu = b.vu;
  b.vu = vu * c - b.vv * s; b.vv = vu * s + b.vv * c;
  b.spin *= 0.6;
}
function stepBall(b, hit) {                              // one tiny step of a ball's life; hit(kind, strength) for sounds
  const h = STEP, pu = b.u, pv = b.v;
  b.t += h;
  b.vy -= (b.on ? G_ROLL : G_FLY) * h;
  if (b.on && b.v < L + HU) {   // spin curls the ball as it rolls up the lane: a lot on a slow roll, hardly at all on a hard one
    const sp = Math.hypot(b.vu, b.vv);
    b.vu += b.spin * 2.4 * Math.max(0.12, Math.min(1.3, 1.6 - sp / 3.2)) * h;
  }
  b.u += b.vu * h; b.v += b.vv * h; b.y += b.vy * h;
  // the walls: both sides, the back, the net over the board, the hump's back face and the board's front edge
  if (b.u > HALF - R) { b.u = HALF - R; if (b.vu > 0) { hit('wall', b.vu); b.vu *= -0.68; english(b); } }   // lively walls, for bank shots
  if (b.u < -HALF + R) { b.u = -HALF + R; if (b.vu < 0) { hit('wall', -b.vu); b.vu *= -0.68; english(b); } }
  if (b.v > B1 - R) { b.v = B1 - R; if (b.vv > 0) { hit('back', b.vv); b.vv *= -0.45; english(b); } }
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
    for (const [cu, c, r] of b.lay.rings) {
      const du = b.u - cu, dv = b.v - c, d = Math.hypot(du, dv);
      if (d < 1e-6 || Math.abs(d - r) >= R + 0.006) continue;
      const side = Math.hypot(pu - cu, pv - c) >= r ? 1 : -1;   // the side it was on a moment ago
      if (side > 0 && dv > r * 0.3) continue;   // the back of every ring is a ramp: a ball rolls in over it, but can't get back out
      const nu = du / d, nvv = dv / d, to = r + side * (R + 0.006);
      b.u = cu + nu * to; b.v = c + nvv * to;
      const vr = b.vu * nu + b.vv * nvv;
      if (vr * side < 0) { hit('rim', Math.abs(vr)); b.vu -= 1.45 * vr * nu; b.vv -= 1.45 * vr * nvv; if (Math.abs(vr) > 1) english(b); }
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
const MACHINES = [5.97, 7.82];            // their middles, across the room
const BALLS = 20, SLOT = BALLS / 2;       // twenty balls: ten in the slot down each side of the lane
const LEDGE = 0.13;                       // how wide each ball slot is
const OUT = HALF + LEDGE;                 // from the middle of the lane to the outside walls (along the lane)
const VF = -0.12, VB = B1 + 0.06;         // the very front and back of a machine
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
const tealMat = new THREE.MeshBasicMaterial({ color: 0x29e6ff, toneMapped: false });
const ringMat = {}, holeMat = {};
for (const [p, c] of Object.entries(COL)) {
  ringMat[p] = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, emissive: new THREE.Color(c), emissiveIntensity: 1.6 });
  holeMat[p] = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, map: canvasTex(256, 256, x => {
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
    const c = t.clone(); c.needsUpdate = true; c.repeat.set(0.25, 2);   // the slot covers: a strip of the same Tetris holo
    coverMat.map = c; coverMat.emissiveMap = c; coverMat.color.setHex(0xffffff); coverMat.emissiveIntensity = 0.7; coverMat.needsUpdate = true;
  }),
  loadTex('skeeorb.png', t => { orbMat.map = t; orbMat.color.setHex(0xffffff); orbMat.needsUpdate = true; }),
  loadTex('wood.jpg', t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    woodMat.map = t; woodMat.color.setHex(0xffffff); woodMat.needsUpdate = true;
  })
]);

// ---------- Building one machine ----------
function surface(v0, v1, n, mat, u0 = -HALF, u1 = HALF, drop = 0) {   // a sheet following the height H(v): the lane, the board, a slot floor
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const v = v0 + (v1 - v0) * i / n;
    for (let j = 0; j <= 1; j++) { const u = j ? u1 : u0; pos.push(u, H(v) - drop, -v); uv.push((u + HALF) / W, v / W); }
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
function topEdge(v) {   // how high the board's walls come up: rising from the end of the lane to a tall cage round the board
  if (v < L) return H(Math.max(v, 0)) + 0.3;
  if (v < B0) return H(L) + 0.3 + (YB + 1.0 - H(L) - 0.3) * (v - L) / (B0 - L);
  if (v <= B1) return H(v) + 1.0;
  return H(B1) + BACK_H;
}
function panel(v0, v1, top, x) {   // a holo side wall from v0 to v1, with its top edge following top(v), 4cm thick
  const sh = new THREE.Shape();
  sh.moveTo(v0, 0); sh.lineTo(v1, 0);
  for (let i = 60; i >= 0; i--) { const v = v0 + (v1 - v0) * i / 60; sh.lineTo(v, top(v)); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 4 });
  const m = new THREE.Mesh(g, holoMat);
  m.rotation.y = Math.PI / 2;   // the shape's x runs down the machine
  m.position.x = x;
  return m;
}
function tube(points, radius, mat, closed) {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), points.length * 2, radius, 8, closed), mat);
}
function ringMesh(u, v, r, mat) {   // a ring lip lying on the board
  const pts = [];
  for (let k = 0; k < 64; k++) {
    const a = k / 64 * Math.PI * 2, rv = v + r * Math.sin(a);
    pts.push(new THREE.Vector3(u + r * Math.cos(a), H(rv) + LIP * 0.45, -rv));
  }
  return tube(pts, LIP * 0.5, mat, true);
}
function holeMesh(u, v, r, pts) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r * 1.05, 40), holeMat[pts]);
  m.position.set(u, H(v) + 0.003, -v);
  m.rotation.x = TILT_ROT; m.scale.y = STRETCH;
  return m;
}
function tinyPod() {   // a tiny ring and its hole, as one piece that can sink into the board and pop back up
  const pod = new THREE.Group(), inner = new THREE.Group();
  pod.rotation.x = TILT_ROT; pod.add(inner);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(TINY, LIP * 0.5, 10, 48), ringMat[75]);
  ring.position.z = LIP * 0.45;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(TINY_HOLE * 1.05, 32), holeMat[75]);
  hole.position.set(0, -TINY + TINY_HOLE + 0.004, 0.003);
  inner.add(ring, hole);
  pod.visible = false;
  return { pod, inner, ring, hole };
}
const SLOT_V = k => 0.12 + k * 0.1;                  // where the balls sit down each slot
const slotY = v => H(v) - 0.025 + R;                 // (a slot's floor is a little lower than the lane)
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
  // the target board, its rings in the middle, and eight tiny ring pods (a game shows 2 to 8 of them at a time)
  g.add(surface(B0, B1, 14, boardMat));
  CENTER.forEach(([u, v, r, p]) => g.add(ringMesh(u, B0 + v, r, ringMat[p])));
  CENTER_HOLES.forEach(([u, v, r, p]) => g.add(holeMesh(u, B0 + v, r, p)));
  const pods = [];
  for (let k = 0; k < 8; k++) { const p = tinyPod(); g.add(p.pod); pods.push(p); }
  // the walls: tall holo walls round the board, and along the lane the outside walls with a ball slot each side
  g.add(panel(L, VB, topEdge, HALF), panel(L, VB, topEdge, -HALF - 0.04));
  const laneTop = v => H(Math.max(v, 0)) + 0.3;
  g.add(panel(VF, L + 0.04, laneTop, OUT), panel(VF, L + 0.04, laneTop, -OUT - 0.04));
  const covers = [];
  for (const side of [-1, 1]) {
    const mid = side * (HALF + LEDGE / 2);
    g.add(surface(VF, L, 30, darkMat, mid - LEDGE / 2, mid + LEDGE / 2, 0.025));   // the slot's floor
    const cap = new THREE.Mesh(new THREE.BoxGeometry(LEDGE, 0.3, 0.04), holoMat);   // closing off the slot where the lane ends
    cap.position.set(mid, H(L) + 0.12, -L - 0.02); g.add(cap);
    const rail = [];   // a neon rail between the lane and the slot
    for (let k = 0; k <= 20; k++) { const v = -0.02 + (L + 0.02) * k / 20; rail.push(new THREE.Vector3(side * HALF, H(v) + 0.03, -v)); }
    g.add(tube(rail, 0.012, tealMat, false));
    // the slot's cover: Tetris holo over the balls, sliding back into the far end of the slot when a game starts
    const len = SLOT_V(SLOT - 1) - SLOT_V(0) + 0.14, far = SLOT_V(SLOT - 1) + 0.07;
    const geo = new THREE.BoxGeometry(LEDGE + 0.01, 0.012, len); geo.translate(0, 0, len / 2);
    const c = new THREE.Mesh(geo, coverMat);
    c.position.set(mid, slotY(far) + R + 0.012, -far); c.rotation.x = Math.atan(SLOPE);
    g.add(c); covers.push(c);
  }
  const front = new THREE.Mesh(new THREE.BoxGeometry(2 * OUT + 0.08, H(VF) - 0.01, 0.04), holoMat);   // the front, under your end
  front.position.set(0, (H(VF) - 0.01) / 2, -VF + 0.02); g.add(front);
  const lipF = new THREE.Mesh(new THREE.BoxGeometry(2 * OUT + 0.08, 0.04, 0.04), trimMat);
  lipF.position.set(0, H(VF) + 0.01, -VF + 0.02); g.add(lipF);
  const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, topEdge(VB), 0.06), holoMat);
  back.position.set(0, topEdge(VB) / 2, -(B1 + 0.03)); g.add(back);
  // neon along the tops of all the walls
  for (const [x, v0, v1, top] of [[HALF + 0.02, L, VB, topEdge], [-HALF - 0.02, L, VB, topEdge], [OUT + 0.02, VF, L + 0.04, laneTop], [-OUT - 0.02, VF, L + 0.04, laneTop]]) {
    const pts = [];
    for (let k = 0; k <= 50; k++) { const v = v0 + (v1 - v0) * k / 50; pts.push(new THREE.Vector3(x, top(Math.min(v, B1)) + 0.012, -v)); }
    g.add(tube(pts, 0.011, trimMat, false));
  }
  // your orb, set in the backboard above the rings, slowly turning, with a glow round it and a neon rim
  const ORB_R = 0.32, ORB_Y = H(B1) + 0.42, ORB_Z = -(B1 - 0.004);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(ORB_R * 4, ORB_R * 4), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x9a6bff,
    transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.position.set(0, ORB_Y, ORB_Z - 0.002); g.add(glow);
  const orb = new THREE.Mesh(new THREE.CircleGeometry(ORB_R, 64), orbMat);
  orb.position.set(0, ORB_Y, ORB_Z); g.add(orb);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(ORB_R + 0.008, 0.016, 10, 72), trimMat);
  rim.position.copy(orb.position); g.add(rim);
  const orbLight = new THREE.PointLight(0x9a6bff, 1.5, 3, 1.6); orbLight.position.set(0, ORB_Y, ORB_Z + 0.4); g.add(orbLight);
  // light over the board, so the rings and the balls shine
  const boardLight = new THREE.PointLight(0x9fe8ff, 5, 4.5, 1.5); boardLight.position.set(0, YB + 1.3, -(B0 + 0.9)); g.add(boardLight);
  // the sign at the top of the backboard: SKEE·BALL, the score and the balls left
  const sc = document.createElement('canvas'); sc.width = 1024; sc.height = 420;
  const sTex = new THREE.CanvasTexture(sc); sTex.colorSpace = THREE.SRGBColorSpace; sTex.anisotropy = MAX_ANISO;
  const SIGN_H = W * 420 / 1024;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(W, SIGN_H), new THREE.MeshBasicMaterial({ map: sTex, toneMapped: false }));
  sign.position.set(0, topEdge(VB) - 0.03 - SIGN_H / 2, ORB_Z); g.add(sign);
  g.traverse(o => { if (o.isMesh) o.userData.skee = i; });   // clicking any part of it means "play this one"
  // the balls
  const balls = [];
  for (let k = 0; k < BALLS; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), woodMat);
    b.visible = false; b.userData.skee = i; g.add(b); balls.push(b);
  }
  return { i, g, pods, covers, orb, glow, orbLight, sc, sTex, balls,
           data: null, tray: 0, live: [], seen: null, signKey: '', score: 0, cov: 0, lay: null, layN: -1, pop: null };
}

// ---------- The best scores, up on the back wall over the machines ----------
const hc = document.createElement('canvas'); hc.width = 1024; hc.height = 640;
const hTex = new THREE.CanvasTexture(hc); hTex.colorSpace = THREE.SRGBColorSpace; hTex.anisotropy = MAX_ANISO;
const hiBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.24, 1.4), new THREE.MeshBasicMaterial({ map: hTex, toneMapped: false }));
hiBoard.position.set((MACHINES[0] + MACHINES[1]) / 2, 4.28, -10.94);
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

// ---------- The tiny rings: sinking away, and popping up in their new pattern ----------
function placePods(m, lay) {   // set the pods where this layout has its tiny rings
  m.pods.forEach((p, k) => {
    const t = lay.tiny[k];
    p.pod.visible = !!t;
    if (!t) return;
    p.pod.position.set(t.u, H(t.v), -t.v);
    p.ring.material = ringMat[t.pts]; p.hole.material = holeMat[t.pts];
  });
}
function podScale(m, s, sink) {   // all the pods at one size, sunk this far into the board
  for (const p of m.pods) { p.inner.scale.set(s, s * STRETCH, Math.max(0.01, s)); p.inner.position.z = -sink; }
}
function showLayout(m, g, n, animate) {   // the tiny rings for ball n of game g
  const lay = layoutFor(g, n);
  if (animate && m.lay) m.pop = { t: 0, next: lay, swapped: false, sounded: false };
  else { m.pop = null; placePods(m, lay); podScale(m, 1, 0); }
  m.lay = lay; m.layN = n;
}
function stepPop(m, dt) {
  const p = m.pop;
  if (!p) return;
  p.t += dt;
  if (p.t < 0.35) podScale(m, 1 - p.t / 0.35, p.t / 0.35 * 0.03);             // the old ones sink away...
  else {
    if (!p.swapped) { p.swapped = true; placePods(m, p.next); }
    if (!p.sounded) { p.sounded = true; sfx.skeePour(4, near(m) * 0.7); }
    const k = Math.min(1, (p.t - 0.35) / 0.45);                                 // ...and the new ones pop up, with a little bounce
    podScale(m, k < 1 ? Math.sin(k * Math.PI * 0.62) / Math.sin(Math.PI * 0.62) * (1 + 0.15 * Math.sin(k * Math.PI)) : 1, (1 - k) * 0.03);
    if (k >= 1) { m.pop = null; podScale(m, 1, 0); if (my === m) showUi(); }
  }
}

// ---------- The balls: waiting in the side slots, rolling, sinking ----------
function busySet(m) { return new Set([...m.live.map(l => l.mesh), m.hand && m.hand.mesh].filter(Boolean)); }
function placeTray(m) {   // the balls waiting in the slots, filling the two slots evenly from your end; the rest hidden (or busy)
  let k = 0;
  const busy = busySet(m);
  for (const b of m.balls) {
    if (busy.has(b)) continue;
    if (k < m.tray) {
      const side = k % 2 ? 1 : -1, v = SLOT_V(Math.floor(k / 2));
      b.visible = true; b.scale.setScalar(1);
      b.position.set(side * (HALF + LEDGE / 2), slotY(v), -v);
      k++;
    } else b.visible = false;
  }
}
function freeBall(m) {   // the waiting ball nearest your end of the slots
  const busy = busySet(m);
  return m.balls.filter(b => !busy.has(b) && b.visible).sort((a, b) => b.position.z - a.position.z)[0] || m.balls.find(b => !busy.has(b));
}
function near(m) {   // how loud this machine should be where you are
  const d = camera.position.distanceTo(m.g.position) + 0.5;
  return Math.min(1, 3 / d);
}
function launch(m, roll) {   // a ball leaves its slot and rolls (yours or anyone's: the same on every screen)
  let mesh = m.hand && m.hand.mesh;
  if (mesh) m.hand = null;                // yours: it's already out of the slot, sitting on the lane
  else { mesh = freeBall(m); if (m.tray > 0) m.tray--; }
  if (!mesh) return null;
  if (!m.lay || m.layN !== roll.n) showLayout(m, roll.g, roll.n, false);
  const l = { mesh, n: roll.n, g: roll.g, b: newBall(roll.u, roll.p, roll.a, roll.s, m.lay), acc: 0, sink: 0, sounds: {},
              slow: 1 - 0.45 * Math.abs(roll.s) * (1 - roll.p) };   // a slow, spinning roll plays out in slight slow motion
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
        if (l.n + 1 < BALLS && m.data && m.data.g === l.g) showLayout(m, l.g, l.n + 1, true);   // new tiny rings for the next ball
      }
      continue;
    }
    const k = near(m), last = l.sounds;
    l.acc += dt * (l.b.v < L + HU ? l.slow : 1);
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
    if (b.on && b.v < B0) fastest = Math.max(fastest, Math.hypot(b.vu, b.vv) / 7);
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
function rolling(m) { return m.live.some(l => !l.gone) || !!m.pop; }
function showUi() {
  if (!my) { ui.style.display = 'none'; return; }
  ui.style.display = 'flex';
  const d = my.data, touch = my.hand && my.hand.touch;
  againBtn.style.display = mine(my) ? 'none' : '';
  if (!mine(my)) uiText.textContent = d && d.id === myId && d.done ? `Game over: ${d.score}` : 'Ready';
  else if (my.hand) uiText.textContent = {
    aim: touch ? 'Drag to aim, let go to lock it' : 'Aim with your mouse, click to lock it',
    spin: 'Click to stop the spin bar',
    power: touch ? 'Drag up and down for power, let go to roll' : 'Move up and down for power, click to roll' }[my.hand.stage];
  else uiText.textContent = rolling(my) ? 'Rolling…' : my.tray ? 'Get ready…' : 'Last ball rolling…';
}

// ---------- A roll: aim (an arrow that follows you), spin (a timing bar), power (a tachometer you set) ----------
const gauge = document.createElement('canvas');
gauge.width = 440; gauge.height = 250;
gauge.style.cssText = 'position:fixed;left:50%;bottom:76px;transform:translateX(-50%);width:330px;height:188px;z-index:25;display:none;pointer-events:none';
document.body.appendChild(gauge);
const SPIN_TIME = 3.2, SEGS = 20, AIM_MAX = 0.5;   // the spin bar's trip across and back (seconds), the tach's segments, the widest aim (radians)
function drawGauge(h) {
  const x = gauge.getContext('2d'), W2 = gauge.width;
  x.clearRect(0, 0, W2, gauge.height);
  if (!h || h.stage === 'aim') { gauge.style.display = 'none'; return; }
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

// The aiming arrow: chevrons glowing up the lane from the ball, the way it'll go (longer as the power builds)
const aimCanvas = document.createElement('canvas'); aimCanvas.width = 64; aimCanvas.height = 512;
{ const x = aimCanvas.getContext('2d'), g = x.createLinearGradient(0, 512, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  for (let y = 0; y < 512; y += 48) { x.beginPath(); x.moveTo(8, y + 40); x.lineTo(32, y + 8); x.lineTo(56, y + 40); x.lineTo(46, y + 40); x.lineTo(32, y + 22); x.lineTo(18, y + 40); x.fill(); } }
const aimMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(aimCanvas), color: 0x29e6ff, transparent: true,
  depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
const aim = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1), aimMat);
aim.geometry.translate(0, 0.5, 0); aim.geometry.rotateX(-Math.PI / 2);   // it grows forward from the ball, lying on the lane
aim.visible = false;
function showAim(h) {
  aim.visible = !!h;
  if (!h) return;
  aim.position.set(0, H(0.08) + 0.005, -0.08);
  aim.rotation.set(Math.atan(SLOPE), -h.aim, 0, 'YXZ');   // tipped up the lane's slope, turned the way it'll go
  const p = h.stage === 'power' ? h.seg / SEGS : 0.3;
  aim.scale.set(1, 1, 0.6 + p * 1.6);
  aimMat.color.setHSL(h.stage === 'power' ? 0.33 - p * 0.33 : 0.52, 1, 0.55);
}
function ballX(m) {   // where your ball is on the screen (pixels across)
  const p = new THREE.Vector3(0, H(0.08), -0.08).applyMatrix4(m.g.matrixWorld).project(camera);
  return (p.x + 1) / 2 * window.innerWidth;
}
function readyBall(m) {   // your turn and nothing rolling: the next ball comes up out of a slot onto the lane, ready to aim
  if (m.hand || m.tray <= 0 || rolling(m) || !mine(m) || (view && view.t < 1)) return;
  const mesh = freeBall(m);
  if (!mesh) return;
  m.hand = { mesh, stage: 'aim', t: 0, aim: 0, spin: 0, seg: 8, y0: 0, seg0: 8 };
  m.tray--; placeTray(m);
  mesh.visible = true; mesh.position.set(0, H(0.08) + R, -0.08);
  m.g.add(aim);
  sfx.skeeThump(0.5);
  showUi();
}
function steer(h, e) {   // the pointer moving: swinging the aim, or raising and lowering the power
  if (h.stage === 'aim') h.aim = Math.max(-1, Math.min(1, (e.clientX - ballX(my)) / (window.innerWidth * 0.32))) * AIM_MAX;
  else if (h.stage === 'power') {
    const seg = Math.round(h.seg0 + (h.y0 - e.clientY) / (window.innerHeight * 0.03));   // up a segment for every bit you move up
    h.seg = Math.max(1, Math.min(SEGS, seg));
    const v = 0.08 - h.seg / SEGS * 0.16;   // the ball draws back as the power builds
    h.mesh.position.set(0, H(Math.max(v, -0.02)) + R, -v);
  }
}
function next(h, e) {   // lock this step in and go on to the next
  if (h.stage === 'aim') { h.stage = 'spin'; h.t = 0; sfx.skeeRim(0.8); }
  else if (h.stage === 'spin') { h.stage = 'power'; h.y0 = e.clientY; h.seg0 = h.seg; sfx.skeeRim(0.8); }
  else if (h.stage === 'power') { roll(my, h); return; }
  showUi();
}
function down(e) {
  const h = my && my.hand;
  if (!h || !mine(my)) return;
  h.touch = e.pointerType === 'touch';
  if (h.touch && h.stage !== 'spin') { h.dragging = true; if (h.stage === 'power') { h.y0 = e.clientY; h.seg0 = h.seg; } steer(h, e); return; }   // phones: drag, then let go
  next(h, e);
}
function move(e) {
  const h = my && my.hand;
  if (!h || (e.pointerType === 'touch' && !h.dragging)) return;
  steer(h, e);
}
function up(e) {
  const h = my && my.hand;
  if (!h || !h.dragging) return;
  h.dragging = false;
  next(h, e);
}
function roll(m, h) {
  const d = m.data, n = BALLS - d.left;
  // everyone uses exactly the numbers that are sent, so their ball rolls the same as yours
  const r = { n, g: d.g, by: myId, u: 0, p: +(h.seg / SEGS).toFixed(4), a: +h.aim.toFixed(4), s: +h.spin.toFixed(4), t: Date.now() };
  const l = launch(m, r);
  if (!l) return;
  l.mine = true;
  m.myLeft = d.left - 1;
  m.rolling = (m.rolling || 0) + 1;
  update(ref(db, 'game/skee/m' + m.i), { left: m.myLeft, t: serverNow() }).catch(() => {});
  set(ref(db, 'game/skee/r' + m.i), r).catch(() => {});
  m.seen = d.g + ':' + n;
  showAim(null); drawGauge(null);
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
const PLAY_EYE = new THREE.Vector3(0, 2.45, 1.25), PLAY_LOOK = new THREE.Vector3(0, 0.9, -2.3), PLAY_FOV = 58;   // standing back from the lane
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
  if (m.hand) { m.hand = null; m.tray++; placeTray(m); showAim(null); drawGauge(null); }
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
    if (playing && (!was || was.g !== m.data.g)) {   // a new game: full slots, and the covers slide open
      for (const l of m.live) l.mesh.visible = false;
      m.live = []; m.hand = null;
      if (my === m) { showAim(null); drawGauge(null); }
      m.tray = m.data.left;
      const n = BALLS - m.data.left;
      showLayout(m, m.data.g, n, !!m.lay);
      m.seen = m.data.g + ':' + (n - 1);
      if (m.data.left === BALLS) sfx.skeePour(0, near(m));
    }
    if (!playing && !m.live.length && !m.hand) m.tray = BALLS;   // between games the slots sit full under their covers
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
    launch(m, { n: Math.round(num(r.n, 0, BALLS - 1)), g: r.g, u: num(r.u, -HALF + R, HALF - R), p: num(r.p, 0, 1),
                a: num(r.a, -AIM_MAX, AIM_MAX), s: num(r.s, -1, 1) });
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
    stepPop(m, dt);
    const open = m.data && !stale(m.data) ? 1 : 0;   // the slot covers: slid back while a game's on
    m.cov += (open - m.cov) * Math.min(1, dt * 4);
    for (const c of m.covers) c.scale.z = Math.max(0.02, 1 - m.cov);
    m.orb.rotation.z -= dt * 0.25;                       // the orb's galaxy slowly turns
    m.flash = Math.max(0, (m.flash || 0) - dt * 1.5);    // and flares when a ball drops
    m.glow.material.opacity = 0.45 + 0.1 * Math.sin(blinkT * 2 + m.i) + m.flash * 0.6;
    m.glow.scale.setScalar(1 + m.flash * 0.35);
    m.orbLight.intensity = 1.5 + m.flash * 6;
    paintSign(m, blink);
  }
  if (my) {
    readyBall(my);
    const h = my.hand;
    if (h && h.stage === 'spin') { h.t += dt; h.spin = Math.sin(h.t / SPIN_TIME * Math.PI * 2); }   // the spin bar sliding
    showAim(h); drawGauge(h);
  }
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