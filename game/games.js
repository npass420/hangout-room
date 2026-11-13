// =====================================================================
// games.js — the Game Room: a big neon arcade hall behind the Frog King's door. Neon walls (neonwall.jpg), a floor of
// puffy midnight blue glitter velvet cushions (cushion.jpg) with glowing seams that squish under your feet, neon tubes
// along the top of every wall, and a nebula (ceiling.jpg) drifting overhead in shifting layers. Two skee-ball machines
// stand on the right (skeeball.js); bowling down the left side and pool in the middle come next, their spots marked out on the floor.
// You walk in through the frog's doors (gdoor.jpg, a Kindroid picture). Clicking them twice whooshes you back to the Cave.
// It's a bounce house, so here (and only here) you can jump (Space) and sprint (Shift); everyone sees you bounce.
// =====================================================================
import * as THREE from 'three';
import { ref, set, get, update, remove, push, onValue, onDisconnect,
         query, orderByChild, startAt, endAt, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, EYE, renderer, scene, camera, canvas, BASE_FOV,
         std, goldMat, easeInOut, RAINBOW, RAINBOW_CSS, colorIndex, makeLabel, PHONE } from '../core.js';
import { sfx, setupMute } from '../sounds.js';
import { travelHome } from '../portal.js';
import { makeEntrance, doorSpan } from '../entrance.js';
import { makeClock } from '../clock.js';
import { inRoom } from '../world.js';
import { makeSkee } from './skeeball.js';

document.querySelector('#ui h1').textContent = 'Game Room';
document.title = 'Game Room';

// ---------- The size of the hall ----------
const HX = 9, HZ = 11, RH = 5;          // half its width, half its length, and its height (meters)
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
const PINK = new THREE.Color(0xff3fa8), TEAL = new THREE.Color(0x29e6ff);

// ---------- The way in: the Frog King's doors, traced from their picture (their left side, bottom corner to top middle) ----------
const DOOR_X = 2;
const ENTRANCE = { style: 'frog', file: new URL('gdoor.jpg', import.meta.url).href, x: DOOR_X, z: HZ, height: 2.6, roomHalf: HX, roomHeight: RH,
  door: { points: [[0.300, 0.887], [0.287, 0.82], [0.280, 0.75], [0.281, 0.65], [0.290, 0.55], [0.303, 0.50], [0.333, 0.45],
                   [0.373, 0.423], [0.430, 0.413], [0.500, 0.410]] } };

// ---------- The walls: the neon wall picture, all the way round, glowing in the dark ----------
function loadTex(file, setup) {   // a promise that's done once the picture is on, or has failed
  return new Promise(done => {
    new THREE.TextureLoader().load(new URL(file, import.meta.url).href, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; setup(t); done(); },
      undefined, () => { console.warn(file + ' did not load'); done(); });
  });
}
function plane(w, h, mat, x, y, z, rx, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
  scene.add(m);
  return m;
}
const wallMats = [];
for (const [len, x, z, ry] of [[HX * 2, 0, -HZ, 0], [HX * 2, 0, HZ, Math.PI], [HZ * 2, -HX, 0, Math.PI / 2], [HZ * 2, HX, 0, -Math.PI / 2]]) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1f45, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
  mat.userData.len = len;
  wallMats.push(mat);
  plane(len, RH, mat, x, RH / 2, z, 0, ry);
}
const WALL_ASPECT = 1 / 0.785;   // the picture is this many times wider than it is tall
const wallLoaded = loadTex('neonwall.jpg', t => {
  for (const m of wallMats) {   // one copy of the picture is a wall's height tall; side by side, every other one flipped
    const tex = t.clone(); tex.needsUpdate = true;
    tex.wrapS = THREE.MirroredRepeatWrapping;
    tex.repeat.set(m.userData.len / (RH * WALL_ASPECT), 1);
    m.map = tex; m.emissiveMap = tex; m.color.setHex(0xffffff); m.emissiveIntensity = 0.55; m.needsUpdate = true;
  }
});

