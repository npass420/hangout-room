// =====================================================================
// stack.js — LittleStack, the wooden block tower
// Test a block to feel how loose it is, then pull it and hope. The tower's luck is a dice roll
// based on how loose the block is and how shaky the tower has become; real physics only runs for the crash.
// =====================================================================
import * as THREE from 'three';
import { ref, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, serverNow, scene, TABLE_Y, seatAngle, paintTexture, std, RAINBOW_CSS, colorIndex } from './core.js';
import { sfx } from './sounds.js';
// Play a sound without ever letting a sound problem break the game
function sound(name, ...args) { try { if (typeof sfx[name] === 'function') sfx[name](...args); } catch (e) { console.warn('LittleStack sound', e); } }

export const stackGroup = new THREE.Group();   // the tower, hidden while another game is on the table
stackGroup.visible = false;
scene.add(stackGroup);
const gameRef = ref(db, 'room/stack/game');
const lossesRef = ref(db, 'room/stack/losses');
let game = null;      // shared state: players, turn, where every block is
let losses = {};      // name -> how many times they knocked the tower over

// ---------- Sizes and odds ----------
const LEVELS = 18, N = LEVELS * 3, MAX_STACK = 8;
const BL = 0.135, BW = 0.045, BH = 0.027;              // block length, width, height
const RISK = { loose: 0.005, snug: 0.02, tight: 0.09 }; // chance the tower falls when you pull one
const RISK_WEAK = 0.001;                                // extra for each level that's missing a block
const RISK_TALL = 0.002;                                // extra for each level taller than the start
const PULL_TIME = 2.4;                                  // seconds the slow pull takes
const FALL_AT = 0.7;                                    // how far through the pull a doomed tower gives way
export const STACK_TARGET = new THREE.Vector3(0, TABLE_Y + 0.22, 0);   // where board view looks

// ---------- The tower's layout ----------
function seeded(seed) {
  let s = Math.floor(seed) % 2147483647; if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
// In each level, either the two side blocks carry the weight (so the middle is loose) or the middle does (so the sides are)
function sidesCarry(seed, L) { const r = seeded(seed * 31 + L * 7919 + 1); r(); return r() < 0.5; }
const Q_X = new THREE.Quaternion();                                                           // long side along x
const Q_Z = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);   // long side along z
function slotXZ(L, j) { return L % 2 === 0 ? [0, (j - 1) * BW] : [(j - 1) * BW, 0]; }
const jitter = Array.from({ length: N }, (_, i) => { const r = seeded(i * 101 + 7); return [(r() - 0.5) * 0.0016, (r() - 0.5) * 0.0016, (r() - 0.5) * 0.024]; });
function homePose(i, s) {   // where block i sits when it's in spot s (level * 3 + position)
  const L = Math.floor(s / 3), j = s % 3, [x, z] = slotXZ(L, j), [jx, jz, jy] = jitter[i];
  const q = (L % 2 ? Q_Z : Q_X).clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), jy));
  return { p: new THREE.Vector3(x + jx, TABLE_Y + BH * (L + 0.5), z + jz), q };
}
function freshSlots() { return Array.from({ length: N }, (_, i) => i); }
function slotsOf(g) { return g && g.slots ? g.slots.split(',').map(Number) : freshSlots(); }

