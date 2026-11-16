// =====================================================================
// tables.js — the Table Room: dark wood plank floor, dark wood wainscot under burgundy wallpaper, and a big red
// dot-matrix clock above the door. Toward the back wall, on its black velvet rug, stands the game
// table (made in the Workshop: table/gametable/), its rubies glowing, with a tall chair on either side, under a red paper lantern that glows from a tiny
// light deep inside and lets a soft white light fall onto the table. For now it's on show only; games are to come, a
// table summoned for each.
// Chat is shared with the other rooms. Leaving by the door whooshes you back to the Cave.
// You walk in through an old tavern door (tdoor.jpg, a Kindroid picture) that swings open in front of you.
// VERSION 12
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, remove, push, onValue, onDisconnect,
         query, orderByChild, startAt, endAt, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, ROOM, HEIGHT, EYE, renderer, scene, camera, canvas, BASE_FOV,
         box, std, envMap, goldMat, RAINBOW, RAINBOW_CSS, colorIndex, makeLabel, PHONE } from '../core.js';
import { sfx, setupMute } from '../sounds.js';
import { travelHome } from '../portal.js';
import { makeEntrance, doorSpan } from '../entrance.js';
import { makeClock } from '../clock.js';
import { inRoom } from '../world.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeGameTable, TABLE_HEIGHT } from './gametable/gametable.js';
import { makeChair } from './gametable/chair.js';
import { makeLantern } from './gametable/lantern.js';

document.querySelector('#ui h1').textContent = 'Table Room';
document.title = 'Table Room';

