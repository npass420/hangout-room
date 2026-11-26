// =====================================================================
// studio.js — the Doodle Gallery room: black and gold marble, the big doodle board, the picture walls,
// walking around, the people in the room, chat, and the main loop.
// This is where everyone arrives: you start a step out from the back wall, facing the doodle board. The back wall is
// marble, sized for five portals side by side; the Game Room's portal hangs in the middle spot.
// VERSION 10
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, remove, push, onValue, onDisconnect,
         query, orderByChild, startAt, endAt, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, ROOM, HEIGHT, EYE, rnd, renderer, scene, camera, canvas, BASE_FOV,
         box, std, easeInOut, envMap, goldMat, RAINBOW, RAINBOW_CSS, colorIndex, makeLabel, PHONE } from '../core.js';
import { sketchViewPose, sketchEnter, sketchLeave, startSketch, updateSketch, SKETCH_NAME, BOARD_SPOT } from './sketch.js';
import { sfx, setupMute } from '../sounds.js';
import { inRoom } from '../world.js';
import { build as buildTable } from '../pieces/marbletable.js';
import { throne } from '../pieces/throne.js';
import { makeCurtain } from '../pieces/curtain.js';
import { makeSummon } from '../pieces/summon.js';
import { makePortalNode } from '../pieces/portalnode.js';
import { makeDenVanish } from '../pieces/denvanish.js';
import { makePortalFrame } from '../pieces/portalframe.js';
import { startCheckers } from '../checkers/checkers.js';
import { startOthello } from '../checkers/othello.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { setupHud } from '../hud.js';
setupHud();   // (the corner buttons open and close the chat, the menu and who's here; the title fades: see hud.js)

// ---------- Black and gold marble (marble.jpg, a Kindroid image) ----------
// The picture is big enough to use once per surface, so nothing repeats: each wall shows a different part of it,
// the floor gets thin gold seams drawn on so it reads as big polished tiles, and the ceiling is a darker copy.
// Until the picture has loaded, everything is plain black stone.
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
// All polished: their reflections come from a snapshot of this room (below), so they shine with the real neon
const wallMats = [0, 1, 2, 3].map(() => std(0x0b0a0c, 0.32, { envMapIntensity: 0.45 }));
const floorMat = std(0x0b0a0c, 0.25, { envMapIntensity: 0.7 });
const ceilMat = std(0x0b0a0c, 0.38, { envMapIntensity: 0.35 });
function stoneTex(src) {
  const t = new THREE.Texture(src);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  t.needsUpdate = true;
  return t;
}
const marbleImg = new Image();
let marbleDone;
const marbleLoaded = new Promise(r => { marbleDone = r; });
marbleImg.onload = () => {
  // Phones get a smaller copy, so the picture fits in their memory
  let src = marbleImg;
  const maxSize = PHONE ? 1536 : 3072;
  if (marbleImg.width > maxSize) {
    const c = document.createElement('canvas');
    c.width = c.height = maxSize;
    c.getContext('2d').drawImage(marbleImg, 0, 0, maxSize, maxSize);
    src = c;
  }
  // Walls: 9 wide by 4 tall, so each one uses a strip of the picture, a different strip (and some flipped) per wall
  const strips = [[0, false], [0.19, true], [0.37, false], [0.556, true]];
  wallMats.forEach((m, i) => {
    const t = stoneTex(src);
    const [y, flip] = strips[i];
    t.repeat.set(flip ? -1 : 1, HEIGHT / ROOM);
    t.offset.set(flip ? 1 : 0, y);
    m.map = t; m.color.setHex(0xffffff); m.needsUpdate = true;
  });
  // Floor: the whole picture, with thin gold seams every 1.5 meters (8 by 8 tiles)
  const SZ = src.width, fc = document.createElement('canvas');
  fc.width = fc.height = SZ;
  const g = fc.getContext('2d');
  g.drawImage(src, 0, 0, SZ, SZ);
  const TILES = Math.round(ROOM / 1.5), step = SZ / TILES, lw = Math.max(2, SZ / 900);
  for (let i = 0; i <= TILES; i++) {
    const p = Math.round(i * step);
    g.fillStyle = 'rgba(0,0,0,0.55)';          // a dark groove
    g.fillRect(p - lw, 0, lw * 2, SZ); g.fillRect(0, p - lw, SZ, lw * 2);
    g.fillStyle = 'rgba(205,165,70,0.75)';     // with a thin gold line in it
    g.fillRect(p - lw / 2, 0, lw, SZ); g.fillRect(0, p - lw / 2, SZ, lw);
  }
  floorMat.map = stoneTex(fc); floorMat.color.setHex(0xffffff); floorMat.needsUpdate = true;
  // Ceiling: the picture again, turned and darker
  const ct = stoneTex(src);
  ct.rotation = Math.PI / 2; ct.center.set(0.5, 0.5);
  ceilMat.map = ct; ceilMat.color.setHex(0x6a6a6a); ceilMat.needsUpdate = true;
  snapRoom();
  marbleDone();
};
marbleImg.onerror = () => { console.warn('marble.jpg did not load; the room stays plain black'); marbleDone(); };
marbleImg.src = new URL('marble.jpg', import.meta.url).href;   // the picture sits next to this file

// ---------- The room: four walls, the floor and the ceiling ----------
function plane(w, h, mat, x, y, z, rx, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true;
  scene.add(m);
  return m;
}
const H2 = HEIGHT / 2, R2 = ROOM / 2;
plane(ROOM, HEIGHT, wallMats[0], 0, H2, -R2, 0, 0);              // the far wall (the doodle board)
plane(ROOM, HEIGHT, wallMats[1], 0, H2, R2, 0, Math.PI);         // the back wall (kept clear for portals)
plane(ROOM, HEIGHT, wallMats[2], -R2, H2, 0, 0, Math.PI / 2);    // the left wall (pictures)
plane(ROOM, HEIGHT, wallMats[3], R2, H2, 0, 0, -Math.PI / 2);    // the right wall (pictures)
const floor = plane(ROOM, ROOM, floorMat, 0, 0, 0, -Math.PI / 2, 0);
floor.userData.floor = true;
plane(ROOM, ROOM, ceilMat, 0, HEIGHT, 0, Math.PI / 2, 0);
// The marble's reflections: a snapshot of this very room, so the polish on the floor, walls and ceiling shows the
// real ring and neon (and nothing that isn't here). It's retaken when the marble loads and when the neon changes color.
const pmrem = new THREE.PMREMGenerator(renderer);
let roomEnv = null, snapTimer = 0;
function snapRoom() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    if (roomIsOff) { snapRoom(); return; }   // (the room's switched off for the den: wait until it's back)
    const hide = [floor, marker, ...Object.values(avatars).map(a => a.g)];   // not the floor itself, or people (they'd freeze in it)
    const was = hide.map(o => o.visible);
    hide.forEach(o => { o.visible = false; });
    const env = pmrem.fromScene(scene, 0.02, 0.05, 30);
    hide.forEach((o, i) => { o.visible = was[i]; });
    if (roomEnv) roomEnv.dispose();
    roomEnv = env;
    for (const m of [floorMat, ceilMat, ...wallMats]) { m.envMap = env.texture; m.needsUpdate = true; }
  }, 100);
}
// ---------- The game table, in the middle of the room under the ring (made in the Workshop: pieces/marbletable.js) ----------
// White marble, its jewels, and the summoning circle set into its top, where games will be summoned.
const gameTable = buildTable();
scene.add(gameTable);
// Summoning: click the circle and the games rise out of it side by side, Checkers and Othello, each with its name;
// click one and its board assembles out of glowing motes onto the table (pieces/summon.js). Esc sends it all back.
const summon = makeSummon({ top: 0.85, renderer,
  onChoose: g => set(ref(db, 'tables/board'), g).catch(() => {}),   // (everyone's board comes out: which game's)
  onBoard: on => game.show(on) });
scene.add(summon.group);
// The games on the board (checkers/checkers.js, checkers/othello.js): their pieces stand on the summoned board; Start
// locks your view onto it. `game` is whichever game's board is out.
const gameHooks = {
  onView: (side, watching) => gameView(side, watching),
  seated: () => chair != null,
  onStart: () => update(denRef, { closed: 1 }).catch(() => {}) };   // (a game starting brings the den's curtain down for everyone)
