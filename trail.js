// =====================================================================
// trail.js — LittleTrail, the trail market game
// A flat loop around a little mountain: open stalls, collect rent, ride the steam train,
// and be the richest when the sun sets. Played on the table, or full-window with the "Big board".
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, scene, camera, TABLE_Y, seatAngle, rnd, paintTexture, box, std, easeInOut,
         RAINBOW, RAINBOW_CSS, colorIndex, makeLabel,
         makeCounter, drawCounter, placeCounter, sinkCounter, animateCounter } from './core.js';
import { sfx } from './sounds.js';

export const trailGroup = new THREE.Group();   // the board and everything on it, hidden while another game is on the table
trailGroup.visible = false;
scene.add(trailGroup);
const trailRef = ref(db, 'room/trail');
let trail = null;            // the shared LittleTrail state
let trailBusy = false;       // dice, pawns or the train are moving
const VER = 3;               // games saved by older boards can't continue on this one

// ---------- Money and rules ----------
const SPOTS = 48, START_COINS = 5000, LAP_PAY = 400, GOAL = 20000, MAX_TRAIL = 6;
const HALFWAY = 24, HALF_PAY = 200;   // Halfway Camp, across from the Trailhead: a second payday each lap
const STATIONS = [6, 18, 30, 42];
const STATION_BUY = 200, STATION_RENT = [25, 50, 100, 200], FARE = 40;
const SECTION_BONUS = 0.15;     // each other stall you own in the same section adds 15% rent
const RENT_MULT = [0.18, 0.7, 1.9, 4.2];   // rent at each level, as a share of the stall's price
const LENGTHS = [30, 60, 0];   // game length choices, in minutes until sunset (0 = endless: first to the goal wins)
const LEVELS = ['Cart', 'Stand', 'Shop', 'Lodge'];

// Four sections, each with a train station in the middle and four color groups of stalls
const SECTIONS = [
  { name: 'Meadow',   icon: '🌼', ground: 0x8fc45a, station: 'Meadow Station' },
  { name: 'Forest',   icon: '🌲', ground: 0x4f7d3a, station: 'Forest Station' },
  { name: 'Lake',     icon: '🏞️', ground: 0x6fae7a, station: 'Lake Station' },
  { name: 'Mountain', icon: '⛰️', ground: 0x9a8a72, station: 'Mountain Station' }
];
const GROUP_INFO = [
  ['Wildflowers', '#f48fb1'], ['Sunflower Field', '#ffd54f'], ['Orchard', '#ef6c4a'], ['Berry Patch', '#b0407a'],
  ['Pine Grove', '#2e7d4f'], ['Birch Grove', '#c9c3a8'], ['Mushroom Glade', '#c0392b'], ['Campground', '#e67e22'],
  ['Lily Pond', '#7fd6a8'], ['Marsh', '#7d8a3a'], ['Boat Dock', '#3a7fc8'], ['Lakeside Beach', '#f1d18a'],
  ['Canyon', '#c46a3a'], ['Old Mine', '#6b5a4a'], ['Cliff Ridge', '#8a8f99'], ['Summit Lookout', '#e0b23a']
];
const GROUPS = [];        // each group: { name, color, spots, buy, up, rent[] }
const GROUP_OF = {};      // spot -> group index
(function buildGroups() {
  const runs = [];
  for (let q = 0; q < 4; q++) {
    const a = [], b = [];
    for (let k = (q === 0 || q === 2 ? 12 * q + 1 : 12 * q); k < 12 * q + 6; k++) a.push(k);   // spots 0 and 24 are the paydays
    for (let k = 12 * q + 7; k < 12 * q + 12; k++) b.push(k);
    runs.push(a, b);
  }
  for (const r of runs) {
    for (const spots of [r.slice(0, 3), r.slice(3)]) {
      const gi = GROUPS.length;
      const buy = Math.round((60 + 22 * gi) / 10) * 10;
      GROUPS.push({ name: GROUP_INFO[gi][0], color: GROUP_INFO[gi][1], spots, buy, up: Math.round(buy / 20) * 10,
                    rent: RENT_MULT.map(m => Math.max(5, Math.round(buy * m / 5) * 5)) });
      for (const k of spots) GROUP_OF[k] = gi;
    }
  }
})();
function sectionOf(k) { return Math.floor(k / 12); }
function isStation(k) { return STATIONS.includes(k); }
function spotInfo(k) {
  if (k === 0) return { name: 'Trailhead', color: '#f5e6b8', desc: `Start · +${LAP_PAY} every time you pass` };
  if (k === HALFWAY) return { name: 'Halfway Camp', color: '#f5d08a', desc: `Rest stop · +${HALF_PAY} every time you pass` };
  if (isStation(k)) {
    const sec = SECTIONS[sectionOf(k)];
    return { name: sec.station, color: '#5d5f66', station: true, desc: `🚂 Train station · buy ${STATION_BUY} · ride to the next station for ${FARE}` };
  }
  const g = GROUPS[GROUP_OF[k]];
  return { name: g.name, color: g.color, desc: `${SECTIONS[sectionOf(k)].icon} ${SECTIONS[sectionOf(k)].name} stall · buy ${g.buy} · rent from ${g.rent[0]}` };
}

