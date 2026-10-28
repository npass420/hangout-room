// =====================================================================
// trail.js — LittleTrail, the mountain trail market game
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, scene, TABLE_Y, seatAngle, rnd, paintTexture, box, std, easeInOut,
         RAINBOW, RAINBOW_CSS, colorIndex, makeLabel,
         makeCounter, drawCounter, placeCounter, sinkCounter, animateCounter } from './core.js';
import { validPlayer, othelloGroup } from './othello.js';
import { sfx } from './sounds.js';

export const trailGroup = new THREE.Group();   // the hill and everything on it, hidden while Othello is on the table
trailGroup.visible = false;
scene.add(trailGroup);
const trailRef = ref(db, 'room/trail');
let trail = null;            // the shared LittleTrail state
let trailBusy = false;       // dice or pawns are moving

// ---------- Money and rules ----------
const SPOTS = 32, START_COINS = 5000, LAP_PAY = 300, GOAL = 10000, MAX_TRAIL = 6;
const RANGER = 8, HOT_SPRING = 16, ROCKSLIDE = 24, HOT_SPRING_PAY = 50, ROCKSLIDE_FEE = 50;
const LENGTHS = [45, 60, 90];   // game length choices, in minutes until sunset

// Areas climb the hill: 3 stalls each, prices go up as you climb
const AREAS = [
  { name: 'Meadow',         color: '#7cc35a', buy: 100, up: 50,  rent: [10, 40, 120, 300] },
  { name: 'Pine Forest',    color: '#2e7d4f', buy: 160, up: 80,  rent: [15, 60, 180, 450] },
  { name: 'Creek Crossing', color: '#3aa0c8', buy: 220, up: 110, rent: [20, 85, 250, 600] },
  { name: 'Waterfall',      color: '#5b7fe0', buy: 300, up: 150, rent: [30, 120, 350, 800] },
  { name: 'Cliff Ridge',    color: '#a0703c', buy: 380, up: 190, rent: [40, 160, 450, 1000] },
  { name: 'Snowline',       color: '#dfe8f0', buy: 460, up: 230, rent: [50, 200, 550, 1200] },
  { name: 'Alpine Lake',    color: '#2bb7b0', buy: 530, up: 265, rent: [55, 225, 625, 1350] },
  { name: 'Summit',         color: '#e0b23a', buy: 600, up: 300, rent: [60, 250, 700, 1500] }
];
const SPECIALS = {
  0:  { name: 'Trailhead',      color: '#f5e6b8', desc: `Start · +${LAP_PAY} every time you pass` },
  4:  { name: 'Weather',        color: '#8e5ec9', desc: 'Draw a Weather card', weather: true },
  8:  { name: 'Ranger Station', color: '#4b6b45', desc: 'Just visiting' },
  12: { name: 'Weather',        color: '#8e5ec9', desc: 'Draw a Weather card', weather: true },
  16: { name: 'Hot Spring',     color: '#ff8a65', desc: `Rest and collect +${HOT_SPRING_PAY}` },
  20: { name: 'Weather',        color: '#8e5ec9', desc: 'Draw a Weather card', weather: true },
  24: { name: 'Rockslide',      color: '#77736d', desc: `Slide down to the Ranger Station · pay ${ROCKSLIDE_FEE}` },
  28: { name: 'Weather',        color: '#8e5ec9', desc: 'Draw a Weather card', weather: true }
};
function spotInfo(k) {
  if (SPECIALS[k]) return { ...SPECIALS[k], special: true };
  const a = AREAS[Math.floor(k / 4)];
  return { name: a.name, color: a.color, desc: `Stall · buy ${a.buy} · rent from ${a.rent[0]}` };
}

// ---------- The hill: low and wide, so you can see across the table ----------
const MTN_R = 0.84, MTN_H = 0.32, MTN_TOP = 0.12;
function mtnNoise(th, y) {
  return 0.022 * Math.sin(5 * th + y * 9) + 0.014 * Math.sin(11 * th - y * 17 + 1.3) + 0.008 * Math.sin(23 * th + y * 31);
}
function mtnSurfaceR(th, y) {   // how far the surface is from the center at this angle and height
  return (MTN_R - (MTN_R - MTN_TOP) * (y / MTN_H)) + mtnNoise(th, y) * (1 - 0.7 * y / MTN_H);
}
function mtnHeightAt(th, r) {   // how high the ground is at this angle and distance from the center
  let lo = 0, hi = MTN_H;
  if (r >= mtnSurfaceR(th, 0)) return 0;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (mtnSurfaceR(th, mid) > r) lo = mid; else hi = mid;
  }
  return lo;
}
export const mountainMesh = (function mountain() {
  const geo = new THREE.CylinderGeometry(MTN_TOP, MTN_R, MTN_H, 72, 12, false);
  const pos = geo.attributes.position;
  const colors = [], c = new THREE.Color();
  const grass = new THREE.Color(0x4f7d3a), rock = new THREE.Color(0x7d746a), snow = new THREE.Color(0xf2f4f7);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), yy = pos.getY(i) + MTN_H / 2;
    const r = Math.hypot(x, z), th = Math.atan2(x, z);
    if (r > 0.0001) {
      const nr = mtnSurfaceR(th, yy);
      pos.setX(i, Math.sin(th) * nr); pos.setZ(i, Math.cos(th) * nr);
    }
    const t = yy / MTN_H + 0.06 * Math.sin(th * 7 + yy * 20);
    if (t < 0.45) c.copy(grass);
    else if (t < 0.55) c.copy(grass).lerp(rock, (t - 0.45) / 0.1);
    else if (t < 0.8) c.copy(rock);
    else if (t < 0.86) c.copy(rock).lerp(snow, (t - 0.8) / 0.06);
    else c.copy(snow);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  m.position.y = TABLE_Y + MTN_H / 2;
  m.castShadow = true; m.receiveShadow = true;
  m.userData.mountain = true;
  trailGroup.add(m);
  return m;
})();
export const MTN_TARGET = new THREE.Vector3(0, TABLE_Y + 0.12, 0);   // where board view looks

// Sunlight on the hill: turns golden, then orange, as sunset gets close
const trailSun = new THREE.DirectionalLight(0xffffff, 0);
trailSun.position.set(1.5, 2.5, 1);
trailGroup.add(trailSun);
const SUN_DAY = new THREE.Color(0xfff4e0), SUN_GOLD = new THREE.Color(0xffc070), SUN_SET = new THREE.Color(0xff6a3d);

// ---------- The trail: 32 stepping stones spiraling up, evenly spaced ----------
const spotPos = [];
(function trailPath() {
  const N = 600, TURNS = 1.25, TH0 = Math.PI / 8;
  const samples = [], dist = [0];
  for (let i = 0; i <= N; i++) {
    const u = i / N, y = 0.03 + 0.22 * u, th = TH0 + u * TURNS * Math.PI * 2;
    const r = mtnSurfaceR(th, y) + 0.02;
    samples.push(new THREE.Vector3(Math.sin(th) * r, TABLE_Y + y, Math.cos(th) * r));
    if (i) dist.push(dist[i - 1] + samples[i].distanceTo(samples[i - 1]));
  }
  let j = 0;
  for (let k = 0; k < SPOTS; k++) {
    const target = dist[N] * k / (SPOTS - 1);
    while (j < N - 1 && dist[j + 1] < target) j++;
    const f = (target - dist[j]) / ((dist[j + 1] - dist[j]) || 1);
    spotPos.push(samples[j].clone().lerp(samples[j + 1], f));
  }
})();

