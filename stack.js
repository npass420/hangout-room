// =====================================================================
// stack.js — LittleStack, the wooden block tower
// =====================================================================
import * as THREE from 'three';
import { ref, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, scene, TABLE_Y, paintTexture, std, RAINBOW_CSS, colorIndex } from './core.js';
import { sfx } from './sounds.js';

export const stackGroup = new THREE.Group();   // the tower, hidden while another game is on the table
stackGroup.visible = false;
scene.add(stackGroup);
const gameRef = ref(db, 'room/stack/game');
const posesRef = ref(db, 'room/stack/poses');
const lossesRef = ref(db, 'room/stack/losses');
let game = null;      // shared state: players, turn, phase
let losses = {};      // name -> how many times they knocked the tower over

// ---------- Sizes ----------
const LEVELS = 18, N = LEVELS * 3, MAX_STACK = 8;
const BL = 0.135, BW = 0.045, BH = 0.027;      // block length, width, height
const K = 10;                                  // the physics runs 10x bigger, which keeps small blocks steady
const GRAVITY = -70;                           // a touch softer than real, so collapses are fun to watch
export const STACK_TARGET = new THREE.Vector3(0, TABLE_Y + 0.22, 0);   // where board view looks

// ---------- The tower's layout (every computer builds the same one from the same seed) ----------
function seeded(seed) {
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
// Real wooden blocks are never exactly the same height, so some end up loose: that's what makes the game work
function blockHeights(seed) { const r = seeded(seed); return Array.from({ length: N }, () => BH * (1 - r() * 0.035)); }
const Q_X = new THREE.Quaternion();                                                           // long side along x
const Q_Z = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);   // long side along z
function slotXZ(level, j) { return level % 2 === 0 ? [0, (j - 1) * BW] : [(j - 1) * BW, 0]; }
function towerPoses(seed) {
  const h = blockHeights(seed), poses = [];
  let base = TABLE_Y;
  for (let L = 0; L < LEVELS; L++) {
    let top = 0;
    for (let j = 0; j < 3; j++) {
      const i = L * 3 + j, [x, z] = slotXZ(L, j);
      poses.push({ p: new THREE.Vector3(x, base + h[i] / 2, z), q: (L % 2 ? Q_Z : Q_X).clone() });
      top = Math.max(top, h[i]);
    }
    base += top;
  }
  return poses;
}
function enc(p, q) { return [p.x, p.y, p.z, q.x, q.y, q.z, q.w].map(v => v.toFixed(5)).join(','); }
function dec(s) { const a = s.split(',').map(Number); return { p: new THREE.Vector3(a[0], a[1], a[2]), q: new THREE.Quaternion(a[3], a[4], a[5], a[6]) }; }