// ---------- The ceiling: a nebula (ceiling.jpg) drifting overhead in layers ----------
// Three copies of the picture at different sizes turn slowly in different directions and slide over each other, one
// tinted pink and one teal, so the clouds are always shifting and overlapping. Stars twinkle across the whole ceiling.
const skyU = { uMap: { value: null }, uTime: { value: 0 } };
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyU,
  vertexShader: `varying vec2 vP;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform sampler2D uMap; uniform float uTime; varying vec2 vP;
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 layer(vec2 p, float size, float turn, vec2 drift) {   // one copy of the nebula, turned and slid
      float c = cos(turn), s = sin(turn);
      vec2 q = mat2(c, -s, s, c) * (p - drift) / size + 0.5;
      if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec3(0.0);
      return texture2D(uMap, q).rgb;
    }
    void main() {
      float t = uTime;
      vec3 col = layer(vP, 15.0, t * 0.012, vec2(sin(t * 0.021), cos(t * 0.017)) * 1.5);
      col += layer(vP, 24.0, -t * 0.008 + 2.1, vec2(cos(t * 0.013), sin(t * 0.019)) * 2.5) * vec3(1.0, 0.45, 0.85) * 0.75;
      col += layer(vP, 11.0, t * 0.006 + 4.0, vec2(sin(t * 0.011 + 1.0), cos(t * 0.015)) * 3.5) * vec3(0.35, 0.95, 1.0) * 0.6;
      vec2 g = vP * 3.0, id = floor(g);   // the stars
      float h = hash2(id);
      if (h > 0.9) {
        float d = length(fract(g) - 0.5 - (vec2(hash2(id + 3.1), hash2(id + 7.7)) - 0.5) * 0.6);
        float tw = 0.45 + 0.55 * sin(t * (0.8 + h * 2.5) + h * 60.0);
        col += vec3(0.85, 0.9, 1.0) * smoothstep(0.06, 0.0, d) * tw * (0.5 + 2.0 * (h - 0.9) * 10.0 * 0.1);
      }
      gl_FragColor = vec4(col * 0.9, 1.0);
    }`
});
plane(HX * 2, HZ * 2, skyMat, 0, RH, 0, Math.PI / 2, 0);
const skyLoaded = loadTex('ceiling.jpg', t => { skyU.uMap.value = t; });
// The nebula's glow on the room: a soft light under the ceiling that slowly shifts between violet, pink and teal
const skyGlow = new THREE.PointLight(0x9a6bff, 6, 16, 1.4);
skyGlow.position.set(0, RH - 0.8, -2);
scene.add(skyGlow);
const SKY_HUES = [new THREE.Color(0x8a6bff), PINK, TEAL];

// ---------- Neon tubes along the top of every wall, pink on the long walls and teal on the short ones ----------
const GLOW = [[1, 1.0], [2.4, 0.4], [5, 0.15], [10, 0.05]];   // [size, opacity]: a bright core with layers of glow around it
function neonTube(len, col, x, y, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, y, z); g.rotation.y = ry;
  const hot = col.clone().lerp(new THREE.Color(0xffffff), 0.35);
  for (const [k, op] of GLOW) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * k, 0.012 * k, len, 10),
      new THREE.MeshBasicMaterial({ color: k === 1 ? hot : col, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.rotation.z = Math.PI / 2;
    g.add(m);
  }
  scene.add(g);
}
neonTube(HX * 2 - 0.2, PINK, 0, RH - 0.12, -HZ + 0.08, 0);
neonTube(HX * 2 - 0.2, PINK, 0, RH - 0.12, HZ - 0.08, 0);
neonTube(HZ * 2 - 0.2, TEAL, -HX + 0.08, RH - 0.12, 0, Math.PI / 2);
neonTube(HZ * 2 - 0.2, TEAL, HX - 0.08, RH - 0.12, 0, Math.PI / 2);

// ---------- Lights: dim blue all round, and colored lights along the ceiling so the velvet catches pink and teal ----------
scene.add(new THREE.HemisphereLight(0x5a66ff, 0x120a24, 0.55));
for (let i = 0; i < 6; i++) {
  const col = i % 2 ? TEAL : PINK, l = new THREE.PointLight(col, 9, 11, 1.6);
  l.position.set(i < 3 ? -4.5 : 4.5, RH - 0.6, -7 + (i % 3) * 7);
  scene.add(l);
}