const checkersGame = startCheckers({ center: { x: 0, z: 0 }, top: summon.topOf('checkers'), cell: summon.cellOf('checkers'), parent: summon.group, ...gameHooks });
const othelloGame = startOthello({ center: { x: 0, z: 0 }, top: summon.topOf('othello'), cell: summon.cellOf('othello'), parent: summon.group, board: summon.board, ...gameHooks });
const curGame = () => (summon.game === 'othello' ? othelloGame : checkersGame);
const game = {
  show(on) { const c = curGame(); for (const g of [checkersGame, othelloGame]) if (g !== c || !on) g.show(false); if (on) c.show(true); },
  refresh() { checkersGame.refresh(); othelloGame.refresh(); },
  deselect: () => curGame().deselect(),
  busy: () => curGame().busy(),
  shown: () => curGame().shown(),
  tap: p => curGame().tap(p),
  canTap: p => curGame().canTap(p),
  leave: () => curGame().leave(),
  update: t => { checkersGame.update(t); othelloGame.update(t); }
};
function listenBoard() {   // (the board is shared: out for everyone, or away for everyone; 1 was checkers)
  onValue(ref(db, 'tables/board'), s => {
    const v = s.val(), g = v === 1 ? 'checkers' : v;
    if (g === 'checkers' || g === 'othello') { if (summon.state === 'idle' || summon.state === 'menu') summon.buildNow(g); }
    else if (summon.state === 'board' && !game.busy()) summon.dismiss();
  });
}
// and a white marble throne at each side, facing in (made in the Workshop: pieces/throne.js), pulled back so its base
// clears the table's legs with a little room. Click one (or Z beside it) to sit in it; Z again to get up.
const THRONE_AT = 1.08;                       // each throne's middle, out from the table's middle
const THRONES = [];                           // where each one stands: { x, z, a }
for (let k = 0; k < 4; k++) {
  const a = k * Math.PI / 2, t = throne();
  t.position.set(Math.sin(a) * THRONE_AT, 0, Math.cos(a) * THRONE_AT);
  t.rotation.y = a + Math.PI;   // (its front toward the table)
  t.traverse(o => { o.userData.throne = k; });
  scene.add(t);
  THRONES.push({ x: t.position.x, z: t.position.z, a, mesh: t });
}

// ---------- The game den: the curtain, the holodeck, and the crystals ----------
// Someone sits: the lamp floats down. Anyone sitting clicks the lamp: the black glass curtain drops from the ring for
// everyone (pieces/curtain.js), its sky fades in and spreads out into a holodeck filling the whole room, floor and
// all; each click on the lamp after that changes the sky, for everyone. Those sitting are in the den: for them the
// gallery is gone. For everyone else the gallery stays, and once the curtain is down gold glitter creeps up the black
// glass and the column dissolves from the top into a rising plume of gold dust (pieces/denvanish.js), leaving a
// floating portal node (pieces/portalnode.js) at each open throne: click one to port into it. Once nobody is sitting,
// the den clears for everyone: the curtain lifts, both games reset, and the board goes away. Arriving to an empty site
// (nobody else here), whatever was left is cleared before anything shows. Shared through the database: tables/den
// { closed, sky }.
let roomOff = [], roomIsOff = false;
function setRoom(on) {   // (for those in the den with the sky in: the room's own things switched off, not drawn at all)
  if (!on === roomIsOff) return;
  roomIsOff = !on;
  if (!on) {
    const keep = new Set([gameTable, summon.group, curtain.group, marker, nodeGroup, vanish.group, ...THRONES.map(t => t.mesh)]);
    roomOff = scene.children.filter(o => o.visible && !keep.has(o) && !o.isLight && !o.userData.avatar);
    for (const o of roomOff) o.visible = false;
  } else { for (const o of roomOff) o.visible = true; roomOff = []; }
}
const curtain = makeCurtain({ radius: 1.97, top: HEIGHT - 0.72, ceiling: HEIGHT, lampLow: 1.75 });
scene.add(curtain.group);
const denRef = ref(db, 'tables/den');
let den = { closed: 0, sky: 0 };
let denFirst = true;
function clearDen() {   // nobody left in the den: the curtain lifts, both games reset, then the board goes away (for everyone)
  update(denRef, { closed: 0 }).catch(() => {});
  Promise.all([checkersGame.reset(), othelloGame.reset()])
    .then(() => set(ref(db, 'tables/board'), 0)).catch(() => {});
}
// Arriving to an empty site: cleared first (the den open, no board, both games fresh), then the den and the board are
// listened to, so what shows is already clean, with nothing played out.
get(ref(db, 'room/presence')).then(ps => {
  if (Object.keys(ps.val() || {}).length) return;
  return Promise.all([update(denRef, { closed: 0 }), set(ref(db, 'tables/board'), 0), checkersGame.reset(), othelloGame.reset()]);
}).catch(() => {}).then(() => {
  listenBoard();
  onValue(denRef, s => {
    den = s.val() || { closed: 0, sky: 0 };
    if (den.closed) curtain.close(); else curtain.open();
    curtain.setSky(den.sky | 0);
    if (denFirst) { denFirst = false; curtain.snap(); }   // (on load: the den as it was left, not played out)
  });
});
setTimeout(() => {   // (the curtain's skies and glass, and the games' boards and pieces, ready before they're needed)
  curtain.warm(renderer, scene, camera);
  const was = [];
  summon.group.traverse(o => { was.push([o, o.visible]); o.visible = true; });
  try { renderer.compile(scene, camera); } catch (e) {}
  for (const [o, v] of was) o.visible = v;
}, 600);
function lampClicked() {
  if (chair == null) { showBanner('Sit at the table first', 2); return; }
  if (!curtain.closed) update(denRef, { closed: 1 }).catch(() => {});
  else update(denRef, { sky: (curtain.skyIndex + 1) % curtain.SKY_COUNT }).catch(() => {});
}
// the portal nodes (one where each throne is) and the vanishing
const nodeGroup = new THREE.Group();
scene.add(nodeGroup);
const vanish = makeDenVanish({ radius: 1.97, height: HEIGHT - 0.72 });
scene.add(vanish.group);

// Gold baseboards along the bottom of every wall, all the way across
for (const [x, z, w, d] of [[0, -R2 + 0.01, ROOM, 0.02], [0, R2 - 0.01, ROOM, 0.02], [-R2 + 0.01, 0, 0.02, ROOM], [R2 - 0.01, 0, 0.02, ROOM]]) {
  box(w, 0.09, d, goldMat, x, 0.045, z, scene).castShadow = false;
}

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xffe2b8, 0x2a2018, 1.0));   // soft, even light everywhere

// ---------- Neon: a ring floating under the middle of the ceiling, and a tube all the way around the top corners of the room ----------
const NEON_COLORS = [['Warm white', 0xffe8c4], ['Yellow', 0xffd23a], ['Orange', 0xff9a2e], ['Pink', 0xff5fa8],
                     ['Purple', 0xb05cff], ['Blue', 0x3d8bff], ['Green', 0x3dff8a], ['Red', 0xff3b3b]];
const neonMats = [];   // { mat, core } for every neon layer in the room
// A neon tube is a thin bright core with layers of colored glow around it. The layers are kept faint so they add up
// to the color itself instead of washing out to white.
const GLOW = [[1, 1.0, true], [2.2, 0.42, false], [4.5, 0.16, false], [9, 0.06, false]];   // [size, opacity, is the core]
function neonMat(opacity, core, map) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: map || null, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  neonMats.push({ mat, core });
  return mat;
}
// The ring: floats on its own (no cables), with a lid over the tube like a real ring light, so it shines down and out
const RING_R = 2.0, RING_Y = HEIGHT - 0.7;   // 4 m across: big enough to hang over a table for four with its chairs
const ring = new THREE.Group();
scene.add(ring);
const LID_W = 0.075;                                   // how far the lid reaches past the tube on each side
const lidMat = std(0x0d0c0b, 0.35, { envMap, envMapIntensity: 0.25, side: THREE.DoubleSide });
const lid = new THREE.Mesh(new THREE.RingGeometry(RING_R - LID_W, RING_R + LID_W, 180), lidMat);   // the flat top
lid.rotation.x = -Math.PI / 2; lid.position.y = RING_Y + 0.05;
ring.add(lid);
const rimMat = std(0xc9a227, 0.3, { metalness: 0.9, envMap, envMapIntensity: 0.8, side: THREE.DoubleSide });   // gold, seen from both sides
for (const r of [RING_R - LID_W, RING_R + LID_W]) {   // a gold rim down the inside and outside edges
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.07, 180, 1, true), rimMat);
  rim.position.y = RING_Y + 0.015;
  ring.add(rim);
}
for (const [k, op, core] of GLOW) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.011 * k, 12, 180), neonMat(op, core));
  m.rotation.x = Math.PI / 2; m.position.y = RING_Y;
  ring.add(m);
}
// The corner tube: runs around the room right where the walls meet the ceiling, with its glow washing
// onto the ceiling and down the wall, like real cove lighting
function fadeTex(brightAtTop) {   // white fading to black, for the glow wash (black adds nothing when glowing)
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 256);
  const stops = [[0, 1], [0.25, 0.45], [0.55, 0.14], [1, 0]];
  for (const [at, v] of stops) grd.addColorStop(brightAtTop ? at : 1 - at, `rgb(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)})`);
  g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const COVE_Y = HEIGHT - 0.06, IN = 0.06;   // how high the tube runs, and how far out from the wall