// ---------- Rules: which blocks you may pull, how risky it is, where it goes ----------
function topLevel(sl) { let t = 0; for (const s of sl) if (s >= 0) t = Math.max(t, Math.floor(s / 3)); return t; }
function levelHas(sl, L) { const h = [false, false, false]; for (const s of sl) if (s >= 0 && Math.floor(s / 3) === L) h[s % 3] = true; return h; }
function canTest(sl, i) { return sl[i] >= 0 && Math.floor(sl[i] / 3) <= topLevel(sl) - 2; }   // not from the top two levels
function holdsUp(sl, i) {   // would the level still stand without this block? (it needs the middle, or both sides)
  const L = Math.floor(sl[i] / 3), h = levelHas(sl, L);
  h[sl[i] % 3] = false;
  return h[1] || (h[0] && h[2]);
}
function kindOf(sl, seed, i) {
  const L = Math.floor(sl[i] / 3), j = sl[i] % 3;
  const h = levelHas(sl, L), count = h.filter(Boolean).length;
  const carriers = sidesCarry(seed, L);
  let kind = (carriers ? j !== 1 : j === 1) ? 'tight' : 'loose';
  if (kind === 'loose' && (L < 4 || count < 3)) kind = 'snug';   // low levels and gappy levels grip harder
  return kind;
}
function riskOf(sl, seed, i) {
  if (!holdsUp(sl, i)) return 1;
  const top = topLevel(sl);
  let weak = 0;
  for (let L = 0; L < top; L++) if (levelHas(sl, L).filter(Boolean).length < 3) weak++;
  return RISK[kindOf(sl, seed, i)] + weak * RISK_WEAK + Math.max(0, top + 1 - LEVELS) * RISK_TALL;
}
function freeSpots(sl) {   // spots on top where the pulled block can go
  const top = topLevel(sl), h = levelHas(sl, top);
  if (h.every(Boolean)) return [0, 1, 2].map(j => (top + 1) * 3 + j);
  return [0, 1, 2].filter(j => !h[j]).map(j => top * 3 + j);
}

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
const meshes = [];
const shown = [];   // where each block is drawn right now: { p, q }
for (let i = 0; i < N; i++) {
  const tint = new THREE.Color().setHSL(0.09, 0.45, 0.62 + ((i * 37) % 11) / 100);
  const m = new THREE.Mesh(new THREE.BoxGeometry(BL, BH * 0.99, BW * 0.985), std(tint, 0.7, { map: woodTex }));
  m.castShadow = true; m.receiveShadow = true;
  m.userData.block = i;
  stackGroup.add(m);
  meshes.push(m);
  const h = homePose(i, i);
  shown.push({ p: h.p.clone(), q: h.q.clone() });
  m.position.copy(h.p); m.quaternion.copy(h.q);
}
// Ghost spots on top of the tower, showing where the pulled block can go
const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.35, depthWrite: false });
const ghosts = [0, 1, 2].map(j => {
  const g = new THREE.Mesh(new THREE.BoxGeometry(BL, BH, BW), ghostMat.clone());
  g.visible = false;
  g.userData.slot = j;
  stackGroup.add(g);
  return g;
});

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
function myTurn() { return !!game && game.phase === 'play' && effectiveTurn() === myId; }
function lossKey(name) { return String(name || '?').replace(/[.#$\[\]\/]/g, '_').slice(0, 20) || '?'; }
export function stackInUse() { return present().length > 0; }

// ---------- Your turn: test a block, pull it, place it ----------
let hoverIdx = -1;
function banner(text, secs) { if (S.activeGame === 'stack' && hooks.banner) hooks.banner(text, secs); }
export function stackHover(i) {   // highlight blocks you're allowed to test
  const ok = i >= 0 && myTurn() && game.stage === 'pick' && canTest(slotsOf(game), i);
  const want = ok ? i : -1;
  if (want === hoverIdx) return want >= 0;
  hoverIdx = want;
  return hoverIdx >= 0;
}
function stackTest(i) {
  if (!myTurn() || game.stage !== 'pick') return;
  if (!canTest(slotsOf(game), i)) { banner('Not from the top two levels! ✋', 2); return; }
  update(gameRef, { testing: i });
}
// room.js calls this when you press on a block; blocks are now tested with a tap instead (see stackTap)
export function stackGrab() { return false; }
// A tap on or near the tower: test the closest block you're allowed to, or place your block in the closest spot.
// Taps don't have to be exact, which matters on a phone. Returns true if the tap was used.
const TAP_NEAR = 0.06;   // how close (in meters) a tap has to land to count
function rayDist(ray, p) { const d = ray && ray.distanceToPoint ? ray.distanceToPoint(p) : NaN; return typeof d === 'number' ? d : NaN; }
export function stackTap(hitBlock, hitSlot, ray) {
  if (!game || !stackGroup.visible || !myTurn()) return false;
  if (game.stage === 'carry') {
    if (hitSlot !== undefined) { stackPlace(hitSlot); return true; }
    let best = -1, bestD = TAP_NEAR * 1.5;
    for (const s of freeSpots(slotsOf(game))) {   // the glowing spots on top
      const L = Math.floor(s / 3), [x, z] = slotXZ(L, s % 3);
      const d = rayDist(ray, new THREE.Vector3(x, TABLE_Y + BH * (L + 0.5), z));
      if (d < bestD) { bestD = d; best = s % 3; }
    }
    if (best >= 0) { stackPlace(best); return true; }
    return false;
  }
  if (game.stage !== 'pick') return false;
  const sl = slotsOf(game);
  if (hitBlock !== undefined && canTest(sl, hitBlock)) { stackTest(hitBlock); return true; }
  let best = -1, bestD = TAP_NEAR;
  for (let i = 0; i < N; i++) {
    if (!canTest(sl, i)) continue;
    const d = rayDist(ray, shown[i].p);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) { stackTest(best); return true; }
  if (hitBlock !== undefined) { stackTest(hitBlock); return true; }   // a top-level block: shows the "not from the top" hint
  return false;
}
// The ▲ ▼ ◀ ▶ buttons: move your test to the next block over
function stackNudge(dL, dJ) {
  if (!myTurn() || game.stage !== 'pick') return;
  const sl = slotsOf(game), top = topLevel(sl);
  const at = {};   // spot -> block
  sl.forEach((s, i) => { if (s >= 0) at[s] = i; });
  const ok = s => at[s] !== undefined && canTest(sl, at[s]);
  let cur = game.testing >= 0 && sl[game.testing] >= 0 ? sl[game.testing] : -1;
  if (cur < 0) {   // nothing tested yet: start in the middle of the tower
    const L0 = Math.max(0, Math.floor((top - 2) / 2));
    for (let d = 0; d <= top; d++) for (const L of [L0 - d, L0 + d]) for (const j of [1, 0, 2]) {
      if (L >= 0 && ok(L * 3 + j)) { update(gameRef, { testing: at[L * 3 + j] }); return; }
    }
    return;
  }
  let L = Math.floor(cur / 3), j = cur % 3;
  for (let step = 0; step < LEVELS * 3; step++) {
    if (dL) L += dL; else { j += dJ; if (j < 0 || j > 2) return; }
    if (L < 0 || L > top) return;
    if (dL) { for (const jj of [j, 1, 0, 2]) if (ok(L * 3 + jj)) { update(gameRef, { testing: at[L * 3 + jj] }); return; } }
    else if (ok(L * 3 + j)) { update(gameRef, { testing: at[L * 3 + j] }); return; }
  }
}
export function stackDrag() {}
export function stackRelease() {}
function stackPull() {
  const name = S.myName;
  runTransaction(gameRef, g => {
    if (!g || g.phase !== 'play' || g.stage !== 'pick' || effectiveTurn(g) !== myId) return;
    const sl = slotsOf(g), i = g.testing;
    if (!(i >= 0) || !canTest(sl, i)) return;
    const risk = riskOf(sl, g.seed, i);
    g.stage = 'pulling'; g.moving = i; g.testing = -1;
    g.risk = risk; g.fall = Math.random() < risk;   // the hidden roll
    g.pullAt = serverNow(); g.puller = myId; g.pullerName = name;
    g.lean = Math.random() * Math.PI * 2;
    return g;
  });
}
function finishPull() {   // the pull is over: either it's in your hand, or the tower is coming down
  const pullAt = game.pullAt;
  let loser = null;
  runTransaction(gameRef, g => {
    loser = null;
    if (!g || g.phase !== 'play' || g.stage !== 'pulling' || g.pullAt !== pullAt) return;
    if (g.fall) {
      loser = g.pullerName;
      if (g.players && g.players[g.puller]) g.players[g.puller].lost = (g.players[g.puller].lost || 0) + 1;
      g.fell = g.puller; g.stage = 'pick';
      g.ev = (g.ev || 0) + 1;
      if ((g.tower || 1) >= (g.towers || 10)) {   // that was the last tower: fewest knock-overs wins
        const ps = Object.values(g.players || {});
        const least = Math.min(...ps.map(p => p.lost || 0));
        const names = ps.filter(p => (p.lost || 0) === least).map(p => p.name);
        g.phase = 'over';
        g.winners = names.join(' & ');
        g.note = `🏆 ${g.winners} ${names.length > 1 ? 'win' : 'wins'} the match!`;
      } else {
        g.phase = 'fallen';
        g.note = `💥 ${g.pullerName} knocked it over!`;
      }
    } else {
      const sl = slotsOf(g); sl[g.moving] = -1; g.slots = sl.join(',');
      g.stage = 'carry';
    }
    return g;
  }).then(r => {
    if (r && r.committed && loser) runTransaction(ref(db, 'room/stack/losses/' + lossKey(loser)), n => (n || 0) + 1);
  });
}
export function stackPlace(j) {
  if (!myTurn() || game.stage !== 'carry') return;
  const spot = freeSpots(slotsOf(game)).find(s => s % 3 === j);
  if (spot === undefined) return;
  runTransaction(gameRef, g => {
    if (!g || g.phase !== 'play' || g.stage !== 'carry' || effectiveTurn(g) !== myId) return;
    const sl = slotsOf(g);
    if (!freeSpots(sl).includes(spot)) return;
    sl[g.moving] = spot; g.slots = sl.join(',');
    g.stage = 'pick'; g.moving = -1; g.testing = -1;
    g.moves = (g.moves || 0) + 1;
    g.turn = nextAfter(g, myId) || myId;
    return g;
  });
}
export function stackPickables() {
  if (!stackGroup.visible) return [];
  return [...meshes, ...ghosts.filter(g => g.visible)];
}

// ---------- The crash: real physics if it loads, a simpler tumble if not ----------
let RAPIER = null, loading = null;
function loadPhysics() {
  if (!loading) loading = (async () => {
    let mod;
    try { mod = await import('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.12.0/+esm'); }
    catch (e) { mod = await import('https://esm.sh/@dimforge/rapier3d-compat@0.12.0'); }
    const R = mod.default && mod.default.World ? mod.default : mod;
    await (R.init ? R.init() : mod.init());
    RAPIER = R;
  })().catch(e => { console.warn('LittleStack: physics did not load, using the simple tumble', e); });
  return loading;
}
const K = 10;   // physics runs 10x bigger, which it handles better
let collapse = null;   // { world, bodies } or { simple: [...] }
function startCollapse(leanDir) {
  if (collapse) return;
  if (S.activeGame === 'stack') sound('crash');
  const push = (p, i) => {   // higher blocks get shoved harder, all in roughly the same direction
    const h = p.y - TABLE_Y, r = seeded(i * 13 + (game.round || 1) * 977);
    return new THREE.Vector3(leanDir.x * (0.25 + h * 2.2) + (r() - 0.5) * 0.15, (r() - 0.3) * 0.2, leanDir.z * (0.25 + h * 2.2) + (r() - 0.5) * 0.15);
  };
  if (RAPIER) {
    const world = new RAPIER.World({ x: 0, y: -45, z: 0 });
    const table = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, (TABLE_Y - 0.03) * K, 0));
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.03 * K, 1.0 * K).setFriction(0.6), table);
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5 * K, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(5 * K, 0.5 * K, 5 * K).setFriction(0.8), floor);
    const bodies = shown.map((s, i) => {
      const v = push(s.p, i), r = seeded(i * 7 + 3);
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(s.p.x * K, s.p.y * K, s.p.z * K)
        .setRotation({ x: s.q.x, y: s.q.y, z: s.q.z, w: s.q.w })
        .setLinvel(v.x * K, v.y * K, v.z * K)
        .setAngvel({ x: (r() - 0.5) * 3, y: (r() - 0.5) * 2, z: (r() - 0.5) * 3 }));
      world.createCollider(RAPIER.ColliderDesc.cuboid(BL / 2 * K * 0.98, BH / 2 * K * 0.98, BW / 2 * K * 0.98).setFriction(0.5).setRestitution(0.15), b);
      return b;
    });
    collapse = { world, bodies, t: 0, acc: 0 };
  } else {
    collapse = { t: 0, simple: shown.map((s, i) => {
      const r = seeded(i * 7 + 3);
      return { v: push(s.p, i), axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), spin: 2 + r() * 5 };
    }) };
  }
}
function stepCollapse(dt) {
  const c = collapse;
  c.t += dt;
  if (c.t > 6) return;   // everything has settled by now
  if (c.world) {
    c.acc = Math.min(c.acc + dt, 4 / 60);
    while (c.acc >= 1 / 60) { c.acc -= 1 / 60; c.world.step(); }
    c.bodies.forEach((b, i) => {
      const t = b.translation(), r = b.rotation();
      shown[i].p.set(t.x / K, t.y / K, t.z / K); shown[i].q.set(r.x, r.y, r.z, r.w);
    });
  } else {
    c.simple.forEach((s, i) => {
      const p = shown[i].p;
      s.v.y -= 2.5 * dt;
      p.addScaledVector(s.v, dt);
      const ground = Math.hypot(p.x, p.z) < 0.98 ? TABLE_Y + BH / 2 : BH / 2;
      if (p.y < ground) { p.y = ground; s.v.y = -s.v.y * 0.25; s.v.x *= 0.6; s.v.z *= 0.6; s.spin *= 0.5; }
      shown[i].q.premultiply(new THREE.Quaternion().setFromAxisAngle(s.axis, s.spin * dt));
    });
  }
}
function endCollapse() {
  if (collapse && collapse.world) { try { collapse.world.free(); } catch (e) {} }
  collapse = null;
}

