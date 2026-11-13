// =====================================================================
// skeeball.js — two skee-ball machines on the right side of the Game Room. Holographic Tetris cabinets (holo.jpg),
// a purple velvet lane with fine gold stitching up its sides (lane.jpg), a hump that launches the ball onto a target
// board of glowing neon rings, and an orb on a post by the tray (skeeorb.png, your own picture) that the wooden balls (wood.jpg)
// pour out of at the start of a game.
// Click a machine to play: pull a ball back (drag down) and let go to roll it; the farther you pull, the harder it
// goes, and pulling off to one side sends it the other way. Nine balls a game. Everyone in the room sees every roll
// (each ball's path is worked out the same way on every screen), and the best scores go up on the board on the back wall.
// =====================================================================
import * as THREE from 'three';
import { ref, set, update, onValue, onDisconnect, push, query, orderByChild, limitToLast, runTransaction }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, renderer, scene, camera, serverNow } from '../core.js';
import { sfx } from '../sounds.js';

// ---------- The shape of a machine and how a ball moves on it (meters and seconds) ----------
// u runs across the lane (right is plus), v runs down it from your end, y is up.
// Every screen runs these same steps from the same start, so everyone sees the same ball end up in the same hole.
const W = 0.76, HALF = W / 2, R = 0.035;                 // lane width, and a ball's radius
const Y0 = 0.80, SLOPE = 0.12, L = 3.0;                  // how high the lane starts, how much it climbs a meter, how long it is
const HU = 0.30, KICK = 0.75;                            // the hump: how long, and how steep it is at the lip (the launch)
const HUMP_TOP = Y0 + SLOPE * L + HU * (SLOPE + (KICK - SLOPE) / 2);
const B0 = L + HU + 0.26, BL = 1.15, B1 = B0 + BL, TILT = 0.55;   // the target board: where it starts, how long, how steep
const YB = HUMP_TOP - 0.06, TROUGH = HUMP_TOP - 0.34;    // its bottom edge, and the gutter in front of it
const LIP = 0.032;                                       // how tall the ring lips stand
const RINGS = [[B0 + 0.42, 0.30], [B0 + 0.48, 0.225], [B0 + 0.535, 0.155], [B0 + 0.58, 0.095], [B0 + 0.615, 0.048]];
const HOLES = [[0, B0 + 0.1875, 0.058, 10], [0, B0 + 0.3175, 0.052, 20], [0, B0 + 0.4325, 0.046, 30], [0, B0 + 0.526, 0.040, 40],
               [0, B0 + 0.615, 0.040, 50], [-0.27, B0 + 1.0, 0.046, 100], [0.27, B0 + 1.0, 0.046, 100]];