// ---------- Wood, wallpaper and the floor (Kindroid pictures) ----------
// floor.jpg is the plank floor, wall.jpg the upright boards of the wainscot along the bottom of the walls.
// Above the wainscot, and on the ceiling, is burgundy wallpaper (drawn here for now).
// Everything polished takes its reflections from a snapshot of this room (below).
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
const TEX = PHONE ? 1024 : 2048;
const floorMat = std(0x2a1e18, 0.3, { envMapIntensity: 0.7 });
const wallMat = std(0x2a1e18, 0.4, { envMapIntensity: 0.35 });           // the wainscot
const paperMat = std(0xffffff, 0.85, { envMapIntensity: 0.1 });           // burgundy wallpaper
const ceilMat = std(0xffffff, 0.85, { envMapIntensity: 0.08 });           // the ceiling: the same wallpaper
const trimMat = std(0x2a170c, 0.35, { envMapIntensity: 0.4 });            // rails and baseboards
// The floor and the wainscot: the picture with the Kindroid mark trimmed off, pulled from its warm red brown toward a
// deep dark brown, and repeated mirrored (every other copy flipped), so the edges of the picture always meet up.
function photoTex(img, repeatX, repeatY) {
  const S = Math.min(TEX, img.width), c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, img.width * 0.94, img.height * 0.94, 0, 0, S, S);
  g.globalCompositeOperation = 'saturation';       // less red...
  g.fillStyle = 'rgba(128,128,128,0.35)'; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'multiply';         // ...and darker
  g.fillStyle = '#9a8a80'; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.anisotropy = MAX_ANISO;
  t.repeat.set(repeatX, repeatY);
  return t;
}
function loadPhoto(file, mat, repeatX, repeatY) {   // a promise that's done once the picture is on, or has failed
  return new Promise(done => {
    const img = new Image();
    img.onload = () => { mat.map = photoTex(img, repeatX, repeatY); mat.color.setHex(0xffffff); mat.needsUpdate = true; snapRoom(); done(); };
    img.onerror = () => { console.warn(file + ' did not load; it stays plain dark wood'); done(); };
    img.src = new URL(file, import.meta.url).href;   // next to this file
  });
}
// Burgundy wallpaper with a soft tone on tone damask pattern (a stand in, until there's a Kindroid wallpaper)
function wallpaperTex() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), r = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(77);
  g.fillStyle = '#4a0e18'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {                 // a faint fabric grain
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '120,40,55'},${r() * 0.08})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1);
  }
  const motif = (cx, cy, sc) => {                  // one damask flower: a tall leafy shape, mirrored left and right
    g.save(); g.translate(cx, cy); g.scale(sc, sc);
    for (const m of [1, -1]) {
      g.save(); g.scale(m, 1);
      g.beginPath();
      g.moveTo(0, -110);
      g.bezierCurveTo(30, -80, 60, -60, 40, -20);
      g.bezierCurveTo(80, -30, 90, 20, 50, 30);
      g.bezierCurveTo(70, 60, 40, 90, 0, 110);
      g.lineTo(0, 70);
      g.bezierCurveTo(20, 55, 30, 35, 12, 20);
      g.bezierCurveTo(30, 0, 20, -30, 0, -45);
      g.closePath();
      g.fill();
      g.beginPath(); g.ellipse(58, -62, 10, 20, 0.6, 0, Math.PI * 2); g.fill();      // little side leaves
      g.beginPath(); g.ellipse(62, 72, 9, 16, -0.6, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  g.fillStyle = 'rgba(120,32,48,0.28)';            // the pattern: a little lighter than the paper, so it only shows in the light
  for (const [x, y] of [[0, 0], [S, 0], [0, S], [S, S], [S / 2, S / 2]]) motif(x, y, 1.6);
  g.fillStyle = 'rgba(120,32,48,0.16)';
  for (const [x, y] of [[S / 2, 0], [S / 2, S], [0, S / 2], [S, S / 2]]) motif(x, y, 0.7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAX_ANISO;
  return t;
}
{
  const paper = wallpaperTex();
  paper.repeat.set(ROOM / 0.9, (HEIGHT - 1) / 0.9);   // the pattern repeats every 90 cm
  paperMat.map = paper;
  const top = paper.clone(); top.repeat.set(ROOM / 0.9, ROOM / 0.9); top.needsUpdate = true;
  ceilMat.map = top;
}

// ---------- The room: four walls, the floor and the ceiling ----------
function plane(w, h, mat, x, y, z, rx, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true;
  scene.add(m);
  return m;
}
const H2 = HEIGHT / 2, R2 = ROOM / 2;
const WAIN = 1.0;                                            // the wainscot comes up to the rail
// The way in: an old tavern door, cut out of its picture (where it sits in the picture, as parts of its size)
const DOOR_X = 1.6;
const ENTRANCE = { style: 'tavern', file: new URL('tdoor.jpg', import.meta.url).href, x: DOOR_X, z: R2, height: 2.35, roomHalf: R2, roomHeight: HEIGHT,
  door: { x0: 0.234, x1: 0.781, top: 0.125, bottom: 0.887, spring: 0.293 } };
for (const [x, z, ry] of [[0, -R2, 0], [0, R2, Math.PI], [-R2, 0, Math.PI / 2], [R2, 0, -Math.PI / 2]]) {   // far, entry (door and clock), left, right
  plane(ROOM, WAIN, wallMat, x, WAIN / 2, z, 0, ry);                          // wood below
  plane(ROOM, HEIGHT - WAIN, paperMat, x, WAIN + (HEIGHT - WAIN) / 2, z, 0, ry);   // wallpaper above
}
const floor = plane(ROOM, ROOM, floorMat, 0, 0, 0, -Math.PI / 2, 0);
floor.userData.floor = true;
plane(ROOM, ROOM, ceilMat, 0, HEIGHT, 0, Math.PI / 2, 0);
// Baseboards, a rail and a crown along every wall (the baseboard and rail stop at the door's surround)
const DOOR_GAP = doorSpan(ENTRANCE);
for (const [y, h, d] of [[0.07, 0.14, 0.03], [1.0, 0.06, 0.035], [HEIGHT - 0.08, 0.16, 0.06]]) {
  for (const [x, z, w, dd] of [[0, -R2 + d / 2, ROOM, d], [0, R2 - d / 2, ROOM, d], [-R2 + d / 2, 0, d, ROOM], [R2 - d / 2, 0, d, ROOM]]) {
    if (z > 0 && y < 3) {   // the entry wall: one piece each side of the doorway
      const a = DOOR_X - DOOR_GAP, b = DOOR_X + DOOR_GAP;
      box(a + R2, h, dd, trimMat, (a - R2) / 2, y, z, scene).castShadow = false;
      box(R2 - b, h, dd, trimMat, (b + R2) / 2, y, z, scene).castShadow = false;
      continue;
    }
    box(w, h, dd, trimMat, x, y, z, scene).castShadow = false;
  }
}
// The polish: a snapshot of this very room, taken from about table height, used for every reflection in here.
// It's retaken as each picture loads. The game table's stones also get a snapshot as a cube, taken just above the
// board, which they look out into through their facets.
const pmrem = new THREE.PMREMGenerator(renderer);
const cubeTarget = new THREE.WebGLCubeRenderTarget(PHONE ? 256 : 512, { type: THREE.HalfFloatType });
const cubeCamera = new THREE.CubeCamera(0.05, 30, cubeTarget);
let roomEnv = null, snapTimer = 0;
const reflective = [floorMat, wallMat, paperMat, ceilMat, trimMat];
const tableMats = [];   // (the game table's, filled in below)
function snapRoom() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const hide = [marker, ...Object.values(avatars).map(a => a.g)];   // not people (they'd freeze in it)
    const was = hide.map(o => o.visible);
    hide.forEach(o => { o.visible = false; });
    for (const m of tableMats) m.envMap = null;   // (the snapshots are taken without the table's own reflections)
    cubeCamera.position.set(0, TABLE_TOP + 0.35, TABLE_Z); cubeCamera.updateMatrixWorld();
    cubeCamera.update(renderer, scene);
    scene.position.y = -1.0;
    const env = pmrem.fromScene(scene, 0.02, 0.05, 30);
    scene.position.y = 0;
    hide.forEach((o, i) => { o.visible = was[i]; });
    if (roomEnv) roomEnv.dispose();
    roomEnv = env;
    for (const m of [...reflective, ...tableMats]) { m.envMap = env.texture; m.needsUpdate = true; }
  }, 150);
}
const floorLoaded = loadPhoto('floor.jpg', floorMat, ROOM / 1.8, ROOM / 1.8);   // one copy of the picture covers 1.8 meters
const wallLoaded = loadPhoto('wall.jpg', wallMat, ROOM / 1.0, 1);              // and the wainscot is a meter tall