const SIDE = ROOM - IN * 2;                // each run of tube, so the four meet at the corners
const washDown = fadeTex(true), washOut = fadeTex(false);
const ceilWashMat = neonMat(0.55, false, washOut), wallWashMat = neonMat(0.5, false, washDown);
const tubeMats = GLOW.map(([, op, core]) => neonMat(op, core));
for (const turn of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {   // the far wall, then turned around to the other three
  const side = new THREE.Group();
  side.rotation.y = turn;
  scene.add(side);
  GLOW.forEach(([k], i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.009 * k, 0.009 * k, SIDE, 10), tubeMats[i]);
    m.rotation.z = Math.PI / 2;   // lying along the wall
    m.position.set(0, COVE_Y, -R2 + IN);
    side.add(m);
  });
  const ceilWash = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, 0.8), ceilWashMat);   // glow on the ceiling, brightest at the wall
  ceilWash.rotation.x = Math.PI / 2;
  ceilWash.position.set(0, HEIGHT - 0.004, -R2 + 0.4);
  side.add(ceilWash);
  const wallWash = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, 0.6), wallWashMat);   // and down the top of the wall
  wallWash.position.set(0, HEIGHT - 0.3, -R2 + 0.004);
  side.add(wallWash);
}
let neonIndex = -1;
function setNeon(i) {
  i = Number.isInteger(i) && i >= 0 && i < NEON_COLORS.length ? i : 0;
  if (i === neonIndex) return;
  neonIndex = i;
  const col = new THREE.Color(NEON_COLORS[i][1]);
  const hot = col.clone().lerp(new THREE.Color(0xffffff), 0.3);    // the core is a little white-hot, but clearly the color
  for (const n of neonMats) n.mat.color.copy(n.core ? hot : col);
  switchGlow.color.copy(col);
  snapRoom();   // the marble's reflections change color too
}

// The light switch on the right-hand picture wall, in the gap past its last column of frames (by the back wall corner),
// level with the middle of the bottom row: click it to change the neon color for everyone
const switchGroup = new THREE.Group();
const switchGlow = new THREE.MeshBasicMaterial({ color: 0xffe8c4, toneMapped: false });
(function lightSwitch() {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.015), goldMat);
  const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.05, 0.02), switchGlow);
  toggle.position.z = 0.015;
  switchGroup.add(plate, toggle);
  switchGroup.position.set(R2 - 0.015, 1.16, R2 - 0.45);   // between the last frame's edge and the back wall
  switchGroup.rotation.y = -Math.PI / 2;                    // facing into the room
  switchGroup.traverse(o => { if (o.isMesh) o.userData.lightSwitch = true; });
  scene.add(switchGroup);
})();

// The portal to the Game Room, a small framed picture hung in the middle of the back wall. There's room for five
// along the wall (centers about x = -4.6, -2.3, 0, 2.3, 4.6); this one has the center spot. Click it: it flares, a golden flash, and
// you're in the Game Room.
const portalFrame = makePortalFrame();
portalFrame.group.position.set(0, 1.75, R2 - 0.045);   // (hung like a picture, its middle a little over eye height)
portalFrame.group.rotation.y = Math.PI;   // facing into the room
scene.add(portalFrame.group);
let leaving = false;
function goGameRoom() {
  if (leaving || porting || chair != null || anim) return;
  leaving = true;
  me.tx = me.tz = null; marker.visible = false;
  const t0 = performance.now();
  (function glowUp() {
    const e = Math.min((performance.now() - t0) / 450, 1);
    portalFrame.flare(e * e);
    if (e < 1) requestAnimationFrame(glowUp);
  })();
  setTimeout(() => { whiteout.style.transition = 'opacity 0.35s'; whiteout.style.opacity = '1'; }, 300);
  // (take yourself off this room's list first, so you don't show in both rooms while the server notices you left)
  setTimeout(() => {
    let gone = false;
    const go = () => { if (!gone) { gone = true; location.href = location.pathname + '?room=game'; } };
    remove(ref(db, 'room/presence/' + myId)).catch(() => {}).then(go);
    setTimeout(go, 1200);   // (if the network's slow, go anyway)
  }, 700);
}
setNeon(0);
onValue(ref(db, 'room/decor/neon'), s => setNeon(s.val()));
const neonLoaded = get(ref(db, 'room/decor/neon'));
function nextNeon() {
  if (!S.myName) return;
  const i = (Math.max(0, neonIndex) + 1) % NEON_COLORS.length;
  set(ref(db, 'room/decor/neon'), i).catch(e => console.warn('Light switch', e));
  setNeon(i);
  showBanner(`💡 ${NEON_COLORS[i][0]}`, 1.5);
  sfx.ping();
}

// ---------- Other people: a standing snowman with a name tag, gliding to wherever they walk ----------
const WALK = 2.2;     // walking speed, meters a second
const avatars = {};   // id -> { g, name, c }
const footShadow = (() => {   // a soft dark spot on the floor under each snowman
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.6)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.3)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
})();
function makeAvatar(name, c) {
  const g = new THREE.Group();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), footShadow);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.003;
  g.add(shadow);
  const mat = std(new THREE.Color(RAINBOW[c]), 0.75);
  for (const [r, y] of [[0.28, 0.28], [0.21, 0.74], [0.15, 1.1]]) {   // three stacked snowballs: big bottom, middle, small head
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat);
    b.position.y = y;
    b.castShadow = true;
    g.add(b);
  }
  const label = makeLabel(name, RAINBOW_CSS[c]);
  label.position.y = 1.47;
  g.add(label);
  g.traverse(o => { o.userData.avatar = true; });
  scene.add(g);
  return { g, name, c };
}
function spotOf(p) {   // where someone is standing (kept inside the room)
  const lim = R2 - 0.5;
  const x = Number.isFinite(p.x) ? p.x : 0, z = Number.isFinite(p.z) ? p.z : R2 - 1.3;
  return { x: Math.max(-lim, Math.min(lim, x)), z: Math.max(-lim, Math.min(lim, z)) };
}
function refreshAvatars() {
  for (const id of Object.keys(avatars)) {
    const p = S.presence[id];
    if (!p || id === myId || p.name !== avatars[id].name || colorIndex(p) !== avatars[id].c) {
      scene.remove(avatars[id].g);
      delete avatars[id];
    }
  }
  for (const [id, p] of Object.entries(S.presence)) {
    if (id === myId) continue;
    const fresh = !avatars[id];
    if (fresh) avatars[id] = makeAvatar(p.name, colorIndex(p));
    const a = avatars[id], to = spotOf(p);
    a.tx = to.x; a.tz = to.z;
    a.ty = Number.isInteger(p.ch) && THRONES[p.ch] ? 0.4 : 0;   // (sitting in a throne: up on its cushion)
    if (Number.isInteger(p.ch) && THRONES[p.ch]) { const t = THRONES[p.ch]; a.tx = t.x - Math.sin(t.a) * 0.04; a.tz = t.z - Math.cos(t.a) * 0.04; }
    if (fresh) a.g.position.set(a.tx, a.ty, a.tz);   // someone new just appears where they are
  }
}
function moveAvatars(dt) {   // everyone else glides toward where they're walking
  for (const a of Object.values(avatars)) {
    const p = a.g.position, dx = a.tx - p.x, dz = a.tz - p.z, d = Math.hypot(dx, dz);
    p.y += ((a.ty || 0) - p.y) * Math.min(1, dt * 6);   // (easing up into a throne, or down out of it)
    if (d < 0.001) continue;
    const step = Math.min(d, WALK * dt);
    p.x += dx / d * step; p.z += dz / d * step;
  }
}

// ---------- Who's online: everyone, in every room, each with an icon for where they are (world.js) ----------
const connEl = document.getElementById('conn');
const whoBtn = document.getElementById('whoBtn');
inRoom('gallery');

function refreshAll() {
  refreshAvatars();
  if (typeof game !== 'undefined') game.refresh();   // (the board's panel: who's here to play)
}
hooks.refreshAll = refreshAll;

// ---------- Chat ----------
const msgs = document.getElementById('msgs');
const chatInput = document.getElementById('chatInput');
const newDot = document.getElementById('newDot');

// Two tabs on the chat box: 💬 Chat is only what people type, 🔔 Room is joins, leaves and gallery news
const tabStyle = document.createElement('style');
tabStyle.textContent = `#chatTabs { display: flex; gap: 6px; margin-bottom: 6px; }
  #chatTabs button { position: relative; margin: 0; font-size: 13px; padding: 4px 12px; background: rgba(233,201,143,0.25); color: #f3e6cf; }
  #chatTabs button.on { background: #e9c98f; color: #2a1c10; }
  #roomDot { display: none; position: absolute; top: 1px; right: 1px; width: 8px; height: 8px; border-radius: 50%; background: #ff3b2f; }
  #roomLog { display: none; height: 150px; overflow-y: auto; font-size: 14px; margin-bottom: 8px; word-wrap: break-word; }
  #roomLog .sys { font-style: italic; opacity: 0.75; font-size: 13px; }
  body.roomTab #msgs { display: none; }
  body.roomTab #roomLog { display: block; }
  @media (max-width: 700px) { #roomLog { height: 110px; } }`;