const G_FLY = 9.8, G_ROLL = 7.0;                         // a rolling ball speeds up and slows down a bit slower than a falling one
function H(v) {                                          // how high the surface is, this far down the machine
  if (v < L) return Y0 + SLOPE * Math.max(v, -0.3);
  if (v < L + HU) { const x = (v - L) / HU; return Y0 + SLOPE * L + HU * (SLOPE * x + (KICK - SLOPE) * x * x / 2); }
  if (v < B0) return TROUGH;
  return YB + (v - B0) * TILT;
}
function slopeAt(v) { if (v < L) return SLOPE; if (v < L + HU) return SLOPE + (KICK - SLOPE) * (v - L) / HU; if (v < B0) return 0; return TILT; }
function newBall(u, power, aim) {                        // power 0..1, aim in radians (left is minus)
  const sp = 2.4 + power * 3.4, v = 0.08, s = SLOPE;
  return { u, v, y: H(v) + R * Math.sqrt(1 + s * s), vu: sp * Math.sin(aim), vv: sp * Math.cos(aim), vy: sp * Math.cos(aim) * s,
           on: true, t: 0, onT: 0, res: null, spin: 0 };
}
const STEP = 1 / 240;
function stepBall(b, hit) {                              // one tiny step of a ball's life; hit(kind, strength) for sounds
  const h = STEP, pu = b.u, pv = b.v;
  b.t += h;
  b.vy -= (b.on ? G_ROLL : G_FLY) * h;
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
      const e = vn < -0.6 ? 0.32 : 0;
      if (vn < -0.6) hit(b.v > B0 ? 'land' : 'thump', -vn);
      b.vv -= (1 + e) * vn * nv; b.vy -= (1 + e) * vn * ny;
    }
    b.on = true; b.onT += h;
    const k = Math.max(0, 1 - (b.v > B0 ? 0.9 : b.v > L + HU ? 2.5 : 0.16) * h);   // velvet drag: light on the lane, heavier on the board
    b.vu *= k; b.vv *= k; b.vy *= k;
  } else { b.on = false; b.onT = 0; }
  // the ring lips on the board: only a ball down low touches them (a flying one sails over)
  if (b.v > B0 - 0.05 && b.y - hs < need + LIP) {
    for (const [c, r] of RINGS) {
      const du = b.u, dv = b.v - c, d = Math.hypot(du, dv);
      if (d < 1e-6 || Math.abs(d - r) >= R + 0.006) continue;
      const side = Math.hypot(pu, pv - c) >= r ? 1 : -1;   // the side it was on a moment ago
      const nu = du / d, nvv = dv / d, to = r + side * (R + 0.006);
      b.u = nu * to; b.v = c + nvv * to;
      const vr = b.vu * nu + b.vv * nvv;
      if (vr * side < 0) { hit('rim', Math.abs(vr)); b.vu -= 1.45 * vr * nu; b.vv -= 1.45 * vr * nvv; }
      if (side > 0 && dv > 0) b.vu += (b.u >= 0 ? 1 : -1) * 0.6 * h;   // perched on top of a lip: it always tips off one way or the other
    }
  }
  // where it ends up: down a hole, in the gutter, or rolled back to you
  if (b.on && b.v > B0) {
    const sp = Math.hypot(b.vu, b.vv);
    for (const [hu, hv, hr, pts] of HOLES)
      if (sp < 3 && Math.hypot(b.u - hu, b.v - hv) < hr - R * 0.3) { b.res = { pts, u: hu, v: hv }; return; }
  }
  if (b.on && b.v > L + HU && b.v < B0 && b.onT > 0.25) { b.res = { pts: 0, gutter: true }; return; }
  if (b.on && b.v < 0.5 && b.vv < 0) { b.res = { pts: 0, back: true }; return; }
  b.still = b.on && Math.hypot(b.vu, b.vv) < 0.05 ? (b.still || 0) + h : 0;
  if (b.t > 14 || b.still > 1) b.res = { pts: 0, gutter: true };   // stuck somewhere (it never should be): it's out
}

// ---------- Where the machines stand ----------
const MACHINES = [5.95, 7.75];            // their middles, across the room
const FRONT_Z = -2.4;                      // the end you stand at (they run off toward the back wall)
const BALLS = 9;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
const COLS = ['#ff3fa8', '#b36bff', '#29e6ff', '#ffd36a', '#ffffff'];   // the rings' neon, outside in: 10 20 30 40 50

function loadTex(file, setup) {   // a promise that's done once the picture is on, or has failed
  return new Promise(done => {
    new THREE.TextureLoader().load(new URL(file, import.meta.url).href, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; setup(t); done(); },
      undefined, () => { console.warn(file + ' did not load'); done(); });
  });
}