// ---------- The floor: puffy velvet cushions with glowing seams ----------
// Every cushion is a real bump, so the room's lights roll over it. The velvet is your picture (cushion.jpg); the glitter
// is drawn on top, evenly everywhere and twinkling as you move; the seams between cushions glow; and the floor sinks a
// little under everyone's feet.
const TILE = 1.2, PUFF = 0.17;   // a cushion's size, and how high it puffs up
function doorFlat(x, z) {        // flat in front of the doors, so they can swing open over the floor
  return Math.max(0, Math.min(1, (Math.hypot(x - DOOR_X, z - HZ) - doorSpan(ENTRANCE) + 0.25) / 0.6));
}
const floorGeo = (() => {
  const per = PHONE ? 6 : 12, nx = Math.round(HX * 2 / TILE * per), nz = Math.round(HZ * 2 / TILE * per);
  const g = new THREE.PlaneGeometry(HX * 2, HZ * 2, nx, nz);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const fx = ((p.getX(i) / TILE) % 1 + 1) % 1, fz = ((p.getZ(i) / TILE) % 1 + 1) % 1;
    const wall = Math.min(1, (HX - Math.abs(p.getX(i))) / 0.15, (HZ - Math.abs(p.getZ(i))) / 0.15, doorFlat(p.getX(i), p.getZ(i)));   // flat where it meets the walls
    p.setY(i, PUFF * wall * Math.pow(Math.sin(Math.PI * fx) * Math.sin(Math.PI * fz), 0.55));   // round and full, pulled down at the seams
  }
  g.computeVertexNormals();
  return g;
})();
const floorMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.85, sheen: 1, sheenRoughness: 0.45, sheenColor: 0x8fa2ff });
const FEET = 8;
const floorU = { uTime: { value: 0 }, uFeet: { value: Array.from({ length: FEET }, () => new THREE.Vector4(0, 0, 0, 0)) } };
floorMat.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, floorU);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      uniform vec4 uFeet[${FEET}];
      varying vec3 vWPos;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      for (int i = 0; i < ${FEET}; i++) {   // sinking in under each pair of feet
        vec2 d = transformed.xz - uFeet[i].xy;
        transformed.y -= uFeet[i].z * exp(-dot(d, d) / 0.12);
      }
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uTime;
      varying vec3 vWPos;
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
    .replace('#include <opaque_fragment>', `#include <opaque_fragment>
      {
        float far = length(cameraPosition - vWPos);
        // The glitter: a tiny fleck in some of the cells of a very fine grid, each tilted its own way, so it flashes
        // when it lines up with your eye and the light
        vec2 g = vWPos.xz * 150.0, id = floor(g);
        float h = hash2(id), h2 = hash2(id + 17.3);
        if (h > 0.82) {
          vec2 at = fract(g) - 0.5 - (vec2(h2, fract(h * 13.7)) - 0.5) * 0.5;
          float fleck = smoothstep(0.28, 0.0, length(at));
          vec3 tilt = normalize(vec3(h2 - 0.5, 1.3, fract(h * 7.1) - 0.5));
          float flash = pow(max(0.0, sin(dot(normalize(cameraPosition - vWPos), tilt) * 46.0 + h * 40.0 + uTime * 0.6)), 14.0);
          vec3 col = mix(vec3(0.82, 0.88, 1.0), vec3(1.0, 0.86, 0.58), step(0.62, h2));   // silver, some pale gold
          gl_FragColor.rgb += col * fleck * (0.12 + 1.8 * flash) * smoothstep(10.0, 1.5, far);
        }
        // The seams between cushions: thin glowing lines, teal one way and pink the other
        vec2 c = vWPos.xz / ${TILE.toFixed(2)};
        vec2 e = abs(fract(c) - 0.5);
        float w = 0.5 - 0.012 / ${TILE.toFixed(2)} - fwidth(c.x) * 0.5;
        float seamX = smoothstep(w, 0.5, e.x), seamZ = smoothstep(w, 0.5, e.y);
        gl_FragColor.rgb += vec3(0.16, 0.9, 1.0) * seamX * 0.65 + vec3(1.0, 0.25, 0.66) * seamZ * 0.65;
      }`);
};
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.userData.floor = true;
scene.add(floor);
const floorLoaded = loadTex('cushion.jpg', t => {
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.repeat.set(HX * 2 / 2.4, HZ * 2 / 2.4);   // one copy of the velvet covers two cushions each way
  floorMat.map = t; floorMat.needsUpdate = true;
});
function floorHeight(x, z) {   // how high the cushions are at a spot (for standing on them)
  const fx = ((x / TILE) % 1 + 1) % 1, fz = ((z / TILE) % 1 + 1) % 1;
  return PUFF * doorFlat(x, z) * Math.pow(Math.sin(Math.PI * fx) * Math.sin(Math.PI * fz), 0.55);
}