// ---------- Wooden blocks ----------
const woodTex = paintTexture(256, 64, (g, w, h) => {
  g.fillStyle = '#e2c08d'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(${120 + Math.random() * 40},${80 + Math.random() * 30},40,${0.15 + Math.random() * 0.2})`;
    g.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * h;
    g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 10, w * 0.7, y + (Math.random() - 0.5) * 10, w, y + (Math.random() - 0.5) * 6);
    g.stroke();
  }
});
const meshes = [];     // one per block
const shown = [];      // what each block currently shows: { p, q }
const targets = [];    // where the shared state says each block is
let heights = blockHeights(1);
for (let i = 0; i < N; i++) {
  const tint = new THREE.Color().setHSL(0.09, 0.45, 0.62 + ((i * 37) % 11) / 100);
  const m = new THREE.Mesh(new THREE.BoxGeometry(BL, BH, BW * 0.985), std(tint, 0.7, { map: woodTex }));
  m.castShadow = true; m.receiveShadow = true;
  m.userData.block = i;
  stackGroup.add(m);
  meshes.push(m);
  shown.push(null);
  targets.push(null);
}
let shapedSeed = -1;
function shapeBlocks(seed) {   // give each block its slightly different height
  if (seed === shapedSeed) return;
  shapedSeed = seed;
  heights = blockHeights(seed);
  meshes.forEach((m, i) => { m.geometry.dispose(); m.geometry = new THREE.BoxGeometry(BL, heights[i], BW * 0.985); });
}
function placeMesh(i, p, q) {
  meshes[i].position.copy(p);
  meshes[i].quaternion.copy(q);
  shown[i] = { p: p.clone(), q: q.clone() };
}
towerPoses(1).forEach((t, i) => { placeMesh(i, t.p, t.q); targets[i] = { p: t.p.clone(), q: t.q.clone() }; });

// Ghost spots on top of the tower, showing where the block you pulled out can go
const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.35, depthWrite: false });
const ghosts = [0, 1, 2].map(j => {
  const g = new THREE.Mesh(new THREE.BoxGeometry(BL, BH, BW), ghostMat.clone());
  g.visible = false;
  g.userData.slot = j;
  stackGroup.add(g);
  return g;
});
let slots = [];   // [{ p, q }] for each ghost that's showing

// ---------- Physics (only runs on the computer of the person whose turn it is) ----------
let RAPIER = null, loading = null;
async function loadPhysics() {
  if (RAPIER) return RAPIER;
  if (!loading) loading = (async () => {
    let mod;
    try { mod = await import('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.12.0/+esm'); }
    catch (e) { mod = await import('https://esm.sh/@dimforge/rapier3d-compat@0.12.0'); }
    const R = mod.default && mod.default.World ? mod.default : mod;
    await (R.init ? R.init() : mod.init());
    RAPIER = R;
    return R;
  })();
  return loading;
}
let world = null, bodies = [];
let building = false, physicsError = false;
let collapseUntil = 0;   // after a fall, keep showing the collapse for a few seconds
function makeBody(i, p, q, asleep) {
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(p.x * K, p.y * K, p.z * K)
    .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    .setLinearDamping(0.05).setAngularDamping(0.2);
  if (asleep && desc.setSleeping) desc.setSleeping(true);
  const body = world.createRigidBody(desc);
  world.createCollider(RAPIER.ColliderDesc.cuboid(BL / 2 * K, heights[i] / 2 * K, BW * 0.985 / 2 * K)
    .setFriction(0.55).setRestitution(0.02).setDensity(1), body);
  return body;
}
async function buildWorld() {
  building = true;
  try {
    try { await loadPhysics(); }
    catch (e) { physicsError = true; console.error('LittleStack physics failed to load', e); refreshStackUI(); return; }
    if (!amAuthority()) return;
    world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    world.timestep = 1 / 60;
    try { if (world.integrationParameters && 'numSolverIterations' in world.integrationParameters) world.integrationParameters.numSolverIterations = 8; } catch (e) {}
    // The tabletop and the floor
    const table = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, (TABLE_Y - 0.03) * K, 0));
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.03 * K, 1.0 * K).setFriction(0.6), table);
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5 * K, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(5 * K, 0.5 * K, 5 * K), floor);
    bodies = [];
    for (let i = 0; i < N; i++) {
      const t = targets[i];
      bodies.push(t && !(game.stage === 'carry' && game.moving === i) ? makeBody(i, t.p, t.q, true) : null);
      if (t) placeMesh(i, t.p, t.q);
    }
    lastSent = targets.map(t => (t ? enc(t.p, t.q) : ''));
  } finally { building = false; refreshStackUI(); }
}
function dropWorld() {
  if (world) { try { world.free(); } catch (e) {} }
  world = null; bodies = []; grab = null; acc = 0;
}
function amAuthority() { return !!game && game.phase === 'play' && effectiveTurn() === myId; }

// ---------- Players and turns ----------
function ids(g = game) { return Object.entries((g && g.players) || {}).sort((a, b) => a[1].order - b[1].order).map(([id]) => id); }
function present(g = game) { return ids(g).filter(id => S.presence[id]); }
function nextAfter(g, id) {
  const all = ids(g), i = all.indexOf(id);
  for (let k = 1; k <= all.length; k++) {
    const c = all[(i + k + all.length) % all.length];
    if (S.presence[c]) return c;
  }
  return '';
}
function effectiveTurn(g = game) {
  if (!g || g.phase !== 'play') return '';
  const p = present(g);
  if (!p.length) return '';
  if (p.includes(g.turn)) return g.turn;
  return nextAfter(g, g.turn) || p[0];
}
function lossKey(name) { return String(name || '?').replace(/[.#$\[\]\/]/g, '_').slice(0, 20) || '?'; }
export function stackInUse() { return present().length > 0; }

// ---------- Which levels you may take from, and where the block can go ----------
function levelOf(y) { return Math.max(0, Math.floor((y - TABLE_Y) / (BH * 0.99))); }   // levels are a hair under a full block tall
function topLevel(except) {
  let top = 0;
  for (let i = 0; i < N; i++) if (i !== except && shown[i]) top = Math.max(top, levelOf(shown[i].p.y));
  return top;
}
function canTake(i) {
  if (!shown[i]) return false;
  return levelOf(shown[i].p.y) < topLevel(i) - 1;   // not from the top two levels
}
function computeSlots(moving) {
  const top = topLevel(moving);
  const onTop = [];
  for (let i = 0; i < N; i++) if (i !== moving && shown[i] && levelOf(shown[i].p.y) === top) onTop.push(i);
  let level = top, taken = [false, false, false], baseY;
  if (onTop.length >= 3) {
    level = top + 1;
    baseY = Math.max(...onTop.map(i => shown[i].p.y + heights[i] / 2));
  } else {
    baseY = Math.min(...onTop.map(i => shown[i].p.y - heights[i] / 2));
    for (const i of onTop) {   // which of the three spots are filled
      const p = shown[i].p, lat = top % 2 === 0 ? p.z : p.x;
      taken[Math.max(0, Math.min(2, Math.round(lat / BW) + 1))] = true;
    }
  }
  const out = [];
  for (let j = 0; j < 3; j++) {
    if (taken[j]) continue;
    const [x, z] = slotXZ(level, j);
    out.push({ j, p: new THREE.Vector3(x, baseY + heights[moving] / 2 + 0.004, z), q: (level % 2 ? Q_Z : Q_X).clone() });
  }
  return out;
}

// ---------- Your turn: grab, push or pull, then place ----------
let grab = null;   // { i, axis, lat, start, base, q, offset }
let hoverIdx = -1;
const plane = new THREE.Plane(), hit = new THREE.Vector3();
export function stackHover(i) {
  const ok = i >= 0 && amAuthority() && world && game.stage === 'pick' && canTake(i);
  const want = ok ? i : -1;
  if (want === hoverIdx) return want >= 0;
  if (hoverIdx >= 0) meshes[hoverIdx].material.emissive.setHex(0x000000);
  hoverIdx = want;
  if (hoverIdx >= 0) meshes[hoverIdx].material.emissive.setHex(0x3a2a10);
  return hoverIdx >= 0;
}
export function stackGrab(i, ray) {
  if (!amAuthority() || !world || game.stage !== 'pick' || !canTake(i) || !bodies[i]) return false;
  const p = shown[i].p.clone(), q = shown[i].q.clone();
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(q); axis.y = 0; axis.normalize();
  plane.set(new THREE.Vector3(0, 1, 0), -p.y);
  if (!ray.intersectPlane(plane, hit)) return false;
  grab = { i, axis, lat: new THREE.Vector3(-axis.z, 0, axis.x), start: hit.clone(), base: p, q, offset: 0 };
  meshes[i].material.emissive.setHex(0x5a3a10);
  bodies[i].wakeUp();
  sfx.clack(0.5);
  return true;
}
export function stackDrag(ray) {
  if (!grab) return;
  if (!ray.intersectPlane(plane, hit)) return;
  grab.offset = Math.max(-BL * 1.3, Math.min(BL * 1.3, hit.clone().sub(grab.start).dot(grab.axis)));
}
export function stackRelease() {
  if (!grab) return;
  meshes[grab.i].material.emissive.setHex(0x000000);
  grab = null;
}
export function stackPlace(j) {
  if (!amAuthority() || !world || game.stage !== 'carry') return;
  const s = slots.find(x => x.j === j);
  if (!s) return;
  const i = game.moving;
  bodies[i] = makeBody(i, s.p, s.q, false);
  placeMesh(i, s.p, s.q);
  settleStart = performance.now();
  update(gameRef, { stage: 'settle' });
  sfx.clack(0.8);
}
export function stackPickables() {
  if (!stackGroup.visible) return [];
  return [...meshes, ...ghosts.filter(g => g.visible)];
}

// ---------- Sending the tower to everyone else ----------
let lastSent = [];
let lastSendAt = 0;
function sendPoses(force) {
  const now = performance.now();
  if (!force && now - lastSendAt < 125) return;
  lastSendAt = now;
  const out = {};
  for (let i = 0; i < N; i++) {
    if (!shown[i] || (game.stage === 'carry' && game.moving === i)) continue;
    const e = enc(shown[i].p, shown[i].q);
    if (e !== lastSent[i]) { out['b' + i] = e; lastSent[i] = e; }
  }
  if (Object.keys(out).length) update(posesRef, out);
}

// ---------- Did the tower fall? ----------
const UPV = new THREE.Vector3();
function fallen(except) {
  for (let i = 0; i < N; i++) {
    if (i === except || !bodies[i]) continue;
    const { p, q } = shown[i];
    UPV.set(0, 1, 0).applyQuaternion(q);
    const tilted = Math.abs(UPV.y) < 0.7;                      // tipped over on its side
    const onTable = p.y < TABLE_Y + BH * 0.9;
    const away = Math.hypot(p.x, p.z) > BW * 2.4;              // outside the tower's footprint
    if (tilted || (onTable && away) || p.y < TABLE_Y - 0.05) return true;
  }
  return false;
}
function towerFell() {
  collapseUntil = performance.now() + 3500;
  const name = S.myName;
  runTransaction(gameRef, g => {
    if (!g || g.phase !== 'play') return;
    g.phase = 'fallen'; g.fell = myId; g.stage = 'pick'; g.moving = -1;
    g.note = `💥 ${name} knocked the tower over!`;
    g.ev = (g.ev || 0) + 1;
    return g;
  });
  runTransaction(ref(db, 'room/stack/losses/' + lossKey(name)), n => (n || 0) + 1);
}

// ---------- Every frame ----------
let acc = 0, settleStart = 0, passing = false;
const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function stepPhysics(dt) {
  acc = Math.min(acc + dt, 4 / 60);
  while (acc >= 1 / 60) {
    acc -= 1 / 60;
    if (grab && bodies[grab.i]) {   // your hand moves the grabbed block along its length
      const b = bodies[grab.i], t = b.translation();
      tmpP.set(t.x / K, t.y / K, t.z / K);
      const want = grab.base.clone().addScaledVector(grab.axis, grab.offset);
      const err = want.sub(tmpP);
      const va = Math.max(-0.25, Math.min(0.25, err.dot(grab.axis) * 10));
      const vl = Math.max(-0.1, Math.min(0.1, err.dot(grab.lat) * 10));
      const vy = Math.max(-0.1, Math.min(0.1, (grab.base.y - tmpP.y) * 10));
      b.setLinvel({ x: (grab.axis.x * va + grab.lat.x * vl) * K, y: vy * K, z: (grab.axis.z * va + grab.lat.z * vl) * K }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.setRotation({ x: grab.q.x, y: grab.q.y, z: grab.q.z, w: grab.q.w }, true);
    }
    world.step();
  }
  for (let i = 0; i < N; i++) {
    const b = bodies[i];
    if (!b) continue;
    const t = b.translation(), r = b.rotation();
    placeMesh(i, tmpP.set(t.x / K, t.y / K, t.z / K), tmpQ.set(r.x, r.y, r.z, r.w));
  }
}
export function updateStack(dt) {
  if (!game) return;
  const auth = amAuthority();
  const collapsing = performance.now() < collapseUntil;
  if (auth && !world && !building && !physicsError) buildWorld();
  if (world && !auth && !collapsing) { sendPoses(true); dropWorld(); }

  if (world) {
    stepPhysics(dt);
    if (auth && game.stage === 'pick' && grab) {   // pulled all the way out? Then it's in your hand
      const p = shown[grab.i].p;
      if (Math.abs(p.x * grab.axis.x + p.z * grab.axis.z) > BL * 0.85) {
        const i = grab.i;
        stackRelease();
        world.removeRigidBody(bodies[i]); bodies[i] = null;
        update(gameRef, { stage: 'carry', moving: i });
        game.stage = 'carry'; game.moving = i;
        sfx.clack(0.6);
      }
    }
    if (auth && fallen(game.stage === 'carry' ? game.moving : (grab ? grab.i : -1))) {
      stackRelease();
      towerFell();
      game.phase = 'fallen';
    }
    if (auth && game.stage === 'settle' && !passing) {   // wait for the tower to settle, then pass the turn
      const quiet = bodies.every(b => !b || b.isSleeping());
      const t = performance.now() - settleStart;
      if ((quiet && t > 700) || t > 2500) {
        passing = true;
        sendPoses(true);
        runTransaction(gameRef, g => {
          if (!g || g.phase !== 'play' || effectiveTurn(g) !== myId) return;
          g.stage = 'pick'; g.moving = -1; g.turn = nextAfter(g, myId) || myId;
          g.moves = (g.moves || 0) + 1;
          return g;
        }).finally(() => { passing = false; });
      }
    }
    sendPoses(false);
  } else {
    // Everyone else: glide each block toward where the shared state says it is
    const k = 1 - Math.exp(-dt * 14);
    for (let i = 0; i < N; i++) {
      const t = targets[i];
      if (!t || (game.stage === 'carry' && game.moving === i)) continue;
      if (!shown[i]) { placeMesh(i, t.p, t.q); continue; }
      shown[i].p.lerp(t.p, k); shown[i].q.slerp(t.q, k);
      meshes[i].position.copy(shown[i].p); meshes[i].quaternion.copy(shown[i].q);
    }
  }

  // The block in someone's hand floats above the tower; ghost spots show where it can go
  const carrying = game.phase === 'play' && game.stage === 'carry' && game.moving >= 0;
  if (carrying) {
    if (!slots.length || slots.moving !== game.moving) { slots = computeSlots(game.moving); slots.moving = game.moving; }
    const i = game.moving, top = Math.max(...slots.map(s => s.p.y), STACK_TARGET.y);
    const t = performance.now() / 1000;
    meshes[i].position.set(0, top + 0.09 + Math.sin(t * 2) * 0.006, 0);
    meshes[i].quaternion.copy(slots[0] ? slots[0].q : Q_X);
    ghosts.forEach((g, j) => {
      const s = slots.find(x => x.j === j);
      g.visible = !!s;
      if (s) { g.position.copy(s.p); g.quaternion.copy(s.q); g.material.opacity = 0.25 + Math.sin(t * 4) * 0.1; }
    });
  } else {
    if (slots.length) slots = [];
    ghosts.forEach(g => { g.visible = false; });
  }
}

// ---------- Applying the shared state ----------
function applyGame(g) {
  const prev = game;
  game = g || { phase: 'lobby' };
  if (prev && (game.round || 0) !== (prev.round || 0)) { dropWorld(); collapseUntil = 0; }   // a fresh tower: start over
  if (game.seed) shapeBlocks(game.seed);
  if (prev && (game.ev || 0) > (prev.ev || 0) && game.note) {
    hooks.addSys(game.note);
    if (S.activeGame === 'stack') sfx.crash();
  }
  if (prev && prev.stage === 'carry' && game.stage === 'settle' && game.turn !== myId && S.activeGame === 'stack') sfx.clack(0.8);
  if (game.stage !== 'carry') slots = [];
  refreshStackUI();
}
function applyPoses(v) {
  v = v || {};
  for (let i = 0; i < N; i++) {
    const s = v['b' + i];
    if (!s) continue;
    targets[i] = dec(s);
    if (!world && !shown[i]) placeMesh(i, targets[i].p, targets[i].q);
  }
}

// ---------- Actions ----------
function stackJoin() {
  if (S.seated < 0) return;
  const seat = S.seated;
  runTransaction(gameRef, g => {
    g = g || { phase: 'lobby' };
    g.players = g.players || {};
    for (const id of Object.keys(g.players)) if (!S.presence[id]) delete g.players[id];   // tidy up people who left
    if (Object.keys(g.players).filter(id => id !== myId).length >= MAX_STACK) return;
    g.players[myId] = { seat, order: Date.now(), name: S.myName, c: S.myHue };
    return g;
  });
}
function stackLeave() {
  if (world) sendPoses(true);
  runTransaction(gameRef, g => {
    if (!g || !g.players || !g.players[myId]) return;
    if (g.phase === 'play' && effectiveTurn(g) === myId) {
      g.turn = nextAfter(g, myId);
      if (g.stage === 'carry') g.stage = 'pick';   // the block in your hand is set back down below
    }
    delete g.players[myId];
    return g;
  });
}
function freshTower(startAfter) {
  const seed = 1 + Math.floor(Math.random() * 2147483000);
  const out = {};
  towerPoses(seed).forEach((t, i) => { out['b' + i] = enc(t.p, t.q); });
  update(posesRef, out).then(() => runTransaction(gameRef, g => {
    if (!g || !g.players || !g.players[myId]) return;
    for (const id of Object.keys(g.players)) if (!S.presence[id]) delete g.players[id];
    const list = ids(g);
    if (!list.length) return;
    g.phase = 'play'; g.seed = seed; g.round = (g.round || 0) + 1;
    g.stage = 'pick'; g.moving = -1; g.fell = ''; g.note = ''; g.moves = 0;
    g.turn = startAfter && g.players[startAfter] ? startAfter : list[0];
    return g;
  }));
}
function stackEnd() {
  runTransaction(gameRef, g => {
    if (!g || !g.players || !g.players[myId]) return;
    g.phase = 'lobby'; g.stage = 'pick'; g.moving = -1;
    return g;
  });
}

// ---------- LittleStack panel ----------
const sStatus = document.getElementById('sStatus');
const sPlayers = document.getElementById('sPlayers');
const sJoin = document.getElementById('sJoin');
const sStart = document.getElementById('sStart');
const sRebuild = document.getElementById('sRebuild');
const sMore = document.getElementById('sMore');
const sMenu = document.getElementById('sMenu');
const sLeave = document.getElementById('sLeave');
const sEnd = document.getElementById('sEnd');
const sReset = document.getElementById('sReset');
sJoin.addEventListener('click', stackJoin);
sStart.addEventListener('click', () => freshTower(''));
sRebuild.addEventListener('click', () => freshTower(game && game.fell));   // whoever knocked it over goes first
let menuOpen = false;
sMore.addEventListener('click', () => { menuOpen = !menuOpen; refreshStackUI(); });
function armButton(btn, label, action) {
  let armed = false, timer = 0;
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true; btn.textContent = 'Sure? Click again';
      timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000);
      return;
    }
    clearTimeout(timer); armed = false; btn.textContent = label;
    menuOpen = false;
    action();
  });
}
armButton(sLeave, 'Leave game', stackLeave);
armButton(sEnd, 'End game', stackEnd);
armButton(sReset, 'Reset losses', () => update(ref(db, 'room/stack'), { losses: null }));

function refreshStackUI() {
  if (!game) return;
  const list = present();
  const players = game.players || {};
  const me = !!(players[myId] && S.presence[myId]);
  const turn = effectiveTurn();
  const turnName = players[turn] ? players[turn].name : '…';
  let st;
  if (game.phase === 'play') {
    if (turn === myId) {
      st = game.stage === 'carry' ? 'Now click a glowing spot on top to place it'
        : game.stage === 'settle' ? 'Steady… let it settle'
        : world ? 'Your turn! Drag a block to push or pull it out (not from the top two levels)'
        : physicsError ? "Couldn't load the physics. Try Ctrl+F5." : 'Your turn! Getting the physics ready…';
    } else {
      st = game.stage === 'carry' ? `${turnName} is placing a block on top…` : `${turnName}'s turn`;
    }
  } else if (game.phase === 'fallen') {
    st = `${game.note || '💥 The tower fell!'} Click Rebuild for the next round.`;
  } else {
    st = list.length ? `${list.length} player${list.length > 1 ? 's' : ''} ready · click Start` : 'Sit in a chair and click Join game';
  }
  sStatus.textContent = st;

  sPlayers.textContent = '';
  list.forEach(id => {
    const p = players[id];
    const div = document.createElement('div');
    const dot = document.createElement('span');
    dot.textContent = '● ';
    dot.style.color = RAINBOW_CSS[colorIndex(p)];
    div.appendChild(dot);
    const lost = losses[lossKey(p.name)] || 0;
    div.appendChild(document.createTextNode(`${game.phase === 'play' && id === turn ? '▶ ' : ''}${p.name}${id === myId ? ' (you)' : ''} · 💥 ${lost}`));
    sPlayers.appendChild(div);
  });

  sJoin.style.display = !me && S.seated >= 0 && !S.boardView && list.length < MAX_STACK ? '' : 'none';
  sStart.style.display = me && game.phase === 'lobby' ? '' : 'none';
  sRebuild.style.display = me && game.phase === 'fallen' ? '' : 'none';
  sMore.style.display = me ? '' : 'none';
  if (!me) menuOpen = false;
  sMenu.style.display = me && menuOpen ? '' : 'none';
  sEnd.style.display = game.phase !== 'lobby' ? '' : 'none';
  if (hooks.refreshSwitch) hooks.refreshSwitch();
}

// ---------- Called by the room ----------
export function refreshStack() { refreshStackUI(); }
export function hideStack() { stackRelease(); }
export function stackSeatChanged(seat) {
  if (game && game.players && game.players[myId]) update(ref(db, 'room/stack/game/players/' + myId), { seat });
}
export function startStack() {
  onValue(gameRef, s => applyGame(s.val()));
  onValue(posesRef, s => applyPoses(s.val()));
  onValue(lossesRef, s => { losses = s.val() || {}; refreshStackUI(); });
}