// ---------- A dot-matrix wall clock above the door: the day and your local time ----------
const wallClock = makeClock({ lit: '#ff2a1f', dim: '#3a1613', width: 1.25, frame: goldMat });
wallClock.group.position.set(DOOR_X, 3.15, R2 - 0.03);
wallClock.group.rotation.y = Math.PI;
scene.add(wallClock.group);

// ---------- The way in: the front of the building outside, and its doors (click them twice to leave) ----------
// You come in through them: the room fades in with you a few steps outside, the doors swing open, you walk in and they
// shut behind you. Outside, everything but the picture is dark, so the room only shows through the doorway.
const entrance = makeEntrance(ENTRANCE);

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xffe2c0, 0x3a2414, 1.5));   // soft, warm light everywhere (the tables get their own)

// ---------- The game table, in the middle of the room on its rug ----------
// Made in the Workshop (its files and pictures are in table/gametable/). Its pictures load from there; the room's glow
// and its snapshots make its rubies shine.
const GLOW = 1;   // the layer glowing things are put on (the rubies)
const RUG = 3.0;  // the rug, meters square
const TABLE_Z = -(R2 - RUG / 2 - 0.1);   // where it stands: toward the back wall, its rug's far edge 10 cm from the wall
const tableManager = new THREE.LoadingManager();
const tableLoaded = new Promise(r => { tableManager.onLoad = r; tableManager.onError = () => {}; });
const tableLoader = new THREE.TextureLoader(tableManager).setPath(new URL('gametable/', import.meta.url).href);
const gameTable = makeGameTable(THREE, { loader: tableLoader, anisotropy: MAX_ANISO, onReady: () => snapRoom(),
  glowLayer: GLOW, envCube: cubeTarget.texture }, { rug: RUG });