// ---------- The board: a flat loop around the table with a little mountain in the middle ----------
const BASE_H = 0.025;                  // the board is a low, flat plateau
const R_PATH = 0.70, R_STALL = 0.60, R_TRACK = 0.80, R_BOARD = 0.87;
const TUNNEL_AFTER = 38;               // the trail (and the train) go through the mountain between spots 38 and 39
const spotAng = [];
(function angles() {
  const w = [];
  for (let k = 0; k < SPOTS; k++) w.push(k === TUNNEL_AFTER ? 3.4 : 1);   // the tunnel gap is longer
  const total = w.reduce((a, b) => a + b, 0);
  let a = Math.PI * 0.75;
  for (let k = 0; k < SPOTS; k++) { spotAng.push(a); a += w[k] / total * Math.PI * 2; }
})();
const TUNNEL_ANG = (spotAng[TUNNEL_AFTER] + spotAng[TUNNEL_AFTER + 1]) / 2;
const TOP = TABLE_Y + BASE_H;
function onRing(ang, r, y = TOP) { return new THREE.Vector3(Math.sin(ang) * r, y, Math.cos(ang) * r); }
function tangentAt(ang) { return new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang)); }
function sectionOfAngle(ang) {   // which section a point on the board belongs to (for coloring the ground)
  let best = 0, bd = 9;
  for (let k = 0; k < SPOTS; k++) {
    let d = Math.abs(((ang - spotAng[k]) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    if (d < bd) { bd = d; best = k; }
  }
  return sectionOf(best);
}
const spotPos = spotAng.map(a => onRing(a, R_PATH, TOP + 0.004));

// Everything that counts as "the ground" for pointing (so pointing at it does nothing)
export const mountainMesh = new THREE.Group();
trailGroup.add(mountainMesh);
(function ground() {
  const geo = new THREE.CylinderGeometry(R_BOARD, R_BOARD + 0.01, BASE_H, 96, 1, false);
  const pos = geo.attributes.position, colors = [], c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (Math.hypot(x, z) < 0.001) c.setHex(0x7a9a5a);
    else c.setHex(SECTIONS[sectionOfAngle(Math.atan2(x, z))].ground);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  m.position.y = TABLE_Y + BASE_H / 2;
  m.receiveShadow = true;
  m.userData.mountain = true;
  mountainMesh.add(m);
})();
// The little mountain in the middle, plus a ridge running out over the trail with the tunnel through it
function rockyMesh(geo, snowLine) {
  const pos = geo.attributes.position, colors = [], c = new THREE.Color();
  const grass = new THREE.Color(0x5b7d3a), rock = new THREE.Color(0x7d746a), snow = new THREE.Color(0xf2f4f7);
  geo.computeBoundingBox();
  const maxY = geo.boundingBox.max.y;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = 0.06 * Math.sin(x * 37 + z * 11) + 0.05 * Math.sin(z * 29 - y * 17) + 0.03 * Math.sin(x * 71 + y * 53);
    if (y > 0.001) { pos.setX(i, x * (1 + n * 0.5)); pos.setZ(i, z * (1 + n * 0.5)); pos.setY(i, y * (1 + n * 0.3)); }
    const t = y / maxY + 0.08 * Math.sin(x * 40 + z * 30);
    if (t < 0.25) c.copy(grass); else if (t < 0.4) c.copy(grass).lerp(rock, (t - 0.25) / 0.15);
    else if (t < snowLine) c.copy(rock); else c.copy(snow);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  m.castShadow = true; m.receiveShadow = true;
  m.userData.mountain = true;
  return m;
}
(function mountain() {
  const peak = rockyMesh(new THREE.ConeGeometry(0.34, 0.27, 28, 6), 0.72);
  peak.position.set(0, TOP + 0.135, 0);
  mountainMesh.add(peak);
  // The ridge: a long rocky hump from the mountain out past the train track
  const ridgeGeo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const ridge = rockyMesh(ridgeGeo, 0.86);
  const mid = (0.30 + 0.93) / 2;
  ridge.scale.set(0.105, 0.15, (0.93 - 0.30) / 2);   // narrow across the trail, long toward the edge
  ridge.position.copy(onRing(TUNNEL_ANG, mid, TOP - 0.002));
  ridge.rotation.y = TUNNEL_ANG;
  mountainMesh.add(ridge);
  // Stone arches with dark openings where the trail and track go in and out
  const stone = std(0x6a625a, 0.9);
  const hole = new THREE.MeshBasicMaterial({ color: 0x0b0806 });
  for (const side of [-1, 1]) {
    const t = tangentAt(TUNNEL_ANG);
    const c = onRing(TUNNEL_ANG, (R_PATH + R_TRACK) / 2, TOP).addScaledVector(t, side * 0.098);
    const yaw = Math.atan2(t.x, t.z);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.013, 8, 20, Math.PI), stone);
    arch.position.copy(c); arch.rotation.y = yaw; arch.castShadow = true;
    const dark = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20, 0, Math.PI), hole);
    dark.position.copy(c).addScaledVector(t, -side * 0.004); dark.rotation.y = yaw + (side > 0 ? 0 : Math.PI);
    dark.userData.mountain = true;
    mountainMesh.add(arch, dark);
  }
})();
export const MTN_TARGET = new THREE.Vector3(0, TABLE_Y + 0.08, 0);   // where board view looks

// Sunlight on the board: turns golden, then orange, as sunset gets close
const trailSun = new THREE.DirectionalLight(0xffffff, 0);
trailSun.position.set(1.5, 2.5, 1);
trailGroup.add(trailSun);
const SUN_DAY = new THREE.Color(0xfff4e0), SUN_GOLD = new THREE.Color(0xffc070), SUN_SET = new THREE.Color(0xff6a3d);

// ---------- The trail: 48 stepping stones around the loop ----------
export const spotMeshes = [];
spotPos.forEach((p, k) => {
  const info = spotInfo(k);
  const big = k === 0 || k === HALFWAY || info.station;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(big ? 0.042 : 0.034, big ? 0.045 : 0.037, 0.012, 24), std(new THREE.Color(info.color), 0.6));
  m.position.copy(p);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.spot = k;
  trailGroup.add(m);
  spotMeshes.push(m);
});
// Dirt path linking the stones, all the way around
(function dirtPath() {
  const pts = [];
  for (let k = 0; k < SPOTS; k++) {
    pts.push(spotPos[k].clone().add(new THREE.Vector3(0, -0.004, 0)));
    if (k === TUNNEL_AFTER) pts.push(onRing(TUNNEL_ANG, R_PATH, TOP));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 0.011, 6, true), std(0xa98a60, 0.95));
  tube.receiveShadow = true;
  trailGroup.add(tube);
})();
// Scenery for each section: flowers, trees, a pond, rocks
(function scenery() {
  const trunkMat = std(0x5a3a24), leafMat = std(0x2f5d34, 0.9), birchMat = std(0xe8e2d0, 0.8);
  const rockMat = std(0x8a8178, 0.9), water = std(0x3a8fd0, 0.15, { metalness: 0.2 });
  const flowerCols = [0xf48fb1, 0xffd54f, 0xffffff, 0xb39ddb];
  const clear = p => { const r = Math.hypot(p.x, p.z); return spotPos.some(s => s.distanceTo(p) < 0.06) || Math.abs(r - R_STALL) < 0.04 || Math.abs(r - R_PATH) < 0.03 || Math.abs(r - R_TRACK) < 0.03; };
  const place = (n, rMin, rMax, sec, make) => {
    let placed = 0, tries = 0;
    while (placed < n && tries < 800) {
      tries++;
      const ang = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin);
      if (sectionOfAngle(ang) !== sec || Math.abs(ang - TUNNEL_ANG) < 0.25) continue;
      const p = onRing(ang, r);
      if (clear(p)) continue;
      const o = make(); o.position.copy(p); o.rotation.y = rnd() * 6; trailGroup.add(o); placed++;
    }
  };
  // Meadow: flowers
  place(40, 0.38, 0.86, 0, () => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), std(flowerCols[Math.floor(rnd() * 4)], 0.6));
    f.position.y = 0.004; const g = new THREE.Group(); g.add(f); return g;
  });
  // Forest: pines and birches
  place(22, 0.36, 0.86, 1, () => {
    const g = new THREE.Group(), s = 0.6 + rnd() * 0.6, birch = rnd() < 0.3;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.004 * s, 0.005 * s, 0.03 * s, 6), birch ? birchMat : trunkMat);
    trunk.position.y = 0.015 * s;
    const cone = new THREE.Mesh(birch ? new THREE.SphereGeometry(0.02 * s, 8, 6) : new THREE.ConeGeometry(0.024 * s, 0.07 * s, 8), birch ? std(0x7cb342, 0.9) : leafMat);
    cone.position.y = (birch ? 0.04 : 0.055) * s; cone.castShadow = true;
    g.add(trunk, cone); return g;
  });
  // Lake: a pond inside the loop, with reeds
  const lakeMid = (spotAng[24] + spotAng[35]) / 2;
  const pond = new THREE.Mesh(new THREE.CircleGeometry(0.075, 28), water);
  pond.rotation.x = -Math.PI / 2; pond.scale.set(1.5, 1, 1);
  pond.position.copy(onRing(lakeMid, 0.46, TOP + 0.002)); pond.rotation.z = lakeMid;
  trailGroup.add(pond);
  place(14, 0.38, 0.86, 2, () => {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.03, 4), std(0x6b8e23)); r.position.set((i - 1) * 0.004, 0.015, 0); g.add(r); }
    return g;
  });
  // Mountain: rocks
  place(16, 0.36, 0.86, 3, () => {
    const g = new THREE.Group();
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.012 + rnd() * 0.012, 0), rockMat);
    r.position.y = 0.006; r.castShadow = true; g.add(r); return g;
  });
  // Section names floating over the middle of each section
  SECTIONS.forEach((sec, q) => {
    const a = (spotAng[12 * q + 1] + spotAng[12 * q + 11]) / 2;
    const l = makeLabel(`${sec.icon} ${sec.name}`, '#fff6dd');
    l.position.copy(onRing(a, 0.47, TOP + 0.09));
    l.scale.set(0.26, 0.065, 1);
    trailGroup.add(l);
  });
  const th = makeLabel('Trailhead', '#f5e6b8');
  th.position.copy(spotPos[0]).add(new THREE.Vector3(0, 0.09, 0));
  th.scale.set(0.28, 0.07, 1);
  trailGroup.add(th);
  const hc = makeLabel('⛺ Halfway Camp', '#f5d08a');
  hc.position.copy(spotPos[HALFWAY]).add(new THREE.Vector3(0, 0.09, 0));
  hc.scale.set(0.3, 0.075, 1);
  trailGroup.add(hc);
})();