// ---------- Where the games will go: glowing outlines on the floor, with a name floating over each ----------
const ZONES = [
  { name: 'Bowling', x0: -8.6, x1: -5.0, z0: -10.6, z1: 6.5, col: PINK },
  { name: 'Pool', x0: -2.6, x1: 2.6, z0: -8.0, z1: -3.0, col: TEAL },
  { name: 'Pool', x0: -2.6, x1: 2.6, z0: -1.5, z1: 3.5, col: TEAL }
];
for (const zn of ZONES) {
  const mat = new THREE.MeshBasicMaterial({ color: zn.col, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const y = PUFF + 0.03, t = 0.05, w = zn.x1 - zn.x0, d = zn.z1 - zn.z0, cx = (zn.x0 + zn.x1) / 2, cz = (zn.z0 + zn.z1) / 2;
  for (const [sx, sz, px, pz] of [[w, t, cx, zn.z0], [w, t, cx, zn.z1], [t, d, zn.x0, cz], [t, d, zn.x1, cz]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(px, y, pz);
    scene.add(m);
  }
  const label = makeLabel(zn.name + ' · coming soon', '#' + zn.col.getHexString());
  label.position.set(cx, 2.2, cz);
  label.scale.multiplyScalar(1.6);
  scene.add(label);
}

// ---------- The way in: the front of the building outside, and its doors (click them twice to leave) ----------
// You come in through them: the room fades in with you a few steps outside, the doors swing open, you walk in and they
// shut behind you. Outside, everything but the picture is dark, so the room only shows through the doorway.
const entrance = makeEntrance(ENTRANCE);

// ---------- Skee-ball: two machines on the right (click one to play; while you play, the machine has the mouse) ----------
const skee = makeSkee({
  banner: (text, secs) => showBanner(text, secs),
  enter(x, z) { me.tx = me.tz = null; marker.visible = false; me.x = x; me.z = z; sendSpot(true); },   // you're standing at the machine
  leave(x, z, y, p) { [me.x, me.z] = clampSpot(x, z); yaw = y; pitch = p; sendSpot(true); }             // back to walking, from right there
});

// ---------- A round window by the door, onto the sky outside (it follows your own clock), and a neon clock over it ----------
// (Quick ones for now; they'll get their proper look later.)
const portCanvas = document.createElement('canvas');
portCanvas.width = portCanvas.height = 256;
const portTex = new THREE.CanvasTexture(portCanvas);
portTex.colorSpace = THREE.SRGBColorSpace;
const PORT_STARS = Array.from({ length: 70 }, () => [Math.random(), Math.random(), Math.random()]);
const PORT_SKY = {
  night: ['#040818', '#0d1d45'], dawn: ['#2b4f8f', '#ff9e6b'], day: ['#3d8fe0', '#a9d8ff'], dusk: ['#3a2a6b', '#ff7a45']
};
let portMinute = -1;
function updatePort() {
  const now = new Date(), minute = now.getHours() * 60 + now.getMinutes();
  if (minute === portMinute) return;   // once a minute is plenty
  portMinute = minute;
  const h = minute / 60, phase = (h < 5 || h >= 21) ? 'night' : h < 7 ? 'dawn' : h < 17.5 ? 'day' : 'dusk';
  const g = portCanvas.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, PORT_SKY[phase][0]); grd.addColorStop(1, PORT_SKY[phase][1]);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  if (phase === 'night') {
    g.fillStyle = '#ffffff';
    for (const [x, y, b] of PORT_STARS) { g.globalAlpha = 0.3 + b * 0.7; g.fillRect(x * 256, y * 200, 1 + b * 1.6, 1 + b * 1.6); }
    g.globalAlpha = 1;
  }
  portTex.needsUpdate = true;
}
updatePort();
{
  const g = new THREE.Group();
  g.position.set(-3, 2.1, HZ - 0.03); g.rotation.y = Math.PI;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.62, 48), new THREE.MeshBasicMaterial({ map: portTex, toneMapped: false }));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.67, 0.08, 18, 64),
    new THREE.MeshPhysicalMaterial({ color: 0xff8da0, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.12, emissive: 0xff3f8a, emissiveIntensity: 0.25 }));
  rim.scale.z = 0.7;
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.74, 0.86, 64),
    new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  halo.position.z = -0.01;
  g.add(glass, rim, halo);
  for (let i = 0; i < 8; i++) {   // little gold bolts round the rim
    const a = i / 8 * Math.PI * 2, b = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), goldMat);
    b.position.set(Math.cos(a) * 0.67, Math.sin(a) * 0.67, 0.07);
    g.add(b);
  }
  scene.add(g);
}
const wallClock = makeClock({ lit: '#3ff0ff', dim: '#0c2630', back: '#04050d', width: 1.15,
  frame: new THREE.MeshStandardMaterial({ color: 0x14102a, roughness: 0.5 }), glow: 'rgba(41,230,255,0.4)' });