export const spotMeshes = [];
spotPos.forEach((p, k) => {
  const info = spotInfo(k);
  const big = k === 0 || k === SPOTS - 1;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(big ? 0.052 : 0.042, big ? 0.056 : 0.046, 0.016, 24), std(new THREE.Color(info.color), 0.6));
  m.position.copy(p);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.spot = k;
  trailGroup.add(m);
  spotMeshes.push(m);
});

// Dirt path linking the stones
(function dirtPath() {
  const curve = new THREE.CatmullRomCurve3(spotPos.map(p => p.clone().add(new THREE.Vector3(0, -0.005, 0))));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 320, 0.013, 6), std(0xa98a60, 0.95));
  tube.receiveShadow = true;
  trailGroup.add(tube);
})();

// Little pine trees on the lower slopes
(function trees() {
  const trunkMat = std(0x5a3a24), leafMat = std(0x2f5d34, 0.9);
  let placed = 0, tries = 0;
  while (placed < 26 && tries < 600) {
    tries++;
    const th = rnd() * Math.PI * 2, y = 0.02 + rnd() * 0.12;
    const r = mtnSurfaceR(th, y);
    const p = new THREE.Vector3(Math.sin(th) * r, TABLE_Y + y, Math.cos(th) * r);
    if (spotPos.some(s => s.distanceTo(p) < 0.1)) continue;   // keep room for the stalls
    const s = 0.6 + rnd() * 0.6;
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.006 * s, 0.006 * s, 0.03 * s, 6), trunkMat);
    trunk.position.y = 0.015 * s;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03 * s, 0.09 * s, 8), leafMat);
    cone.position.y = 0.06 * s;
    cone.castShadow = true;
    g.add(trunk, cone);
    g.position.copy(p);
    trailGroup.add(g);
    placed++;
  }
})();

// Signs over the Trailhead and the Summit
(function signs() {
  const a = makeLabel('Trailhead', '#f5e6b8');
  a.position.copy(spotPos[0]).add(new THREE.Vector3(0, 0.1, 0));
  a.scale.set(0.32, 0.08, 1);
  const b = makeLabel('Summit', '#e0b23a');
  b.position.copy(spotPos[SPOTS - 1]).add(new THREE.Vector3(0, 0.1, 0));
  b.scale.set(0.32, 0.08, 1);
  trailGroup.add(a, b);
})();

// ---------- Chairlift from the Summit back down to the Trailhead ----------
const liftChairs = [];
let liftA, liftB;
(function chairlift() {
  const metal = std(0x3a3a3a, 0.5, { metalness: 0.5 });
  const top = spotPos[SPOTS - 1].clone().multiplyScalar(0.55); top.y = spotPos[SPOTS - 1].y;
  const baseAng = Math.PI / 8 - 0.2;
  const bottom = new THREE.Vector3(Math.sin(baseAng) * 0.88, TABLE_Y, Math.cos(baseAng) * 0.88);
  function pole(p, h) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, h, 8), metal);
    m.position.set(p.x, p.y + h / 2, p.z);
    m.castShadow = true;
    trailGroup.add(m);
    return new THREE.Vector3(p.x, p.y + h, p.z);
  }
  liftA = pole(top, 0.16);
  liftB = pole(bottom, 0.3);
  const dir = new THREE.Vector3().subVectors(liftB, liftA);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, dir.length(), 6), std(0x222222, 0.5));
  cable.position.copy(liftA).add(liftB).multiplyScalar(0.5);
  cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  trailGroup.add(cable);
  for (let i = 0; i < 3; i++) {
    const chair = new THREE.Group();
    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.03, 4), metal);
    hanger.position.y = -0.015;
    const seatBox = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.02), std(0xc0392b, 0.6));
    seatBox.position.y = -0.032;
    chair.add(hanger, seatBox);
    trailGroup.add(chair);
    liftChairs.push({ g: chair, t: i / 3 });
  }
})();

// ---------- Jobs: each player's game piece is a tiny model of their trade ----------
const JOBS = [
  { id: 'icecream',  name: 'Ice Cream', icon: '🍦' },
  { id: 'coffee',    name: 'Coffee',    icon: '☕' },
  { id: 'grill',     name: 'Grill',     icon: '🍔' },
  { id: 'bar',       name: 'Bar',       icon: '🍺' },
  { id: 'wine',      name: 'Wine',      icon: '🍷' },
  { id: 'toys',      name: 'Toys',      icon: '🦆' },
  { id: 'bakery',    name: 'Bakery',    icon: '🧁' },
  { id: 'outfitter', name: 'Outfitter', icon: '🏮' }
];
function jobInfo(id) { return JOBS.find(j => j.id === id) || JOBS[0]; }
const LEVELS = ['Cart', 'Stand', 'Shop', 'Lodge'];