// ---------- The railway: a track around the outside, four stations, and a little steam train ----------
(function railway() {
  const rail = std(0x6d6f75, 0.35, { metalness: 0.7 }), wood = std(0x5a3a24, 0.9);
  for (const r of [R_TRACK - 0.013, R_TRACK + 0.013]) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0025, 4, 160), rail);
    m.rotation.x = Math.PI / 2; m.position.y = TOP + 0.005;
    trailGroup.add(m);
  }
  const TIES = 110;
  for (let i = 0; i < TIES; i++) {
    const a = i / TIES * Math.PI * 2;
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.004, 0.01), wood);
    tie.position.copy(onRing(a, R_TRACK, TOP + 0.002));
    tie.rotation.y = a + Math.PI / 2;
    trailGroup.add(tie);
  }
})();
// Station buildings sit inside the loop; the roof turns the owner's color
const stationHouses = {};
for (const k of STATIONS) {
  const g = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.045), std(0xe8dcc4, 0.8));
  walls.position.y = 0.0175;
  const roofMat = std(0x7a7f88, 0.6);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.03, 4), roofMat);
  roof.position.y = 0.05; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.75);
  const sign = makeLabel('🚉', '#ffffff'); sign.position.y = 0.09; sign.scale.set(0.09, 0.0225, 1);
  [walls, roof].forEach(m => { m.castShadow = true; g.add(m); });
  g.add(sign);
  g.position.copy(onRing(spotAng[k], R_STALL, TOP));
  g.rotation.y = spotAng[k];
  // a little platform out to the track
  const plat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.07), std(0x8a8178, 0.9));
  plat.position.copy(onRing(spotAng[k], (R_PATH + R_TRACK) / 2 + 0.005, TOP + 0.003));
  plat.rotation.y = spotAng[k];
  trailGroup.add(g, plat);
  stationHouses[k] = { g, roofMat };
}
// The train: a locomotive and two cars, always chugging around the loop
const TRAIN_SPEED = Math.PI * 2 / 45;   // one lap every 45 seconds
let trainAng = 0;
const trainParts = [];
(function train() {
  const red = std(0xb3261e, 0.5), black = std(0x222222, 0.5, { metalness: 0.4 }), gold = std(0xd4a63c, 0.3, { metalness: 0.8 });
  const loco = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.075), black); base.position.y = 0.01;
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.045, 12), red); boiler.rotation.x = Math.PI / 2; boiler.position.set(0, 0.026, 0.012);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.025), red); cab.position.set(0, 0.03, -0.022);
  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.004, 0.03), black); cabRoof.position.set(0, 0.047, -0.022);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.004, 0.018, 8), black); chimney.position.set(0, 0.045, 0.026);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.004, 12), gold); band.rotation.x = Math.PI / 2; band.position.set(0, 0.026, 0.02);
  [base, boiler, cab, cabRoof, chimney, band].forEach(m => { m.castShadow = true; loco.add(m); });
  trailGroup.add(loco);
  trainParts.push({ g: loco, back: 0, chimney });
  const carCols = [0x2e7d4f, 0x3a7fc8];
  carCols.forEach((col, i) => {
    const car = new THREE.Group();
    const cb = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.008, 0.06), black); cb.position.y = 0.009;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.016, 0.058), std(col, 0.6)); body.position.y = 0.021;
    [cb, body].forEach(m => { m.castShadow = true; car.add(m); });
    trailGroup.add(car);
    trainParts.push({ g: car, back: 0.115 * (i + 1) / R_TRACK });
  });
})();
const smoke = Array.from({ length: 7 }, (_, i) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0, depthWrite: false }));
  trailGroup.add(m);
  return { m, t: i / 7, from: new THREE.Vector3() };
});
function placeTrain(ang) {
  for (const p of trainParts) {
    const a = ang - p.back;
    p.g.position.copy(onRing(a, R_TRACK, TOP + 0.004));
    const t = tangentAt(a);
    p.g.rotation.y = Math.atan2(t.x, t.z);
  }
}
placeTrain(0);

// ---------- Jobs: just for looks, each player's icon on their piece and stalls ----------
const JOBS = [
  { id: 'burger',   name: 'Burger',    icon: '🍔' },
  { id: 'bar',      name: 'Bar',       icon: '🍺' },
  { id: 'icecream', name: 'Ice Cream', icon: '🍦' },
  { id: 'toys',     name: 'Toys',      icon: '🧸' },
  { id: 'pets',     name: 'Pets',      icon: '🐾' },
  { id: 'music',    name: 'Music',     icon: '🎵' }
];
function jobInfo(id) { return JOBS.find(j => j.id === id) || JOBS[0]; }
const iconMats = {};
function iconMaterial(icon) {   // an emoji drawn on a little sprite that always faces you
  if (!iconMats[icon]) {
    const t = paintTexture(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '96px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      g.fillText(icon, w / 2, h / 2 + 6);
    });
    iconMats[icon] = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
  }
  return iconMats[icon];
}