const TABLE_TOP = gameTable.top;
gameTable.group.position.z = TABLE_Z;
scene.add(gameTable.group);
gameTable.group.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
gameTable.group.children[0].traverse(o => { o.userData.floor = true; });   // (the rug: click it to walk there, like the floor)
tableMats.push(...gameTable.materials);
// Two tall chairs across from each other at its left and right ends, each facing the table (side on to the door, so
// both players can see the door and the clock)
const showOpts = { loader: tableLoader, anisotropy: MAX_ANISO, onReady: () => snapRoom(), glowLayer: GLOW, envCube: cubeTarget.texture };
const CHAIR_X = 1.05;   // how far out from the middle of the table each chair stands
const chairs = [1, -1].map(side => {
  const c = makeChair(THREE, showOpts);
  c.group.position.set(side * CHAIR_X, gameTable.top - TABLE_HEIGHT, TABLE_Z);   // (standing on the rug)
  c.group.rotation.y = -side * Math.PI / 2;   // (turned to face the table)
  c.group.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  scene.add(c.group);
  tableMats.push(...c.materials);
  return c;
});
const TABLE_KEEP = 1.3;   // how close you can walk to the middle of the table (it's 1.5 m across, with its chairs)

// ---------- The red paper lantern hanging over the table ----------
// Its little light shines soft and white straight down onto the table (white, so the table keeps its own colors); the
// lantern itself glows red. It hangs on a thin dark cord from a small dark plate on the ceiling.
const LANTERN_Y = 3.0;
const lantern = makeLantern(THREE, { glowLayer: GLOW, shadows: !PHONE });
lantern.group.position.set(0, LANTERN_Y, TABLE_Z);
lantern.light.target.position.set(0, 0, TABLE_Z);   // (its light falling straight down onto the table)
scene.add(lantern.light.target);
scene.add(lantern.group);
{
  const cordMat = new THREE.MeshStandardMaterial({ color: 0x140a06, roughness: 0.6 });
  const top = LANTERN_Y + 0.26 * 0.88 + 0.04;   // (the top of its wooden ring)
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, HEIGHT - top, 8), cordMat);
  cord.position.set(0, (HEIGHT + top) / 2, TABLE_Z);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.025, 32), cordMat);
  plate.position.set(0, HEIGHT - 0.0125, TABLE_Z);
  scene.add(cord, plate);
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
  const x = Number.isFinite(p.x) ? p.x : 1.6, z = Number.isFinite(p.z) ? p.z : R2 - 1.3;
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
    if (fresh) a.g.position.set(to.x, 0, to.z);   // someone new just appears where they are
  }
}
function moveAvatars(dt) {   // everyone else glides toward where they're walking
  for (const a of Object.values(avatars)) {
    const p = a.g.position, dx = a.tx - p.x, dz = a.tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.001) continue;
    const step = Math.min(d, WALK * dt);
    p.x += dx / d * step; p.z += dz / d * step;
  }
}

// ---------- Who's online: everyone, in every room and the Cave, each with an icon for where they are (world.js) ----------
const connEl = document.getElementById('conn');
const whoBtn = document.getElementById('whoBtn');
inRoom('tables');