// A little model about 1 unit tall, standing on y = 0, in its natural colors
function makeJobModel(job) {
  const g = new THREE.Group();
  const add = (geo, color, x, y, z, rough = 0.6, extra = {}) => {
    const m = new THREE.Mesh(geo, std(color, rough, extra));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  switch (job) {
    case 'coffee':
      add(new THREE.CylinderGeometry(0.3, 0.26, 0.6, 20), 0xf4f1ea, 0, 0.3, 0, 0.4);
      add(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 20), 0x4a2a14, 0, 0.6, 0);
      add(new THREE.TorusGeometry(0.14, 0.05, 8, 16), 0xf4f1ea, 0.3, 0.32, 0, 0.4);
      add(new THREE.SphereGeometry(0.09, 8, 6), 0xffffff, -0.05, 0.78, 0, 1, { transparent: true, opacity: 0.6 });
      add(new THREE.SphereGeometry(0.07, 8, 6), 0xffffff, 0.06, 0.92, 0, 1, { transparent: true, opacity: 0.45 });
      break;
    case 'grill': {
      add(new THREE.CylinderGeometry(0.35, 0.33, 0.15, 20), 0xd9a25b, 0, 0.075, 0);
      add(new THREE.CylinderGeometry(0.37, 0.37, 0.12, 20), 0x5a3218, 0, 0.21, 0, 0.9);
      const cheese = add(new THREE.BoxGeometry(0.62, 0.04, 0.62), 0xf4c430, 0, 0.29, 0);
      cheese.rotation.y = Math.PI / 4;
      add(new THREE.CylinderGeometry(0.38, 0.38, 0.03, 20), 0x5aa83a, 0, 0.32, 0);
      const bun = add(new THREE.SphereGeometry(0.35, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0xd9a25b, 0, 0.33, 0);
      bun.scale.y = 0.8;
      break;
    }
    case 'bar':
      add(new THREE.CylinderGeometry(0.28, 0.28, 0.6, 20), 0xe0a020, 0, 0.3, 0, 0.3);
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 20), 0xfffaf0, 0, 0.64, 0, 0.9);
      add(new THREE.SphereGeometry(0.17, 12, 8), 0xfffaf0, 0.08, 0.72, 0, 0.9);
      add(new THREE.TorusGeometry(0.15, 0.05, 8, 16), 0xe0a020, 0.3, 0.3, 0, 0.3);
      break;
    case 'wine':
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 20), 0x1f4d2b, 0, 0.3, 0, 0.3);
      add(new THREE.CylinderGeometry(0.205, 0.205, 0.25, 20), 0xf1e6c8, 0, 0.3, 0, 0.8);
      add(new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x1f4d2b, 0, 0.6, 0, 0.3);
      add(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12), 0x1f4d2b, 0, 0.82, 0, 0.3);
      add(new THREE.CylinderGeometry(0.078, 0.078, 0.1, 12), 0x8e1b2b, 0, 0.97, 0);
      break;
    case 'toys': {
      const body = add(new THREE.SphereGeometry(0.33, 16, 12), 0xffd23a, 0, 0.32, -0.04, 0.4);
      body.scale.set(1.15, 0.85, 1.25);
      add(new THREE.SphereGeometry(0.2, 16, 12), 0xffd23a, 0, 0.72, 0.14, 0.4);
      const beak = add(new THREE.ConeGeometry(0.08, 0.2, 10), 0xff8c1a, 0, 0.7, 0.4, 0.5);
      beak.rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(0.035, 8, 6), 0x111111, 0.1, 0.8, 0.28, 0.3);
      add(new THREE.SphereGeometry(0.035, 8, 6), 0x111111, -0.1, 0.8, 0.28, 0.3);
      break;
    }
    case 'bakery': {
      add(new THREE.CylinderGeometry(0.3, 0.22, 0.4, 16), 0x7fc8e8, 0, 0.2, 0);
      const frost = add(new THREE.SphereGeometry(0.32, 16, 12), 0xf6c1d9, 0, 0.5, 0, 0.7);
      frost.scale.y = 0.8;
      add(new THREE.ConeGeometry(0.18, 0.25, 16), 0xf6c1d9, 0, 0.8, 0, 0.7);
      add(new THREE.SphereGeometry(0.08, 10, 8), 0xc0392b, 0, 0.96, 0, 0.3);
      break;
    }
    case 'outfitter':
      add(new THREE.CylinderGeometry(0.25, 0.27, 0.08, 16), 0x2b2b2b, 0, 0.04, 0, 0.5, { metalness: 0.5 });
      add(new THREE.CylinderGeometry(0.19, 0.19, 0.5, 16), 0xffd36b, 0, 0.33, 0, 0.4, { emissive: 0xffb020, emissiveIntensity: 0.9 });
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        add(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), 0x2b2b2b, Math.sin(a) * 0.21, 0.33, Math.cos(a) * 0.21, 0.5, { metalness: 0.5 });
      }
      add(new THREE.ConeGeometry(0.28, 0.2, 16), 0x2b2b2b, 0, 0.68, 0, 0.5, { metalness: 0.5 });
      add(new THREE.TorusGeometry(0.11, 0.025, 8, 16), 0x2b2b2b, 0, 0.88, 0, 0.5, { metalness: 0.5 });
      break;
    default: {   // ice cream
      const cone = add(new THREE.ConeGeometry(0.28, 0.65, 16), 0xd9a25b, 0, 0.325, 0);
      cone.rotation.x = Math.PI;
      add(new THREE.SphereGeometry(0.3, 16, 12), 0xf7a8c4, 0, 0.72, 0, 0.7);
      add(new THREE.SphereGeometry(0.07, 8, 6), 0xc0392b, 0, 1.03, 0, 0.3);
    }
  }
  return g;
}
function sizedJobModel(job, height) {   // the model scaled to a given height
  const m = makeJobModel(job);
  const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
  m.scale.setScalar(height / (size.y || 1));
  return m;
}

// ---------- Pawns: your job's model on a little base in your rainbow color ----------
const pawns = {};   // id -> { g, c, job, anim }
function makePawn(c, job) {
  const g = new THREE.Group();
  const baseDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.008, 20), std(new THREE.Color(RAINBOW[c]), 0.5));
  baseDisc.position.y = 0.004;
  baseDisc.castShadow = true;
  const model = sizedJobModel(job, 0.05);
  model.position.y = 0.008;
  g.add(baseDisc, model);
  trailGroup.add(g);
  return g;
}
function pawnSpotPos(k, rank) {   // several pawns on one stone stand in a little ring, nudged toward the outside edge
  const p = spotPos[k].clone();
  const out = new THREE.Vector3(p.x, 0, p.z).normalize();
  p.addScaledVector(out, 0.01);
  p.y += 0.008;
  const ang = rank * Math.PI / 3;
  p.x += Math.sin(ang) * 0.02; p.z += Math.cos(ang) * 0.02;
  return p;
}

// ---------- Booths: what you own shows up just uphill from the stone ----------
const booths = {};   // spot -> { g, key }
function makeBooth(c, job, lv, k) {
  const g = new THREE.Group();
  const s = [0.75, 0.95, 1.15, 1.4][lv] || 1;
  const wood = std(0x8a5a33, 0.8);
  const col = std(new THREE.Color(RAINBOW[c]), 0.6);
  box(0.04 * s, 0.026 * s, 0.026 * s, wood, 0, 0.013 * s, 0, g);             // the stall
  box(0.03 * s, 0.006 * s, 0.002, std(0xf1e6c8, 0.8), 0, 0.018 * s, 0.0135 * s, g);   // counter sign
  const awning = box(0.048 * s, 0.004 * s, 0.024 * s, col, 0, 0.03 * s, 0.012 * s, g);
  awning.rotation.x = 0.35;                                                  // tilted down toward the trail
  if (lv >= 2) box(0.004, 0.02 * s, 0.004, wood, -0.022 * s, 0.04 * s, -0.01 * s, g);   // a flag pole for Shops and Lodges
  if (lv >= 3) box(0.012 * s, 0.008 * s, 0.002, col, -0.016 * s, 0.047 * s, -0.01 * s, g);
  const item = sizedJobModel(job, 0.022 * s);
  item.position.y = 0.026 * s;
  g.add(item);
  const p = spotPos[k];
  const th = Math.atan2(p.x, p.z);
  const r = Math.hypot(p.x, p.z) - 0.04;
  g.position.set(Math.sin(th) * r, TABLE_Y + mtnHeightAt(th, r) - 0.003, Math.cos(th) * r);   // sitting on the slope
  g.rotation.y = th;   // facing out toward the trail
  trailGroup.add(g);
  return g;
}
function syncBooths() {
  const want = {};
  for (let k = 0; k < SPOTS; k++) {
    const st = stallOwner(trail, k);
    if (st) {
      const p = trail.players[st.o];
      want[k] = `${st.o}|${st.lv}|${colorIndex(p)}|${p.job}`;
    }
  }
  for (const k of Object.keys(booths)) {
    if (booths[k].key !== want[k]) { trailGroup.remove(booths[k].g); delete booths[k]; }
  }
  for (const k of Object.keys(want)) {
    if (!booths[k]) {
      const st = stallOwner(trail, +k), p = trail.players[st.o];
      booths[k] = { g: makeBooth(colorIndex(p), p.job, st.lv, +k), key: want[k] };
    }
  }
}