document.head.appendChild(tabStyle);
const chatTabs = document.createElement('div');
chatTabs.id = 'chatTabs';
const chatTabBtn = document.createElement('button');
chatTabBtn.textContent = '💬 Chat';
const roomTabBtn = document.createElement('button');
roomTabBtn.textContent = '🔔 Room';
const roomDot = document.createElement('span');
roomDot.id = 'roomDot';
roomTabBtn.appendChild(roomDot);
chatTabs.append(chatTabBtn, roomTabBtn);
const roomLog = document.createElement('div');
roomLog.id = 'roomLog';
msgs.parentNode.insertBefore(chatTabs, msgs);
msgs.parentNode.insertBefore(roomLog, msgs.nextSibling);
function showTab(room) {
  document.body.classList.toggle('roomTab', room);
  chatTabBtn.classList.toggle('on', !room);
  roomTabBtn.classList.toggle('on', room);
  if (room) { roomDot.style.display = 'none'; roomLog.scrollTop = roomLog.scrollHeight; }
  else msgs.scrollTop = msgs.scrollHeight;
}
chatTabBtn.addEventListener('click', () => showTab(false));
roomTabBtn.addEventListener('click', () => showTab(true));
showTab(false);
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
function addSys(text, c) {   // grey line in the Room tab, like "Sam joined the room"
  const div = document.createElement('div');
  div.className = 'sys';
  const dot = document.createElement('span');
  dot.textContent = '● ';
  if (Number.isInteger(c) && c >= 0 && c < 7) dot.style.color = RAINBOW_CSS[c];
  div.appendChild(dot);
  div.appendChild(document.createTextNode(text));
  roomLog.appendChild(div);
  while (roomLog.children.length > 100) roomLog.removeChild(roomLog.firstChild);   // keep only the latest 100
  roomLog.scrollTop = roomLog.scrollHeight;
  if (!document.body.classList.contains('roomTab')) roomDot.style.display = 'block';
}
hooks.addSys = addSys;

// ---------- Big on-screen messages, like "Saved to the Doodle Gallery!" ----------
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
  showTab(false);   // back to the chat to see your message
}
document.getElementById('send').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

setupMute(document.getElementById('mute'));

// ---------- Entering the room (the name box over the gallery, set up by start.js) ----------
const nameBox = document.getElementById('nameBox');
const nameInput = document.getElementById('nameInput');
try { nameInput.value = localStorage.getItem('hangoutName') || ''; } catch (e) {}