function refreshAll() {
  refreshAvatars();
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

// ---------- Leaving the room: the 🚪 button or the door (clicked twice), then the portal whoosh back to the Cave ----------
const leaveBtn = document.getElementById('leaveRoom');
let leaveArmed = 0;
function leaveRoom() {
  if (!S.myName) return;
  if (Date.now() - leaveArmed > 3000) {   // first click: ask to be sure
    leaveArmed = Date.now();
    leaveBtn.textContent = 'Sure? Click again';
    showBanner('🚪 Click again to leave the room', 3);
    setTimeout(() => { if (Date.now() - leaveArmed >= 3000) leaveBtn.textContent = '🚪 Leave'; }, 3100);
    return;
  }
  goHome();
}
function goHome() {   // the whoosh back to the Cave
  if (!S.myName) return;
  travelHome(() => remove(ref(db, 'tables/presence/' + myId)));
}
leaveBtn.addEventListener('click', leaveRoom);


// ---------- Entering the room ----------
const nameBox = document.getElementById('nameBox');
const nameInput = document.getElementById('nameInput');
try { nameInput.value = localStorage.getItem('hangoutName') || ''; } catch (e) {}

function enterRoom() {
  const name = nameInput.value.trim().slice(0, 20);
  if (!name) { nameInput.focus(); return; }
  S.myName = name;
  try { localStorage.setItem('hangoutName', name); } catch (e) {}
  nameBox.style.display = 'none';

  // Say we're here, and have the room remove us automatically if we close the tab or lose connection
  const meRef = ref(db, 'tables/presence/' + myId);
  onValue(ref(db, '.info/connected'), s => {
    if (s.val() === true) {
      onDisconnect(meRef).remove();
      get(ref(db, 'tables/presence')).then(ps => {
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
  onValue(ref(db, 'tables/presence'), s => {
    const next = s.val() || {};
    if (!firstPresence) logJoinsLeaves(S.presence, next);   // the first list is just who's already here
    firstPresence = false;
    S.presence = next;
    refreshAll();
  });

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
const HINT_WALK = PHONE ? 'Drag to look · tap the floor to walk' : 'Drag to look · click the floor to walk (or W A S D)';
hint.textContent = HINT_WALK;
const LIMIT = R2 - 0.5;                       // how close to the walls you can walk
const me = { x: 1.6 + (Math.random() - 0.5) * 1.2, z: R2 - 1.4, tx: null, tz: null };   // you start just inside the door
let yaw = 0, pitch = -0.12;                   // facing the table
function clampSpot(x, z) {   // inside the walls, and not in the table
  x = Math.max(-LIMIT, Math.min(LIMIT, x)); z = Math.max(-LIMIT, Math.min(LIMIT, z));
  const dz = z - TABLE_Z, d = Math.hypot(x, dz);
  if (d < TABLE_KEEP) return d > 0.001 ? [x * TABLE_KEEP / d, TABLE_Z + dz * TABLE_KEEP / d] : [0, TABLE_Z + TABLE_KEEP];
  return [x, z];
}
function mySpot() {   // what everyone else sees: where you're standing (or walking to)
  const x = me.tx != null ? me.tx : me.x, z = me.tz != null ? me.tz : me.z;
  return { x: +x.toFixed(2), z: +z.toFixed(2) };
}
let sentAt = 0, sendTimer = 0;
function sendSpot(now) {   // tell everyone where you're going (a few times a second at most)
  if (!S.myName) return;
  clearTimeout(sendTimer); sendTimer = 0;
  if (!now && performance.now() - sentAt < 250) { sendTimer = setTimeout(() => sendSpot(true), 250); return; }
  sentAt = performance.now();
  update(ref(db, 'tables/presence/' + myId), mySpot()).catch(() => {});
}
function walkTo(x, z) {
  [me.tx, me.tz] = clampSpot(x, z);
  marker.position.set(me.tx, 0.024, me.tz);   // (above the rug, too)
  marker.visible = true; markerFade = 1;
  sendSpot(true);
}
function setFov(f) {
  camera.fov = Math.max(20, Math.min(BASE_FOV, f));
  camera.updateProjectionMatrix();
}
camera.position.set(me.x, EYE, me.z);
camera.rotation.set(pitch, yaw, 0);

// A soft gold ring on the floor showing where you'll walk
const marker = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.22, 40),
  new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
scene.add(marker);
let markerFade = 0;

// ---------- Keys ----------
const keys = new Set();
function typing() { const a = document.activeElement; return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')); }
function resetView() {   // R: look straight ahead again and zoom back out
  setFov(BASE_FOV);
  pitch = -0.12;
}
window.addEventListener('keydown', e => {
  if (typing() || !S.myName) return;
  if (e.key.toLowerCase() === 'r' && !intro) { resetView(); return; }
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    keys.add(k);
    if (k.startsWith('arrow')) e.preventDefault();   // don't scroll the page
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
function keyWalk(dt) {   // W/S or up/down walk, A/D step sideways, left/right turn
  if (!keys.size || typing()) return;
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
  e.preventDefault();
  setFov(camera.fov + e.deltaY * 0.03);
}, { passive: false });

// ---------- Mouse / touch ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let down = null;
let lastX = 0, lastY = 0;
function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
function aim(e) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
function pickUnder(e) {   // the first real thing under the pointer (not the light's glow, the marker or other people)
  aim(e);
  const hit = raycaster.intersectObjects(scene.children, true).find(h => shown(h.object) && !h.object.userData.avatar
    && h.object !== marker && !(h.object.material && h.object.material.blending === THREE.AdditiveBlending));
  if (!hit) return null;
  const u = hit.object.userData;
  if (u.door) return { door: true };
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
    if (d > 0) setFov(camera.fov * pinchDist / d);
    pinchDist = d;
    return;
  }
  if (down && !intro) {   // drag to look around: the view follows the mouse (drag right to turn right, up to look up)
    const k = 0.004 * (camera.fov / BASE_FOV);   // slower when zoomed in
    yaw -= (e.clientX - lastX) * k;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - lastY) * k));
  }
  lastX = e.clientX; lastY = e.clientY;
  if (!down && e.target === canvas && !PHONE) {   // show where a click would take you
    canvas.style.cursor = pickUnder(e) ? 'pointer' : 'grab';
  }
});
window.addEventListener('pointerup', e => {
  const wasTap = down && e.target === canvas && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
  down = null;
  endTouch(e);
  if (!wasTap || intro || !S.myName) return;
  const p = pickUnder(e);
  if (!p) return;
  if (p.door) leaveRoom();
  else if (p.floor) walkTo(p.floor.x, p.floor.z);
});

// ---------- The glow ----------
// Only things marked to glow (the table's rubies) bleed a soft halo of their own color; nothing else does. Each frame is
// drawn twice: once with everything but the glowing things blacked out (that becomes the halo), then normally, with
// the halo laid over it. (On phones the room is simply drawn, without the halo, to keep it smooth.)
const glowOnly = new THREE.Layers(); glowOnly.set(GLOW);
let render = () => renderer.render(scene, camera), sizeGlow = () => {};
if (!PHONE) {
  const target = () => new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  const glowComposer = new EffectComposer(renderer, target());
  glowComposer.renderToScreen = false;
  glowComposer.addPass(new RenderPass(scene, camera));
  glowComposer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.15, 0));
  const finalComposer = new EffectComposer(renderer, target());
  finalComposer.addPass(new RenderPass(scene, camera));
  const mix = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: { baseTexture: { value: null }, glowTexture: { value: glowComposer.renderTarget2.texture } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D baseTexture, glowTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D(baseTexture, vUv) + texture2D(glowTexture, vUv); }'
  }), 'baseTexture');
  mix.needsSwap = true;
  finalComposer.addPass(mix);
  finalComposer.addPass(new OutputPass());
  const blackout = new THREE.MeshBasicMaterial({ color: 0x000000 }), swapped = new Map(), hidden = [];
  // (anything with see-through parts, like the doorway cut out of the door picture, is blacked out only where it's solid,
  // so the glow still shows through its open parts; one black copy is made for each such material, and kept)
  const cutouts = new Map();
  const blackFor = m => {
    if (Array.isArray(m) || !(m.transparent || m.alphaTest > 0)) return blackout;
    let b = cutouts.get(m);
    if (!b) cutouts.set(m, b = new THREE.MeshBasicMaterial({ color: 0x000000 }));
    if (b.map !== (m.map || null) || b.alphaMap !== (m.alphaMap || null)) {   // (its picture may arrive after the room opens)
      b.map = m.map || null; b.alphaMap = m.alphaMap || null; b.needsUpdate = true;
    }
    b.alphaTest = m.alphaTest || 0; b.transparent = m.transparent; b.opacity = m.opacity; b.side = m.side; b.depthWrite = m.depthWrite;
    return b;
  };
  render = () => {
    scene.traverse(o => {
      if (o.layers.test(glowOnly)) return;
      if (o.isMesh) { swapped.set(o, o.material); o.material = blackFor(o.material); }   // (still hides what's behind it)
      else if ((o.isSprite || o.isPoints || o.isLine) && o.visible) { hidden.push(o); o.visible = false; }   // (name tags)
    });
    const bg = scene.background; scene.background = null;
    glowComposer.render();
    scene.background = bg;
    for (const [o, m] of swapped) o.material = m;
    for (const o of hidden) o.visible = true;
    swapped.clear(); hidden.length = 0;
    finalComposer.render();
  };
  sizeGlow = () => { glowComposer.setSize(window.innerWidth, window.innerHeight); finalComposer.setSize(window.innerWidth, window.innerHeight); };
  sizeGlow();
}