// ---------- Every frame ----------
let finishing = false;           // asked the room to finish a pull
let restoredAfterFall = false;   // walked in to an already-fallen tower (no crash replay)
const UP = new THREE.Vector3(0, 1, 0);
const WIGGLE = { loose: 0.005, snug: 0.0025, tight: 0.001 };
function leanDirOf(g) { return new THREE.Vector3(Math.sin(g.lean || 0), 0, Math.cos(g.lean || 0)); }
let uiKey = '';
export function updateStack(dt) {
  if (!game) return;
  const t = performance.now() / 1000;

  // Keep the panel in step with the game, even if an update was missed
  const key = [S.activeGame, game.phase, game.stage, game.testing, effectiveTurn(), game.moves, game.round, S.seated, S.boardView].join('|');
  if (key !== uiKey) { uiKey = key; try { refreshStackUI(); } catch (e) { console.error('LittleStack panel', e); } }

  // Doomed pull: the tower gives way partway through
  const pulling = game.phase === 'play' && game.stage === 'pulling';
  const prog = pulling ? Math.min(1, Math.max(0, (serverNow() - game.pullAt) / 1000 / PULL_TIME)) : 0;
  const down = game.phase === 'fallen' || game.phase === 'over';
  if ((pulling && game.fall && prog >= FALL_AT) || (down && !collapse && !restoredAfterFall)) startCollapse(leanDirOf(game));
  if (pulling && prog >= 1 && myTurn()) { if (!finishing) { finishing = true; finishPull(); } } else if (!pulling) finishing = false;

  if (collapse) {
    stepCollapse(dt);
  } else {
    const sl = slotsOf(game);
    const k = 1 - Math.exp(-dt * 10);
    const lean = leanDirOf(game);
    const sway = pulling ? (0.002 + (game.risk || 0) * 0.06) * Math.sin(t * 7) * Math.min(1, prog * 2) : 0;
    for (let i = 0; i < N; i++) {
      let p, q;
      if (pulling && i === game.moving) {   // sliding slowly out toward the puller
        const h = homePose(i, sl[i]);
        const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(h.q);
        const pl = game.players && game.players[game.puller];
        const a = seatAngle(pl && pl.seat >= 0 ? pl.seat : 0);
        const sign = axis.x * Math.sin(a) + axis.z * Math.cos(a) >= 0 ? 1 : -1;
        const e = prog * prog * (3 - 2 * prog);
        p = h.p.clone().addScaledVector(axis, sign * BL * 1.1 * e); q = h.q;
        p.addScaledVector(lean, (p.y - TABLE_Y) * sway);
      } else if (game.phase === 'play' && game.stage === 'carry' && i === game.moving) {   // floating above the tower
        const spots = freeSpots(sl);
        const L = Math.floor(spots[0] / 3);
        p = new THREE.Vector3(0, TABLE_Y + BH * (L + 0.5) + 0.09 + Math.sin(t * 2) * 0.006, 0);
        q = L % 2 ? Q_Z : Q_X;
      } else if (sl[i] >= 0) {
        const h = homePose(i, sl[i]);
        p = h.p; q = h.q;
        if (sway) p.addScaledVector(lean, (p.y - TABLE_Y) * sway);   // the whole tower sways a little during a pull
        if (game.phase === 'play' && game.stage === 'pick' && game.testing === i) {   // testing: a little wiggle
          const amp = holdsUp(sl, i) ? WIGGLE[kindOf(sl, game.seed, i)] : 0.0006;
          const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
          p.addScaledVector(axis, Math.sin(t * 18) * amp);
          q = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.sin(t * 23) * amp * 5));
        }
      } else continue;
      if (pulling && i === game.moving || (game.stage === 'pick' && game.testing === i) || sway) { shown[i].p.copy(p); shown[i].q.copy(q); }
      else { shown[i].p.lerp(p, k); shown[i].q.slerp(q, k); }
    }
    // Ghost spots where the block can go
    const carrying = game.phase === 'play' && game.stage === 'carry';
    const spots = carrying ? freeSpots(sl) : [];
    ghosts.forEach((g, j) => {
      const s = spots.find(x => x % 3 === j);
      g.visible = s !== undefined;
      if (g.visible) {
        const L = Math.floor(s / 3), [x, z] = slotXZ(L, j);
        g.position.set(x, TABLE_Y + BH * (L + 0.5), z);
        g.quaternion.copy(L % 2 ? Q_Z : Q_X);
        g.material.opacity = 0.25 + Math.sin(t * 4) * 0.1;
      }
    });
  }
  if (collapse) ghosts.forEach(g => { g.visible = false; });

  // Glow on the block being tested or pulled, and a softer glow on the one under your pointer
  for (let i = 0; i < N; i++) {
    const hot = game.phase === 'play' && ((game.stage === 'pick' && game.testing === i) || (pulling && game.moving === i));
    meshes[i].material.emissive.setHex(hot ? 0x5a3a10 : i === hoverIdx ? 0x3a2a10 : 0x000000);
    meshes[i].position.copy(shown[i].p);
    meshes[i].quaternion.copy(shown[i].q);
  }
}
// ---------- Applying the shared state ----------
function applyGame(g) {
  const prev = game;
  game = g || { phase: 'lobby' };
  if (game.phase === 'play' && !['pick', 'pulling', 'carry'].includes(game.stage)) game.stage = 'pick';   // a game left over from an older version
  if (!prev && (game.phase === 'fallen' || game.phase === 'over')) restoredAfterFall = true;   // just walked in: don't replay the crash
  if (prev && (game.round || 0) !== (prev.round || 0)) { endCollapse(); restoredAfterFall = false; }   // a fresh tower
  if (game.phase === 'play' && S.activeGame === 'stack') loadPhysics();   // have the crash ready
  if (prev) { try { announce(prev); } catch (e) { console.error('LittleStack announce', e); } }
  refreshStackUI();
}
// Sounds and big on-screen messages for what just happened
function announce(prev) {
  const g = game, players = g.players || {};
  const nameOf = id => players[id] ? players[id].name : 'Someone';
  if ((g.ev || 0) > (prev.ev || 0) && g.note) {   // the tower fell
    if (g.phase === 'over') {
      banner(g.note, 6);
      if (S.activeGame === 'stack') sound('win');
      hooks.addSys(g.note);   // keep the match result in the chat too
    } else banner(g.fell === myId ? '💥 Oops! You knocked it over!' : g.note, 4);
    return;
  }
  if (g.phase !== 'play') return;
  const newTower = (g.round || 0) !== (prev.round || 0);
  const myTurnNow = effectiveTurn(g) === myId && g.stage === 'pick';
  const wasMyTurn = prev.phase === 'play' && effectiveTurn(prev) === myId;
  if (newTower) {
    const label = `Tower ${g.tower || 1} of ${g.towers || 10}`;
    banner(myTurnNow ? `${label} · you go first! 🎯` : `${label} · ${nameOf(effectiveTurn(g))} goes first`, 3);
  } else if (g.stage === 'pulling' && prev.stage !== 'pulling') {
    banner(g.puller === myId ? 'Pulling… 🤞' : `${nameOf(g.puller)} is pulling… 😬`, 2.4);
  } else if (g.stage === 'carry' && prev.stage === 'pulling') {
    banner(g.puller === myId ? 'Phew! 😅 Click a glowing spot on top' : `Phew! ${nameOf(g.puller)} got it 😅`, 2.5);
  } else if (myTurnNow && !wasMyTurn) {
    banner('Your turn! 🎯', 2);
  }
  if (S.activeGame === 'stack') {
    if (g.testing >= 0 && g.testing !== prev.testing) sound('clack', 0.4);
    if (g.stage === 'pulling' && prev.stage !== 'pulling') sound('clack', 0.6);
    if (g.stage === 'carry' && prev.stage === 'pulling') sound('clack', 0.9);
    if (g.stage === 'pick' && prev.stage === 'carry') sound('clack', 0.8);
  }
}