function enterRoom() {
  if (S.myName) return;   // already in
  const name = nameInput.value.trim().slice(0, 20);
  if (!name) { nameBox.classList.remove('nudge'); void nameBox.offsetWidth; nameBox.classList.add('nudge'); nameInput.focus(); return; }
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
        set(meRef, { name: S.myName, c: S.myHue, t: Date.now(), ...mySpot() });
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

  startSketch();    // LittleSketch, the big doodle board

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

// ---------- Walking around: drag to look, click the floor to walk there (or W A S D / arrow keys) ----------
const hint = document.getElementById('hint');
const HINT_WALK = PHONE ? 'Drag to look · tap the floor to walk · tap the board to doodle · tap a picture to see it'
                        : 'Drag to look · click the floor to walk (or W A S D) · click a throne (or Z) to sit · click the board to doodle · click a picture to see it';
hint.textContent = HINT_WALK;
const LIMIT = R2 - 0.5;                       // how close to the walls you can walk
const TABLE_KEEP = THRONE_AT + 0.31 + 0.25;   // how close to the table's middle you can walk (out past the thrones, plus your body)
const me = { x: (Math.random() - 0.5) * 2.4, z: R2 - 1.2, tx: null, tz: null };   // you start a step out from the back wall (spread a little, so nobody stacks up)
let yaw = 0, pitch = -0.05;                   // facing the doodle board
let anim = null;                              // a camera move in progress (walking up to the board and back)
const boardSaved = { x: 0, z: 0, yaw: 0, pitch: 0 };
const boardSpot = { x: 0, z: 0 };            // where your snowman stands while you're at the board
const DEN_KEEP = 2.35;                        // with the den's curtain down: how far from the middle you have to stay
function clampSpot(x, z) {   // (inside the walls, and not in the table, or in the den with its curtain down)
  x = Math.max(-LIMIT, Math.min(LIMIT, x)); z = Math.max(-LIMIT, Math.min(LIMIT, z));
  if (curtain.closed) {
    const r = Math.hypot(x, z);
    if (r < DEN_KEEP) { if (r < 0.001) { x = DEN_KEEP; z = 0; } else { x *= DEN_KEEP / r; z *= DEN_KEEP / r; } }
    return [x, z];
  }
  if (Math.abs(x) < TABLE_KEEP && Math.abs(z) < TABLE_KEEP) {   // (pushed out the nearest side)
    if (TABLE_KEEP - Math.abs(x) < TABLE_KEEP - Math.abs(z)) x = Math.sign(x || 1) * TABLE_KEEP; else z = Math.sign(z || 1) * TABLE_KEEP;
  }
  return [x, z];
}
function mySpot() {   // what everyone else sees: where you're standing (or walking to), and whether you're at the board
  if (S.atSketch) return { x: +boardSpot.x.toFixed(2), z: +boardSpot.z.toFixed(2), b: true, ch: null };
  if (chair != null) return { x: +THRONES[chair].x.toFixed(2), z: +THRONES[chair].z.toFixed(2), b: null, ch: chair };
  const x = me.tx != null ? me.tx : me.x, z = me.tz != null ? me.tz : me.z;
  return { x: +x.toFixed(2), z: +z.toFixed(2), b: null, ch: null };
}
let sentAt = 0, sendTimer = 0;
function sendSpot(now) {   // tell everyone where you're going (a few times a second at most)
  if (!S.myName) return;
  clearTimeout(sendTimer); sendTimer = 0;
  if (!now && performance.now() - sentAt < 250) { sendTimer = setTimeout(() => sendSpot(true), 250); return; }
  sentAt = performance.now();
  update(ref(db, 'room/presence/' + myId), mySpot()).catch(() => {});
}
function walkTo(x, z) {
  if (seat.sitting || chair != null) return;   // (sitting: stand up first, with Z)
  [me.tx, me.tz] = clampSpot(x, z);
  marker.position.set(me.tx, 0.012, me.tz);
  marker.visible = true; markerFade = 1;
  sendSpot(true);
}
function setFov(f) {
  camera.fov = Math.max(20, Math.min(BASE_FOV, f));
  camera.updateProjectionMatrix();
}
function lookQuat(pos, target) {
  const m = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
function viewQuat(y, p) { return new THREE.Quaternion().setFromEuler(new THREE.Euler(p, y, 0, 'YXZ')); }
function moveCamera(toPos, toQuat, done) {
  anim = { fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(), toPos, toQuat, t: 0, dur: 0.9, done };
}
camera.position.set(me.x, EYE, me.z);
camera.rotation.set(pitch, yaw, 0);

// ---------- Z: sit down on the floor (a quick plop with a little bounce), Z again to stand; sitting, you can look but not walk ----------
const SIT = 0.9, PLOP = [90, 9], RISE = [30, 11];   // (eye height sitting; how it pulls you down, and back up)
const seat = { sitting: false, y: EYE, fall: 0, settling: false };
function toggleSit() {
  if (chair != null) { if (curtain.closed) leaveDen(); else leaveThrone(); return; }   // (in a throne: Z gets you up; in the den, out of it)
  if (!seat.sitting) {   // (standing right beside a free throne: Z sits you in it)
    const near = THRONES.findIndex(t => Math.hypot(t.x - me.x, t.z - me.z) < 0.95);
    if (near >= 0 && !throneTaken(near)) { sitThrone(near); return; }
  }
  seat.sitting = !seat.sitting;
  seat.settling = true; seat.fall = 0;
  if (seat.sitting) { me.tx = me.tz = null; marker.visible = false; }
}
function settle(dt) {
  if (!seat.settling) return;
  const target = seat.sitting ? SIT : EYE, pull = seat.sitting ? PLOP : RISE;
  seat.fall += ((target - seat.y) * pull[0] - seat.fall * pull[1]) * dt;
  seat.y += seat.fall * dt;
  if (Math.abs(target - seat.y) < 0.002 && Math.abs(seat.fall) < 0.02) { seat.y = target; seat.settling = false; }
}

// ---------- Sitting in a throne: the view glides down into the seat, facing the table ----------
const CHAIR_EYE = 1.14;                       // your eye height sitting in a throne
let chair = null;                             // which throne you're in (or null)
function throneTaken(k) { return Object.entries(S.presence).some(([id, p]) => id !== myId && p.ch === k); }
function sitThrone(k) {
  if (anim || chair != null || S.atSketch) return;
  if (throneTaken(k)) { showBanner('Someone is sitting there'); return; }
  const t = THRONES[k];
  seat.sitting = seat.settling = false;
  me.tx = me.tz = null; marker.visible = false;
  chair = k;
  const x = t.x - Math.sin(t.a) * 0.06, z = t.z - Math.cos(t.a) * 0.06;   // (a touch forward on the cushion)
  me.x = x; me.z = z;
  yaw = Math.atan2(t.x, t.z); pitch = -0.3;   // (facing the table, looking down at it a little)
  moveCamera(new THREE.Vector3(x, CHAIR_EYE, z), viewQuat(yaw, pitch), () => { seat.y = CHAIR_EYE; });
  sendSpot(true);
  game.refresh();
}
function leaveThrone() {
  if (anim || chair == null) return;
  const t = THRONES[chair];
  chair = null;
  [me.x, me.z] = clampSpot(t.x + Math.sin(t.a) * 0.6, t.z + Math.cos(t.a) * 0.6);   // (up, and a step back out behind it)
  pitch = -0.05;
  moveCamera(new THREE.Vector3(me.x, EYE, me.z), viewQuat(yaw, pitch), () => { seat.y = EYE; });
  sendSpot(true);
  game.refresh();
}

// A soft gold ring on the floor showing where you'll walk
const marker = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.22, 40),
  new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
scene.add(marker);
let markerFade = 0;

// ---------- Walking up to the doodle board, and stepping back ----------
function enterSketch() {
  if (anim || S.atSketch || !S.myName) return;
  seat.sitting = seat.settling = false; seat.y = EYE; chair = null;   // (up off the floor, or out of the throne, to draw)
  boardSaved.x = me.x; boardSaved.z = me.z; boardSaved.yaw = yaw; boardSaved.pitch = pitch;
  me.tx = me.tz = null;
  const others = Object.entries(S.presence).filter(([id, p]) => id !== myId && p.b).length;
  const side = others % 2 ? 1 : -1, row = Math.floor(others / 2);   // off to the sides of the board, so nobody blocks the view
  boardSpot.x = BOARD_SPOT.x + side * Math.min(LIMIT, BOARD_SPOT.side + row * 0.7);
  boardSpot.z = BOARD_SPOT.z;
  S.atSketch = true;
  setFov(BASE_FOV);
  const v = sketchViewPose(camera.aspect);
  moveCamera(v.pos, lookQuat(v.pos, v.target), null);
  document.body.classList.add('atSketch');
  hint.textContent = `${SKETCH_NAME} · Esc or Back to step away`;
  sketchEnter();
  sendSpot(true);
}
function leaveSketch() {
  if (!S.atSketch || anim) return;
  S.atSketch = false;
  document.body.classList.remove('atSketch');
  sketchLeave();
  me.x = boardSaved.x; me.z = boardSaved.z; yaw = boardSaved.yaw; pitch = boardSaved.pitch;
  moveCamera(new THREE.Vector3(me.x, EYE, me.z), viewQuat(yaw, pitch), null);
  hint.textContent = HINT_WALK;
  sendSpot(true);
}
hooks.sketchBack = leaveSketch;

// ---------- Keys ----------
const keys = new Set();
function typing() { const a = document.activeElement; return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')); }
window.addEventListener('keydown', e => {
  if (typing() || !S.myName) return;
  if (e.key === 'Escape') {
    if (S.atSketch) leaveSketch();
    else if (typing()) return;
    else if (game.deselect()) return;                                                  // (a picked piece, or the board's panel)
    else if (gameCam) return;                                                          // (in the game: Leave game, top left)
    else if (summon.state === 'board') { if (!game.busy()) set(ref(db, 'tables/board'), 0).catch(() => {}); }   // (the board away, for everyone)
    else summon.back();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.repeat && !S.atSketch && !S.galleryOpen && !anim) { toggleSit(); return; }
  if (k === 'r' && !S.atSketch && !S.galleryOpen && !anim) { setFov(BASE_FOV); pitch = -0.05; return; }   // R: look straight ahead again, zoomed back out
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    keys.add(k);
    if (k.startsWith('arrow')) e.preventDefault();   // don't scroll the page
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
function keyWalk(dt) {   // W/S or up/down walk, A/D step sideways, left/right turn
  if (seat.sitting || seat.settling || chair != null) { if (keys.has('arrowleft')) yaw += 1.8 * dt; if (keys.has('arrowright')) yaw -= 1.8 * dt; return; }   // (sitting: turn only)
  if (!keys.size || S.atSketch || anim || S.galleryOpen || typing()) return;
  if (keys.has('arrowleft')) yaw += 1.8 * dt;
  if (keys.has('arrowright')) yaw -= 1.8 * dt;
  const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const sdir = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  if (!f && !sdir) return;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // the way you're facing, flat on the floor
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // to your right
  let mx = fx * f + rx * sdir, mz = fz * f + rz * sdir;
  const len = Math.hypot(mx, mz);
  mx /= len; mz /= len;
  me.tx = me.tz = null; marker.visible = false;
  [me.x, me.z] = clampSpot(me.x + mx * WALK * dt, me.z + mz * WALK * dt);
  sendSpot(false);
}

// Scroll to zoom
canvas.addEventListener('wheel', e => {
  if (S.atSketch) return;
  e.preventDefault();
  if (gameCam && gameCam.view === 'free') { if (!gameCam.lock) gameCam.od = Math.max(0.45, Math.min(4, gameCam.od * Math.exp(e.deltaY * 0.001))); return; }
  setFov(camera.fov + e.deltaY * 0.03);
}, { passive: false });

// ---------- Porting in: click a portal node: it glows golden, the screen flashes gold, and you're in its throne ----------
// (behind the flash the room gets everything it'll show ready, and the flash only fades once it's drawn smoothly)
const whiteout = document.createElement('div');
whiteout.style.cssText = 'position:fixed; inset:0; background:radial-gradient(ellipse at center, #fff4d6 0%, #ffd27a 45%, #e6a63c 100%); opacity:0; pointer-events:none; transition:opacity 0.2s; z-index:5;';
document.body.appendChild(whiteout);
let porting = false;
function portIn(k) {
  if (porting || chair != null || anim) return;
  if (throneTaken(k)) { showBanner('Someone just sat there', 2); return; }
  porting = true;
  const node = nodes[k].n, t0 = performance.now();
  (function glowUp() {   // (the node glows golden)
    const e = Math.min((performance.now() - t0) / 380, 1);
    node.flare(e * e);
    if (e < 1) requestAnimationFrame(glowUp);
  })();
  setTimeout(() => { whiteout.style.transition = 'opacity 0.3s'; whiteout.style.opacity = '1'; }, 300);
  setTimeout(() => {
    node.flare(0);
    if (throneTaken(k)) { porting = false; whiteout.style.transition = 'opacity 0.6s'; whiteout.style.opacity = '0'; showBanner('Someone just sat there', 2); return; }
    const t = THRONES[k];
    seat.sitting = seat.settling = false; seat.y = CHAIR_EYE;
    me.tx = me.tz = null; marker.visible = false;
    chair = k;
    me.x = t.x - Math.sin(t.a) * 0.06; me.z = t.z - Math.cos(t.a) * 0.06;
    yaw = Math.atan2(t.x, t.z); pitch = -0.3;
    setFov(BASE_FOV);
    camera.position.set(me.x, CHAIR_EYE, me.z); camera.quaternion.copy(viewQuat(yaw, pitch));
    sendSpot(true); game.refresh();
    // wait behind the flash: everything ready to draw, then a few smooth frames, then the flash fades
    try { renderer.compile(scene, camera); } catch (e) {}
    let good = 0, last = performance.now();
    (function settle() {
      const now = performance.now(), smooth = now - last < 40; last = now;
      good = smooth ? good + 1 : 0;
      if (good < 6 && now - t0 < 4000) { requestAnimationFrame(settle); return; }
      whiteout.style.transition = 'opacity 0.9s'; whiteout.style.opacity = '0';
      porting = false;
    })();
  }, 640);
}

// ---------- Leaving the den (Leave the den, or Z): a flash, and you're out in the gallery, facing where the den is ----------
// Someone's still in it: behind the flash the den's already gone and the portal nodes are there. You were the last one:
// behind the flash the den clears for everyone, and the black glass column stands a moment (everything getting ready
// behind it), then lifts, leaving the table.
function leaveDen() {
  if (porting || anim || chair == null || gameCam) return;
  porting = true;
  const t0 = performance.now();
  whiteout.style.transition = 'opacity 0.3s'; whiteout.style.opacity = '1';
  setTimeout(() => {
    const others = Object.entries(S.presence).some(([id, p]) => id !== myId && Number.isInteger(p.ch));
    const t = THRONES[chair];
    chair = null;
    seat.sitting = seat.settling = false; seat.y = EYE;
    me.tx = me.tz = null; marker.visible = false;
    [me.x, me.z] = clampSpot(Math.sin(t.a) * (DEN_KEEP + 0.5), Math.cos(t.a) * (DEN_KEEP + 0.5));
    yaw = Math.atan2(me.x, me.z); pitch = -0.05;   // (facing the den)
    setFov(BASE_FOV);
    camera.position.set(me.x, EYE, me.z); camera.quaternion.copy(viewQuat(yaw, pitch));
    if (others) {   // (the den's gone, the nodes there at once)
      denGone = true; denWasHidden = true; goneFor = 1;
      nodes.forEach((o, k) => { o.glow = 0; o.k = throneTaken(k) ? 0 : 1; });
    } else { curtain.open(); clearDen(); }   // (the den clears: denFrame stands the glass column, which lifts after a moment)
    sendSpot(true); game.refresh();
    try { renderer.compile(scene, camera); } catch (e) {}
    let good = 0, last = performance.now();
    (function settle() {
      const now = performance.now(), smooth = now - last < 40; last = now;
      good = smooth ? good + 1 : 0;
      if (good < 6 && now - t0 < 4000) { requestAnimationFrame(settle); return; }
      whiteout.style.transition = 'opacity 0.9s'; whiteout.style.opacity = '0';
      porting = false;
    })();
  }, 340);
}
// ---------- Changing thrones: sitting at the table, click an open throne and you glide round the table into it ----------
function switchThrone(k) {
  if (anim || porting || chair == null || k === chair || gameCam) return;
  if (throneTaken(k)) { showBanner('Someone is sitting there'); return; }
  const from = THRONES[chair].a, t = THRONES[k];
  let d = t.a - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  chair = k;
  me.x = t.x - Math.sin(t.a) * 0.06; me.z = t.z - Math.cos(t.a) * 0.06;
  yaw = Math.atan2(t.x, t.z); pitch = -0.3;
  anim = { fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(), toPos: new THREE.Vector3(me.x, CHAIR_EYE, me.z),
    toQuat: viewQuat(yaw, pitch), t: 0, dur: 0.7 + Math.abs(d) * 0.35, done: () => { seat.y = CHAIR_EYE; },
    around: { a0: from, d, r: THRONE_AT - 0.06 } };   // (round the table, swinging out behind the thrones on the way)
  sendSpot(true); game.refresh();
}

// ---------- Mouse / touch ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let down = null;
let lastX = 0, lastY = 0;
function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
function underSummon(o) { for (; o; o = o.parent) if (o === summon.group) return true; return false; }
function pickUnder(e) {   // the first real thing under the pointer (not the neon glow, the marker or other people)
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(scene.children, true).find(h => shown(h.object) && !h.object.userData.avatar
    && h.object !== marker && !(h.object.material && h.object.material.blending === THREE.AdditiveBlending));
  if (!hit) return null;
  const u = hit.object.userData;
  if (u.curtainLamp) return { lamp: true };
  if (u.portal != null) return { portal: u.portal };
  // anything on the summoned board (the board, its pieces, their glows): the board, at the point straight under the
  // pointer on the squares' level (so a click on a tall piece or a king's orb counts for the square it stands on)
  if (u.boardPick || (game.shown() && underSummon(hit.object))) {
    const y = TABLE_TOP + summon.TOP, p = new THREE.Vector3();
    return { board: raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) || hit.point };
  }
  if (u.summonPick) return { summon: u.summonPick };   // (the game picked)
  if (u.circle) return { circle: true };
  if (u.throne != null) return { throne: u.throne };
  if (u.sketch) return { sketch: true };
  if (u.lightSwitch) return { lightSwitch: true };
  if (u.portalFrame) return { portalFrame: true };
  if (u.gallery) return { gallery: true };   // the gallery opens its own viewer
  if (u.floor) return { floor: hit.point };
  return null;
}
// Two-finger pinch zooms (phones)
const touchPts = new Map();
let pinchDist = 0;
function pinchSpread() { const [a, b] = [...touchPts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
canvas.addEventListener('pointerdown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPts.size === 2) { pinchDist = pinchSpread(); down = null; return; }   // a pinch, not a tap
  down = { x: e.clientX, y: e.clientY };
  lastX = e.clientX; lastY = e.clientY;
});
function endTouch(e) { touchPts.delete(e.pointerId); if (touchPts.size < 2) pinchDist = 0; }
window.addEventListener('pointercancel', e => { down = null; endTouch(e); });
window.addEventListener('pointermove', e => {
  if (touchPts.has(e.pointerId)) touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPts.size === 2 && pinchDist > 0) {
    const d = pinchSpread();
    if (!S.atSketch && d > 0) setFov(camera.fov * pinchDist / d);
    pinchDist = d;
    return;
  }
  if (down && gameCam) {   // in the game, free view: drag turns you round the board (unless it's locked)
    if (gameCam.view === 'free' && !gameCam.lock) {
      gameCam.oy -= (e.clientX - lastX) * 0.006;
      gameCam.op = Math.max(0.12, Math.min(1.5, gameCam.op + (e.clientY - lastY) * 0.005));
    }
  } else if (down && !S.atSketch && !anim) {   // drag to look around: the view follows the mouse (drag right to turn right, up to look up)
    const k = 0.004 * (camera.fov / BASE_FOV);   // slower when zoomed in
    yaw -= (e.clientX - lastX) * k;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - lastY) * k));
  }
  lastX = e.clientX; lastY = e.clientY;
  if (!down && e.target === canvas && !PHONE) {   // show where a click would take you
    const p = S.atSketch || anim ? null : pickUnder(e);
    canvas.style.cursor = p && (p.lamp || p.portal != null || p.summon || p.circle || (p.board && game.canTap(p.board)) || p.throne != null || p.sketch || p.lightSwitch || p.portalFrame || p.gallery || p.floor) ? 'pointer' : 'grab';
  }
});
window.addEventListener('pointerup', e => {
  const wasTap = down && e.target === canvas && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
  down = null;
  endTouch(e);
  if (!wasTap || !S.myName || S.atSketch || anim || S.galleryOpen) return;
  const p = pickUnder(e);
  if (!p) return;
  if (p.board) game.tap(p.board);
  else if (gameCam) return;   // (in the game, only the board)
  else if (p.portal != null) portIn(p.portal);
  else if (p.lamp) lampClicked();   // (the lamp: first the curtain comes down, then each click a new sky)
  else if (p.summon) summon.choose(p.summon);
  else if (p.circle) summon.circleClicked();
  else if (p.throne != null) { if (chair == null) sitThrone(p.throne); else switchThrone(p.throne); }
  else if (p.sketch) enterSketch();
  else if (p.lightSwitch) nextNeon();
  else if (p.portalFrame) goGameRoom();
  else if (p.floor) walkTo(p.floor.x, p.floor.z);
});