// ---------- Weather deck: 8 good, 8 bad, shuffled; every card comes up once before a reshuffle ----------
const WEATHER = [
  { text: 'Sunny day! +100', kind: 'coins', n: 100 },
  { text: 'Busy weekend! +150', kind: 'coins', n: 150 },
  { text: 'Found a lost wallet! +75', kind: 'coins', n: 75 },
  { text: 'Tip jar is full! +50', kind: 'coins', n: 50 },
  { text: 'Tailwind! Move ahead 3', kind: 'move', n: 3 },
  { text: `Chairlift pass! Ride to the Trailhead, +${LAP_PAY}`, kind: 'goto', to: 0, lap: true },
  { text: 'Hot Spring pass! Off to the Hot Spring', kind: 'goto', to: HOT_SPRING },
  { text: 'Festival! Everyone gives 25 to whoever has the fewest coins', kind: 'festival' },
  { text: 'Thunderstorm! −100', kind: 'coins', n: -100 },
  { text: 'Hail! −75', kind: 'coins', n: -75 },
  { text: 'Flat tire! −50', kind: 'coins', n: -50 },
  { text: 'Muddy trail! −50', kind: 'coins', n: -50 },
  { text: 'Mudslide! Move back 3', kind: 'move', n: -3 },
  { text: 'Rockslide! Go to the Ranger Station', kind: 'goto', to: RANGER },
  { text: 'Windstorm! Pay 25 to each other player', kind: 'windstorm' },
  { text: 'Repairs! Pay 25 for each booth level you own', kind: 'repairs' }
];
function newDeck() {
  const a = WEATHER.map((_, i) => i);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.join(',');
}

// ---------- Players, turns and rules (these work on a copy of the shared state) ----------
function trailIds(t = trail) {
  return Object.entries((t && t.players) || {}).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
}
function validTrailIds(t = trail) { return trailIds(t).filter(id => S.presence[id]); }               // still in the room
function activeIds(t = trail) { return validTrailIds(t).filter(id => !t.players[id].out); }         // still in the game
function gameIsDead(t = trail) { return !!t && t.phase === 'play' && activeIds(t).length < 2; }    // everyone left mid-game
function nextAfter(t, id) {
  const all = trailIds(t);
  const i = all.indexOf(id);
  for (let k = 1; k <= all.length; k++) {
    const cand = all[(i + k + all.length) % all.length];
    if (cand !== id && S.presence[cand] && !t.players[cand].out) return cand;
  }
  return '';
}
function effectiveTurn(t = trail) {   // whose turn it really is (skips anyone who left or is out)
  if (!t || t.phase !== 'play') return '';
  const ids = activeIds(t);
  if (!ids.length) return '';
  if (ids.includes(t.turn)) return t.turn;
  return nextAfter(t, t.turn) || ids[0];
}
function areaOf(k) { return Math.floor(k / 4); }
function stallOwner(t, k) {   // the stall's owner, if they're still playing
  const st = t && t.stalls && t.stalls['s' + k];
  if (!st || !t.players || !t.players[st.o] || !S.presence[st.o] || t.players[st.o].out) return null;
  return st;
}
function ownsArea(t, id, a) {
  return [1, 2, 3].every(i => { const st = stallOwner(t, a * 4 + i); return st && st.o === id; });
}
function rentFor(t, k) {
  const st = stallOwner(t, k);
  if (!st) return 0;
  let r = AREAS[areaOf(k)].rent[st.lv];
  if (st.lv === 0 && ownsArea(t, st.o, areaOf(k))) r *= 2;   // own the whole area: Cart rent doubles
  return r;
}
function worth(t, id) {   // coins plus what you paid for your stalls and upgrades
  let w = t.players[id].coins || 0;
  for (const [key, st] of Object.entries(t.stalls || {})) {
    if (st.o !== id) continue;
    const a = AREAS[areaOf(+key.slice(1))];
    w += a.buy + st.lv * a.up;
  }
  return w;
}
function goBroke(t, id, log, why) {
  const p = t.players[id];
  if (p.out) return;
  p.out = true;
  p.coins = 0;
  for (const key of Object.keys(t.stalls || {})) if (t.stalls[key].o === id) delete t.stalls[key];   // stalls go back up for sale
  if (log) log.push(why || `${p.name} ran out of coins and is out of the game!`);
}
function payUpTo(t, id, n, log) {   // pay what you can; hitting 0 puts you out
  const p = t.players[id];
  if (p.out || n <= 0) return 0;
  const paid = Math.min(n, p.coins);
  p.coins -= paid;
  if (p.coins <= 0) goBroke(t, id, log);
  return paid;
}
function payRent(t, id, ownerId, rent, log) {
  const p = t.players[id], o = t.players[ownerId];
  if (p.coins > rent) {
    p.coins -= rent; o.coins += rent;
    log.push(`${p.name} paid ${o.name} ${rent} rent`);
  } else {
    o.coins += p.coins;
    goBroke(t, id, log, `${p.name} couldn't pay ${rent} rent to ${o.name} and is out of the game!`);
  }
}
function moveBy(t, id, n, log) {
  const p = t.players[id];
  const raw = p.pos + n;
  if (raw >= SPOTS) { p.coins += LAP_PAY; log.push(`${p.name} passed the Trailhead (+${LAP_PAY})`); }
  p.pos = ((raw % SPOTS) + SPOTS) % SPOTS;
}
function drawWeather(t, id, log, depth) {
  if (!t.deck || (t.deckPos || 0) >= WEATHER.length) { t.deck = newDeck(); t.deckPos = 0; }
  const card = WEATHER[+t.deck.split(',')[t.deckPos]];
  t.deckPos++;
  const p = t.players[id];
  log.push(`🌦 ${p.name} drew: ${card.text}`);
  const others = activeIds(t).filter(q => q !== id);
  if (card.kind === 'coins') {
    if (card.n > 0) p.coins += card.n; else payUpTo(t, id, -card.n, log);
  } else if (card.kind === 'move') {
    moveBy(t, id, card.n, log);
    if (depth < 2) landOn(t, id, log, depth + 1);
  } else if (card.kind === 'goto') {
    p.pos = card.to;
    if (card.lap) p.coins += LAP_PAY;
    if (depth < 2) landOn(t, id, log, depth + 1);
  } else if (card.kind === 'festival') {
    const ids = activeIds(t);
    const poorest = ids.reduce((a, b) => (t.players[b].coins < t.players[a].coins ? b : a), ids[0]);
    let got = 0;
    for (const q of ids) if (q !== poorest) got += payUpTo(t, q, 25, log);
    t.players[poorest].coins += got;
    log.push(`${t.players[poorest].name} collected ${got} from the Festival`);
  } else if (card.kind === 'windstorm') {
    for (const q of others) t.players[q].coins += payUpTo(t, id, 25, log);
  } else if (card.kind === 'repairs') {
    let levels = 0;
    for (const st of Object.values(t.stalls || {})) if (st.o === id) levels += st.lv + 1;
    if (levels) log.push(`${p.name} paid ${payUpTo(t, id, 25 * levels, log)} for repairs`);
  }
}
// What happens on the stone you land on
function landOn(t, id, log, depth = 0) {
  const p = t.players[id], k = p.pos;
  if (p.out) return;
  if (k === HOT_SPRING) { p.coins += HOT_SPRING_PAY; log.push(`${p.name} rested at the Hot Spring (+${HOT_SPRING_PAY})`); return; }
  if (k === ROCKSLIDE) {
    p.pos = RANGER;
    log.push(`${p.name} got caught in a Rockslide and slid down to the Ranger Station (−${ROCKSLIDE_FEE})`);
    payUpTo(t, id, ROCKSLIDE_FEE, log);
    return;
  }
  if (SPECIALS[k]) { if (SPECIALS[k].weather) drawWeather(t, id, log, depth); return; }
  const a = AREAS[areaOf(k)], st = stallOwner(t, k);
  if (!st) {
    if (p.coins > a.buy) t.pending = { who: id, k, type: 'buy' };
    else log.push(`${p.name} can't afford the ${a.name} stall (${a.buy})`);
  } else if (st.o === id) {
    if (st.lv < 3 && p.coins > a.up) t.pending = { who: id, k, type: 'up' };
  } else {
    payRent(t, id, st.o, rentFor(t, k), log);
  }
}
function checkWin(t, log) {
  if (t.phase !== 'play') return;
  const ids = activeIds(t);
  let w = ids.find(id => t.players[id].coins >= GOAL);
  if (!w && ids.length === 1 && trailIds(t).some(id => t.players[id].out)) w = ids[0];
  if (w) {
    t.phase = 'over'; t.winner = w; delete t.pending;
    log.push(`🏆 ${t.players[w].name} wins LittleTrail!`);
  }
}
function sunsetEnd(t, log) {   // time's up: the richest player wins (coins + stalls)
  const ids = activeIds(t);
  if (!ids.length) return;
  const w = ids.reduce((a, b) => (worth(t, b) > worth(t, a) ? b : a), ids[0]);
  t.phase = 'over'; t.winner = w; delete t.pending;
  log.push(`🌅 The sun has set! ${t.players[w].name} wins with ${worth(t, w).toLocaleString()} (coins + stalls)`);
}
function sunsetPassed(t) { return t.phase === 'play' && t.endsAt && serverNow() >= t.endsAt; }
function finishTurn(t, id) {
  if (t.phase === 'play' && !t.pending) t.turn = nextAfter(t, id) || id;
}
function postLog(t, log) {   // remember what happened so everyone's chat can show it
  t.note = log.join('\n');
  if (log.length) t.ev = (t.ev || 0) + 1;
}
function resetPlayers(t) {
  for (const id of Object.keys(t.players || {})) {
    const p = t.players[id];
    p.pos = 0; p.coins = START_COINS; p.out = false;
  }
  delete t.stalls; delete t.pending; delete t.dice; delete t.deck; delete t.endsAt;
  t.deckPos = 0; t.note = ''; t.mover = ''; t.winner = ''; t.passed = false;
}