// ---------- The materials ----------
const laneMat = new THREE.MeshPhysicalMaterial({ color: 0x5a2a9a, roughness: 0.9, sheen: 1, sheenRoughness: 0.4, sheenColor: 0xc8a0ff });
const boardMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.9, sheen: 1, sheenRoughness: 0.45, sheenColor: 0xc8a0ff });
const holoMat = new THREE.MeshStandardMaterial({ color: 0x4a3a8a, roughness: 0.35, metalness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x14062a, roughness: 0.95 });
const woodMat = new THREE.MeshPhysicalMaterial({ color: 0xb07a45, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.15 });
const orbMat = new THREE.MeshBasicMaterial({ color: 0x8a6bff, transparent: true, toneMapped: false });
const trimMat = new THREE.MeshBasicMaterial({ color: 0xff3fa8, toneMapped: false });
const ringMats = COLS.map(c => new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, emissive: new THREE.Color(c), emissiveIntensity: 1.6 }));
const glowTex = (() => {   // a soft round glow, for behind the orb
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

// The target board's picture: the velvet, with the holes sunk into it and their numbers stitched beside them
const BW = 1024, BH = Math.round(BW * BL / W);
const boardCanvas = document.createElement('canvas'); boardCanvas.width = BW; boardCanvas.height = BH;
const boardTex = new THREE.CanvasTexture(boardCanvas);
boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = MAX_ANISO;
boardMat.map = boardTex;
const bx = u => (u / W + 0.5) * BW, by = v => (1 - (v - B0) / BL) * BH, bs = m => m / W * BW;   // board meters to picture pixels
function paintBoard(laneImg) {
  const x = boardCanvas.getContext('2d');
  x.fillStyle = '#3c1470'; x.fillRect(0, 0, BW, BH);
  if (laneImg) for (let y = 0; y < BH; y += BW) x.drawImage(laneImg, 0, y, BW, BW);   // the same stitched velvet as the lane
  for (const [k, [c, r]] of RINGS.entries()) {     // a fine gold stitch just outside each ring, and a soft glow of its color
    x.save();
    x.strokeStyle = COLS[k]; x.globalAlpha = 0.18; x.lineWidth = bs(0.03);
    x.beginPath(); x.ellipse(bx(0), by(c), bs(r), bs(r), 0, 0, Math.PI * 2); x.stroke();
    x.globalAlpha = 0.9; x.strokeStyle = '#f2c86e'; x.lineWidth = 2; x.setLineDash([9, 5]);
    x.beginPath(); x.ellipse(bx(0), by(c), bs(r + 0.022), bs(r + 0.022), 0, 0, Math.PI * 2); x.stroke();
    x.restore();
  }
  for (const [u, v, r, pts] of HOLES) {            // each hole: a deep dark well with a gold rim
    const g = x.createRadialGradient(bx(u), by(v), 0, bx(u), by(v), bs(r));
    g.addColorStop(0, '#000000'); g.addColorStop(0.7, '#07010f'); g.addColorStop(1, '#2a0d4a');
    x.fillStyle = g; x.beginPath(); x.arc(bx(u), by(v), bs(r), 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#ffd98a'; x.lineWidth = 4; x.stroke();
    x.save();
    x.font = `bold ${pts === 100 ? 40 : 34}px "Trebuchet MS", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = pts === 100 ? '#29e6ff' : '#ff3fa8'; x.shadowBlur = 14; x.fillStyle = '#fff4d8';
    const ty = pts === 100 ? by(v) + bs(r) + 30 : by(v) + bs(r) + 22;
    x.fillText(String(pts), bx(u), ty);
    x.restore();
  }
  boardTex.needsUpdate = true;
}
paintBoard(null);

const loaded = Promise.all([
  loadTex('lane.jpg', t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    laneMat.map = t; laneMat.color.setHex(0xffffff); laneMat.needsUpdate = true;
    paintBoard(t.image);
  }),
  loadTex('holo.jpg', t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.4, 1.4);
    holoMat.map = t; holoMat.emissiveMap = t; holoMat.color.setHex(0xffffff); holoMat.emissiveIntensity = 0.55; holoMat.needsUpdate = true;
  }),
  loadTex('skeeorb.png', t => { orbMat.map = t; orbMat.color.setHex(0xffffff); orbMat.needsUpdate = true; }),
  loadTex('wood.jpg', t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    woodMat.map = t; woodMat.color.setHex(0xffffff); woodMat.needsUpdate = true;
  })
]);

// ---------- Building one machine ----------
function surface(v0, v1, n, mat, uvOf) {   // the lane (or the board) as a sheet of little squares following H(v)
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const v = v0 + (v1 - v0) * i / n;
    for (let j = 0; j <= 1; j++) {
      const u = (j - 0.5) * W;
      pos.push(u, H(v), -v);
      uv.push(...uvOf(u, v));
    }
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
function topEdge(v) {   // how high the side panels come up: a low rail along the lane, rising to a tall cage around the board
  if (v < L) return H(v) + 0.1;
  if (v < B0) return H(L) + 0.1 + (YB + 0.85 - H(L) - 0.1) * (v - L) / (B0 - L);
  return H(Math.min(v, B1)) + 0.85 + (v > B1 ? 0.1 : 0);
}
const VF = -0.19, VB = B1 + 0.06;   // the very front and back of the cabinet
function sidePanel() {
  const sh = new THREE.Shape();
  sh.moveTo(VF, 0); sh.lineTo(VB, 0);
  for (let i = 40; i >= 0; i--) { const v = VF + (VB - VF) * i / 40; sh.lineTo(v, topEdge(v)); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 4 });
  const m = new THREE.Mesh(g, holoMat);
  m.rotation.y = Math.PI / 2;   // the shape's x runs down the machine, and it's 4cm thick across
  return m;
}
function tube(points, radius, mat, closed) {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), points.length * 2, radius, 8, closed), mat);
}
function buildMachine(i) {
  const g = new THREE.Group();
  g.position.set(MACHINES[i], 0, FRONT_Z);
  scene.add(g);
  // the lane and its hump (the velvet tiles every lane width down its length)
  g.add(surface(-0.02, L, 60, laneMat, (u, v) => [u / W + 0.5, v / W]));
  g.add(surface(L, L + HU, 24, laneMat, (u, v) => [u / W + 0.5, v / W]));
  // the gutter in front of the board, and the drops into it
  const gut = new THREE.Mesh(new THREE.PlaneGeometry(W, B0 - L - HU), darkMat);
  gut.rotation.x = -Math.PI / 2; gut.position.set(0, TROUGH, -(L + HU + B0) / 2); g.add(gut);
  for (const [v, top] of [[L + HU, HUMP_TOP], [B0, YB]]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(W, top - TROUGH), darkMat);
    f.position.set(0, (top + TROUGH) / 2, -v); f.rotation.y = v === B0 ? 0 : Math.PI; g.add(f);
  }
  // the target board and its neon ring lips
  g.add(surface(B0, B1, 8, boardMat, (u, v) => [u / W + 0.5, (v - B0) / BL]));
  RINGS.forEach(([c, r], k) => {
    const pts = [];
    for (let a = 0; a < 64; a++) {
      const u = r * Math.cos(a / 64 * Math.PI * 2), v = c + r * Math.sin(a / 64 * Math.PI * 2);
      pts.push(new THREE.Vector3(u, H(v) + LIP * 0.45, -v));
    }
    g.add(tube(pts, LIP * 0.5, ringMats[k], true));
  });
  // the cabinet: holo side panels, the back, the front with the ball tray, and the orb
  const right = sidePanel(); right.position.x = HALF; g.add(right);
  const left = sidePanel(); left.position.x = -HALF - 0.04; g.add(left);
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, topEdge(VB), 0.06), holoMat);
  back.position.set(0, topEdge(VB) / 2, -(B1 + 0.03)); g.add(back);
  const under = new THREE.Mesh(new THREE.BoxGeometry(W, H(-0.02) - 0.06, 0.03), holoMat);   // the front, under the tray
  under.position.set(0, (H(-0.02) - 0.06) / 2, -VF - 0.015); g.add(under);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(W, 0.03, -VF), darkMat);
  tray.position.set(0, H(-0.02) - 0.075, -VF / 2); g.add(tray);
  const lipF = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, 0.05, 0.03), trimMat);
  lipF.position.set(0, H(-0.02) - 0.03, -VF); g.add(lipF);
  // neon along the tops of the side panels
  for (const x of [HALF + 0.02, -HALF - 0.02]) {
    const pts = [];
    for (let k = 0; k <= 50; k++) { const v = VF + (VB - VF) * k / 50; pts.push(new THREE.Vector3(x, topEdge(v) + 0.012, -v)); }
    g.add(tube(pts, 0.011, trimMat, false));
  }
  // the orb: your picture, slowly turning, up on a holo post beside the tray where you can see it while you play.
  // The balls pour out of it at the start of a game.
  const ORB_X = HALF + 0.24, ORB_Y = 1.08, ORB_Z = -0.45;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, ORB_Y - 0.17, 0.1), holoMat);
  post.position.set(ORB_X, (ORB_Y - 0.17) / 2, ORB_Z - 0.06); g.add(post);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x9a6bff,
    transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.position.set(ORB_X, ORB_Y, ORB_Z - 0.01); g.add(glow);
  const orb = new THREE.Mesh(new THREE.CircleGeometry(0.17, 64), orbMat);
  orb.position.set(ORB_X, ORB_Y, ORB_Z); g.add(orb);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.012, 10, 64), trimMat);
  rim.position.copy(orb.position); g.add(rim);
  const orbLight = new THREE.PointLight(0x9a6bff, 1.2, 2.2, 1.6); orbLight.position.set(ORB_X, ORB_Y, ORB_Z + 0.25); g.add(orbLight);
  // light over the board, so the rings and the balls shine
  const boardLight = new THREE.PointLight(0x9fe8ff, 3, 3.2, 1.5); boardLight.position.set(0, YB + 0.95, -(B0 + 0.5)); g.add(boardLight);
  // the sign over the board: SKEE·BALL, the score and the balls left
  const sc = document.createElement('canvas'); sc.width = 1024; sc.height = 640;
  const sTex = new THREE.CanvasTexture(sc); sTex.colorSpace = THREE.SRGBColorSpace; sTex.anisotropy = MAX_ANISO;
  const SIGN_H = W * 640 / 1024;   // across the top of the backboard
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(W, SIGN_H), new THREE.MeshBasicMaterial({ map: sTex, toneMapped: false }));
  sign.position.set(0, topEdge(VB) - 0.03 - SIGN_H / 2, -(B1 - 0.002)); g.add(sign);
  g.traverse(o => { if (o.isMesh) o.userData.skee = i; });   // clicking any part of it means "play this one"
  // the balls
  const balls = [];
  for (let k = 0; k < BALLS; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), woodMat);
    b.visible = false; b.userData.skee = i; g.add(b); balls.push(b);
  }
  return { i, g, orb, glow, orbLight, sc, sTex, balls, ORB_X, ORB_Y, ORB_Z,
           data: null, tray: 0, pour: [], live: [], seen: null, signKey: '', score: 0 };
}

// ---------- The best scores, up on the back wall ----------
const hc = document.createElement('canvas'); hc.width = 1024; hc.height = 768;
const hTex = new THREE.CanvasTexture(hc); hTex.colorSpace = THREE.SRGBColorSpace; hTex.anisotropy = MAX_ANISO;
const hiBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), new THREE.MeshBasicMaterial({ map: hTex, toneMapped: false }));
hiBoard.position.set((MACHINES[0] + MACHINES[1]) / 2, 4.0, -10.94);
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
  frame(x, 1024, 768, '#29e6ff');
  neonText(x, 'SKEE·BALL HIGH SCORES', 512, 100, 64, '#ff3fa8');
  if (!best.length) neonText(x, 'nobody yet · be the first', 512, 400, 44, '#b36bff');
  best.forEach((b, k) => {
    const y = 190 + k * 68, col = k === 0 ? '#ffd36a' : k < 3 ? '#29e6ff' : '#cdb8ff';
    neonText(x, String(k + 1), 110, y, 46, col, 'center');
    neonText(x, b.name, 170, y, 46, col, 'left');
    neonText(x, String(b.score), 900, y, 50, col, 'right', '"Courier New", monospace');
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
  frame(x, 1024, 640, '#b36bff');
  neonText(x, 'SKEE·BALL', 512, 110, 108, '#ff3fa8');
  if (over) {
    neonText(x, blink ? 'GAME OVER' : '', 512, 260, 70, '#ffd36a');
    neonText(x, String(d.score), 512, 400, 150, '#29e6ff', 'center', '"Courier New", monospace');
    neonText(x, d.name, 512, 545, 52, '#cdb8ff');
  } else if (free) {
    neonText(x, blink ? 'PLAY ME' : '', 512, 300, 110, '#29e6ff');
    if (d && d.name) neonText(x, `last: ${d.name} ${d.score}`, 512, 470, 50, '#cdb8ff');
    if (best[0]) neonText(x, `best: ${best[0].score}`, 512, 550, 50, '#ffd36a');
  } else {
    neonText(x, d.name, 512, 225, 56, '#cdb8ff');
    neonText(x, String(d.score).padStart(4, '0'), 512, 370, 170, '#29e6ff', 'center', '"Courier New", monospace');
    for (let k = 0; k < BALLS; k++) {   // a dot for each ball: lit while it's still to roll
      x.save(); x.beginPath(); x.arc(512 + (k - 4) * 74, 540, 22, 0, Math.PI * 2);
      const on = k < d.left;
      x.fillStyle = on ? '#ffd36a' : '#2a1a40'; x.shadowColor = '#ffd36a'; x.shadowBlur = on ? 20 : 0; x.fill(); x.restore();
    }
  }
  m.sTex.needsUpdate = true;
}

// ---------- The balls: in the tray, pouring out of the orb, rolling, sinking ----------
const trayU = k => (k - (BALLS - 1) / 2) * (W - 0.08) / (BALLS - 1);
const TRAY_V = VF / 2, trayY = () => H(-0.02) - 0.06 + R;
function placeTray(m) {   // the balls waiting in the tray sit side by side; the rest are hidden (or busy)
  let k = 0;
  const busy = new Set([...m.live.map(l => l.mesh), ...m.pour.map(p => p.mesh), m.hand && m.hand.mesh].filter(Boolean));
  for (const b of m.balls) {
    if (busy.has(b)) continue;
    if (k < m.tray) { b.visible = true; b.position.set(trayU(k), trayY(), -TRAY_V); k++; }
    else b.visible = false;
  }
}
function freeBall(m) {   // a ball mesh that isn't doing anything
  const busy = new Set([...m.live.map(l => l.mesh), ...m.pour.map(p => p.mesh), m.hand && m.hand.mesh].filter(Boolean));
  return m.balls.find(b => !busy.has(b));
}
function near(m) {   // how loud this machine should be where you are
  const d = camera.position.distanceTo(m.g.position) + 0.5;
  return Math.min(1, 3 / d);
}
function startPour(m, n) {   // the balls come out of the orb one after another and drop into the tray
  m.tray = 0; m.pour = [];
  for (const l of m.live) l.mesh.visible = false;
  m.live = [];
  for (let k = 0; k < n; k++) {
    const mesh = m.balls[k];
    m.pour.push({ mesh, t: -k * 0.22, k });
  }
  placeTray(m);
}
function updatePour(m, dt) {
  for (const p of m.pour) {
    p.t += dt;
    if (p.t < 0) { p.mesh.visible = false; continue; }
    if (!p.sounded) { p.sounded = true; sfx.skeePour(p.k, near(m)); m.flash = 1; }
    const k = Math.min(1, p.t / 0.55), e = 1 - (1 - k) * (1 - k);
    const sx = m.ORB_X, sy = m.ORB_Y, sz = m.ORB_Z + 0.02, ex = trayU(p.k), ey = trayY(), ez = -TRAY_V;
    p.mesh.visible = true;
    p.mesh.scale.setScalar(0.3 + 0.7 * Math.min(1, k * 2.5));
    p.mesh.position.set(sx + (ex - sx) * e, sy + (ey - sy) * e + Math.sin(k * Math.PI) * 0.16, sz + (ez - sz) * e + Math.sin(k * Math.PI) * 0.12);
    p.mesh.rotation.x -= dt * 9;
    if (k >= 1) { p.done = true; p.mesh.scale.setScalar(1); sfx.skeeThump(0.4 * near(m)); }
  }
  const before = m.pour.length;
  m.pour = m.pour.filter(p => { if (p.done) m.tray++; return !p.done; });
  if (m.pour.length !== before) placeTray(m);
}
function launch(m, u, power, aim) {   // a ball leaves the tray and rolls (yours or anyone's: the same on every screen)
  let mesh = m.hand && m.hand.mesh;
  if (mesh) m.hand = null;                // yours: it's already out of the tray, in your hand
  else { mesh = freeBall(m); if (m.tray > 0) m.tray--; }
  if (!mesh) return null;
  const l = { mesh, b: newBall(u, power, aim), acc: 0, sink: 0, sounds: {} };
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
      if (l.sink > 0.4) { l.mesh.visible = false; l.gone = true; }
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
    if (b.on && b.v < B0) fastest = Math.max(fastest, Math.hypot(b.vu, b.vv) / 5);
    if (b.res) {
      if (b.res.pts) { l.mesh.position.set(b.res.u, H(b.res.v) + R * 0.6, -b.res.v); sfx.skeeDrop(b.res.pts, k); }
      else sfx.skeeGutter(k);
      if (l.mine) mineDone(m, b.res.pts);
    }
  }
  m.live = m.live.filter(l => !l.gone);
  return fastest * near(m);
}

// ---------- Playing: walking up to a machine, pulling back and letting go ----------
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
function showUi() {
  if (!my) { ui.style.display = 'none'; return; }
  ui.style.display = 'flex';
  const d = my.data, mine = d && d.id === myId && !d.done;
  againBtn.style.display = mine ? 'none' : '';
  uiText.textContent = mine ? (my.tray || my.pour.length ? 'Pull a ball back and let go to roll it' : 'Rolling…')
                            : (d && d.id === myId && d.done ? `Game over: ${d.score}` : 'Ready');
}

// The aiming line: a glowing streak down the lane while you pull back
const aimCanvas = document.createElement('canvas'); aimCanvas.width = 64; aimCanvas.height = 512;
{ const x = aimCanvas.getContext('2d'), g = x.createLinearGradient(0, 512, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  for (let y = 0; y < 512; y += 48) { x.beginPath(); x.moveTo(8, y + 40); x.lineTo(32, y + 8); x.lineTo(56, y + 40); x.lineTo(46, y + 40); x.lineTo(32, y + 22); x.lineTo(18, y + 40); x.fill(); } }
const aimMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(aimCanvas), color: 0x29e6ff, transparent: true,
  depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
const aim = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 1), aimMat);
aim.geometry.translate(0, 0.5, 0); aim.geometry.rotateX(-Math.PI / 2);   // it grows forward from the ball, lying on the lane
aim.visible = false;

function laneX(m, u) {   // where a spot across the front of the lane is on the screen (in pixels)
  const p = new THREE.Vector3(u, H(0.1), -0.1).applyMatrix4(m.g.matrixWorld).project(camera);
  return (p.x + 1) / 2 * window.innerWidth;
}
function uFromScreen(m, px) {
  const a = laneX(m, -HALF), b = laneX(m, HALF);
  return Math.max(-HALF + R + 0.01, Math.min(HALF - R - 0.01, -HALF + (px - a) / (b - a) * W));
}
function pullOf(h) {   // how hard (0..1) and which way a pull would send the ball
  const power = Math.max(0, Math.min(1, (h.y - h.y0) / (window.innerHeight * 0.32)));
  const turn = Math.max(-0.14, Math.min(0.14, (h.x0 - h.x) / window.innerWidth * 0.9));
  return { power, turn };
}
function down(e) {
  if (!my || view && view.t < 1) return;
  const d = my.data;
  if (!d || d.id !== myId || d.done || my.tray <= 0 || my.hand) return;
  const mesh = freeBallInTray(my);
  if (!mesh) return;
  my.hand = { mesh, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, u: uFromScreen(my, e.clientX) };
  my.tray--; placeTray(my);   // it's in your hand now
  my.g.add(aim); aim.visible = true;
  move(e);
}
function freeBallInTray(m) {   // the tray ball nearest the middle
  const busy = new Set([...m.live.map(l => l.mesh), ...m.pour.map(p => p.mesh)]);
  return m.balls.filter(b => !busy.has(b) && b.visible).sort((a, b) => Math.abs(a.position.x) - Math.abs(b.position.x))[0] || freeBall(m);
}
function move(e) {
  const h = my && my.hand;
  if (!h) return;
  h.x = e.clientX; h.y = e.clientY;
  const { power, turn } = pullOf(h);
  const v = 0.08 - power * 0.2;   // the ball comes back toward you as you pull
  h.mesh.visible = true;
  h.mesh.position.set(h.u, Math.max(H(v), trayY() - R) + R, -v);
  aim.position.set(h.u, H(0.1) + 0.004, -0.1);
  aim.rotation.set(Math.atan(SLOPE), -turn, 0, 'YXZ');   // tipped up the lane's slope, turned the way it'll go
  aim.scale.set(1, 1, 0.25 + power * 1.6);
  aimMat.color.setHSL(0.52 - power * 0.6, 1, 0.55);
  aimMat.opacity = 0.35 + power * 0.65;
}
function up(e) {
  const h = my && my.hand;
  if (!h) return;
  move(e);
  aim.visible = false;
  const { power, turn } = pullOf(h);
  if (power < 0.06) { my.hand = null; my.tray++; placeTray(my); return; }   // barely pulled: it goes back in the tray
  const m = my, d = m.data, n = BALLS - d.left;
  // everyone uses exactly the numbers that are sent, so their ball rolls the same as yours
  const roll = { n, g: d.g, by: myId, u: +h.u.toFixed(4), p: +power.toFixed(4), a: +turn.toFixed(4), t: Date.now() };
  const l = launch(m, roll.u, roll.p, roll.a);
  if (!l) return;
  l.mine = true;
  m.myLeft = d.left - 1;
  m.rolling = (m.rolling || 0) + 1;
  update(ref(db, 'game/skee/m' + m.i), { left: m.myLeft, t: serverNow() }).catch(() => {});
  set(ref(db, 'game/skee/r' + m.i), roll).catch(() => {});
  m.seen = d.g + ':' + n;
  showUi();
}
function mineDone(m, pts) {   // one of your balls finished: add up the score, and end the game after the ninth
  m.score += pts;
  m.rolling--;
  const d = m.data;
  if (!d || d.id !== myId) return;
  const fields = { score: m.score, t: serverNow() };
  const over = m.myLeft <= 0 && m.rolling <= 0;
  if (over) fields.done = true;
  update(ref(db, 'game/skee/m' + m.i), fields).catch(() => {});
  if (pts === 100) opts.banner && opts.banner('💯 100!', 2);
  if (over) {
    onDisconnect(ref(db, 'game/skee/m' + m.i)).cancel();
    if (m.score > 0) push(ref(db, 'game/skee/best'), { name: S.myName, score: m.score, t: Date.now() }).catch(() => {});
    const place = best.filter(b => b.score >= m.score).length;
    sfx.skeeOver(m.score >= (best[0] ? best[0].score : 1));
    opts.banner && opts.banner(place < 8 && m.score > 0 ? `🏆 ${m.score}! That's on the high score board` : `Game over: ${m.score}`, 4);
  }
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
const PLAY_EYE = new THREE.Vector3(0, 1.5, 1.0), PLAY_LOOK = new THREE.Vector3(0, 0.55, -2.4);   // standing just back from the tray
function enter(m) {
  my = m;
  m.g.updateMatrixWorld();
  const to = m.g.localToWorld(PLAY_EYE.clone()), look = m.g.localToWorld(PLAY_LOOK.clone());
  const toQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(to, look, new THREE.Vector3(0, 1, 0)));
  view = { t: 0, fromP: camera.position.clone(), fromQ: camera.quaternion.clone(), to, toQ };
  opts.enter && opts.enter(to.x, to.z);
  showUi();
}
function leave() {
  if (!my) return;
  const m = my, d = m.data;
  if (m.hand) { m.hand = null; m.tray++; placeTray(m); aim.visible = false; }
  if (d && d.id === myId && !d.done) {   // walked away mid-game: the machine is free again (that game doesn't count)
    update(ref(db, 'game/skee/m' + m.i), { done: true, t: serverNow() }).catch(() => {});
    onDisconnect(ref(db, 'game/skee/m' + m.i)).cancel();
  }
  my = null; view = null;
  showUi();
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  opts.leave && opts.leave(camera.position.x, camera.position.z, e.y, e.x);
}

// ---------- Everyone's machines, kept in step with the database ----------
const machines = MACHINES.map((_, i) => buildMachine(i));
machines.forEach(m => {
  onValue(ref(db, 'game/skee/m' + m.i), s => {
    const d = s.val(), was = m.data;
    m.data = d && typeof d === 'object' ? d : null;
    const playing = m.data && !stale(m.data);
    if (playing && (!was || was.g !== m.data.g)) {   // a new game: nine balls pour out of the orb
      if (m.data.left === BALLS) startPour(m, BALLS);
      else { m.tray = m.data.left; m.pour = []; placeTray(m); }   // walked in partway through someone's game
      m.seen = m.data.g + ':-1';
    } else if (!playing && !m.live.length) { m.tray = 0; m.pour = []; placeTray(m); }
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
    launch(m, Math.max(-HALF + R, Math.min(HALF - R, +r.u || 0)), Math.max(0, Math.min(1, +r.p || 0)), Math.max(-0.14, Math.min(0.14, +r.a || 0)));
  }, () => {});
});

// ---------- Every frame ----------
let blinkT = 0;
function updateAll(dt) {
  blinkT += dt;
  const blink = Math.floor(blinkT * 1.6) % 2 === 0;
  let roll = 0;
  for (const m of machines) {
    updatePour(m, dt);
    roll = Math.max(roll, updateLive(m, dt));
    m.orb.rotation.z -= dt * 0.25;                       // the orb's galaxy slowly turns
    m.flash = Math.max(0, (m.flash || 0) - dt * 3);      // and flares as a ball comes out
    m.glow.material.opacity = 0.45 + 0.1 * Math.sin(blinkT * 2 + m.i) + m.flash * 0.5;
    m.orbLight.intensity = 1.2 + m.flash * 4;
    paintSign(m, blink);
  }
  sfx.skeeRoll(roll);
  if (view) {   // glide up to the machine, then stay put
    view.t = Math.min(1, view.t + dt / 0.8);
    const k = view.t * view.t * (3 - 2 * view.t);
    camera.position.lerpVectors(view.fromP, view.to, k);
    camera.quaternion.slerpQuaternions(view.fromQ, view.toQ, k);
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