// ---------- Actions ----------
function tidy(g) {   // drop people who left the room; if nobody's left, the match is over
  for (const id of Object.keys(g.players || {})) if (!S.presence[id] && id !== myId) delete g.players[id];
  if (!Object.keys(g.players || {}).length && g.phase !== 'lobby') { g.phase = 'lobby'; g.stage = 'pick'; g.testing = -1; g.moving = -1; }
}
function stackJoin() {
  if (S.seated < 0) return;
  const seat = S.seated;
  runTransaction(gameRef, g => {
    g = g || { phase: 'lobby' };
    g.players = g.players || {};
    tidy(g);
    if (Object.keys(g.players).filter(id => id !== myId).length >= MAX_STACK) return;
    g.players[myId] = { seat, order: Date.now(), name: S.myName, c: S.myHue, lost: 0 };
    return g;
  });
}
function stackLeave() {
  runTransaction(gameRef, g => {
    if (!g || !g.players || !g.players[myId]) return;
    if (g.phase === 'play' && effectiveTurn(g) === myId && g.stage !== 'pulling') {
      g.turn = nextAfter(g, myId);
      g.testing = -1;
    }
    delete g.players[myId];
    tidy(g);
    return g;
  });
}
function freshTower(g, startWith) {
  g.phase = 'play'; g.seed = 1 + Math.floor(Math.random() * 2147483000); g.round = (g.round || 0) + 1;
  g.slots = freshSlots().join(',');
  g.stage = 'pick'; g.testing = -1; g.moving = -1; g.fall = false; g.fell = ''; g.note = ''; g.moves = 0;
  g.turn = startWith && g.players[startWith] ? startWith : ids(g)[0];
}
function startMatch() {
  runTransaction(gameRef, g => {
    if (!g || !g.players || !g.players[myId] || g.phase === 'play' || g.phase === 'fallen') return;
    tidy(g);
    for (const p of Object.values(g.players)) p.lost = 0;
    g.towers = TOWERS.includes(g.towers) ? g.towers : 10;
    g.tower = 1; g.winners = '';
    freshTower(g, '');
    return g;
  });
}
function rebuild() {   // the next tower in the match; whoever knocked it over goes first
  runTransaction(gameRef, g => {
    if (!g || !g.players || !g.players[myId] || g.phase !== 'fallen') return;
    tidy(g);
    g.tower = (g.tower || 1) + 1;
    freshTower(g, g.fell);
    return g;
  });
}