function syncPawns() {
  const ids = activeIds();
  const players = (trail && trail.players) || {};
  for (const id of Object.keys(pawns)) {
    const p = players[id];
    if (!ids.includes(id) || colorIndex(p) !== pawns[id].c || p.job !== pawns[id].job) {
      trailGroup.remove(pawns[id].g);
      delete pawns[id];
    }
  }
  ids.forEach((id, rank) => {
    if (!pawns[id]) {
      const p = players[id], c = colorIndex(p);
      pawns[id] = { g: makePawn(c, p.job), c, job: p.job, anim: null };
      pawns[id].g.position.copy(pawnSpotPos(p.pos || 0, rank));
    }
  });
}
function placeAllPawns() {
  const players = (trail && trail.players) || {};
  activeIds().forEach((id, rank) => {
    if (pawns[id]) { pawns[id].anim = null; pawns[id].g.position.copy(pawnSpotPos(players[id].pos || 0, rank)); }
  });
}

// ---------- Sounds for what happened ----------
let queuedLines = null;   // sounds waiting until the pawn finishes moving
function playLineSounds(lines) {
  lines.forEach((line, i) => setTimeout(() => {
    if (/🏆|🌅/.test(line)) sfx.win();
    else if (/out of the game/.test(line)) sfx.out();
    else if (/🌦/.test(line)) sfx.card();
    else if (/opened|upgraded/.test(line)) sfx.buy();
    else if (/rent|Hot Spring|Trailhead|Festival/.test(line)) sfx.coin();
  }, i * 350));
}

// ---------- Dice ----------
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]]
};
const FACE_NORMAL = { 1: [0, 1, 0], 6: [0, -1, 0], 3: [1, 0, 0], 4: [-1, 0, 0], 2: [0, 0, 1], 5: [0, 0, -1] };
const diceMats = [3, 4, 1, 6, 2, 5].map(n => std(0xffffff, 0.4, { map: paintTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#f6f1e4'; g.fillRect(0, 0, w, h);
  g.fillStyle = n === 1 ? '#b3261e' : '#222222';
  for (const [x, y] of PIPS[n]) { g.beginPath(); g.arc(x * w, y * h, n === 1 ? 14 : 11, 0, Math.PI * 2); g.fill(); }
}) }));
const DIE = 0.055;
const dice = [0, 1].map(() => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE, DIE), diceMats);
  m.castShadow = true;
  m.visible = false;
  trailGroup.add(m);
  return m;
});
function diceFinalQuat(v, yaw) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...FACE_NORMAL[v]), new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(q);
}
let rollAnim = null;
function startRoll(t) {
  const mover = t.players[t.mover];
  const a = seatAngle(mover.seat >= 0 ? mover.seat : 0);
  const rank = activeIds(t).indexOf(t.mover);
  if (pawns[t.mover] && rank >= 0) pawns[t.mover].g.position.copy(pawnSpotPos(t.from, rank));   // start from where they were
  rollAnim = { t: 0, dur: 0.9, items: [] };
  [-0.33, 0.33].forEach((off, i) => {
    const ang = a + off;
    const land = new THREE.Vector3(Math.sin(ang) * 0.91, TABLE_Y + DIE / 2, Math.cos(ang) * 0.91);
    const start = land.clone().multiplyScalar(1.06); start.y = land.y + 0.35;
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    rollAnim.items.push({ mesh: dice[i], start, land, qFinal: diceFinalQuat(t.dice[i], Math.random() * Math.PI * 2), axis });
    dice[i].visible = true;
  });
  rollAnim.after = () => startHop(t);
  sfx.dice();
}
function moveDone() {
  trailBusy = false;
  placeAllPawns();
  refreshTrailUI();
  if (queuedLines) { playLineSounds(queuedLines); queuedLines = null; }
}
function startHop(t) {
  const pw = pawns[t.mover];
  if (!pw) { moveDone(); return; }
  const path = [];
  for (let s = 1; s <= t.steps; s++) path.push({ k: (t.from + s) % SPOTS });
  const finalPos = t.players[t.mover].pos;
  if (path[path.length - 1].k !== finalPos) path.push({ k: finalPos, jump: true });   // a Weather card or Rockslide moved them on
  pw.anim = { path, i: 0, t: 0, prev: t.from, rank: activeIds(t).indexOf(t.mover) };
}
function finishTrailAnims() {
  if (rollAnim) {
    for (const it of rollAnim.items) { it.mesh.position.copy(it.land); it.mesh.quaternion.copy(it.qFinal); }
    rollAnim = null;
  }
  for (const id of Object.keys(pawns)) pawns[id].anim = null;
  trailBusy = false;
  if (queuedLines) { playLineSounds(queuedLines); queuedLines = null; }
}