wallClock.group.position.set(-3, 3.45, HZ - 0.04);
wallClock.group.rotation.y = Math.PI;
scene.add(wallClock.group);

// ---------- Other people: a standing snowman with a name tag, gliding to wherever they walk ----------
const WALK = 2.6;     // walking speed, meters a second (a big room)
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
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01;
  g.add(shadow);
  const mat = std(new THREE.Color(RAINBOW[c]), 0.75);
  for (const [r, y] of [[0.28, 0.28], [0.21, 0.74], [0.15, 1.1]]) {   // three stacked snowballs: big bottom, middle, small head
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat);
    b.position.y = y;
    g.add(b);
  }
  const label = makeLabel(name, RAINBOW_CSS[c]);
  label.position.y = 1.47;
  g.add(label);
  g.traverse(o => { o.userData.avatar = true; });
  scene.add(g);
  return { g, name, c };
}
const LIM_X = HX - 0.5, LIM_Z = HZ - 0.5;   // how close to the walls anyone can walk
function clampSpot(x, z) { return [Math.max(-LIM_X, Math.min(LIM_X, x)), Math.max(-LIM_Z, Math.min(LIM_Z, z))]; }
function spotOf(p) {   // where someone is standing (kept inside the room)
  const x = Number.isFinite(p.x) ? p.x : DOOR_X, z = Number.isFinite(p.z) ? p.z : HZ - 1.6;
  const [cx, cz] = clampSpot(x, z);
  return { x: cx, z: cz };
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
    if (!fresh && p.j && p.j !== a.j) a.jumpT = performance.now();   // they just jumped
    a.j = p.j;
    if (fresh) a.g.position.set(to.x, 0, to.z);   // someone new just appears where they are
  }
}
function moveAvatars(dt, t) {   // everyone else bounces along toward where they're walking
  for (const a of Object.values(avatars)) {
    const p = a.g.position, dx = a.tx - p.x, dz = a.tz - p.z, d = Math.hypot(dx, dz);
    if (d > 0.001) {
      const step = Math.min(d, WALK * (d > 1 ? 2 : 1) * dt);   // keeping up when they sprint
      p.x += dx / d * step; p.z += dz / d * step;
      a.phase = (a.phase || 0) + step * 5;
    }
    a.air = jumpHeight((performance.now() - (a.jumpT || 0)) / 1000);
    p.y = floorHeight(p.x, p.z) - 0.04 + (d > 0.001 ? Math.abs(Math.sin(a.phase)) * 0.12 : 0) + a.air;   // a little hop as they go
  }
}
function jumpHeight(t) {   // how high a jump is, t seconds after leaving the floor (the same arc as your own)
  return t > 0 && t < JUMP_TIME ? JUMP_UP * t - GRAVITY / 2 * t * t : 0;
}
function pressFeet() {   // where the floor sinks in: under you and under everyone else (deeper just after landing, none in the air)
  const feet = floorU.uFeet.value;
  let i = 0;
  if (!intro) feet[i++].set(me.x, me.z, me.air > 0.02 ? 0 : 0.05 + me.land * 0.12, 0);
  for (const a of Object.values(avatars)) {
    if (i >= FEET) break;
    const since = (performance.now() - (a.jumpT || 0)) / 1000 - JUMP_TIME;   // seconds since they landed
    feet[i++].set(a.g.position.x, a.g.position.z, a.air > 0.02 ? 0 : 0.06 + (since > 0 && since < 0.4 ? (0.4 - since) * 0.3 : 0), 0);
  }
  for (; i < FEET; i++) feet[i].z = 0;
}