// ---------- Window resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Main loop ----------
// Top left, while the curtain is down: a button to leave the game den (out of your throne, and the curtain lifts)
const leaveBtn = document.createElement('button');
leaveBtn.className = 'corner'; leaveBtn.id = 'leaveBtn'; leaveBtn.textContent = '⤺ Leave the den';
leaveBtn.style.cssText = 'left:16px; top:16px; width:auto; padding:0 16px; border-radius:20px; font-size:15px; display:none;';
document.body.appendChild(leaveBtn);
leaveBtn.addEventListener('click', () => {
  leaveBtn.blur();
  if (gameCam) { game.leave(); return; }   // (in the game: out of it, back to the den)
  if (chair != null) leaveDen();            // (a flash, and you're out in the gallery; the den stays for anyone still in it)
});
// In the game: four small view buttons down the left, always there: close isometric (angled down from your side), top
// (straight down), look around (drag round the board, scroll in and out) and lock (holds the view where it is; from
// the other two it locks wherever you're looking from now)
const viewBtns = {};
[['angled', '◩', 'Close isometric'], ['top', '⬒', 'Top'], ['free', '✥', 'Look around'], ['lock', '🔓', 'Lock the view']].forEach(([v, icon, title], i) => {
  const b = document.createElement('button');
  b.className = 'corner'; b.textContent = icon; b.title = title;
  b.style.cssText = `left:16px; top:${68 + i * 50}px; display:none;`;
  document.body.appendChild(b);
  b.addEventListener('click', () => { b.blur(); setGameView(v); });
  viewBtns[v] = b;
});
function setGameView(v) {
  if (!gameCam) return;
  if (v === 'lock') {
    if (gameCam.view !== 'free') setGameView('free');
    gameCam.lock = !gameCam.lock;
  } else if (v !== gameCam.view) {
    if (v === 'free') {   // (free starts from wherever you're looking from now)
      const off = camera.position.clone().sub(BOARD_MID), d = off.length();
      gameCam.od = d; gameCam.op = Math.max(0.12, Math.min(1.5, Math.asin(off.y / d))); gameCam.oy = Math.atan2(off.x, off.z);
    }
    gameCam.view = v; gameCam.lock = false;
  }
  showViewBtns();
}
function showViewBtns() {   // (the view you're in, and the lock when it's on, lit gold)
  for (const [v, b] of Object.entries(viewBtns)) {
    b.style.display = gameCam ? 'block' : 'none';
    const on = !!gameCam && (v === 'lock' ? gameCam.lock : gameCam.view === v);
    b.style.background = on ? 'rgba(233,201,143,0.92)' : '';
    b.style.color = on ? '#2a1c10' : '';
  }
  viewBtns.lock.textContent = gameCam && gameCam.lock ? '🔒' : '🔓';
}