// ---------- Coin counters in front of each player ----------
const trailCounters = {};   // id -> counter
const TRAIL_CNT_DIST = 0.945;
function refreshTrailCounters() {
  const players = (trail && trail.players) || {};
  const ids = validTrailIds();
  for (const id of ids) {
    const seat = players[id].seat;
    if (!trailCounters[id]) trailCounters[id] = makeCounter(31, 0.24, trailGroup);
    const cnt = trailCounters[id];
    if (seat >= 0 && (!cnt.active || cnt.seat !== seat)) placeCounter(cnt, seat, TRAIL_CNT_DIST);
  }
  for (const id of Object.keys(trailCounters)) {
    if (!ids.includes(id) && trailCounters[id].active) sinkCounter(trailCounters[id]);
  }
}

// ---------- Applying the shared state ----------
function applyTrail(t) {
  const prev = trail;
  trail = t || { phase: 'lobby', rollNo: 0 };
  syncPawns();
  syncBooths();
  const players = trail.players || {};
  const isNextRoll = prev && trail.rollNo === (prev.rollNo || 0) + 1 && trail.mover && players[trail.mover] && trail.dice;
  const lines = prev && (trail.ev || 0) > (prev.ev || 0) && trail.note ? trail.note.split('\n') : [];
  if (isNextRoll && S.activeGame === 'trail') {
    finishTrailAnims();
    trailBusy = true;
    if (lines.length) queuedLines = lines;   // play these once the pawn arrives
    startRoll(trail);
  } else {
    if (!trailBusy) placeAllPawns();
    if (lines.length && S.activeGame === 'trail') playLineSounds(lines);
  }
  lines.forEach(line => hooks.addSys(line));   // tell the chat what happened
  refreshTrailUI();
  refreshTrailCounters();
}

// ---------- Actions ----------
let chosenMins = 60;   // the game length you picked
function trailJoin(job) {
  if (!trail || S.seated < 0) return;
  const seat = S.seated;
  runTransaction(trailRef, t => {
    t = t || { phase: 'lobby', rollNo: 0 };
    t.players = t.players || {};
    if (t.phase === 'play' && !gameIsDead(t)) return;
    for (const id of Object.keys(t.players)) if (!S.presence[id]) delete t.players[id];   // tidy up people who left
    if (t.phase !== 'lobby') { t.phase = 'lobby'; t.turn = ''; resetPlayers(t); }   // a finished or emptied game starts fresh
    if (Object.keys(t.players).filter(id => id !== myId).length >= MAX_TRAIL) return;
    if (Object.entries(t.players).some(([id, q]) => id !== myId && q.job === job)) return;   // someone just took that job
    t.players[myId] = { seat, pos: 0, coins: START_COINS, order: Date.now(), c: S.myHue, name: S.myName, job, out: false };
    return t;
  });
}
function trailLeave() {
  runTransaction(trailRef, t => {
    if (!t || !t.players || !t.players[myId]) return;
    if (t.phase === 'play' && effectiveTurn(t) === myId) { delete t.pending; t.turn = nextAfter(t, myId); }
    goBroke(t, myId);                      // your stalls go back up for sale
    delete t.players[myId];
    return t;
  });
}
function trailStart() {
  const mins = chosenMins;
  runTransaction(trailRef, t => {
    if (!t || t.phase === 'play' || !t.players || !t.players[myId]) return;
    for (const id of Object.keys(t.players)) if (!S.presence[id]) delete t.players[id];
    const ids = trailIds(t);
    if (ids.length < 2) return;
    resetPlayers(t);
    t.phase = 'play'; t.turn = ids[0];
    t.mins = mins; t.endsAt = serverNow() + mins * 60000;
    return t;
  });
}
function trailEnd() {
  runTransaction(trailRef, t => {
    if (!t || !t.players || !t.players[myId]) return;
    resetPlayers(t);
    t.phase = 'lobby'; t.turn = '';
    return t;
  });
}
function trailRoll() {
  if (trailBusy || effectiveTurn() !== myId) return;
  runTransaction(trailRef, t => {
    if (!t || t.phase !== 'play' || effectiveTurn(t) !== myId) return;
    const log = [];
    if (sunsetPassed(t)) { sunsetEnd(t, log); postLog(t, log); return t; }
    if (t.pending) {
      const w = t.pending.who;
      if (S.presence[w] && t.players[w] && !t.players[w].out) return;   // someone is still deciding
      delete t.pending;                                                  // they left, carry on
    }
    const p = t.players[myId];
    const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
    t.dice = [a, b]; t.rollNo = (t.rollNo || 0) + 1; t.mover = myId; t.from = p.pos || 0; t.steps = a + b;
    t.passed = t.from + a + b >= SPOTS;
    moveBy(t, myId, a + b, []);            // the status line already says when you pass the Trailhead
    landOn(t, myId, log, 0);
    checkWin(t, log);
    finishTurn(t, myId);
    postLog(t, log);
    return t;
  });
}
function trailDecide(yes) {
  if (trailBusy) return;
  runTransaction(trailRef, t => {
    if (!t || t.phase !== 'play' || !t.pending || t.pending.who !== myId) return;
    const { k, type } = t.pending;
    const p = t.players[myId], a = AREAS[areaOf(k)], log = [];
    t.stalls = t.stalls || {};
    if (yes && type === 'buy' && !stallOwner(t, k) && p.coins > a.buy) {
      p.coins -= a.buy;
      t.stalls['s' + k] = { o: myId, lv: 0 };
      const jn = jobInfo(p.job).name;
      log.push(`${p.name} opened ${/^[AEIOU]/.test(jn) ? 'an' : 'a'} ${jn} Cart at ${a.name} (−${a.buy})`);
    } else if (yes && type === 'up') {
      const st = t.stalls['s' + k];
      if (st && st.o === myId && st.lv < 3 && p.coins > a.up) {
        p.coins -= a.up; st.lv++;
        log.push(`${p.name} upgraded to a ${LEVELS[st.lv]} at ${a.name} (−${a.up})`);
      }
    }
    delete t.pending;
    checkWin(t, log);
    finishTurn(t, myId);
    postLog(t, log);
    return t;
  });
}
let lastSunsetTry = 0;
function trailSunset() {   // anyone playing can call the sunset once time is up
  runTransaction(trailRef, t => {
    if (!t || !sunsetPassed(t)) return;
    const log = [];
    sunsetEnd(t, log);
    postLog(t, log);
    return t;
  });
}