// ---------- LittleStack panel ----------
const TOWERS = [5, 10, 15];
const sStatus = document.getElementById('sStatus');
const sCount = document.getElementById('sCount');
const sPlayers = document.getElementById('sPlayers');
const sLength = document.getElementById('sLength');
const sInfo = document.getElementById('sInfo');
const sJoin = document.getElementById('sJoin');
const sStart = document.getElementById('sStart');
const sPull = document.getElementById('sPull');
const sTry = document.getElementById('sTry');
const sRebuild = document.getElementById('sRebuild');
const sMore = document.getElementById('sMore');
const sMenu = document.getElementById('sMenu');
const sLeave = document.getElementById('sLeave');
const sReset = document.getElementById('sReset');
const sNudge = document.getElementById('sNudge');
document.getElementById('sUp').addEventListener('click', () => stackNudge(1, 0));
document.getElementById('sDown').addEventListener('click', () => stackNudge(-1, 0));
document.getElementById('sLeft').addEventListener('click', () => stackNudge(0, -1));
document.getElementById('sRight').addEventListener('click', () => stackNudge(0, 1));
const lengthBtns = TOWERS.map(n => {
  const b = document.createElement('button');
  b.className = 'sw';
  b.textContent = `${n} towers`;
  b.addEventListener('click', () => update(gameRef, { towers: n }));
  sLength.appendChild(b);
  return b;
});
sJoin.addEventListener('click', stackJoin);
sStart.addEventListener('click', startMatch);
sPull.addEventListener('click', stackPull);
sTry.addEventListener('click', () => { if (myTurn() && game.stage === 'pick') update(gameRef, { testing: -1 }); });
sRebuild.addEventListener('click', rebuild);
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
armButton(sReset, 'Reset losses', () => update(ref(db, 'room/stack'), { losses: null }));