// ---------- Who's online: everyone, in every room and the Cave, each with an icon for where they are (world.js) ----------
const connEl = document.getElementById('conn');
const whoBtn = document.getElementById('whoBtn');
inRoom('game');

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

// ---------- Big on-screen messages ----------
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
  skee.leave();
  travelHome(() => remove(ref(db, 'game/presence/' + myId)));
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
  const meRef = ref(db, 'game/presence/' + myId);
  onValue(ref(db, '.info/connected'), s => {
    if (s.val() === true) {
      onDisconnect(meRef).remove();
      get(ref(db, 'game/presence')).then(ps => {
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
  onValue(ref(db, 'game/presence'), s => {
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
hint.textContent = PHONE ? 'Drag to look · tap the floor to walk, double tap to run · ⤒ to jump'
                         : 'Drag to look · click the floor to walk, double click to run (or W A S D) · Space to jump · Shift to sprint';
const me = { x: DOOR_X + (Math.random() - 0.5) * 1.2, z: HZ - 1.6, tx: null, tz: null, phase: 0, moving: 0,   // you start just inside the door
  run: false, air: 0, vy: 0, land: 0 };
// Jumping: a big floaty bounce off the cushions
const JUMP_UP = 4.2, GRAVITY = 7, JUMP_TIME = 2 * JUMP_UP / GRAVITY;   // how fast you leave the floor, how hard you fall, how long you're up
function jump() {
  if (intro || !S.myName || me.air > 0 || me.vy || skee.playing) return;
  me.vy = JUMP_UP;
  sfx.bounce();
  if (S.myName) update(ref(db, 'game/presence/' + myId), { j: Date.now() }).catch(() => {});   // so everyone sees you hop
}
function fall(dt) {   // up, over and back down onto the cushions
  if (me.vy || me.air > 0) {
    me.vy -= GRAVITY * dt; me.air += me.vy * dt;
    if (me.air <= 0) { me.air = 0; me.vy = 0; me.land = 1; sfx.land(); }
  }
  me.land = Math.max(0, me.land - dt * 3);
}
if (PHONE) {   // a jump button for phones, bottom left
  const b = document.createElement('button');
  b.textContent = '⤒';
  b.style.cssText = 'position:fixed;left:14px;bottom:84px;width:58px;height:58px;border-radius:50%;font-size:26px;z-index:20;' +
    'background:rgba(41,230,255,0.25);color:#e8fbff;border:2px solid rgba(41,230,255,0.7);box-shadow:0 0 14px rgba(41,230,255,0.5)';
  b.addEventListener('pointerdown', e => { e.preventDefault(); jump(); });
  document.body.appendChild(b);
}
let yaw = 0, pitch = -0.08;                   // facing down the hall
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
  update(ref(db, 'game/presence/' + myId), mySpot()).catch(() => {});
}
function walkTo(x, z, run) {
  me.run = !!run;
  [me.tx, me.tz] = clampSpot(x, z);
  marker.position.set(me.tx, floorHeight(me.tx, me.tz) + 0.02, me.tz);
  marker.visible = true; markerFade = 1;
  sendSpot(true);
}
function setFov(f) {
  camera.fov = Math.max(20, Math.min(BASE_FOV, f));
  camera.updateProjectionMatrix();
}
function eyeHeight() {   // standing on the cushions, with a little bounce in your step while you walk (more when running)
  const fast = me.run || keys.has('shift') ? 2 : 1;
  return EYE + floorHeight(me.x, me.z) * 0.5 + Math.abs(Math.sin(me.phase)) * 0.05 * fast * me.moving + me.air - me.land * 0.06;
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
window.addEventListener('keydown', e => {
  if (typing() || !S.myName) return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift'].includes(k)) {
    keys.add(k);
    if (k.startsWith('arrow') || k === ' ') e.preventDefault();   // don't scroll the page
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
function keyWalk(dt) {   // W/S or up/down walk, A/D step sideways, left/right turn; returns how far you went
  if (!keys.size || typing()) return 0;
  const speed = WALK * (keys.has('shift') ? 2 : 1);   // Shift: sprint
  if (keys.has('arrowleft')) yaw += 1.8 * dt;
  if (keys.has('arrowright')) yaw -= 1.8 * dt;
  const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const sdir = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  if (!f && !sdir) return 0;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // the way you're facing, flat on the floor
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // to your right
  let mx = fx * f + rx * sdir, mz = fz * f + rz * sdir;
  const len = Math.hypot(mx, mz);
  mx /= len; mz /= len;
  me.tx = me.tz = null; marker.visible = false;
  [me.x, me.z] = clampSpot(me.x + mx * speed * dt, me.z + mz * speed * dt);
  sendSpot(false);
  return speed * dt;
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
function pickUnder(e) {   // the first real thing under the pointer (not the neon glow, the marker or other people)
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(scene.children, true).find(h => shown(h.object) && !h.object.userData.avatar
    && h.object !== marker && !(h.object.material && h.object.material.blending === THREE.AdditiveBlending) && !h.object.isSprite);
  if (!hit) return null;
  const u = hit.object.userData;
  if (u.door) return { door: true };
  if (u.skee != null) return { skee: u.skee };
  if (u.floor) return { floor: hit.point };
  return null;
}
// Two-finger pinch zooms (phones)
const touchPts = new Map();
let pinchDist = 0;
function pinchSpread() { const [a, b] = [...touchPts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
canvas.addEventListener('pointerdown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  if (skee.playing) { skee.down(e); return; }   // pulling back a skee-ball
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPts.size === 2) { pinchDist = pinchSpread(); down = null; return; }   // a pinch, not a tap
  down = { x: e.clientX, y: e.clientY };
  lastX = e.clientX; lastY = e.clientY;
});
function endTouch(e) { touchPts.delete(e.pointerId); if (touchPts.size < 2) pinchDist = 0; }
window.addEventListener('pointercancel', e => { down = null; endTouch(e); });
window.addEventListener('pointermove', e => {
  if (skee.playing) { skee.move(e); return; }
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
    const p = pickUnder(e);
    canvas.style.cursor = p ? 'pointer' : 'grab';
  }
});
let lastTap = { t: 0, x: 0, y: 0 };
window.addEventListener('pointerup', e => {
  if (skee.playing) { skee.up(e); down = null; endTouch(e); return; }   // letting go: it rolls
  const wasTap = down && e.target === canvas && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
  down = null;
  endTouch(e);
  if (!wasTap || intro || !S.myName) return;
  const p = pickUnder(e);
  if (!p) return;
  if (p.door) leaveRoom();
  else if (p.skee != null) skee.start(p.skee);
  else if (p.floor) {   // a second tap close by and soon after: run there instead
    const again = performance.now() - lastTap.t < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40;
    walkTo(p.floor.x, p.floor.z, again);
    lastTap = { t: again ? 0 : performance.now(), x: e.clientX, y: e.clientY };
  }
});

// ---------- Window resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
  floorU.uTime.value = t; skyU.uTime.value = t;
  { const k = (t * 0.05) % 3, i = Math.floor(k); skyGlow.color.copy(SKY_HUES[i]).lerp(SKY_HUES[(i + 1) % 3], k - i); }
  entrance.update(dt);       // the doors on their springs
  wallClock.update(); updatePort();
  skee.update(dt);           // the balls, the orbs and the signs (and the camera, while you're playing)
  if (intro) playIntro(dt);   // walking in through the door
  else if (skee.playing) fall(dt);
  else {
    if (keys.has(' ')) jump();   // hold Space to keep bouncing
    fall(dt);
    let went = keyWalk(dt);
    if (me.tx != null) {   // walking (or running) to where you clicked
      const dx = me.tx - me.x, dz = me.tz - me.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, WALK * (me.run ? 2 : 1) * dt);
      if (d > 0.001) { me.x += dx / d * step; me.z += dz / d * step; went += step; }
      if (d - step < 0.001) { me.x = me.tx; me.z = me.tz; me.tx = me.tz = null; me.run = false; }
    }
    const step0 = Math.floor(me.phase / Math.PI);
    me.phase += went * 4.2;
    if (Math.floor(me.phase / Math.PI) !== step0 && me.air <= 0) sfx.pat();   // a tiny pat on the cushions with each step
    me.moving += ((went > 0 ? 1 : 0) - me.moving) * Math.min(1, dt * 8);   // the bounce eases in and out
    camera.position.set(me.x, eyeHeight(), me.z);
    camera.rotation.set(pitch, yaw, 0);
  }
  if (marker.visible && me.tx == null) {   // the ring fades once you get there
    markerFade -= dt * 2.5;
    marker.material.opacity = Math.max(0, markerFade) * 0.8;
    if (markerFade <= 0) marker.visible = false;
  } else if (marker.visible) marker.material.opacity = 0.8;
  moveAvatars(dt, t);
  pressFeet();
  if (!skee.render()) renderer.render(scene, camera);   // while you play skee-ball, it draws its own split screen
});

// ---------- Coming in: the room gets ready behind the Cave (which is black by now), then you walk in through the door ----------
// The pictures and the first data load and everything is drawn once, all while the screen is black, so any stutter
// happens where nobody can see it. Then the Cave fades away and the walk in begins.
const wait = ms => new Promise(r => setTimeout(r, ms));
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : window.requestAnimationFrame(f)); window.requestAnimationFrame(f); });
let intro = { t: -1 };                                // -1 until the Cave says go
const OUTSIDE = new THREE.Vector3(DOOR_X, EYE, HZ + 3.2);   // a few steps back, looking up at the Frog King
function easeIO(k) { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); }
function playIntro(dt) {                              // the camera and the doors, moment by moment
  if (intro.t >= 0) intro.t += dt;
  const t = Math.max(0, intro.t);
  if (t >= 0.9 && !intro.opened) { intro.opened = true; entrance.open(); }    // the doors swing open...
  if (t >= 3.6 && !intro.closed) { intro.closed = true; entrance.close(); }   // ...and shut behind you
  const k = easeIO((t - 1.3) / 2.4);                  // the walk: through the doorway, then over to your spot
  const z = OUTSIDE.z + (me.z - OUTSIDE.z) * k;
  const past = Math.max(0, Math.min(1, (HZ - 0.2 - z) / (HZ - 0.2 - me.z)));   // only drift sideways once you're inside
  camera.position.set(DOOR_X + (me.x - DOOR_X) * past, EYE + (eyeHeight() - EYE) * k, z);
  camera.rotation.set(0.04 + (pitch - 0.04) * k, 0, 0);
  if (t > 4.5) { intro = null; camera.position.set(me.x, eyeHeight(), me.z); camera.rotation.set(pitch, yaw, 0); }
}
window.addEventListener('room-show', () => { if (intro) intro.t = 0; });
camera.position.copy(OUTSIDE); camera.rotation.set(0.04, 0, 0);
(async () => {
  await Promise.race([Promise.all([wallLoaded, floorLoaded, skyLoaded, entrance.loaded, skee.loaded]), wait(8000)]);   // a slow connection doesn't keep you out forever
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  await frames(3);
  window.dispatchEvent(new Event('room-show') && new Event('room-ready'));
})();