// ---------- LittleTrail panel ----------
const tStatus = document.getElementById('tStatus');
const tTimer = document.getElementById('tTimer');
const tPlayers = document.getElementById('tPlayers');
const tNote = document.getElementById('tNote');
const tInfo = document.getElementById('tInfo');
const tJobs = document.getElementById('tJobs');
const tJobBtns = document.getElementById('tJobBtns');
const tLength = document.getElementById('tLength');
const tRoll = document.getElementById('tRoll');
const tBuy = document.getElementById('tBuy');
const tPass = document.getElementById('tPass');
const tStart = document.getElementById('tStart');
const tMore = document.getElementById('tMore');
const tMenu = document.getElementById('tMenu');
const tLeave = document.getElementById('tLeave');
const tEnd = document.getElementById('tEnd');

const jobButtons = {};
for (const j of JOBS) {
  const b = document.createElement('button');
  b.textContent = `${j.icon} ${j.name}`;
  b.addEventListener('click', () => trailJoin(j.id));
  tJobBtns.appendChild(b);
  jobButtons[j.id] = b;
}
const lengthButtons = {};
for (const m of LENGTHS) {
  const b = document.createElement('button');
  b.className = 'sw' + (m === chosenMins ? ' on' : '');
  b.textContent = `${m} min`;
  b.addEventListener('click', () => {
    chosenMins = m;
    for (const n of LENGTHS) lengthButtons[n].classList.toggle('on', n === m);
  });
  tLength.appendChild(b);
  lengthButtons[m] = b;
}
tRoll.addEventListener('click', trailRoll);
tBuy.addEventListener('click', () => trailDecide(true));
tPass.addEventListener('click', () => trailDecide(false));
tStart.addEventListener('click', trailStart);

// The ⋯ button hides Leave and End game; each asks you to click twice so nobody ends a game by accident
let menuOpen = false;
tMore.addEventListener('click', () => { menuOpen = !menuOpen; refreshTrailUI(); });
function armButton(btn, label, confirmLabel, action) {
  let armed = false, timer = 0;
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true; btn.textContent = confirmLabel;
      timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000);
      return;
    }
    clearTimeout(timer); armed = false; btn.textContent = label;
    menuOpen = false;
    action();
  });
}
armButton(tLeave, 'Leave game', 'Sure? Click again', trailLeave);
armButton(tEnd, 'End game', 'Sure? Click again', trailEnd);

function liveTrailPending(t = trail) {
  const pd = t && t.pending;
  if (!pd || !S.presence[pd.who] || !t.players[pd.who] || t.players[pd.who].out) return null;
  return pd;
}
function refreshTrailUI() {
  if (!trail) return;
  const ids = validTrailIds();
  const players = trail.players || {};
  const me = !!(players[myId] && S.presence[myId]);
  const turnId = effectiveTurn();
  const dead = gameIsDead();
  const pd = trail.phase === 'play' ? liveTrailPending() : null;
  let st;
  if (trail.phase === 'play') {
    if (dead) st = me ? 'Not enough players left · open ⋯ and click End game' : 'The last game emptied out · sit and pick a job to start a new one';
    else if (pd) {
      const a = AREAS[areaOf(pd.k)];
      if (pd.who !== myId) st = `${players[pd.who].name} is deciding about ${a.name}…`;
      else if (pd.type === 'buy') st = `Open a stall at ${a.name} for ${a.buy}? Rent starts at ${a.rent[0]}.`;
      else {
        const lv = trail.stalls['s' + pd.k].lv;
        st = `Upgrade your ${LEVELS[lv]} at ${a.name} to a ${LEVELS[lv + 1]} for ${a.up}? Rent goes ${a.rent[lv]} → ${a.rent[lv + 1]}.`;
      }
    } else {
      const last = trail.mover && players[trail.mover] && trail.dice
        ? `${players[trail.mover].name} rolled ${trail.dice[0]} + ${trail.dice[1]}${trail.passed ? ` and passed the Trailhead (+${LAP_PAY})` : ''}. ` : '';
      st = last + (turnId === myId ? 'Your turn! Roll the dice' : `${players[turnId] ? players[turnId].name : '…'}'s turn`);
    }
  } else if (trail.phase === 'over') {
    st = `🏆 ${players[trail.winner] ? players[trail.winner].name : 'Someone'} wins! Pick a length and click Start to play again.`;
  } else {
    st = ids.length >= 2 ? `${ids.length} players ready · pick a game length and click Start` : 'Sit in a chair and pick a job to join (2–6 players)';
  }
  tStatus.textContent = st;
  tNote.textContent = trail.phase !== 'lobby' ? (trail.note || '') : '';

  tPlayers.textContent = '';
  ids.forEach(id => {
    const p = players[id];
    const div = document.createElement('div');
    const dot = document.createElement('span');
    dot.textContent = '● ';
    dot.style.color = RAINBOW_CSS[colorIndex(p)];
    div.appendChild(dot);
    const where = p.out ? 'out' : `${(p.coins || 0).toLocaleString()} · ${spotInfo(p.pos || 0).name}`;
    div.appendChild(document.createTextNode(`${trail.phase === 'play' && id === turnId ? '▶ ' : ''}${jobInfo(p.job).icon} ${p.name}${id === myId ? ' (you)' : ''} · ${where}`));
    tPlayers.appendChild(div);
  });

  const taken = new Set(dead ? [] : ids.filter(id => id !== myId).map(id => players[id].job));
  const canJoin = !me && S.seated >= 0 && !S.boardView && (trail.phase !== 'play' || dead) && (dead || ids.length < MAX_TRAIL);
  tJobs.style.display = canJoin ? '' : 'none';
  for (const j of JOBS) jobButtons[j.id].disabled = taken.has(j.id);

  const mine = pd && pd.who === myId;
  tLength.style.display = me && trail.phase !== 'play' ? '' : 'none';
  tRoll.style.display = me && trail.phase === 'play' && !pd && !dead ? '' : 'none';
  tRoll.disabled = !(turnId === myId && !trailBusy);
  tBuy.style.display = tPass.style.display = mine ? '' : 'none';
  if (mine) {
    const a = AREAS[areaOf(pd.k)];
    tBuy.textContent = pd.type === 'buy' ? `Buy (${a.buy})` : `Upgrade (${a.up})`;
    tPass.textContent = pd.type === 'buy' ? 'Pass' : 'Not now';
  }
  tBuy.disabled = tPass.disabled = trailBusy;
  tStart.style.display = me && trail.phase !== 'play' && ids.length >= 2 ? '' : 'none';
  tMore.style.display = me ? '' : 'none';
  if (!me) menuOpen = false;
  tMenu.style.display = me && menuOpen ? '' : 'none';
  tEnd.style.display = trail.phase !== 'lobby' ? '' : 'none';
  refreshSwitch();
}