// ---------- Pawns: a peg in your rainbow color with your job's icon floating on top ----------
const pawns = {};   // id -> { g, c, job, anim }
function makePawn(c, job) {
  const g = new THREE.Group();
  const mat = std(new THREE.Color(RAINBOW[c]), 0.45);
  const baseDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.006, 16), mat);
  baseDisc.position.y = 0.003;
  const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.011, 0.026, 12), mat);
  peg.position.y = 0.019;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), mat);
  head.position.y = 0.036;
  [baseDisc, peg, head].forEach(m => { m.castShadow = true; g.add(m); });
  const icon = new THREE.Sprite(iconMaterial(jobInfo(job).icon));
  icon.scale.set(0.03, 0.03, 1); icon.position.y = 0.064;
  g.add(icon);
  trailGroup.add(g);
  return g;
}
function pawnSpotPos(k, rank) {   // several pawns on one stone stand in a little ring
  const p = spotPos[k].clone();
  p.y += 0.006;
  if (rank > 0) {
    const ang = rank * Math.PI / 3;
    p.x += Math.sin(ang) * 0.02; p.z += Math.cos(ang) * 0.02;
  }
  return p;
}

// ---------- Stalls: a flat block in the owner's color for each level, their icon on top ----------
const stacks = {};   // spot -> { g, key }
function makeStack(c, job, lv, k) {
  const g = new THREE.Group();
  const mat = std(new THREE.Color(RAINBOW[c]), 0.5);
  const edge = std(new THREE.Color(GROUPS[GROUP_OF[k]].color), 0.6);
  const H = 0.012;
  for (let i = 0; i <= lv; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.044 - i * 0.003, H, 0.044 - i * 0.003), i === 0 ? edge : mat);
    b.position.y = H * (i + 0.5);
    b.castShadow = true; b.receiveShadow = true;
    g.add(b);
  }
  if (lv === 0) {   // a Cart: one block in the group's color with a stripe of the owner's color
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.004, 0.046), mat);
    stripe.position.y = H; g.add(stripe);
  }
  const icon = new THREE.Sprite(iconMaterial(jobInfo(job).icon));
  icon.scale.set(0.034, 0.034, 1); icon.position.y = H * (lv + 1) + 0.022;
  g.add(icon);
  g.position.copy(onRing(spotAng[k], R_STALL, TOP));
  g.rotation.y = spotAng[k];
  trailGroup.add(g);
  return g;
}
function syncStalls() {
  const want = {};
  for (let k = 1; k < SPOTS; k++) {
    const st = stallOwner(trail, k);
    if (st) { const p = trail.players[st.o]; want[k] = `${st.o}|${st.lv}|${colorIndex(p)}|${p.job}`; }
  }
  for (const k of Object.keys(stacks)) if (stacks[k].key !== want[k]) { trailGroup.remove(stacks[k].g); delete stacks[k]; }
  for (const k of Object.keys(want)) {
    if (isStation(+k)) continue;
    if (!stacks[k]) { const st = stallOwner(trail, +k), p = trail.players[st.o]; stacks[k] = { g: makeStack(colorIndex(p), p.job, st.lv, +k), key: want[k] }; }
  }
  for (const k of STATIONS) {   // station roofs
    const st = stallOwner(trail, k);
    stationHouses[k].roofMat.color.set(st ? RAINBOW[colorIndex(trail.players[st.o])] : 0x7a7f88);
  }
}