// ---------- Window resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  sizeGlow();
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  entrance.update(dt);       // the doors on their springs
  if (intro) playIntro(dt);   // walking in through the door
  else {
    keyWalk(dt);
    if (me.tx != null) {   // walking to where you clicked
      const dx = me.tx - me.x, dz = me.tz - me.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, WALK * dt);
      if (d > 0.001) { me.x += dx / d * step; me.z += dz / d * step; }
      if (d - step < 0.001) { me.x = me.tx; me.z = me.tz; me.tx = me.tz = null; }
    }
    camera.position.set(me.x, EYE, me.z);
    camera.rotation.set(pitch, yaw, 0);
  }
  if (marker.visible && me.tx == null) {   // the ring fades once you get there
    markerFade -= dt * 2.5;
    marker.material.opacity = Math.max(0, markerFade) * 0.8;
    if (markerFade <= 0) marker.visible = false;
  } else if (marker.visible) marker.material.opacity = 0.8;
  moveAvatars(dt);
  gameTable.update(clock.elapsedTime);   // (the rubies' glow slowly breathing)
  for (const c of chairs) c.update(clock.elapsedTime);
  lantern.update(clock.elapsedTime);
  wallClock.update();
  render();
});

// ---------- Coming in: the room gets ready behind the Cave (which is black by now), then you walk in through the door ----------
// The pictures and the first data load, the reflections are taken and everything is drawn once, all while the screen
// is black, so any stutter happens where nobody can see it. Then the Cave fades away and the walk in begins.
const wait = ms => new Promise(r => setTimeout(r, ms));
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : window.requestAnimationFrame(f)); window.requestAnimationFrame(f); });
let intro = { t: -1 };                                // -1 until the Cave says go
const OUTSIDE = new THREE.Vector3(DOOR_X, EYE, R2 + 2.6);   // a few steps back, looking at the front of the building
function easeIO(k) { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); }
function playIntro(dt) {                              // the camera and the doors, moment by moment
  if (intro.t >= 0) intro.t += dt;
  const t = Math.max(0, intro.t);
  if (t >= 0.8 && !intro.opened) { intro.opened = true; entrance.open(); }    // the doors swing open...
  if (t >= 3.4 && !intro.closed) { intro.closed = true; entrance.close(); }   // ...and shut behind you
  const k = easeIO((t - 1.2) / 2.3);                  // the walk: through the doorway, then over to your spot
  const z = OUTSIDE.z + (me.z - OUTSIDE.z) * k;
  const past = Math.max(0, Math.min(1, (R2 - 0.2 - z) / (R2 - 0.2 - me.z)));   // only drift sideways once you're inside
  camera.position.set(DOOR_X + (me.x - DOOR_X) * past, EYE, z);
  camera.rotation.set(-0.02 + (pitch + 0.02) * k, 0, 0);
  if (t > 4.3) { intro = null; camera.position.set(me.x, EYE, me.z); camera.rotation.set(pitch, yaw, 0); }
}
// (testing on this PC with ?room=table: straight in, no walk through the door)
const SKIP_DOOR = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && new URLSearchParams(location.search).get('room') === 'table';
window.addEventListener('room-show', () => {
  if (SKIP_DOOR) { intro = null; camera.position.set(me.x, EYE, me.z); camera.rotation.set(pitch, yaw, 0); return; }
  if (intro) intro.t = 0;
});
camera.position.copy(OUTSIDE); camera.rotation.set(-0.02, 0, 0);
(async () => {
  await Promise.race([Promise.all([tableLoaded, floorLoaded, wallLoaded, entrance.loaded]), wait(8000)]);   // a slow connection doesn't keep you out forever
  await wait(300);                                    // the reflection snapshot is taken just after the pictures land
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  await frames(3);
  window.dispatchEvent(new Event('room-ready'));
})();