const FEEL = { loose: 'Loose 🙂', snug: 'Snug 😐', tight: 'Tight 😬' };
function refreshStackUI() {
  if (!game) return;
  const list = present();
  const players = game.players || {};
  const me = !!(players[myId] && S.presence[myId]);
  const turn = effectiveTurn();
  const turnName = players[turn] ? players[turn].name : '…';
  const sl = slotsOf(game);
  const inMatch = game.phase === 'play' || game.phase === 'fallen';
  const testing = game.phase === 'play' && game.stage === 'pick' && game.testing >= 0 && sl[game.testing] >= 0 ? game.testing : -1;
  let st, info = '';
  if (game.phase === 'play') {
    if (game.stage === 'pulling') st = `${players[game.puller] ? players[game.puller].name : 'Someone'} is pulling a block out… 😬`;
    else if (game.stage === 'carry') st = turn === myId ? 'Phew! Click a glowing spot on top to place it' : `${turnName} is placing the block on top…`;
    else st = turn === myId ? 'Your turn! Click a block to test it (not from the top two levels)' : `${turnName}'s turn`;
    if (testing >= 0) {
      const feel = holdsUp(sl, testing) ? FEEL[kindOf(sl, game.seed, testing)] : 'Holding its level up! 😱';
      info = `${turn === myId ? 'This block feels' : turnName + "'s block feels"}: ${feel}`;
    }
  } else if (game.phase === 'fallen') {
    st = `${game.note || '💥 The tower fell!'} Click Rebuild for the next tower.`;
  } else if (game.phase === 'over') {
    st = `${game.note || '🏆 Match over!'} Pick a length and click Play again.`;
  } else {
    st = list.length ? `${list.length} player${list.length > 1 ? 's' : ''} ready · pick a length and click Start` : 'Sit in a chair and click Join game';
  }
  sStatus.textContent = st;
  sInfo.textContent = info;
  sInfo.style.display = info ? '' : 'none';

  // The counter: which tower, how many pulls, how tall
  if (inMatch) {
    const moves = game.moves || 0;
    sCount.textContent = `Tower ${game.tower || 1} of ${game.towers || 10} · ${moves} pull${moves === 1 ? '' : 's'} · ${topLevel(sl) + 1} levels tall`;
  }
  sCount.style.display = inMatch ? '' : 'none';

  sPlayers.textContent = '';
  list.forEach(id => {
    const p = players[id];
    const div = document.createElement('div');
    const dot = document.createElement('span');
    dot.textContent = '● ';
    dot.style.color = RAINBOW_CSS[colorIndex(p)];
    div.appendChild(dot);
    const total = losses[lossKey(p.name)] || 0;
    const match = game.phase === 'lobby' ? '' : ` · 💥 ${p.lost || 0}`;
    const crown = game.phase === 'over' && (p.lost || 0) === Math.min(...list.map(x => players[x].lost || 0)) ? ' 🏆' : '';
    div.appendChild(document.createTextNode(`${game.phase === 'play' && id === turn ? '▶ ' : ''}${p.name}${id === myId ? ' (you)' : ''}${match}${crown}`));
    const small = document.createElement('span');
    small.style.opacity = '0.6';
    small.textContent = ` (${total} all-time)`;
    div.appendChild(small);
    sPlayers.appendChild(div);
  });

  const choosing = me && (game.phase === 'lobby' || game.phase === 'over');
  sLength.style.display = choosing ? '' : 'none';
  const towers = TOWERS.includes(game.towers) ? game.towers : 10;
  lengthBtns.forEach((b, k) => b.classList.toggle('on', TOWERS[k] === towers));
  const myPick = me && turn === myId && game.phase === 'play' && game.stage === 'pick';
  sJoin.style.display = !me && S.seated >= 0 && !S.boardView && list.length < MAX_STACK ? '' : 'none';
  sStart.style.display = choosing ? '' : 'none';
  sStart.textContent = game.phase === 'over' ? 'Play again' : 'Start';
  // Pull it / Try another stay put during a match, greyed out unless you've tested a block on your turn
  sPull.style.display = sTry.style.display = me && game.phase === 'play' ? '' : 'none';
  sPull.disabled = sTry.disabled = !(myPick && testing >= 0);
  sNudge.style.display = myPick ? '' : 'none';
  sRebuild.style.display = me && game.phase === 'fallen' ? '' : 'none';
  sMore.style.display = me ? '' : 'none';
  if (!me) menuOpen = false;
  sMenu.style.display = me && menuOpen ? '' : 'none';
  if (hooks.refreshSwitch) hooks.refreshSwitch();
}

// ---------- Called by the room ----------
export function refreshStack() { refreshStackUI(); }
export function hideStack() { hoverIdx = -1; refreshStackUI(); }
export function stackSeatChanged(seat) {
  if (game && game.players && game.players[myId]) update(ref(db, 'room/stack/game/players/' + myId), { seat });
}
export function startStack() {
  onValue(gameRef, s => applyGame(s.val()));
  onValue(lossesRef, s => { losses = s.val() || {}; refreshStackUI(); });
}