// ---------- Players, turns and rules (these work on a copy of the shared state) ----------
function trailIds(t = trail) {
  return Object.entries((t && t.players) || {}).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
}
function validTrailIds(t = trail) { return trailIds(t).filter(id => S.presence[id]); }               // still in the room
function activeIds(t = trail) { return validTrailIds(t).filter(id => !t.players[id].out); }         // still in the game
function gameIsDead(t = trail) {   // everyone left mid-game, or it's a game from the old board
  return !!t && t.phase === 'play' && (activeIds(t).length < 2 || t.ver !== VER);
}
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
function stallOwner(t, k) {   // the stall's (or station's) owner, if they're still playing
  const st = t && t.stalls && t.stalls['s' + k];
  if (!st || !t.players || !t.players[st.o] || !S.presence[st.o] || t.players[st.o].out) return null;
  return st;
}
function ownsGroup(t, id, gi) { return GROUPS[gi].spots.every(k => { const st = stallOwner(t, k); return st && st.o === id; }); }
function sectionCount(t, id, k) {   // how many OTHER stalls this owner has in the same section
  let n = 0;
  for (let j = 12 * sectionOf(k); j < 12 * sectionOf(k) + 12; j++) {
    if (j === k || j === 0 || j === HALFWAY || isStation(j)) continue;
    const st = stallOwner(t, j);
    if (st && st.o === id) n++;
  }
  return n;
}
function rentFor(t, k) {
  const st = stallOwner(t, k);
  if (!st) return 0;
  if (isStation(k)) return STATION_RENT[STATIONS.filter(s => { const o = stallOwner(t, s); return o && o.o === st.o; }).length - 1];
  const g = GROUPS[GROUP_OF[k]];
  let r = g.rent[st.lv];
  if (st.lv === 0 && ownsGroup(t, st.o, GROUP_OF[k])) r *= 2;      // own the whole color group: Cart rent doubles
  r = Math.round(r * (1 + SECTION_BONUS * sectionCount(t, st.o, k)) / 5) * 5;   // section bonus
  return r;
}
function worth(t, id) {   // coins plus what you paid for your stalls, stations and upgrades
  let w = t.players[id].coins || 0;
  for (const [key, st] of Object.entries(t.stalls || {})) {
    if (st.o !== id) continue;
    const k = +key.slice(1);
    if (isStation(k)) w += STATION_BUY;
    else { const g = GROUPS[GROUP_OF[k]]; if (g) w += g.buy + st.lv * g.up; }
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
function moveBy(t, id, n) {
  const p = t.players[id];
  const from = p.pos, raw = from + n;
  if (raw >= SPOTS) p.coins += LAP_PAY;
  if (from < HALFWAY && raw >= HALFWAY) p.coins += HALF_PAY;   // walked past (or onto) Halfway Camp
  p.pos = ((raw % SPOTS) + SPOTS) % SPOTS;
}
// What happens on the stone you land on
function landOn(t, id, log) {
  const p = t.players[id], k = p.pos;
  if (p.out || k === 0 || k === HALFWAY) return;
  const st = stallOwner(t, k);
  if (isStation(k)) {
    if (st && st.o !== id) payRent(t, id, st.o, rentFor(t, k), log);
    if (p.out) return;
    const fare = st && st.o === id ? 0 : FARE;
    const canBuy = !st && p.coins > STATION_BUY;
    const canRide = p.coins > fare;
    if (canBuy || canRide) t.pending = { who: id, k, type: 'station', buy: canBuy ? 1 : 0, fare };
    return;
  }
  const g = GROUPS[GROUP_OF[k]];
  if (!st) {
    if (p.coins > g.buy) t.pending = { who: id, k, type: 'buy' };
    else log.push(`${p.name} can't afford the ${g.name} stall (${g.buy})`);
  } else if (st.o === id) {
    if (st.lv < 3 && p.coins > g.up) t.pending = { who: id, k, type: 'up' };
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
function sunsetEnd(t, log, early) {   // time's up (or someone counted early): the richest player wins (coins + stalls)
  const ids = activeIds(t);
  if (!ids.length) return;
  const w = ids.reduce((a, b) => (worth(t, b) > worth(t, a) ? b : a), ids[0]);
  t.phase = 'over'; t.winner = w; delete t.pending;
  log.push(`${early ? '🏁 The game was counted early!' : '🌅 The sun has set!'} ${t.players[w].name} wins with ${worth(t, w).toLocaleString()} (coins + stalls)`);
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
  t.note = ''; t.mover = ''; t.winner = ''; t.passed = false; t.passedHalf = false;
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
      pawns[id].g.position.copy(pawnSpotPos(Math.min(p.pos || 0, SPOTS - 1), rank));
    }
  });
}
function placeAllPawns() {
  const players = (trail && trail.players) || {};
  activeIds().forEach((id, rank) => {
    if (pawns[id]) { pawns[id].anim = null; pawns[id].g.position.copy(pawnSpotPos(Math.min(players[id].pos || 0, SPOTS - 1), rank)); }
  });
}

// ---------- Sounds for what happened ----------
let queuedLines = null;   // sounds waiting until the pawn finishes moving
function playLineSounds(lines) {
  lines.forEach((line, i) => setTimeout(() => {
    if (/🏆|🌅/.test(line)) sfx.win();
    else if (/out of the game/.test(line)) sfx.out();
    else if (/opened|upgraded|bought/.test(line)) sfx.buy();
    else if (/rent|Trailhead/.test(line)) sfx.coin();
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
const DIE = 0.05;
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
  [-0.3, 0.3].forEach((off, i) => {
    const ang = a + off;
    const land = new THREE.Vector3(Math.sin(ang) * 0.92, TABLE_Y + DIE / 2, Math.cos(ang) * 0.92);
    const start = land.clone().multiplyScalar(1.05); start.y = land.y + 0.35;
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
  if (queuedPops) { showPops(queuedPops); queuedPops = null; }
}
function startHop(t) {
  const pw = pawns[t.mover];
  if (!pw) { moveDone(); return; }
  const path = [];
  for (let s = 1; s <= t.steps; s++) path.push({ k: (t.from + s) % SPOTS });
  pw.anim = { path, i: 0, t: 0, prev: t.from, rank: activeIds(t).indexOf(t.mover) };
}
// Riding the train: the train pulls into the station, your piece climbs aboard, and off it goes
let rideAnim = null;
function startRide(t) {
  const pw = pawns[t.mover];
  if (!pw) { moveDone(); return; }
  let a0 = spotAng[t.rideFrom], a1 = spotAng[t.rideTo];
  while (a1 <= a0) a1 += Math.PI * 2;
  rideAnim = { id: t.mover, a0, a1, t: 0, dur: 3.2, rank: activeIds(t).indexOf(t.mover), from: t.rideFrom, to: t.rideTo };
  if (S.activeGame === 'trail') sfx.whoosh();
}
function finishTrailAnims() {
  if (rollAnim) {
    for (const it of rollAnim.items) { it.mesh.position.copy(it.land); it.mesh.quaternion.copy(it.qFinal); }
    rollAnim = null;
  }
  for (const id of Object.keys(pawns)) pawns[id].anim = null;
  rideAnim = null;
  trailBusy = false;
  if (queuedLines) { playLineSounds(queuedLines); queuedLines = null; }
  if (queuedPops) { showPops(queuedPops); queuedPops = null; }
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

// ---------- Money pop-ups: +400 / −120 floating up from a player's piece and their card ----------
let queuedPops = null;   // pop-ups waiting until the pawn finishes moving
const popLayer = document.getElementById('tPops');
const popStack = {};     // id -> how many pop-ups are already rising from that piece
function showPops(pops) {
  if (S.activeGame !== 'trail') return;
  pops.forEach(([id, d]) => {
    const text = (d > 0 ? '+' : '−') + Math.abs(d).toLocaleString();
    const cls = 'tPop ' + (d > 0 ? 'plus' : 'minus');
    // over the piece on the board
    const pw = pawns[id];
    if (pw && popLayer) {
      const v = pw.g.position.clone();
      v.y += 0.09;
      if (typeof v.project === 'function') v.project(camera);
      if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
        const n = popStack[id] = (popStack[id] || 0) + 1;
        const el = document.createElement('div');
        el.className = cls; el.textContent = text;
        el.style.left = ((v.x + 1) / 2 * window.innerWidth) + 'px';
        el.style.top = ((1 - v.y) / 2 * window.innerHeight - (n - 1) * 26) + 'px';
        popLayer.appendChild(el);
        setTimeout(() => { el.remove(); popStack[id] = Math.max(0, (popStack[id] || 1) - 1); }, 1900);
      }
    }
    // and on their dashboard card (big board)
    const card = dashCards[id];
    if (card && S.trailFull) {
      const el = document.createElement('div');
      el.className = cls + ' onCard'; el.textContent = text;
      card.el.appendChild(el);
      setTimeout(() => el.remove(), 1900);
    }
  });
}
function coinChanges(prev, next) {   // who gained or lost coins between two states of the same game
  if (!prev || !next || prev.phase !== 'play' || !prev.players || !next.players) return [];
  const out = [];
  for (const [id, p] of Object.entries(next.players)) {
    const q = prev.players[id];
    if (!q) continue;
    const d = (p.coins || 0) - (q.coins || 0);
    if (d) out.push([id, d]);
  }
  return out;
}

// ---------- Applying the shared state ----------
function applyTrail(t) {
  const prev = trail;
  trail = t || { phase: 'lobby', rollNo: 0 };
  const pops = coinChanges(prev, trail);
  syncPawns();
  syncStalls();
  const players = trail.players || {};
  const isNextRoll = prev && trail.rollNo === (prev.rollNo || 0) + 1 && trail.mover && players[trail.mover] && trail.dice;
  const isNextRide = prev && (trail.rideNo || 0) === (prev.rideNo || 0) + 1 && trail.mover && players[trail.mover];
  const lines = prev && (trail.ev || 0) > (prev.ev || 0) && trail.note ? trail.note.split('\n') : [];
  if (isNextRoll && S.activeGame === 'trail') {
    finishTrailAnims();
    trailBusy = true;
    if (lines.length) queuedLines = lines;   // play these once the pawn arrives
    if (pops.length) queuedPops = pops;
    startRoll(trail);
  } else if (isNextRide && S.activeGame === 'trail') {
    finishTrailAnims();
    trailBusy = true;
    if (lines.length) queuedLines = lines;
    if (pops.length) queuedPops = pops;
    startRide(trail);
  } else {
    if (!trailBusy) placeAllPawns();
    if (lines.length && S.activeGame === 'trail') playLineSounds(lines);
    if (pops.length) { if (trailBusy) queuedPops = (queuedPops || []).concat(pops); else showPops(pops); }
  }
  lines.forEach(line => hooks.addSys(line));   // tell the chat what happened
  refreshTrailUI();
  refreshTrailCounters();
}

// ---------- Actions ----------
let chosenMins = 30;   // the game length you picked
function trailJoin(job) {
  if (!trail) return;
  if (S.seated < 0 && S.trailFull && hooks.quietSit) hooks.quietSit();   // on the big board: take a free chair for you
  if (S.seated < 0) { if (hooks.banner) hooks.banner('No free chair at the table to join from', 2.5); return; }
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
    if (!t || (t.phase === 'play' && !gameIsDead(t)) || !t.players || !t.players[myId]) return;
    for (const id of Object.keys(t.players)) if (!S.presence[id]) delete t.players[id];
    const ids = trailIds(t);
    if (ids.length < 2) return;
    resetPlayers(t);
    t.phase = 'play'; t.turn = ids[0]; t.ver = VER;
    t.mins = mins; t.endsAt = mins ? serverNow() + mins * 60000 : 0;   // endless games have no sunset
    return t;
  });
}
function trailEnd() {   // during a game: count it now and the richest wins; otherwise clear the table
  runTransaction(trailRef, t => {
    if (!t || !t.players || !t.players[myId]) return;
    if (t.phase === 'play' && !gameIsDead(t)) { const log = []; sunsetEnd(t, log, true); postLog(t, log); return t; }
    resetPlayers(t);
    t.phase = 'lobby'; t.turn = '';
    return t;
  });
}
function trailRoll() {
  if (trailBusy || effectiveTurn() !== myId) return;
  runTransaction(trailRef, t => {
    if (!t || t.phase !== 'play' || gameIsDead(t) || effectiveTurn(t) !== myId) return;
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
    t.passedHalf = t.from < HALFWAY && t.from + a + b >= HALFWAY;
    moveBy(t, myId, a + b);            // the status line already says when you pass the Trailhead
    landOn(t, myId, log);
    checkWin(t, log);
    finishTurn(t, myId);
    postLog(t, log);
    return t;
  });
}
function trailDecide(choice) {   // 'yes' (buy or upgrade), 'ride' (take the train), or 'no'
  if (trailBusy) return;
  runTransaction(trailRef, t => {
    if (!t || t.phase !== 'play' || !t.pending || t.pending.who !== myId) return;
    const { k, type } = t.pending;
    const p = t.players[myId], log = [];
    t.stalls = t.stalls || {};
    if (type === 'station') {
      const name = SECTIONS[sectionOf(k)].station;
      if (choice === 'yes' && t.pending.buy && !stallOwner(t, k) && p.coins > STATION_BUY) {
        p.coins -= STATION_BUY;
        t.stalls['s' + k] = { o: myId, lv: 0 };
        log.push(`${p.name} bought ${name} (−${STATION_BUY})`);
      } else if (choice === 'ride') {
        const st = stallOwner(t, k);
        const fare = st && st.o === myId ? 0 : FARE;
        if (p.coins > fare) {
          p.coins -= fare;
          if (st && st.o !== myId) t.players[st.o].coins += fare;
          const to = STATIONS[(STATIONS.indexOf(k) + 1) % STATIONS.length];
          const passed = to < k, passedHalf = k < HALFWAY && to > HALFWAY;
          if (passed) p.coins += LAP_PAY;
          if (passedHalf) p.coins += HALF_PAY;
          p.pos = to;
          t.rideNo = (t.rideNo || 0) + 1; t.rideFrom = k; t.rideTo = to; t.mover = myId;
          log.push(`🚂 ${p.name} rode the train to ${SECTIONS[sectionOf(to)].station}${fare ? ` (−${fare}${st && st.o !== myId ? ' to ' + t.players[st.o].name : ''})` : ' (free, it\'s theirs)'}${passed ? ` and passed the Trailhead (+${LAP_PAY})` : ''}${passedHalf ? ` and rested at Halfway Camp (+${HALF_PAY})` : ''}`);
        }
      }
    } else {
      const g = GROUPS[GROUP_OF[k]];
      if (choice === 'yes' && type === 'buy' && !stallOwner(t, k) && p.coins > g.buy) {
        p.coins -= g.buy;
        t.stalls['s' + k] = { o: myId, lv: 0 };
        const jn = jobInfo(p.job).name;
        log.push(`${p.name} opened ${/^[AEIOU]/.test(jn) ? 'an' : 'a'} ${jn} Cart at ${g.name} (−${g.buy})`);
      } else if (choice === 'yes' && type === 'up') {
        const st = t.stalls['s' + k];
        if (st && st.o === myId && st.lv < 3 && p.coins > g.up) {
          p.coins -= g.up; st.lv++;
          log.push(`${p.name} upgraded to a ${LEVELS[st.lv]} at ${g.name} (−${g.up})`);
        }
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
const tTopTimer = document.getElementById('tTopTimer');
const tPlayers = document.getElementById('tPlayers');
const tNote = document.getElementById('tNote');
const tInfo = document.getElementById('tInfo');
const tJobs = document.getElementById('tJobs');
const tJobBtns = document.getElementById('tJobBtns');
const tLength = document.getElementById('tLength');
const tRoll = document.getElementById('tRoll');
const tBuy = document.getElementById('tBuy');
const tRide = document.getElementById('tRide');
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
  b.textContent = m ? `${m} min` : '♾ Endless';
  b.addEventListener('click', () => {
    chosenMins = m;
    for (const n of LENGTHS) lengthButtons[n].classList.toggle('on', n === m);
  });
  tLength.appendChild(b);
  lengthButtons[m] = b;
}
tRoll.addEventListener('click', trailRoll);
tBuy.addEventListener('click', () => trailDecide('yes'));
tRide.addEventListener('click', () => trailDecide('ride'));
tPass.addEventListener('click', () => trailDecide('no'));
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
armButton(tEnd, 'End & count', 'Sure? Click again', trailEnd);

function liveTrailPending(t = trail) {
  const pd = t && t.pending;
  if (!pd || !S.presence[pd.who] || !t.players[pd.who] || t.players[pd.who].out) return null;
  return pd;
}
function rentPreview(t, k, lv, ownerId) {   // what a stall would charge at a level, with your bonuses
  const g = GROUPS[GROUP_OF[k]];
  let r = g.rent[lv];
  const others = sectionCount(t, ownerId, k);
  return Math.round(r * (1 + SECTION_BONUS * others) / 5) * 5;
}
function refreshTrailUI() {
  if (!trail) return;
  const ids = validTrailIds();
  const players = trail.players || {};
  const me = !!(players[myId] && S.presence[myId]);
  const turnId = effectiveTurn();
  const dead = gameIsDead();
  const pd = trail.phase === 'play' && !dead ? liveTrailPending() : null;
  let st;
  if (trail.phase === 'play') {
    if (dead) st = me ? 'This game can\'t continue · open ⋯ and click End & count' : 'The last game emptied out · sit and pick a job to start a new one';
    else if (pd) {
      const info = spotInfo(pd.k);
      if (pd.who !== myId) st = `${players[pd.who].name} is deciding at ${info.name}…`;
      else if (pd.type === 'station') {
        const own = stallOwner(trail, pd.k);
        st = `🚂 ${info.name}! ` + (pd.buy ? `Buy it for ${STATION_BUY}, ` : '') +
             `ride to the next station${pd.fare ? ` for ${pd.fare}` : ' for free'}, or stay?` + (own && own.o !== myId ? '' : '');
      } else if (pd.type === 'buy') {
        const g = GROUPS[GROUP_OF[pd.k]];
        st = `Open a stall at ${g.name} for ${g.buy}? Rent starts at ${rentPreview(trail, pd.k, 0, myId)}.`;
      } else {
        const g = GROUPS[GROUP_OF[pd.k]];
        const lv = trail.stalls['s' + pd.k].lv;
        st = `Upgrade your ${LEVELS[lv]} at ${g.name} to a ${LEVELS[lv + 1]} for ${g.up}? Rent goes ${rentFor(trail, pd.k)} → ${rentPreview(trail, pd.k, lv + 1, myId)}.`;
      }
    } else {
      const last = trail.mover && players[trail.mover] && trail.dice
        ? `${players[trail.mover].name} rolled ${trail.dice[0]} + ${trail.dice[1]}${trail.passed ? ` and passed the Trailhead (+${LAP_PAY})` : ''}${trail.passedHalf ? ` and rested at Halfway Camp (+${HALF_PAY})` : ''}. ` : '';
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
    const where = p.out ? 'out' : `${(p.coins || 0).toLocaleString()} · ${spotInfo(Math.min(p.pos || 0, SPOTS - 1)).name}`;
    div.appendChild(document.createTextNode(`${trail.phase === 'play' && id === turnId ? '▶ ' : ''}${jobInfo(p.job).icon} ${p.name}${id === myId ? ' (you)' : ''} · ${where}`));
    tPlayers.appendChild(div);
  });

  const taken = new Set(dead ? [] : ids.filter(id => id !== myId).map(id => players[id].job));
  const canJoin = !me && (S.seated >= 0 || S.trailFull) && !S.boardView && (trail.phase !== 'play' || dead) && (dead || ids.length < MAX_TRAIL);
  tJobs.style.display = canJoin ? '' : 'none';
  for (const j of JOBS) jobButtons[j.id].disabled = taken.has(j.id);

  const mine = pd && pd.who === myId;
  tLength.style.display = me && trail.phase !== 'play' ? '' : 'none';
  tRoll.style.display = me && trail.phase === 'play' && !pd && !dead ? '' : 'none';
  tRoll.disabled = !(turnId === myId && !trailBusy);
  tBuy.style.display = mine && (pd.type !== 'station' || pd.buy) ? '' : 'none';
  tRide.style.display = mine && pd.type === 'station' && trail.players[myId].coins > pd.fare ? '' : 'none';
  tPass.style.display = mine ? '' : 'none';
  if (mine) {
    if (pd.type === 'station') { tBuy.textContent = `Buy (${STATION_BUY})`; tRide.textContent = `🚂 Ride (${pd.fare || 'free'})`; tPass.textContent = 'Stay'; }
    else {
      const g = GROUPS[GROUP_OF[pd.k]];
      tBuy.textContent = pd.type === 'buy' ? `Buy (${g.buy})` : `Upgrade (${g.up})`;
      tPass.textContent = pd.type === 'buy' ? 'Pass' : 'Not now';
    }
  }
  tBuy.disabled = tRide.disabled = tPass.disabled = trailBusy;
  tStart.style.display = me && (trail.phase !== 'play' || dead) && ids.length >= 2 ? '' : 'none';
  tMore.style.display = me ? '' : 'none';
  if (!me) menuOpen = false;
  tMenu.style.display = me && menuOpen ? '' : 'none';
  tEnd.style.display = trail.phase === 'play' ? '' : 'none';
  refreshDash(turnId, dead);
  if (hooks.refreshSwitch) hooks.refreshSwitch();
}

// ---------- The big board: a dashboard of player cards, and a winner screen ----------
const tDash = document.getElementById('tDash');
const tWin = document.getElementById('tWin');
const tWinTitle = document.getElementById('tWinTitle');
const tWinList = document.getElementById('tWinList');
const tFull = document.getElementById('tFull');
const tBack = document.getElementById('tBack');
const dashCards = {};   // id -> { el, key }
let winSeen = '';
tFull.addEventListener('click', () => { if (hooks.setTrailFull) hooks.setTrailFull(true); });
tBack.addEventListener('click', () => { if (hooks.setTrailFull) hooks.setTrailFull(false); });
document.getElementById('tWinOk').addEventListener('click', () => { winSeen = winKey(); tWin.style.display = 'none'; });
function winKey() { return trail && trail.phase === 'over' ? (trail.winner || '') + '|' + (trail.ev || 0) : ''; }
function refreshDash(turnId, dead) {
  const players = (trail && trail.players) || {};
  const ids = validTrailIds();
  for (const id of Object.keys(dashCards)) if (!ids.includes(id)) { dashCards[id].el.remove(); delete dashCards[id]; }
  ids.forEach((id, i) => {
    const p = players[id];
    if (!dashCards[id]) {
      const el = document.createElement('div');
      el.className = 'tCard';
      el.innerHTML = '<div class="tcName"></div><div class="tcCoins"></div><div class="tcMore"></div>';
      dashCards[id] = { el, key: '' };
    }
    const c = dashCards[id];
    if (tDash.children[i] !== c.el) tDash.insertBefore(c.el, tDash.children[i] || null);
    let stalls = 0, stations = 0, top = 0;
    for (const [key, st] of Object.entries(trail.stalls || {})) {
      if (st.o !== id) continue;
      if (isStation(+key.slice(1))) stations++; else { stalls++; top = Math.max(top, st.lv); }
    }
    const turn = trail.phase === 'play' && !dead && id === turnId;
    const key = [p.name, p.job, colorIndex(p), p.coins, p.out, stalls, stations, turn, trail.winner === id && trail.phase === 'over'].join('|');
    if (key === c.key) return;
    c.key = key;
    c.el.style.setProperty('--c', RAINBOW_CSS[colorIndex(p)]);
    c.el.classList.toggle('turn', turn);
    c.el.classList.toggle('out', !!p.out);
    c.el.classList.toggle('won', trail.phase === 'over' && trail.winner === id);
    c.el.querySelector('.tcName').textContent = `${turn ? '▶ ' : ''}${jobInfo(p.job).icon} ${p.name}${id === myId ? ' (you)' : ''}`;
    c.el.querySelector('.tcCoins').textContent = p.out ? 'out' : `🪙 ${(p.coins || 0).toLocaleString()}`;
    c.el.querySelector('.tcMore').textContent = p.out ? '' : `worth ${worth(trail, id).toLocaleString()} · 🏪 ${stalls}${top ? ' (' + LEVELS[top] + ')' : ''} · 🚉 ${stations}`;
  });
  // winner screen on the big board, once per finished game
  const wk = winKey();
  if (S.trailFull && wk && wk !== winSeen && players[trail.winner]) {
    tWinTitle.textContent = `🏆 ${players[trail.winner].name} wins!`;
    const rows = ids.map(id => [id, players[id].out ? -1 : worth(trail, id)]).sort((a, b) => b[1] - a[1]);
    tWinList.textContent = '';
    rows.forEach(([id, w], i) => {
      const d = document.createElement('div');
      d.innerHTML = '<span></span><b></b>';
      d.firstChild.textContent = `${i + 1}. ${jobInfo(players[id].job).icon} ${players[id].name}`;
      d.firstChild.style.color = RAINBOW_CSS[colorIndex(players[id])];
      d.lastChild.textContent = w < 0 ? 'out' : w.toLocaleString();
      tWinList.appendChild(d);
    });
    tWin.style.display = 'flex';
  } else if (!wk || !S.trailFull) tWin.style.display = 'none';
}
export function trailFullChanged() { for (const id of Object.keys(dashCards)) dashCards[id].key = ''; refreshTrailUI(); }

// Point at (or tap) a stone to see what it is
export function showSpotInfo(k) {
  if (!trail) return;
  if (k < 0) { tInfo.textContent = 'Point at a trail stone to see what it is'; return; }
  const info = spotInfo(k);
  let desc = info.desc;
  const st = stallOwner(trail, k);
  if (st && isStation(k)) desc = `${trail.players[st.o].name}'s station · rent ${rentFor(trail, k)} · ride ${FARE}`;
  else if (st) {
    const bonus = sectionCount(trail, st.o, k);
    desc = `${trail.players[st.o].name}'s ${jobInfo(trail.players[st.o].job).name} ${LEVELS[st.lv]} · rent ${rentFor(trail, k)}${bonus ? ` (+${Math.round(bonus * SECTION_BONUS * 100)}% section bonus)` : ''}`;
  }
  const here = activeIds().filter(id => (trail.players[id].pos || 0) === k).map(id => trail.players[id].name);
  tInfo.textContent = `${info.name} · ${desc}${here.length ? ' · here: ' + here.join(', ') : ''}`;
}

// ---------- Called by the room ----------
export function refreshTrail() {   // after anything changes (people, seats, games)
  syncPawns();
  syncStalls();
  if (!trailBusy) placeAllPawns();
  refreshTrailUI();
  refreshTrailCounters();
}
export function trailInUse() { return validTrailIds().length > 0; }   // someone is in the game, so the table can't switch
export function hideTrail() { finishTrailAnims(); }
export function trailSeatChanged(seat) {   // your counter and dice follow you to a new seat
  if (trail && trail.players && trail.players[myId]) update(ref(db, 'room/trail/players/' + myId), { seat });
}
export function startTrail() {   // start listening when you enter the room
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
  // Pawns hopping from stone to stone (the hop through the tunnel takes a little longer)
  for (const id of Object.keys(pawns)) {
    const pw = pawns[id], a = pw.anim;
    if (!a) continue;
    const step = a.path[a.i];
    const tunnel = a.prev === TUNNEL_AFTER && step.k === TUNNEL_AFTER + 1;
    const dur = tunnel ? 0.6 : 0.22;
    if (a.t === 0 && S.activeGame === 'trail') sfx.hop();
    a.t += dt;
    const p = Math.min(a.t / dur, 1);
    const from = pawnSpotPos(a.prev, Math.max(a.rank, 0)), to = pawnSpotPos(step.k, Math.max(a.rank, 0));
    if (tunnel) {   // walk along the curve through the mountain instead of hopping over it
      let a0 = spotAng[a.prev], a1 = spotAng[step.k];
      if (a1 < a0) a1 += Math.PI * 2;
      pw.g.position.copy(onRing(a0 + (a1 - a0) * p, R_PATH, TOP + 0.01));
    } else {
      pw.g.position.lerpVectors(from, to, p);
      pw.g.position.y += Math.sin(p * Math.PI) * 0.035;
    }
    if (p >= 1) {
      a.prev = step.k; a.i++; a.t = 0;
      if (a.i >= a.path.length) { pw.anim = null; moveDone(); }
    }
  }
  // The train: chugging around, or carrying a rider from one station to the next
  if (rideAnim) {
    const r = rideAnim, pw = pawns[r.id];
    r.t += dt;
    const p = Math.min(r.t / r.dur, 1);
    const k = 0.18;   // the first and last bits are climbing on and off
    if (pw) {
      if (p < k) {
        pw.g.position.lerpVectors(pawnSpotPos(r.from, Math.max(r.rank, 0)), onRing(r.a0, R_TRACK, TOP + 0.03), p / k);
        trainAng = r.a0 + 0.06;
      } else if (p < 1 - k) {
        const u = easeInOut((p - k) / (1 - 2 * k));
        const a = r.a0 + (r.a1 - r.a0) * u;
        pw.g.position.copy(onRing(a, R_TRACK, TOP + 0.03));
        trainAng = a + 0.06;
      } else {
        pw.g.position.lerpVectors(onRing(r.a1, R_TRACK, TOP + 0.03), pawnSpotPos(r.to, Math.max(r.rank, 0)), (p - 1 + k) / k);
        trainAng = r.a1 + 0.06;
      }
    }
    if (p >= 1) { rideAnim = null; moveDone(); }
  } else {
    trainAng += TRAIN_SPEED * dt;
  }
  trainAng %= Math.PI * 2;
  placeTrain(trainAng);
  // Smoke puffs from the chimney
  const chimneyTop = onRing(trainAng + 0.03, R_TRACK, TOP + 0.06);
  for (const s of smoke) {
    s.t += dt * 0.6;
    if (s.t >= 1) { s.t -= 1; s.from.copy(chimneyTop); }
    s.m.position.copy(s.from).add(new THREE.Vector3(0, s.t * 0.08, 0));
    s.m.scale.setScalar(1 + s.t * 2.5);
    s.m.material.opacity = 0.5 * (1 - s.t);
  }
  // Coin counters
  const players = (trail && trail.players) || {};
  for (const id of Object.keys(trailCounters)) {
    const cnt = trailCounters[id];
    if (cnt.outer.visible && players[id]) drawCounter(cnt, players[id].coins || 0);
    animateCounter(cnt, dt);
  }
  // Sunset clock and the light on the board
  let text = '';
  if (trail && trail.phase === 'play' && !trail.endsAt && !gameIsDead()) {   // endless: no sunset, first to the goal wins
    trailSun.color.copy(SUN_DAY); trailSun.intensity = 0.3;
    text = `♾ Endless · first to ${GOAL.toLocaleString()} coins wins`;
  } else if (trail && trail.phase === 'play' && trail.endsAt && !gameIsDead()) {
    const total = (trail.mins || 40) * 60000;
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
  if (text !== shownTimer) { shownTimer = text; tTopTimer.textContent = text; tTimer.textContent = text; tTimer.style.display = text ? '' : 'none'; }
}