// Point at (or tap) a stone to see what it is
export function showSpotInfo(k) {
  if (!trail) return;
  if (k < 0) { tInfo.textContent = 'Point at a trail stone to see what it is'; return; }
  const info = spotInfo(k);
  let desc = info.desc;
  const st = stallOwner(trail, k);
  if (st) desc = `${trail.players[st.o].name}'s ${jobInfo(trail.players[st.o].job).name} ${LEVELS[st.lv]} · rent ${rentFor(trail, k)}`;
  const here = activeIds().filter(id => (trail.players[id].pos || 0) === k).map(id => trail.players[id].name);
  tInfo.textContent = `${info.name} · ${desc}${here.length ? ' · here: ' + here.join(', ') : ''}`;
}

// ---------- Switching which game is on the table ----------
const swOthello = document.getElementById('swOthello');
const swTrail = document.getElementById('swTrail');
function tableIsFree() {
  return !(validPlayer(1) || validPlayer(2)) && validTrailIds().length === 0;
}
function refreshSwitch() {
  swOthello.classList.toggle('on', S.activeGame === 'othello');
  swTrail.classList.toggle('on', S.activeGame === 'trail');
  const free = tableIsFree();
  swOthello.disabled = S.activeGame !== 'othello' && !free;
  swTrail.disabled = S.activeGame !== 'trail' && !free;
}
function switchTo(name) {
  if (name === S.activeGame || !tableIsFree()) return;
  set(ref(db, 'room/active'), name);
}
swOthello.addEventListener('click', () => switchTo('othello'));
swTrail.addEventListener('click', () => switchTo('trail'));
function applyActive(name) {
  S.activeGame = name === 'trail' ? 'trail' : 'othello';
  othelloGroup.visible = S.activeGame === 'othello';
  trailGroup.visible = S.activeGame === 'trail';
  document.getElementById('othelloUI').style.display = S.activeGame === 'othello' ? '' : 'none';
  document.getElementById('trailUI').style.display = S.activeGame === 'trail' ? '' : 'none';
  if (S.activeGame !== 'trail') finishTrailAnims();
  hooks.refreshAll();
}

// ---------- Called by the room ----------
export function refreshTrail() {   // after anything changes (people, seats, games)
  syncPawns();
  syncBooths();
  if (!trailBusy) placeAllPawns();
  refreshTrailUI();
  refreshTrailCounters();
  refreshSwitch();
}
export function trailSeatChanged(seat) {   // your counter and dice follow you to a new seat
  if (trail && trail.players && trail.players[myId]) update(ref(db, 'room/trail/players/' + myId), { seat });
}
export function startTrail() {   // start listening when you enter the room
  onValue(ref(db, 'room/active'), s => applyActive(s.val()));
  get(trailRef).then(s => {
    if (!s.exists()) set(trailRef, { phase: 'lobby', rollNo: 0 });
  });
  onValue(trailRef, s => applyTrail(s.val()));
}

// ---------- Every frame ----------
let shownTimer = '';
export function updateTrail(dt) {
  // Dice tumbling
  if (rollAnim) {
    rollAnim.t += dt;
    const p = Math.min(rollAnim.t / rollAnim.dur, 1);
    for (const it of rollAnim.items) {
      it.mesh.position.lerpVectors(it.start, it.land, easeInOut(p));
      it.mesh.position.y = it.land.y + 0.35 * Math.pow(1 - p, 2) + Math.abs(Math.sin(p * Math.PI * 3)) * 0.03 * (1 - p);
      it.mesh.quaternion.setFromAxisAngle(it.axis, Math.pow(1 - p, 2) * 14).multiply(it.qFinal);
    }
    if (p >= 1) { const after = rollAnim.after; rollAnim = null; after(); }
  }
  // Pawns hopping
  for (const id of Object.keys(pawns)) {
    const pw = pawns[id], a = pw.anim;
    if (!a) continue;
    const step = a.path[a.i];
    const lift = !step.jump && a.prev === SPOTS - 1 && step.k === 0;   // the chairlift ride down
    const long = lift || step.jump;
    const dur = long ? 1.0 : 0.22;
    if (a.t === 0 && S.activeGame === 'trail') { if (long) sfx.whoosh(); else sfx.hop(); }
    a.t += dt;
    const p = Math.min(a.t / dur, 1);
    const from = pawnSpotPos(a.prev, Math.max(a.rank, 0)), to = pawnSpotPos(step.k, Math.max(a.rank, 0));
    pw.g.position.lerpVectors(from, to, long ? easeInOut(p) : p);
    pw.g.position.y += Math.sin(p * Math.PI) * (long ? 0.16 : 0.04);
    if (p >= 1) {
      a.prev = step.k; a.i++; a.t = 0;
      if (a.i >= a.path.length) { pw.anim = null; moveDone(); }
    }
  }
  // Chairlift chairs
  for (const c of liftChairs) {
    c.t = (c.t + dt * 0.05) % 1;
    c.g.position.copy(liftA).lerp(liftB, c.t);
  }
  // Coin counters
  const players = (trail && trail.players) || {};
  for (const id of Object.keys(trailCounters)) {
    const cnt = trailCounters[id];
    if (cnt.outer.visible && players[id]) drawCounter(cnt, players[id].coins || 0);
    animateCounter(cnt, dt);
  }
  // Sunset clock and the light on the hill
  let text = '';
  if (trail && trail.phase === 'play' && trail.endsAt && !gameIsDead()) {
    const total = (trail.mins || 60) * 60000;
    const left = trail.endsAt - serverNow();
    const prog = Math.min(Math.max(1 - left / total, 0), 1);
    if (prog < 0.6) trailSun.color.copy(SUN_DAY).lerp(SUN_GOLD, prog / 0.6);
    else trailSun.color.copy(SUN_GOLD).lerp(SUN_SET, (prog - 0.6) / 0.4);
    trailSun.intensity = 0.25 + 0.35 * prog;
    if (left > 60000) text = `☀ ${Math.ceil(left / 60000)} min until sunset`;
    else if (left > 0) text = `🌅 Sunset in 0:${String(Math.ceil(left / 1000)).padStart(2, '0')}`;
    else text = '🌅 The sun is setting…';
    const now = Date.now();
    if (left <= 0 && activeIds().includes(myId) && now - lastSunsetTry > 3000) { lastSunsetTry = now; trailSunset(); }
  } else {
    trailSun.intensity = 0;
  }
  if (text !== shownTimer) { shownTimer = text; tTimer.textContent = text; tTimer.style.display = text ? '' : 'none'; }
}