// ---------- The game view: Start locks you onto the board ----------
// Your view glides over the board from your side and stays there; the thrones, the lamp and everyone else go, the
// curtain's sky stays (the room behind is already off), with a soft dark fade round the screen's edges. Scroll zooms.
const vignette = document.createElement('div');
vignette.style.cssText = 'position:fixed; inset:0; pointer-events:none; opacity:0; transition:opacity 1.2s; z-index:1;' +
  'background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 85%, rgba(0,0,0,0.85) 100%);';
document.body.appendChild(vignette);
let gameCam = null;   // { side, view: 'angled' | 'top' | 'free', lock, oy, op, od } while in the game view
const TABLE_TOP = 0.85;
const GAME_FOV = 46;   // (a slightly longer lens in the game: the board big, no edge stretch)
const BOARD_MID = new THREE.Vector3(0, TABLE_TOP + summon.TOP, 0);
// The game: just the board, floating in the den's sky (the table, thrones, lamp and everyone else go: studio's loop)
function gameView(side, watching) {
  if (side) {
    fitBoard();
    anim = null;   // (any camera glide in progress gives way to the game view)
    me.tx = me.tz = null; marker.visible = false; seat.sitting = seat.settling = false;
    gameCam = { side, watching: !!watching, view: 'angled', lock: false, oy: 0, op: 0.9, od: 1.6 };
    vignette.style.opacity = '1';
    leaveBtn.textContent = watching ? '⤺ Stop watching' : '⤺ Leave game';
    setFov(GAME_FOV);
    showViewBtns();
  } else if (gameCam) {
    setFov(BASE_FOV);
    gameCam = null;
    vignette.style.opacity = '0';
    leaveBtn.textContent = '⤺ Leave the den';
    showViewBtns();
    camera.up.set(0, 1, 0);
    const t = THRONES[chair != null ? chair : 1];
    me.x = t.x - Math.sin(t.a) * 0.06; me.z = t.z - Math.cos(t.a) * 0.06;   // (back in your throne)
    yaw = Math.atan2(t.x, t.z); pitch = -0.3; seat.y = 1.14;
    moveCamera(new THREE.Vector3(me.x, seat.y, me.z), viewQuat(yaw, pitch), null);
  }
}
// The glow (bloom), only in the game view: the room is off then, so there's power for it. Anything brighter than
// white (the jewels' hot cores, their glitter and light, the lasers) glows softly out around itself, as in the Workshop.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType }));
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.55, 0.95));
composer.addPass(new OutputPass());
const camGoal = new THREE.PerspectiveCamera();   // (a camera, so lookAt points it the way a camera looks)
// Fitting the board to the screen: the closest the camera can come along a direction with the whole board (its frame
// and the pieces standing on it) still on screen, a little in from the edges
const boardCorners = [];
function fitBoard() {   // (the game's board: its middle and corners, for whichever game is out)
  BOARD_MID.y = TABLE_TOP + summon.TOP;
  const half = summon.CELL * 4 * (summon.game === 'othello' ? 1.2 : 1.12);
  boardCorners.length = 0;
  for (const y of [0, 0.07]) for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) boardCorners.push(new THREE.Vector3(cx * half, y, cz * half).add(BOARD_MID));
}
fitBoard();
const fitCam = new THREE.PerspectiveCamera(), fitP = new THREE.Vector3();
function fitDistance(dir, up) {
  fitCam.fov = GAME_FOV; fitCam.aspect = camera.aspect; fitCam.near = 0.01; fitCam.far = 100; fitCam.updateProjectionMatrix();
  fitCam.up.copy(up);
  let lo = 0.2, hi = 8;
  for (let i = 0; i < 22; i++) {
    const d = (lo + hi) / 2;
    fitCam.position.copy(BOARD_MID).addScaledVector(dir, d); fitCam.lookAt(BOARD_MID); fitCam.updateMatrixWorld();
    let fits = true;
    for (const c of boardCorners) { fitP.copy(c).project(fitCam); if (fitP.z > 1 || Math.abs(fitP.x) > 0.97 || Math.abs(fitP.y) > 0.94) { fits = false; break; } }   // (close: the board fills the screen)
    if (fits) hi = d; else lo = d;
  }
  return hi;
}
const ANGLED = 0.87;   // (the angled view's height: about 50 degrees up, from your side)
const UP = new THREE.Vector3(0, 1, 0), camDir = new THREE.Vector3(), camUp = new THREE.Vector3();
function steerGameCam(dt) {
  const s = gameCam.side === 2 ? -1 : 1;
  if (gameCam.view === 'top') { camDir.set(s * 0.0001, 1, 0).normalize(); camUp.set(-s, 0, 0); }
  else if (gameCam.view === 'free') { camDir.set(Math.cos(gameCam.op) * Math.sin(gameCam.oy), Math.sin(gameCam.op), Math.cos(gameCam.op) * Math.cos(gameCam.oy)); camUp.copy(UP); }
  else { camDir.set(s * Math.cos(ANGLED), Math.sin(ANGLED), 0); camUp.copy(UP); }
  const d = gameCam.view === 'free' ? gameCam.od : fitDistance(camDir, camUp);
  camGoal.position.copy(BOARD_MID).addScaledVector(camDir, d);
  camGoal.up.copy(camUp); camGoal.lookAt(BOARD_MID);
  const k = 1 - Math.exp(-dt * 3.5);
  camera.position.lerp(camGoal.position, k);
  camera.quaternion.slerp(camGoal.quaternion, k);
}
// Every frame: who sees what. In the den (sitting at the table): with the sky in, the room is off and only those
// sitting show; in the game, just the board in the sky. Out in the gallery with the curtain down: the table, the
// curtain and everyone at it gone (blazing up and breaking into sparkles), and in the middle a gentle pillar of gold
// light with sparkles drifting up it, the portal nodes (one for each open throne) floating in it one above another,
// staggered, the column slowly turning. Click one to port into its throne.
const NODE_H = [2.3, 1.86, 1.42, 0.98];    // (how high each floats)
const NODE_AT = [-0.08, 0.0, 0.13, 0.0];   // (and how far to the side: a gentle zigzag centered on the pillar's middle)
const nodes = THRONES.map((t, k) => {
  const n = makePortalNode({ floorDrop: NODE_H[k] });
  n.group.scale.setScalar(1.15);
  n.group.position.set(0, NODE_H[k], 0);
  n.group.traverse(o => { o.userData.portal = k; });
  n.group.visible = false;
  nodeGroup.add(n.group);
  return { n, k: 0 };
});
const pillar = new THREE.Group();   // (the pillar of light the nodes float in)
pillar.visible = false;
nodeGroup.add(pillar);
const PU = { pT: { value: 0 }, pK: { value: 0 } };
const pillarMat = (inner) => new THREE.ShaderMaterial({
  uniforms: PU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: 'varying vec2 vU; varying float vF; void main() { vU = uv; vec3 n = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vF = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }',
  fragmentShader: `uniform float pT, pK; varying vec2 vU; varying float vF;
    void main() {
      float up = vU.y;
      float ends = smoothstep(0.0, 0.18, up) * (1.0 - smoothstep(0.7, 1.0, up));
      float streak = 0.65 + 0.35 * sin(vU.x * 6.2832 * 9.0 + up * 6.0 - pT * 0.8) * sin(vU.x * 6.2832 * 4.0 - pT * 0.5);
      float rise = 0.8 + 0.2 * sin(up * 14.0 - pT * 1.6);
      float a = pow(vF, ${inner ? '2.0' : '3.0'}) * ends * streak * rise * pK * ${inner ? '0.35' : '0.16'};
      gl_FragColor = vec4(vec3(1.0, 0.78, 0.45) * a, 1.0);
    }`
});
pillar.add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 2.7, 48, 1, true).translate(0, 1.35, 0), pillarMat(false)));
pillar.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 2.7, 32, 1, true).translate(0, 1.35, 0), pillarMat(true)));
{
  const N = 360, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * 0.32; pos.set([Math.cos(a) * r, Math.random() * 2.6, Math.sin(a) * r], i * 3); seed[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const sp = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { ...PU, pPx: { value: 400 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float pT, pK, pPx; attribute float seed; varying float vA, vS;
      void main() {
        vS = seed;
        vec3 p = position; p.y = mod(p.y + pT * (0.08 + seed * 0.12), 2.6);   // (drifting up the pillar)
        p.x += sin(pT * 0.6 + seed * 40.0) * 0.03; p.z += cos(pT * 0.5 + seed * 30.0) * 0.03;
        float tw = 0.5 + 0.5 * sin(pT * (4.0 + seed * 8.0) + seed * 50.0);
        vA = pK * (0.3 + 0.7 * tw * tw) * smoothstep(0.0, 0.4, p.y) * (1.0 - smoothstep(2.0, 2.6, p.y));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = pPx * (0.008 + 0.016 * seed * seed) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA, vS;
      void main() { vec2 q = gl_PointCoord - 0.5; float a = (exp(-dot(q, q) * 60.0) + (exp(-abs(q.x) * 30.0) * exp(-abs(q.y) * 5.0) + exp(-abs(q.y) * 30.0) * exp(-abs(q.x) * 5.0)) * step(0.86, vS)) * vA;
        gl_FragColor = vec4(mix(vec3(1.0, 0.7, 0.3), vec3(1.0, 0.94, 0.8), step(0.75, vS)) * a * 1.8, a); }`
  }));
  sp.frustumCulled = false; sp.userData.px = sp.material.uniforms.pPx;
  pillar.add(sp); pillar.userData.sparks = sp;
}
let denWasHidden = false, denGone = false, goneFor = 0, emptyFor = 0, denLoading = true, hadSitters = false, wasClosed = false;
function denFrame(dt) {
  const seatedIds = new Set(Object.entries(S.presence).filter(([id, p]) => id !== myId && Number.isInteger(p.ch)).map(([id]) => id));
  const sitting = chair != null || seatedIds.size > 0;
  curtain.lampDown(sitting);
  // nobody sitting for a couple of seconds after someone was (or the curtain down with nobody in it): the den clears
  // for everyone (whoever's here sends it; only once the room has loaded)
  if (sitting) { hadSitters = true; emptyFor = 0; }
  else if ((den.closed || hadSitters) && S.myName && S.presence[myId]) {
    emptyFor += dt;
    if (emptyFor > 2) { emptyFor = 0; hadSitters = false; clearDen(); }
  } else emptyFor = 0;
  const inside = chair != null;
  // the den clearing, seen from out in the gallery: straight to the black glass column, held a moment (everything getting
  // ready behind it), then it lifts, leaving the table (no glitter, no nodes coming and going)
  if (wasClosed && !curtain.closed && !inside && !denLoading) {
    curtain.toGlass(1.2); curtain.glowIn();
    denGone = false; denWasHidden = false;
    nodes.forEach(o => { o.k = 0; o.glow = 0; });
  }
  wasClosed = curtain.closed;
  // (out in the gallery, curtain down: the den's gone, until it lifting has pulled the sky back in round the table)
  const hidden = !inside && (curtain.closed ? curtain.down : curtain.spreadOut);
  if (denLoading) {   // (just arrived: the den as it is, at once: if it's down, only the nodes, nothing played out)
    if (denFirst) return;   // (until the den's state has come in)
    denLoading = false; denWasHidden = hidden; denGone = hidden && !inside; goneFor = 1;
  }
  if (hidden !== denWasHidden) {   // (it blazes up and breaks into sparkles, or gathers back; the den goes or comes at the blaze's height)
    denWasHidden = hidden;
    if (inside) denGone = false;
    else if (hidden) { curtain.glowIn(); vanish.out({ onStart: () => { denGone = true; goneFor = -1e9; }, onGone: () => { goneFor = 0; } }); }   // (down: it glitters gold and vanishes into particles)
    else { denGone = false; curtain.glowIn(); vanish.in({ onDone: () => {} }); }   // (coming back: the den's there at once, its curtain forming glowing out of particles, cooling black, then rolling up)
  }
  if (inside) denGone = false;   // (ported in: it's all there at once)
  goneFor += dt;
  const skyRoom = inside && curtain.skyIn;
  setRoom(!(skyRoom || gameCam));
  gameTable.visible = !denGone && !gameCam;
  for (const t of THRONES) t.mesh.visible = !denGone && !gameCam;
  summon.group.visible = !denGone;
  curtain.group.visible = !denGone;
  curtain.lampShown(!gameCam);
  for (const [id, a] of Object.entries(avatars)) {
    const atTable = seatedIds.has(id);
    a.g.visible = gameCam ? false : skyRoom ? atTable : denGone ? !atTable : true;
  }
  const t = clock.elapsedTime;
  nodes.forEach((o, k) => {   // (each swells in a moment after the sparkles break away, and shrinks away when taken or the den comes back)
    let want = denGone && hidden && !throneTaken(k) && goneFor > 0.3 && !inside ? 1 : 0;
    if (inside) o.k = 0;   // (inside the den: none at all, at once)
    const leaving = !inside && !curtain.closed && o.k > 0.001;   // (the den's coming back: each glows golden, then goes)
    o.glow = leaving ? Math.min(1, (o.glow || 0) + dt / 0.4) : want ? 0 : (o.glow || 0);
    if (leaving && o.glow < 1) want = o.k;   // (holding while it glows up)
    o.n.flare(o.glow * o.glow);
    o.k += Math.sign(want - o.k) * Math.min(Math.abs(want - o.k), dt / (want ? 0.6 : 0.3));
    o.n.group.visible = o.k > 0.001;
    if (o.n.group.visible) {
      const a = performance.now() * 0.00018;   // (the zigzag, all in one plane, slowly turning)
      o.n.group.position.set(Math.cos(a) * NODE_AT[k], NODE_H[k] + Math.sin(performance.now() * 0.0009 + k * 1.7) * 0.03, Math.sin(a) * NODE_AT[k]);
      o.n.appear(o.k); o.n.update(t);
    }
  });
  {   // the pillar: there while any node is
    const pk = Math.max(...nodes.map(o => o.k));
    pillar.visible = pk > 0.001;
    PU.pK.value = pk; PU.pT.value = performance.now() / 1000;
    pillar.userData.sparks.userData.px.value = (window.innerHeight || 800) * Math.min(window.devicePixelRatio || 1, 2) * 0.5;
  }
  vanish.update(dt);
  leaveBtn.style.display = gameCam || (inside && curtain.closed) ? 'block' : 'none';
}
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (gameCam) steerGameCam(dt);
  else if (anim) {
    anim.t += dt;
    const e = easeInOut(Math.min(anim.t / anim.dur, 1));
    if (anim.around) {   // (changing thrones: round the table, facing it)
      const a = anim.around, th = a.a0 + a.d * e, out = Math.sin(Math.PI * e), r = a.r + out * 0.85;
      camera.position.set(Math.sin(th) * r, CHAIR_EYE + out * 0.3, Math.cos(th) * r);
      camera.quaternion.copy(viewQuat(th, -0.3 - out * 0.12));
    } else {
      camera.position.lerpVectors(anim.fromPos, anim.toPos, e);
      camera.quaternion.slerpQuaternions(anim.fromQuat, anim.toQuat, e);
    }
    if (anim.t >= anim.dur) { const done = anim.done; anim = null; if (done) done(); }
  } else if (!S.atSketch) {
    keyWalk(dt);
    if (me.tx != null) {   // walking to where you clicked
      const dx = me.tx - me.x, dz = me.tz - me.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, WALK * dt);
      if (d > 0.001) { me.x += dx / d * step; me.z += dz / d * step; }
      if (d - step < 0.001) { me.x = me.tx; me.z = me.tz; me.tx = me.tz = null; }
      [me.x, me.z] = clampSpot(me.x, me.z);   // (round the table, not through it)
    }
    if (chair == null && curtain.closed) [me.x, me.z] = clampSpot(me.x, me.z);   // (the den's curtain coming down: out you step)
    settle(dt);
    camera.position.set(me.x, seat.y, me.z);
    camera.rotation.set(pitch, yaw, 0);
  }
  if (marker.visible && me.tx == null) {   // the ring fades once you get there
    markerFade -= dt * 2.5;
    marker.material.opacity = Math.max(0, markerFade) * 0.8;
    if (markerFade <= 0) marker.visible = false;
  } else if (marker.visible) marker.material.opacity = 0.8;
  moveAvatars(dt);
  denFrame(dt);
  curtain.update(dt);
  summon.update(dt);
  game.update(clock.elapsedTime);
  portalFrame.update(clock.elapsedTime);
  updateSketch(dt);
  renderer.render(scene, camera);   // (no extra glow pass: it only cost the computer without making the pieces better)
});

// ---------- Coming in: the room gets ready behind start.js's cover, then the cover fades away ----------
// The pictures and the first data load, the reflections are taken and everything is drawn once, all while the cover
// is up, so any stutter happens where nobody can see it. Then the cover fades and you're standing inside.
const wait = ms => new Promise(r => setTimeout(r, ms));
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : window.requestAnimationFrame(f)); window.requestAnimationFrame(f); });
camera.position.set(me.x, EYE, me.z); camera.rotation.set(pitch, yaw, 0);
(async () => {
  await Promise.race([Promise.all([marbleLoaded, neonLoaded, get(ref(db, 'room/sketch/doodles')), get(ref(db, 'room/sketch/gallery'))]), wait(8000)]);   // a slow connection doesn't keep you out forever
  await wait(300);                                    // the reflection snapshot is taken just after the pictures land
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  await frames(3);
  window.dispatchEvent(new Event('room-ready'));
})();