// =====================================================================
// skeeball.js — two skee-ball machines side by side against the back wall of the Game Room, on the right.
// Low Tetris side bars along a runway that's a window down into deep space (layers of stars at different depths drifting
// slowly up it), the bars' squares glowing softly (holo.jpg) with a bright wave on every score, capped with glossy black vinyl
// plates. The balls (white, sectioned like a globe into pastel blocks, every color) wait in a channel down the middle of each
// cap. A metal lipped hump launches the ball up onto a wide landing space in a black box, where a galaxy (vortex.jpg) turns
// slowly behind the rings, its light climbing the box's walls and flaring when a ball drops in.
// The rings are solid: short metal walls with thick chrome rails, their colors glowing along the top. In the middle the
// 10 to 50 rings, a small 150 cup in each top corner, and 2 to 4 bigger pockets anywhere round them (60 low, 75 high, each
// with its number floating over it) that sink away and pop up somewhere new after every ball. Every ring is a ramp from the
// back and sides, and the board dips a touch toward the middle, so balls drift in toward the rings.
// Click a machine to play: the game fills the screen (the room's panels tuck away; 💬 or Enter brings the chat up, ☰ is the
// menu), in one full view up the lane from just behind your ball (V: a split screen, the board up top and your end below).
// A roll is two clicks: the ball sits in the middle of your end and the arrow swings as you move the mouse (it stays aimed
// where your last ball was); click to lock it, then click again to stop the power meter as it sweeps up and down.
// Every roll wobbles a touch, like a real ball. Right click (or Esc) steps back from the power meter to aiming.
// Points burst up big and fly into your score in the corner. Everyone in the room sees every roll
// (each ball's path is worked out the same way on every screen), and the best scores go up on the board on the back wall.
// VERSION 6
// =====================================================================
import * as THREE from 'three';
import { ref, set, update, onValue, onDisconnect, push, query, orderByChild, limitToLast, runTransaction }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, renderer, scene, camera, serverNow, BASE_FOV } from '../core.js';
import { sfx } from '../sounds.js';

// ---------- The shape of a machine and how a ball moves on it (meters and seconds) ----------
// u runs across the lane (right is plus), v runs down it from your end, y is up.
// Every screen runs these same steps from the same start, so everyone sees the same ball end up in the same hole.
const W = 1.9, HALF = W / 2, R = 0.04;                   // lane width, and a ball's radius
const Y0 = 0.80, SLOPE = 0.12, L = 1.6;                  // how high the lane starts, how much it climbs a meter, how long it is
const HU = 0.30, KICK = 0.75;                            // the hump: how long, and how steep it is at the lip (the launch)
const HUMP_TOP = Y0 + SLOPE * L + HU * (SLOPE + (KICK - SLOPE) / 2);
const B0 = L + HU + 0.24, BL = 1.2, B1 = B0 + BL, TILT = 0.55;    // the target board: where it starts, how long, how steep
const YB = HUMP_TOP - 0.06, TROUGH = HUMP_TOP - 0.34;    // its bottom edge, and the gutter in front of it
const LIP = 0.045;                                       // how tall the ring lips stand
const WIDE = HALF + 0.2 - 0.03;                          // the landing space reaches out to the thin hoods, the machine's full width
// The board: rings in the middle (10 on the outside to 50 in the little one at the top), a small 150 cup in each top
// corner, and 2 to 4 pockets round them that sink away and pop up somewhere new after every ball (60 low, 75 high).
// Each ring is [across, down the machine, radius]; each hole [across, down, radius, points].
const CC = 0.6, TINY = 0.095, TINY_HOLE = 0.056;          // the middle of the rings, and the size of a moving pocket and its hole
const CUP = 0.075, CUP_HOLE = 0.045, CUP_U = 0.97, CUP_V = 1.04;   // the two little corner cups
const CENTER = [[0, CC, 0.44, 10], [0, CC + 0.06, 0.27, 20], [0, CC + 0.12, 0.18, 30], [0, CC + 0.165, 0.12, 40], [0, CC + 0.2, 0.05, 50],
                [-CUP_U, CUP_V, CUP, 150], [CUP_U, CUP_V, CUP, 150]];
const CENTER_HOLES = [[0, CC - 0.365, 0.063, 10], [0, CC - 0.135, 0.063, 20], [0, CC - 0.0075, 0.058, 30], [0, CC + 0.0975, 0.052, 40], [0, CC + 0.2, 0.044, 50],
                      [-CUP_U, CUP_V - CUP + CUP_HOLE + 0.004, CUP_HOLE, 150], [CUP_U, CUP_V - CUP + CUP_HOLE + 0.004, CUP_HOLE, 150]];
function layoutFor(g, n) {   // the moving pockets for ball n of game g: 2 to 4, anywhere round the middle rings (the same on every screen)
  let s = (Math.floor(g / 1000) ^ Math.imul(n + 1, 2654435761)) >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const count = 2 + Math.floor(rnd() * 3), tiny = [];
  for (let tries = 0; tiny.length < count && tries < 300; tries++) {
    const u = (rnd() * 2 - 1) * (WIDE - TINY - 0.05), dv = 0.12 + rnd() * 0.95, v = B0 + dv;
    if (Math.hypot(u, dv - CC) < 0.44 + TINY + 0.04) continue;                         // clear of the middle rings,
    if (Math.hypot(Math.abs(u) - CUP_U, dv - CUP_V) < CUP + TINY + 0.04) continue;      // the corner cups
    if (tiny.some(t => Math.hypot(t.u - u, t.v - v) < TINY * 2 + 0.05)) continue;     // and each other
    tiny.push({ u, v, pts: dv > 0.6 ? 75 : 60 });                                       // (higher up is worth more)
  }
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
  const side = (b.v > L + HU ? WIDE : HALF) - R;   // the lane's walls, or the hoods round the wider landing space
  if (b.u > side) { b.u = side; if (b.vu > 0) { hit('wall', b.vu); b.vu *= -0.68; english(b); } }   // lively walls, for bank shots
  if (b.u < -side) { b.u = -side; if (b.vu < 0) { hit('wall', -b.vu); b.vu *= -0.68; english(b); } }
  if (b.v > B1 - R) { b.v = B1 - R; if (b.vv > 0) { hit('back', b.vv); b.vv *= -0.45; english(b); } }
  if (b.v > L && b.y > H(b.v) + 0.85) { b.y = H(b.v) + 0.85; if (b.vy > 0) b.vy *= -0.3; }
  if (pv + R <= B0 && b.v + R > B0 && b.y < YB) { b.v = B0 - R; if (b.vv > 0) { hit('wall', b.vv); b.vv *= -0.4; } }
  if (pv - R >= L + HU && b.v - R < L + HU && b.y < HUMP_TOP + 0.25) { b.v = L + HU + R; if (b.vv < 0) { hit('wall', -b.vv); b.vv *= -0.4; } }   // (a clear guard over the hump: only a rare high one gets back over)
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
    if (b.v > B0) b.vu -= b.u * 1.5 * h;   // the board dips a touch toward the middle, so a ball on it drifts in toward the rings
  } else { b.on = false; b.onT = 0; }
  // the ring lips on the board: only a ball down low touches them (a flying one sails over)
  if (b.v > B0 - 0.05 && b.y - hs < need + LIP) {
    for (const [cu, c, r] of b.lay.rings) {
      const du = b.u - cu, dv = b.v - c, d = Math.hypot(du, dv);
      if (d < 1e-6 || Math.abs(d - r) >= R + 0.006) continue;
      const side = Math.hypot(pu - cu, pv - c) >= r ? 1 : -1;   // the side it was on a moment ago
      if (side > 0 && dv > -r * 0.3) continue;   // the back and sides of every ring are a ramp: a ball rolls in over them, but can't get back out
      const nu = du / d, nvv = dv / d, to = r + side * (R + 0.006);
      b.u = cu + nu * to; b.v = c + nvv * to;
      const vr = b.vu * nu + b.vv * nvv;
      if (vr * side < 0) { hit('rim', Math.abs(vr)); b.vu -= 1.3 * vr * nu; b.vv -= 1.3 * vr * nvv; if (Math.abs(vr) > 1) english(b); }
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
  if (b.t > 6 || b.still > 1) b.res = { pts: 0, gutter: true };   // still wandering round after six seconds, or stuck: it's out
}

// ---------- Where the machines stand: side by side, their backs against the back wall ----------
const MACHINES = [5.46, 7.8];             // their middles, across the room
const BALLS = 20, SLOT = BALLS / 2;       // twenty balls: ten in the channel along each side of the lane
const WALL = 0.2, CH = 0.09, CH_D = 0.07;  // the thick walls along the lane, and the ball channel sunk into the top of each
const OUT = HALF + WALL;                  // from the middle of the lane to the outside of those walls
const WALL_H = 0.16;                      // how high the Tetris side bars stand over the lane (low, so you see more of the board)
const VF = -0.12, VB = B1 + 0.06;         // the very front and back of a machine
const FRONT_Z = -11 + VB + 0.02;          // the end you stand at (the back wall is at -11)
const BACK_H = 0.12;                      // how high the walls round the board stand over it
const CAP = 0.03;                         // the black vinyl cap along the top of every wall
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
const COL = { 10: '#ff3fa8', 20: '#b36bff', 30: '#29e6ff', 40: '#ffd36a', 50: '#ffffff', 60: '#ff8a3d', 75: '#9dff4a', 150: '#ff4d6d' };
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
// The lane: a window down into deep space. Layers of stars at different depths under the runway (the far ones barely
// move as you look round, the near ones slide past), all drifting slowly up toward the board over a deep nebula, with a hint
// of the galaxy's gold and blue in it.
const spaceU = { uTime: { value: 0 } };
const laneMat = new THREE.ShaderMaterial({
  uniforms: spaceU,
  vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform float uTime; varying vec3 vW;
    float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float stars(vec2 p, float scale, float keep, float tw) {   // one layer of stars: a few cells of a grid hold a star
      vec2 g = p * scale, id = floor(g); float h = h21(id);
      if (h < keep) return 0.0;
      vec2 at = fract(g) - 0.5 - (vec2(h21(id + 3.7), h21(id + 9.1)) - 0.5) * 0.7;
      float s = smoothstep(0.1, 0.0, length(at)) + smoothstep(0.3, 0.0, length(at)) * 0.15;   // a bright point with a soft halo
      return s * (0.55 + 0.45 * sin(uTime * tw * (1.0 + h * 3.0) + h * 50.0));
    }
    vec2 deep(float d) {   // where you'd see a layer this far under the lane, looking through it from where you are
      vec3 V = normalize(vW - cameraPosition);
      return vec2(vW.x, -vW.z) + vec2(V.x, -V.z) * d / max(0.3, -V.y);
    }
    void main() {
      vec2 p = deep(1.0) - vec2(0.0, uTime * 0.015);                                     // the nebula, deepest down
      float n = noise(p * 1.6) * 0.6 + noise(p * 3.8) * 0.3 + noise(p * 8.0) * 0.1;
      vec3 col = mix(vec3(0.01, 0.008, 0.035), vec3(0.085, 0.03, 0.19), smoothstep(0.35, 0.85, n));
      col += vec3(0.02, 0.08, 0.16) * smoothstep(0.55, 0.95, noise(p * 1.1 + 4.0));
      col += vec3(0.09, 0.045, 0.012) * smoothstep(0.6, 0.95, noise(p * 1.3 + 9.0));
      col += vec3(0.55, 0.65, 1.0) * stars(deep(0.7) - vec2(0.0, uTime * 0.02), 30.0, 0.84, 1.0) * 0.6;    // far stars, faint and many
      col += vec3(0.85, 0.7, 1.0) * stars(deep(0.4) - vec2(0.0, uTime * 0.035), 19.0, 0.9, 0.9) * 0.85;    // lavender ones
      col += vec3(1.0, 0.72, 0.4) * stars(deep(0.2) - vec2(0.0, uTime * 0.055), 12.0, 0.93, 0.8);          // gold ones, nearer
      col += vec3(0.75, 0.9, 1.0) * stars(deep(0.06) - vec2(0.0, uTime * 0.085), 7.0, 0.965, 1.4) * 1.3;   // a few big bright ones, right under
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`
});
// The board behind the rings: the galaxy (vortex.jpg), turning slowly round the middle of the rings, glowing brighter when
// a ball drops in. Its light carries on up the inside of the walls round the board, fading into the black.
const VORTEX_R = 1.45, SPIN = 0.15;   // how far (meters) the picture reaches from its middle, and how fast it turns
const vortexU = { uTex: { value: null }, uTime: { value: 0 }, uPulse: { value: 0 } };
function vortexMat(origin, wall) {   // one for each machine (its spot in the room), for its board or its walls
  return new THREE.ShaderMaterial({
    uniforms: { ...vortexU, uOrigin: { value: origin.clone() } },
    side: THREE.DoubleSide,
    vertexShader: `uniform vec3 uOrigin; varying vec3 vL; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vL = w.xyz - uOrigin; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uTex; uniform float uTime, uPulse; varying vec3 vL;
      void main() {
        float u = vL.x, v = -vL.z;
        float h = ${wall ? `max(0.0, vL.y - (${YB.toFixed(4)} + (v - ${B0.toFixed(4)}) * ${TILT.toFixed(3)}))` : '0.0'};   // how far up a wall
        vec2 p = vec2(u, (v - ${(B0 + CC).toFixed(4)}) * ${STRETCH.toFixed(4)});
        float r = length(p);
        p += (r > 0.0001 ? p / r : vec2(0.0)) * h * 1.3;   // up the walls, the swirl carries on outward
        float a = -uTime * ${SPIN.toFixed(3)}, c = cos(a), s = sin(a);
        vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) / ${(2 * VORTEX_R).toFixed(3)} + 0.5;
        vec3 col = texture2D(uTex, q).rgb * smoothstep(0.5, 0.44, length(q - 0.5));
        col *= 0.85 + uPulse * 0.9 * exp(-r * 1.6);
        ${wall ? 'col *= exp(-h * 9.0) * 0.9;' : ''}
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`
  });
}
const holoMat = new THREE.MeshStandardMaterial({ color: 0x4a3a8a, roughness: 0.35, metalness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 });
// The Tetris walls come alive: each little square glows softly in its own color, with slow waves of light drifting along
// the walls and squares twinkling on their own now and then; when a ball drops in, a brighter wave runs down the walls.
// (holo.jpg is sixteen squares across.)
const holoU = { uTime: { value: 0 }, uBurst: { value: 0 }, uBurstZ: { value: 0 }, uBurstCol: { value: new THREE.Color(0xffffff) } };
holoMat.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, holoU);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
    varying vec3 vWp; uniform float uTime, uBurst, uBurstZ; uniform vec3 uBurstCol;
    float hb(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    #ifdef USE_MAP
    {
      vec2 sq = vMapUv * 16.0, cell = floor(sq), f = fract(sq);
      vec3 tex = texture2D(map, vMapUv).rgb;
      float h = hb(cell);
      float wave = 0.5 + 0.5 * sin(dot(vWp, vec3(1.3, 0.9, 1.7)) * 1.6 - uTime * 1.1 + h * 1.2);   // slow waves drifting along
      float tw = pow(max(0.0, sin(uTime * (0.35 + h * 0.7) + h * 40.0)), 10.0);                   // a square twinkling on its own
      float inside = smoothstep(0.03, 0.14, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)));       // (the bevels stay dark)
      totalEmissiveRadiance += tex * (pow(wave, 4.0) * 0.5 + tw * 0.7) * inside;
      float run = exp(-pow((vWp.z - uBurstZ) / 0.4, 2.0));                                         // the burst, rushing down the walls
      totalEmissiveRadiance += (tex * 0.7 + uBurstCol * 0.5) * uBurst * run * 1.6 * inside;
    }
    #endif`);
};
const vinylMat = new THREE.MeshPhysicalMaterial({ color: 0x08070d, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1,
  sheen: 0.5, sheenColor: 0x5a3aff, side: THREE.DoubleSide });   // the glossy black vinyl along the tops of the walls
const edgeMat = new THREE.MeshBasicMaterial({ color: 0x29e6ff, toneMapped: false });   // the thin neon lines along its edges
const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0418, roughness: 0.95 });
const chromeMat = new THREE.MeshPhysicalMaterial({ color: 0xe8e4ff, metalness: 0.9, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08,
  emissive: 0x6a4aff, emissiveIntensity: 0.22 });   // the launch hump's lip, in the same polished metal as the rims
// The balls: each one a sectioned globe. Solid pastel blocks between thick straight white bands that run round the ball like
// lines of longitude and latitude (ten round, six top to bottom), with a small white cap on each pole. A set in every pastel
// color (orange, pink, mint, sky blue, lavender, lemon), mixed through the channels. Drawn once, here.
const BALL_LON = 10, BALL_LAT = 6, BALL_BAND = 0.045, BALL_CAP = 0.2;   // the blocks round and top to bottom, the bands' width, the caps
const BALL_COLS = [[255, 178, 115], [255, 158, 196], [140, 230, 190], [140, 196, 255], [196, 160, 255], [255, 226, 120]];
function ballTex([r, g, b]) {
  const w = 1024, h = 512, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
  const fr = n => Math.abs(n - Math.floor(n) - 0.5);
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI, cl = Math.cos(lat);
    for (let i = 0; i < w; i++) {
      const lon = (i + 0.5) / w;
      const dm = (0.5 - fr(lon * BALL_LON)) * (2 * Math.PI / BALL_LON) * cl;   // how far to the nearest band, on the ball's surface
      const dp = (0.5 - fr((lat / Math.PI + 0.5) * BALL_LAT)) * (Math.PI / BALL_LAT);
      const edge = Math.min(dm, dp, Math.PI / 2 - Math.abs(lat) - BALL_CAP) - BALL_BAND;
      const k = Math.max(0, Math.min(1, edge / 0.01 + 0.5));                  // 1 on a block, 0 on the white
      const o = (j * w + i) * 4;
      d[o] = 250 + (r - 250) * k; d[o + 1] = 249 + (g - 249) * k; d[o + 2] = 252 + (b - 252) * k; d[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  return t;
}
const ballMats = BALL_COLS.map(col => { const t = ballTex(col);   // (a little of its own glow, so the colors stay bright in the dim arcade)
  return new THREE.MeshPhysicalMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }); });
const rimMat = {}, railMat = {}, bandMat = {}, holeMat = {}, numTex = {};
for (const [p, c] of Object.entries(COL)) {
  // a ring's rim: polished metal tinted its color, with a glowing band of the color round its inside edge
  rimMat[p] = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.35), metalness: 0.85, roughness: 0.22,
    clearcoat: 1, clearcoatRoughness: 0.1, emissive: new THREE.Color(c), emissiveIntensity: 0.25 });
  railMat[p] = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.6), metalness: 1, roughness: 0.14,
    clearcoat: 1, clearcoatRoughness: 0.06, emissive: new THREE.Color(c), emissiveIntensity: 0.18 });   // the thick chrome rail on top
  bandMat[p] = new THREE.MeshBasicMaterial({ color: new THREE.Color(c), toneMapped: false });
  numTex[p] = canvasTex(128, 64, x => {   // a small glowing number, floating over the pockets that move
    x.font = 'bold 50px "Trebuchet MS", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = c; x.shadowBlur = 14; x.fillStyle = c; x.fillText(p, 64, 34);
    x.shadowBlur = 3; x.fillStyle = '#ffffff'; x.globalAlpha = 0.8; x.fillText(p, 64, 34);
  });
  holeMat[p] = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, map: canvasTex(256, 256, x => {
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);   // a deep dark well with its number glowing in it
    g.addColorStop(0, '#000000'); g.addColorStop(0.75, '#07010f'); g.addColorStop(0.92, '#2a0d4a'); g.addColorStop(1, 'rgba(42,13,74,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.font = `bold ${p.length > 2 ? 88 : 110}px "Trebuchet MS", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = c; x.shadowBlur = 26; x.fillStyle = c; x.fillText(p, 128, 136);
    x.shadowBlur = 6; x.fillStyle = '#ffffff'; x.globalAlpha = 0.7; x.fillText(p, 128, 136);
  }) });
}
const loaded = Promise.all([
  loadTex('vortex.jpg', t => { vortexU.uTex.value = t; }),
  loadTex('holo.jpg', t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.4, 1.4);
    holoMat.map = t; holoMat.emissiveMap = t; holoMat.color.setHex(0xffffff); holoMat.emissiveIntensity = 0.28; holoMat.needsUpdate = true;
  })
]);

// ---------- Building one machine ----------
function surface(v0, v1, n, mat, u0 = -HALF, u1 = HALF, lift = 0) {   // a sheet following the height H(v): the lane, the board, a channel floor
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const v = v0 + (v1 - v0) * i / n;
    for (let j = 0; j <= 1; j++) { const u = j ? u1 : u0; pos.push(u, H(v) + lift, -v); uv.push((u + HALF) / W, v / W); }
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
const laneTop = v => H(Math.max(v, 0)) + WALL_H;
const HOOD = 0.03;                                    // the thin black hoods round the landing space
const BOX_H = 0.26;                                   // how high they stand: a black box round the board, the galaxy's light climbing its walls
function hoodTop(v) {   // how high they stand: over the hump, then over the board
  const v0 = L + HU;
  if (v < B0) return HUMP_TOP + BOX_H + (YB - HUMP_TOP) * (v - v0) / (B0 - v0);
  return H(Math.min(v, B1)) + BOX_H;
}
function panel(v0, v1, top, x, depth = 0.04, mat = holoMat, bottom = () => 0) {   // a wall from v0 to v1, from bottom(v) up to top(v), from x to x + depth
  const sh = new THREE.Shape();
  sh.moveTo(v0, bottom(v0));
  for (let i = 1; i <= 60; i++) { const v = v0 + (v1 - v0) * i / 60; sh.lineTo(v, bottom(v)); }
  for (let i = 60; i >= 0; i--) { const v = v0 + (v1 - v0) * i / 60; sh.lineTo(v, top(v)); }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 4 });
  const m = new THREE.Mesh(g, mat);
  m.rotation.y = Math.PI / 2;   // the shape's x runs down the machine
  m.position.x = x;
  return m;
}
function sheet(pts) {   // a flat sheet through pairs of points (bottom, top), one pair after another
  const pos = [], idx = [];
  pts.forEach(([a, b], k) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z); if (k) { const o = (k - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
function neonLine(pts) {   // a thin glowing line through these points
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.0045, 6, false), edgeMat);
}
// A ring, built solid: a short wall standing up off the board in polished tinted metal, a thick chrome rail along its top
// with its neon color glowing on it, and the board inside it a shade darker, so the rings read as cups. Made flat, then
// laid down on the board's slope.
const RING_H = LIP * 0.8, RAIL = 0.013;
function ringWallGeo(r) {
  const t = 0.006, V = THREE.Vector2;
  const g = new THREE.LatheGeometry([new V(r - t, -0.004), new V(r - t, RING_H), new V(r + t, RING_H), new V(r + t, -0.004)], 96);
  g.rotateX(Math.PI / 2);   // standing up off the board
  return g;
}
const cupMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
function ringOnBoard(u, v, r, pts) {   // a whole ring, lying on the board at (u, v)
  const pod = new THREE.Group(), inner = new THREE.Group();
  pod.rotation.x = TILT_ROT; pod.position.set(u, H(v), -v); pod.add(inner);
  inner.scale.y = STRETCH;
  const rim = new THREE.Mesh(ringWallGeo(r), rimMat[pts]);
  rim.material.side = THREE.DoubleSide;
  const rail = new THREE.Mesh(new THREE.TorusGeometry(r, RAIL, 14, 96), railMat[pts]);
  rail.position.z = RING_H;
  const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0045, 8, 96), bandMat[pts]);
  band.position.z = RING_H + RAIL * 0.85;
  const cup = new THREE.Mesh(new THREE.CircleGeometry(r - 0.006, 64), cupMat);
  cup.position.z = 0.0015; cup.renderOrder = 1;
  inner.add(rim, rail, band, cup);
  return { pod, inner, rim, rail, band };
}
function numberOver(p, pts, r) {   // a small glowing number floating just over a ring
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: numTex[pts], transparent: true, depthWrite: false, toneMapped: false }));
  sp.scale.set(0.11, 0.055, 1);
  sp.position.set(0, r * 0.15, RING_H + 0.07);
  p.inner.add(sp);
  return sp;
}
function holeMesh(u, v, r, pts) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r * 1.05, 40), holeMat[pts]);
  m.position.set(u, H(v) + 0.003, -v);
  m.rotation.x = TILT_ROT; m.scale.y = STRETCH; m.renderOrder = 2;
  return m;
}
function tinyPod(g) {   // a tiny ring and its hole, as one piece that can sink into the board and pop back up
  const p = ringOnBoard(0, B0, TINY, 75);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(TINY_HOLE * 1.05, 32), holeMat[75]);
  hole.position.set(0, -TINY + TINY_HOLE + 0.004, 0.003); hole.renderOrder = 2;
  p.inner.add(hole); p.hole = hole;
  p.num = numberOver(p, 75, TINY);
  p.pod.visible = false;
  g.add(p.pod);
  return p;
}
const SLOT_V = k => 0.12 + k * 0.1;                  // where the balls sit along each channel
const CH_U = HALF + WALL / 2;                        // the middle of a channel, across
const slotY = v => H(v) + WALL_H - CH_D + R;         // a ball sitting in a channel (its slot in the vinyl)
function buildMachine(i) {
  const g = new THREE.Group();
  g.position.set(MACHINES[i], 0, FRONT_Z);
  scene.add(g);
  // the deep space runway, its hump, the gutter in front of the board and the drops into it
  g.add(surface(VF, L, 60, laneMat), surface(L, L + HU, 24, laneMat));
  const gut = new THREE.Mesh(new THREE.PlaneGeometry(2 * OUT, B0 - L - HU), darkMat);
  gut.rotation.x = -Math.PI / 2; gut.position.set(0, TROUGH, -(L + HU + B0) / 2); g.add(gut);
  for (const [v, top] of [[B0, YB]]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(2 * OUT, top - TROUGH), darkMat);
    f.position.set(0, (top + TROUGH) / 2, -v); f.rotation.y = v === B0 ? 0 : Math.PI; g.add(f);
  }
  // the launch hump's lip: a rounded metal bar right across the top edge, and metal caps on both ends of it
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, W, 24), chromeMat);
  lip.rotation.z = Math.PI / 2;
  lip.position.set(0, HUMP_TOP - 0.022, -(L + HU)); g.add(lip);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, HUMP_TOP - 0.022 - TROUGH), chromeMat);   // the hump's back face, down to the gutter
  face.position.set(0, (HUMP_TOP - 0.022 + TROUGH) / 2, -(L + HU + 0.022)); face.rotation.y = Math.PI; g.add(face);
  for (const sd of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), chromeMat);
    cap.position.set(sd * (HALF - 0.01), HUMP_TOP - 0.01, -(L + HU)); g.add(cap);
  }
  // the board: the vortex behind, the rings in the middle and their holes, and eight tiny ring pods (2 to 4 show at a time)
  const boardMat = vortexMat(g.position, false), boxMat = vortexMat(g.position, true);
  g.add(surface(B0, B1, 40, boardMat, -OUT, OUT));
  CENTER.forEach(([u, v, r, p]) => { const ring = ringOnBoard(u, B0 + v, r, p); if (p === 150) numberOver(ring, p, r); g.add(ring.pod); });
  CENTER_HOLES.forEach(([u, v, r, p]) => g.add(holeMesh(u, B0 + v, r, p)));
  const pods = [];
  for (let k = 0; k < 8; k++) pods.push(tinyPod(g));
  // along the lane: a low Tetris side bar each side, capped with glossy black vinyl plates with a thin neon line along each
  // edge, and the balls waiting in a channel down the middle of the cap. They end at the launch hump.
  const side = (WALL - CH) / 2, END = L + HU, under = v => laneTop(v) - CAP;
  for (const sd of [-1, 1]) {
    const inX = sd > 0 ? HALF : -HALF - side, outX = sd > 0 ? HALF + side + CH : -OUT, chX = sd * CH_U - CH / 2;
    g.add(panel(VF, END, under, inX, side), panel(VF, END, under, outX, side));                       // either side of the channel
    g.add(panel(VF, END, v => laneTop(v) - CH_D - 0.006, chX, CH));                                     // under the channel
    g.add(panel(VF, END, laneTop, inX, side, vinylMat, under), panel(VF, END, laneTop, outX, side, vinylMat, under));   // the cap plates
    g.add(surface(VF, END, 30, vinylMat, chX, chX + CH, WALL_H - CH_D));                                // the channel's floor
    for (const v of [VF, END - 0.04]) g.add(panel(v, v + 0.04, laneTop, chX, CH, vinylMat, v2 => laneTop(v2) - CH_D - 0.006));   // its two ends
    for (const eu of [sd * HALF, sd * OUT]) {   // the neon lines along both edges of the cap
      const pts = [];
      for (let k = 0; k <= 30; k++) { const v = VF + (END - VF) * k / 30; pts.push(new THREE.Vector3(eu, laneTop(v) + 0.002, -v)); }
      g.add(neonLine(pts));
    }
  }
  // the top end: one wide landing space, the full width of the machine, with thin black vinyl hoods along the sides and back
  for (const sd of [-1, 1]) {
    g.add(panel(END, VB, hoodTop, sd > 0 ? OUT - HOOD : -OUT, HOOD, vinylMat));
    const pts = [];
    for (let k = 0; k <= 30; k++) { const v = END + (VB - END) * k / 30; pts.push(new THREE.Vector3(sd * (OUT - HOOD / 2), hoodTop(v) + 0.002, -v)); }
    g.add(neonLine(pts));
  }
  // the galaxy's light on the inside of the box: up both sides and across the back
  const IN = OUT - HOOD - 0.002, V = THREE.Vector3;
  for (const sd of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 40; k++) { const v = END + (B1 - END) * k / 40; pts.push([new V(sd * IN, v < B0 ? TROUGH : H(v), -v), new V(sd * IN, hoodTop(v), -v)]); }
    g.add(new THREE.Mesh(sheet(pts), boxMat));
  }
  { const pts = [];
    for (let k = 0; k <= 40; k++) { const u = -IN + 2 * IN * k / 40; pts.push([new V(u, H(B1), -(B1 - 0.002)), new V(u, hoodTop(B1), -(B1 - 0.002))]); }
    g.add(new THREE.Mesh(sheet(pts), boxMat)); }
  const front = new THREE.Mesh(new THREE.BoxGeometry(2 * OUT, H(VF), 0.04), holoMat);   // the front, under your end, right up to the lane
  front.position.set(0, H(VF) / 2, -VF + 0.02); g.add(front);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2 * OUT, hoodTop(VB), HOOD), vinylMat);   // the hood across the back
  back.position.set(0, hoodTop(VB) / 2, -(B1 + HOOD / 2)); g.add(back);
  g.add(neonLine([new THREE.Vector3(-OUT, hoodTop(VB) + 0.002, -(B1 + HOOD / 2)), new THREE.Vector3(OUT, hoodTop(VB) + 0.002, -(B1 + HOOD / 2))]));
  // light over the board, so the rims and the balls shine
  const boardLight = new THREE.PointLight(0xd8c8ff, 6, 4.5, 1.5); boardLight.position.set(0, YB + 1.4, -(B0 + 0.6)); g.add(boardLight);
  const laneLight = new THREE.PointLight(0xbfa8ff, 3, 3, 1.5); laneLight.position.set(0, Y0 + 0.9, -0.5); g.add(laneLight);
  g.traverse(o => { if (o.isMesh) o.userData.skee = i; });   // clicking any part of it means "play this one"
  // the balls
  const balls = [];
  for (let k = 0; k < BALLS; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), ballMats[k % ballMats.length]);
    b.visible = false; b.userData.skee = i; g.add(b); balls.push(b);
  }
  return { i, g, pods, balls,
           data: null, tray: 0, live: [], seen: null, score: 0, shown: 0, lay: null, layN: -1, pop: null, pops: [] };
}

// ---------- The best scores, up on the back wall over the machines ----------
const hc = document.createElement('canvas'); hc.width = 1024; hc.height = 1200;
const hTex = new THREE.CanvasTexture(hc); hTex.colorSpace = THREE.SRGBColorSpace; hTex.anisotropy = MAX_ANISO;
const hiBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.24, 2.625), new THREE.MeshBasicMaterial({ map: hTex, toneMapped: false }));
hiBoard.position.set((MACHINES[0] + MACHINES[1]) / 2, 3.49, -10.94);   // from up high, down the wall between the machines
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
  frame(x, 1024, 1200, '#29e6ff');
  neonText(x, 'SKEE·BALL HIGH SCORES', 512, 90, 60, '#ff3fa8');
  if (!best.length) neonText(x, 'nobody yet · be the first', 512, 600, 44, '#b36bff');
  best.forEach((b, k) => {
    const y = 175 + k * 62, col = k === 0 ? '#ffd36a' : k < 3 ? '#29e6ff' : '#cdb8ff';
    neonText(x, String(k + 1), 110, y, 42, col, 'center');
    neonText(x, b.name, 170, y, 42, col, 'left');
    neonText(x, String(b.score), 900, y, 46, col, 'right', '"Courier New", monospace');
  });
  hTex.needsUpdate = true;
}
paintBest();
onValue(query(ref(db, 'game/skee/best'), orderByChild('score'), limitToLast(16)), s => {
  const list = [];
  s.forEach(c => { const v = c.val(); if (v && typeof v.score === 'number' && typeof v.name === 'string') list.push(v); });
  best = list.sort((a, b) => b.score - a.score || a.t - b.t);
  paintBest();
}, () => {});

function stale(d) { return !d || d.done || serverNow() - (d.t || 0) > 120000; }   // nobody's playing it (or they vanished)

// ---------- Your score while you play: big neon numbers in the top corner of the screen ----------
const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;left:18px;top:14px;z-index:25;display:none;pointer-events:none;font-family:"Trebuchet MS",sans-serif;' +
  'color:#efe6ff;text-shadow:0 0 12px #b36bff';
const hudScore = document.createElement('div');
hudScore.style.cssText = 'font:bold 64px "Courier New",monospace;line-height:1;color:#dffbff;text-shadow:0 0 10px #29e6ff,0 0 26px #29e6ff';
const hudBalls = document.createElement('div');
hudBalls.style.cssText = 'font-weight:bold;font-size:18px;margin-top:4px;color:#ffd36a;text-shadow:0 0 10px #ffd36a';
const hudBest = document.createElement('div');
hudBest.style.cssText = 'font-size:14px;margin-top:2px;color:#cdb8ff';
hud.append(hudScore, hudBalls, hudBest);
let pb = 0;   // your personal best, kept on this computer
try { pb = +localStorage.getItem('skeePB') || 0; } catch (e) {}
document.body.appendChild(hud);
let hudKey = '';
function paintHud(m) {
  const d = m.data, key = Math.round(m.shown) + '|' + (d ? d.left : '') + '|' + !!(d && d.done) + '|' + pb;
  if (key === hudKey) return;
  hudKey = key;
  hudScore.textContent = String(Math.round(m.shown)).padStart(4, '0');
  hudBalls.textContent = !d ? '' : d.done ? 'GAME OVER' : `${d.left} ball${d.left === 1 ? '' : 's'} left`;
  hudBest.textContent = pb ? `your best: ${pb}` : '';
}

// ---------- Big numbers: bursting up out of the hole when a ball drops ----------
// While you play, a huge number bursts up on your screen, hangs a moment, then flies up into your score in the corner.
// Anyone watching from the room sees it float up off the board and fade.
const popCss = document.createElement('style');
popCss.textContent = '.skeePop{position:fixed;z-index:26;pointer-events:none;font:bold 120px "Trebuchet MS",sans-serif;line-height:1;' +
  'transform:translate(-50%,-50%);white-space:nowrap;will-change:transform,opacity}';
document.head.appendChild(popCss);
const sv = new THREE.Vector3();
function popNumber(m, pts, u, v) {
  const col = COL[pts] || '#ffffff', from = new THREE.Vector3(u, H(v) + 0.05, -v);
  if (my === m && view && view.t >= 1) {   // yours: on the screen, big
    sv.copy(from).applyMatrix4(m.g.matrixWorld).project(mode === 'deep' ? deepCam : goalCam);
    const top = window.innerHeight * (mode === 'deep' ? 1 : 1 - STRIP);
    const el = document.createElement('div');
    el.className = 'skeePop'; el.textContent = '+' + pts;
    el.style.color = '#ffffff';
    el.style.textShadow = `0 0 12px ${col}, 0 0 30px ${col}, 0 0 60px ${col}`;
    document.body.appendChild(el);
    m.pops.push({ el, x: (sv.x + 1) / 2 * window.innerWidth, y: (1 - sv.y) / 2 * top, t: 0, pts, big: pts >= 75 });
    return;
  }
  const tex = canvasTex(256, 128, x => {   // anyone else's: floating up off the board
    x.font = 'bold 96px "Trebuchet MS", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = col; x.shadowBlur = 24; x.fillStyle = col; x.fillText('+' + pts, 128, 66);
    x.shadowBlur = 4; x.fillStyle = '#ffffff'; x.globalAlpha = 0.85; x.fillText('+' + pts, 128, 66);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  sp.renderOrder = 10;
  m.g.add(sp);
  m.pops.push({ sp, from, t: 0, pts });
}
function stepPops(m, dt) {
  const hr = hudScore.getBoundingClientRect();
  for (const p of m.pops) {
    p.t += dt;
    const k = p.t;
    if (p.el) {
      let x = p.x, y, s, o = 1;
      if (k < 0.55) { const e = 1 - Math.pow(1 - k / 0.55, 3); y = p.y - e * 70; s = 0.3 + e * (p.big ? 1.5 : 1.15); }   // bursting up
      else if (k < 1.35) { y = p.y - 70; s = (p.big ? 1.8 : 1.45) - 0.08 * Math.sin((k - 0.55) / 0.8 * Math.PI * 2); }   // hanging there, throbbing
      else {                                                                                                        // flying into the score
        const e = Math.min(1, (k - 1.35) / 0.5), ee = e * e;
        x = p.x + (hr.left + hr.width / 2 - p.x) * ee; y = p.y - 70 + (hr.top + hr.height / 2 - p.y + 70) * ee;
        s = (p.big ? 1.8 : 1.45) * (1 - e) + 0.35 * e; o = 1 - Math.max(0, e - 0.75) / 0.25;
        if (e >= 1) p.done = true;
      }
      p.el.style.left = x + 'px'; p.el.style.top = y + 'px'; p.el.style.opacity = o;
      p.el.style.transform = `translate(-50%,-50%) scale(${s})`;
    } else {
      const e = Math.min(1, k / 1.2);
      p.sp.position.copy(p.from).add(new THREE.Vector3(0, 0.1 + e * 0.5, 0));
      const s = 0.25 + Math.min(1, k / 0.3) * 0.35;
      p.sp.scale.set(s, s / 2, 1);
      p.sp.material.opacity = 1 - Math.max(0, e - 0.6) / 0.4;
      if (e >= 1) p.done = true;
    }
  }
  m.pops = m.pops.filter(p => {
    if (!p.done) return true;
    if (p.el) p.el.remove(); else { m.g.remove(p.sp); p.sp.material.map.dispose(); p.sp.material.dispose(); }
    return false;
  });
}

// ---------- The tiny rings: sinking away, and popping up in their new pattern ----------
function placePods(m, lay) {   // set the pods where this layout has its tiny rings
  m.pods.forEach((p, k) => {
    const t = lay.tiny[k];
    p.pod.visible = !!t;
    if (!t) return;
    p.pod.position.set(t.u, H(t.v), -t.v);
    p.rim.material = rimMat[t.pts]; p.rail.material = railMat[t.pts]; p.band.material = bandMat[t.pts]; p.hole.material = holeMat[t.pts];
    p.num.material.map = numTex[t.pts];
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
    if (k >= 1) { m.pop = null; podScale(m, 1, 0); }
  }
}

// ---------- The balls: waiting in the wall channels, rolling, sinking ----------
function busySet(m) { return new Set([...m.live.map(l => l.mesh), m.hand && m.hand.mesh].filter(Boolean)); }
function placeTray(m) {   // the balls waiting in the channels, filling both evenly from your end; the rest hidden (or busy)
  let k = 0;
  const busy = busySet(m);
  for (const b of m.balls) {
    if (busy.has(b)) continue;
    if (k < m.tray) {
      const side = k % 2 ? 1 : -1, v = SLOT_V(Math.floor(k / 2));
      b.visible = true; b.scale.setScalar(1);
      b.position.set(side * CH_U, slotY(v), -v);
      k++;
    } else b.visible = false;
  }
}
function freeBall(m) {   // the waiting ball nearest your end of the channels
  const busy = busySet(m);
  return m.balls.filter(b => !busy.has(b) && b.visible).sort((a, b) => b.position.z - a.position.z)[0] || m.balls.find(b => !busy.has(b));
}
function near(m) {   // how loud this machine should be where you are
  const d = camera.position.distanceTo(m.g.position) + 0.5;
  return Math.min(1, 3 / d);
}
function launch(m, roll) {   // a ball leaves its channel and rolls (yours or anyone's: the same on every screen)
  let mesh = m.hand && m.hand.mesh;
  if (mesh) m.hand = null;                // yours: it's already out of the channel, sitting on the lane
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
// The sound when a ball drops in, and the walls lighting up: the middle rings plink, the moving pockets ring out bigger,
// and a 150 sets off the jackpot (a fanfare, a flash and sparks all over the screen if it's yours)
function dropSound(m, pts, k) {
  if (pts <= 50) { sfx.skeeDrop(pts, k); burst(pts / 120, COL[pts]); return; }
  if (pts < 150) {
    sfx.skeeDrop(pts === 75 ? 50 : 40, k);
    [0, 0.12, 0.24].forEach((d, i) => setTimeout(() => sfx.skeePour(i * 3 + (pts === 75 ? 4 : 0), k), 300 + d * 1000));
    burst(pts === 75 ? 0.9 : 0.7, COL[pts]);
    return;
  }
  sfx.skeeDrop(100, k);
  setTimeout(() => sfx.skeeOver(true), 450);
  for (let i = 0; i < 8; i++) setTimeout(() => sfx.skeePour(i, k), 200 + i * 90);
  burst(1.6, COL[150]);
  if (my === m) jackpot();
}
let burstT = 9;   // how long ago the walls' last burst of light set off (it rushes from the board end toward you)
function burst(amount, col) { holoU.uBurst.value = Math.max(holoU.uBurst.value, amount); vortexU.uPulse.value = Math.max(vortexU.uPulse.value, Math.min(1, amount)); holoU.uBurstCol.value.set(col); burstT = 0; }
const sparkCss = document.createElement('style');
sparkCss.textContent = '.skeeSpark{position:fixed;z-index:26;pointer-events:none;width:10px;height:10px;border-radius:50%;will-change:transform,opacity}' +
  '.skeeFlash{position:fixed;inset:0;z-index:26;pointer-events:none;background:radial-gradient(circle,rgba(255,255,255,0.9),rgba(255,77,109,0.5) 45%,rgba(255,77,109,0) 75%);transition:opacity 0.9s}';
document.head.appendChild(sparkCss);
let sparks = [];
function jackpot() {   // a flash of light, then sparks bursting out all over the screen
  const fl = document.createElement('div');
  fl.className = 'skeeFlash'; document.body.appendChild(fl);
  requestAnimationFrame(() => requestAnimationFrame(() => { fl.style.opacity = '0'; }));
  setTimeout(() => fl.remove(), 1000);
  const cols = ['#ff4d6d', '#ffd36a', '#29e6ff', '#b36bff', '#9dff4a', '#ffffff'];
  for (let i = 0; i < 90; i++) {
    const el = document.createElement('div'), c = cols[i % cols.length], a = Math.random() * Math.PI * 2, sp = 300 + Math.random() * 700;
    el.className = 'skeeSpark'; el.style.background = c; el.style.boxShadow = `0 0 10px ${c}, 0 0 20px ${c}`;
    document.body.appendChild(el);
    sparks.push({ el, x: window.innerWidth / 2, y: window.innerHeight * 0.45, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 250, t: 0, life: 1.2 + Math.random() * 0.8 });
  }
}
function stepSparks(dt) {
  for (const s of sparks) {
    s.t += dt; s.vy += 900 * dt; s.vx *= 1 - dt * 0.8;
    s.x += s.vx * dt; s.y += s.vy * dt;
    s.el.style.transform = `translate(${s.x - 5}px,${s.y - 5}px) scale(${1 - s.t / s.life * 0.6})`;
    s.el.style.opacity = Math.max(0, 1 - s.t / s.life);
  }
  sparks = sparks.filter(s => { if (s.t < s.life) return true; s.el.remove(); return false; });
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
        if (l.b.res.back) { m.tray++; placeTray(m); }   // a ball that rolled back down the runway goes back in the channel: a redo
        else if (l.n + 1 < BALLS && m.data && m.data.g === l.g) showLayout(m, l.g, l.n + 1, true);   // new tiny rings for the next ball
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
      if (b.res.pts) { l.mesh.position.set(b.res.u, H(b.res.v) + R * 0.6, -b.res.v); dropSound(m, b.res.pts, k); popNumber(m, b.res.pts, b.res.u, b.res.v); }
      else sfx.skeeGutter(k);
      if (l.mine && b.res.back) redo(m);
      else if (l.mine) mineDone(m, b.res.pts);
    }
  }
  m.live = m.live.filter(l => !(l.gone && l.sink > 0.4));
  return fastest * near(m);
}

// ---------- Playing: walking up to a machine and taking your turns ----------
let my = null;             // the machine you're playing, or null
let opts = {};
let view = null;           // the camera gliding to (or sitting at) the playing spot
const BTN_CSS = 'font:bold 15px "Trebuchet MS",sans-serif;padding:9px 16px;border-radius:12px;cursor:pointer;' +
  'background:rgba(255,63,168,0.22);color:#fff;border:1px solid rgba(255,63,168,0.8);text-align:left';
function button(label, fn) { const b = document.createElement('button'); b.textContent = label; b.style.cssText = BTN_CSS; b.addEventListener('click', fn); return b; }
function mine(m) { const d = m && m.data; return !!(d && d.id === myId && !d.done); }
function rolling(m) { return m.live.some(l => !l.gone) || !!m.pop; }

// ---------- While you play, the chat and the people list are tucked away: the 💬 button or Enter brings them up ----------
const chatCss = document.createElement('style');
chatCss.textContent = 'body.skeePlay #who, body.skeePlay #worldBox, body.skeePlay #chat, body.skeePlay #phoneBar { display: none !important; }' +
  'body.skeePlay.skeeChat #who, body.skeePlay.skeeChat #worldBox, body.skeePlay.skeeChat #chat { display: block !important; }';
document.head.appendChild(chatCss);
const chatBtn = document.createElement('button');
chatBtn.textContent = '💬';
chatBtn.title = 'Chat (Enter)';
chatBtn.style.cssText = 'position:fixed;right:16px;top:14px;z-index:27;display:none;width:52px;height:52px;border-radius:50%;font-size:24px;cursor:pointer;' +
  'background:rgba(10,4,24,0.75);color:#fff;border:2px solid rgba(179,107,255,0.8);box-shadow:0 0 14px rgba(179,107,255,0.5)';
const chatDot = document.createElement('span');
chatDot.style.cssText = 'display:none;position:absolute;top:4px;right:4px;width:12px;height:12px;border-radius:50%;background:#ff3b2f;box-shadow:0 0 8px #ff3b2f';
chatBtn.appendChild(chatDot);
document.body.appendChild(chatBtn);
const chatOpen = () => document.body.classList.contains('skeeChat');
function showChat(on) {
  document.body.classList.toggle('skeeChat', on);
  const input = document.getElementById('chatInput');
  if (on) { chatDot.style.display = 'none'; const msgs = document.getElementById('msgs'); if (msgs) msgs.scrollTop = msgs.scrollHeight; if (input) input.focus(); }
  else if (input && document.activeElement === input) input.blur();
}
chatBtn.addEventListener('click', () => showChat(!chatOpen()));
{ const msgs = document.getElementById('msgs');   // someone wrote something while the chat's tucked away: a red dot on 💬
  if (msgs) new MutationObserver(() => { if (my && !chatOpen()) chatDot.style.display = 'block'; }).observe(msgs, { childList: true }); }
function playMode(on) {   // tuck the room's panels away while you play, and bring them back after
  document.body.classList.toggle('skeePlay', on);
  if (!on) showChat(false);
  chatBtn.style.display = on ? 'block' : 'none';
  chatDot.style.display = 'none';
  menuBtn.style.display = on ? 'block' : 'none';
}

// ---------- Full screen: starting a game fills the whole screen (no tabs, no taskbar); leaving puts it back ----------
let wantFull = true, ourFull = false;
try { wantFull = localStorage.getItem('skeeFull') !== 'off'; } catch (e) {}
function goFull(on) {
  const el = document.documentElement;
  try {
    if (on && el.requestFullscreen && !document.fullscreenElement) { ourFull = true; el.requestFullscreen({ navigationUI: 'hide' }).catch(() => { ourFull = false; }); }
    if (!on && ourFull && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (!on) ourFull = false;
  } catch (e) {}
}

// ---------- The title card: SKEE·BALL across the screen for a moment while you step up to the machine ----------
const title = document.createElement('div');
title.style.cssText = 'position:fixed;inset:0;z-index:30;display:none;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;' +
  'background:radial-gradient(ellipse at center, rgba(40,10,70,0.92), rgba(4,2,12,0.98));transition:opacity 0.6s;font-family:"Trebuchet MS",sans-serif';
const titleBig = document.createElement('div');
titleBig.textContent = 'SKEE·BALL';
titleBig.style.cssText = 'font-weight:bold;font-size:min(16vw,150px);letter-spacing:0.06em;color:#fff;text-shadow:0 0 18px #ff3fa8,0 0 50px #ff3fa8,0 0 90px #b36bff';
const titleSmall = document.createElement('div');
titleSmall.textContent = 'move the mouse: aim   ·   click: lock it   ·   click: stop the power meter';
titleSmall.style.cssText = 'margin-top:14px;font-size:min(4vw,26px);color:#dffbff;text-shadow:0 0 12px #29e6ff;letter-spacing:0.12em';
title.append(titleBig, titleSmall);
document.body.appendChild(title);
let titleTimer = 0;
function showTitle() {
  clearTimeout(titleTimer);
  title.style.display = 'flex'; title.style.opacity = '1';
  titleTimer = setTimeout(() => { title.style.opacity = '0'; titleTimer = setTimeout(() => { title.style.display = 'none'; }, 650); }, 1300);
}

// ---------- The menu (☰): a new game, the view, full screen, sound, and leaving ----------
const menuBtn = document.createElement('button');
menuBtn.textContent = '☰';
menuBtn.title = 'Menu';
menuBtn.style.cssText = chatBtn.style.cssText + ';right:78px';
const menu = document.createElement('div');
menu.style.cssText = 'position:fixed;right:16px;top:76px;z-index:28;display:none;flex-direction:column;gap:8px;padding:12px;border-radius:16px;' +
  'background:rgba(10,4,24,0.88);border:1px solid rgba(179,107,255,0.7);box-shadow:0 0 22px rgba(179,107,255,0.45)';
const mNew = button('🎳  New game', () => { showMenu(false); if (my) claim(my); });
const mView = button('', () => { setMode(mode === 'split' ? 'deep' : 'split'); menuLabels(); });
const mFull = button('', () => { wantFull = !wantFull; try { localStorage.setItem('skeeFull', wantFull ? 'on' : 'off'); } catch (e) {} goFull(wantFull); menuLabels(); });
const mSound = button('', () => { const b = document.getElementById('mute'); if (b) b.click(); setTimeout(menuLabels, 50); });
const mLeave = button('✕  Leave the game', () => leave());
menu.append(mNew, mView, mFull, mSound, mLeave);
document.body.append(menuBtn, menu);
function menuLabels() {
  mView.textContent = mode === 'split' ? '👁  Deep view  (V)' : '👁  Split view  (V)';
  mFull.textContent = wantFull ? '⛶  Full screen: on' : '⛶  Full screen: off';
  const b = document.getElementById('mute');
  mSound.textContent = (b && /🔇/.test(b.textContent) ? '🔇' : '🔊') + '  Sound';
}
const menuOpen = () => menu.style.display === 'flex';
function showMenu(on) { menu.style.display = on ? 'flex' : 'none'; if (on) menuLabels(); }
menuBtn.addEventListener('click', () => showMenu(!menuOpen()));

// ---------- Game over: a card with your score, your best, and what next ----------
const over = document.createElement('div');
over.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:29;display:none;flex-direction:column;align-items:center;gap:10px;' +
  'padding:26px 40px;border-radius:22px;background:rgba(10,4,24,0.9);border:2px solid rgba(255,63,168,0.8);' +
  'box-shadow:0 0 40px rgba(255,63,168,0.5);font-family:"Trebuchet MS",sans-serif;color:#efe6ff;text-align:center';
const overHead = document.createElement('div');
overHead.style.cssText = 'font-weight:bold;font-size:22px;letter-spacing:0.2em;color:#ffd36a;text-shadow:0 0 10px #ffd36a';
const overScore = document.createElement('div');
overScore.style.cssText = 'font:bold 96px "Courier New",monospace;line-height:1;color:#dffbff;text-shadow:0 0 14px #29e6ff,0 0 40px #29e6ff';
const overNote = document.createElement('div');
overNote.style.cssText = 'font-size:18px;min-height:22px';
const overBtns = document.createElement('div');
overBtns.style.cssText = 'display:flex;gap:10px;margin-top:8px';
overBtns.append(button('🎳  Play again', () => { if (my) claim(my); }), button('✕  Done', () => leave()));
over.append(overHead, overScore, overNote, overBtns);
document.body.appendChild(over);
function showOver(score, newPb, rank) {
  overHead.textContent = 'GAME OVER';
  overScore.textContent = String(score);
  overNote.textContent = newPb ? '⭐ NEW PERSONAL BEST! ⭐' : rank ? `🏆 #${rank} on the high score board` : `your best: ${pb}`;
  if (newPb && rank) overNote.textContent += `   ·   🏆 #${rank}`;
  overNote.style.color = newPb || rank ? '#9dff4a' : '#cdb8ff';
  over.style.display = 'flex';
}
function hideOver() { over.style.display = 'none'; }

// ---------- A roll: swing the arrow with the mouse and click to lock it, then click to stop the power meter as it sweeps
// up and down. No spin: the ball goes where the arrow points (swing it wide to bank it off the walls).
const gauge = document.createElement('canvas');
gauge.width = 440; gauge.height = 250;
gauge.style.cssText = 'position:fixed;left:14px;bottom:14px;width:330px;height:188px;z-index:25;display:none;pointer-events:none';
document.body.appendChild(gauge);
const SEGS = 15, AIM_MAX = 0.5, SWEEP = 1.3;     // the meter's segments, the widest aim (radians), the meter's sweep from empty to full (seconds)
const P_LOW = 0.29, P_HIGH = 0.65;              // the meter's softest roll (just up onto the board) and its hardest (off the back)
const WOBBLE_A = 0.04, WOBBLE_P = 0.02;         // every roll wobbles a touch, like a real ball: the same shot isn't always the same
const TACH_X = 220, TACH_Y = 236, TACH_R0 = 110, TACH_R1 = 168;   // the meter's middle and its inside and outside edges (on the gauge)
let lastPw = 0.5;                               // where you stopped the meter last time (shown, dimmed, between rolls)
function drawGauge(h) {
  const x = gauge.getContext('2d'), W2 = gauge.width;
  x.clearRect(0, 0, W2, gauge.height);
  if (!h && !canSet()) { gauge.style.display = 'none'; return; }
  gauge.style.display = 'block';
  const live = !!h && h.stage === 'power', pw = live ? h.pw : lastPw, lit = Math.max(1, Math.ceil(pw * SEGS));
  // fifteen segments round a half circle, green through gold to red, and a needle
  x.fillStyle = 'rgba(10,4,24,0.8)'; x.beginPath(); x.arc(TACH_X, TACH_Y, TACH_R1 + 12, Math.PI, 0); x.fill();
  x.save(); x.globalAlpha = live ? 1 : 0.45;
  for (let k = 0; k < SEGS; k++) {
    const a0 = Math.PI + k / SEGS * Math.PI + 0.012, a1 = Math.PI + (k + 1) / SEGS * Math.PI - 0.012;
    const hue = 120 - k / (SEGS - 1) * 120, on = k < lit;
    x.fillStyle = on ? `hsl(${hue},100%,55%)` : `hsla(${hue},60%,30%,0.45)`;
    x.save(); if (on) { x.shadowColor = x.fillStyle; x.shadowBlur = 12; }
    x.beginPath(); x.arc(TACH_X, TACH_Y, TACH_R1, a0, a1); x.arc(TACH_X, TACH_Y, TACH_R0, a1, a0, true); x.closePath(); x.fill(); x.restore();
  }
  const na = Math.PI + pw * Math.PI;
  x.strokeStyle = '#ffffff'; x.lineWidth = 4;
  x.beginPath(); x.moveTo(TACH_X, TACH_Y); x.lineTo(TACH_X + Math.cos(na) * (TACH_R1 + 6), TACH_Y + Math.sin(na) * (TACH_R1 + 6)); x.stroke();
  x.fillStyle = '#ffffff'; x.beginPath(); x.arc(TACH_X, TACH_Y, 9, 0, Math.PI * 2); x.fill();
  x.restore();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 54px "Courier New", monospace'; x.save(); x.shadowColor = '#ff3fa8'; x.shadowBlur = 16; x.fillStyle = '#ffffff';
  x.globalAlpha = live ? 1 : 0.5; x.fillText(String(lit), TACH_X, TACH_Y - 52); x.restore();
  x.font = 'bold 15px "Trebuchet MS", sans-serif'; x.fillStyle = live ? '#ffd36a' : '#cdb8ff';
  x.fillText(live ? 'CLICK!' : 'POWER', TACH_X, TACH_Y - 16);
}
function placeHand(h) {   // the ball waiting in the middle of your end (drawn back as the power builds)
  const v = 0.08 - (h.stage === 'power' ? h.pw : 0.25) * 0.16;
  h.mesh.position.set(h.u, H(Math.max(v, -0.02)) + R, -v);
}
function canSet() { return !!(my && mine(my)); }
window.addEventListener('keydown', e => {
  if (!my) return;
  const k = e.key.toLowerCase();
  if (k === 'escape' && chatOpen()) { showChat(false); return; }   // Esc tucks the chat away first
  if (k === 'escape' && menuOpen()) { showMenu(false); return; }     // then the menu
  if (k === 'escape' && document.fullscreenElement) return;         // (in full screen, Esc is the browser's: it leaves full screen)
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  if (k === 'enter') { showChat(true); e.preventDefault(); return; }
  if (k === 'v') { setMode(mode === 'split' ? 'deep' : 'split'); return; }
  if (k === 'escape') { const h = my.hand; if (h && h.stage === 'power') back(h); else leave(); return; }
});
window.addEventListener('contextmenu', e => { if (my) e.preventDefault(); });   // right click is "a step back" while you play

// The aiming arrow: chevrons glowing up the lane from the ball, the way it'll go (longer and hotter the more power)
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
  aim.position.set(h.u, H(0.08) + 0.005, -0.08);
  aim.rotation.set(Math.atan(SLOPE), -h.aim, 0, 'YXZ');   // tipped up the lane's slope, turned the way it'll go
  const p = h.stage === 'power' ? h.pw : 0.5;               // (it grows and heats up with the power while the meter sweeps)
  aim.scale.set(1, 1, 0.8 + p * 1.6);
  aimMat.color.setHSL(0.33 - p * 0.33, 1, h.stage === 'aim' ? 0.55 : 0.7);
}
let keep = null;             // how you aimed your last ball: the next one starts aimed the same way
function readyBall(m) {   // your turn and nothing rolling: the next ball comes out of a channel onto the middle of your end
  if (m.hand || m.tray <= 0 || rolling(m) || !mine(m) || (view && view.t < 1)) return;
  const mesh = freeBall(m);
  if (!mesh) return;
  m.hand = { mesh, stage: 'aim', t: 0, pw: 0, u: 0, aim: keep ? keep.aim : 0, lastX: null };
  m.tray--; placeTray(m);
  mesh.visible = true; placeHand(m.hand);
  m.g.add(aim);
  sfx.skeeThump(0.5);
}
const AIM_SWEEP = 1.1;   // how many screen widths of mouse travel swing the arrow from one side all the way to the other
function steer(h, e) {   // moving the pointer swings the arrow from where it is (a small move, a small change)
  if (h.stage !== 'aim') return;
  if (h.lastX != null) h.aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, h.aim + (e.clientX - h.lastX) / (window.innerWidth * AIM_SWEEP) * 2 * AIM_MAX));
  h.lastX = e.clientX;
}
function next(h) {   // click one locks the aim and starts the power meter, click two stops it and the ball goes
  if (h.stage === 'aim') { h.stage = 'power'; h.t = 0; h.pw = 0; sfx.skeeRim(0.8); }
  else if (h.stage === 'power') roll(my, h);
}
function back(h) {   // a step back: from the power meter to aiming again
  if (h.stage !== 'power') return;
  h.stage = 'aim'; h.t = 0; h.pw = 0; h.lastX = null; placeHand(h);
  sfx.skeeWall(0.3);
}
function down(e) {
  const h = my && my.hand;
  if (!h || !mine(my)) return;
  if (e.button === 2) { back(h); return; }
  if (e.pointerType === 'touch' && h.stage === 'aim') { h.dragging = true; h.lastX = e.clientX; return; }   // phones: drag to aim, let go to lock it
  next(h);
}
function move(e) {
  const h = my && my.hand;
  if (!h || e.target !== renderer.domElement || (e.pointerType === 'touch' && !h.dragging)) return;
  steer(h, e);
}
function up(e) {
  const h = my && my.hand;
  if (!h || !h.dragging) return;
  h.dragging = false;
  next(h);
}
function roll(m, h) {
  const d = m.data, n = BALLS - d.left;
  // everyone uses exactly the numbers that are sent, so their ball rolls the same as yours
  keep = { aim: h.aim }; lastPw = h.pw;
  const wob = () => Math.random() * 2 - 1;   // (the wobble is picked here and sent, so everyone sees the same roll)
  const p = Math.max(0, Math.min(1, P_LOW + h.pw * (P_HIGH - P_LOW) + wob() * WOBBLE_P));
  const a = Math.max(-AIM_MAX, Math.min(AIM_MAX, h.aim + wob() * WOBBLE_A));
  const r = { n, g: d.g, by: myId, u: 0, p: +p.toFixed(4), a: +a.toFixed(4), s: 0, t: Date.now() };
  const l = launch(m, r);
  if (!l) return;
  l.mine = true;
  m.myLeft = d.left - 1;
  m.rolling = (m.rolling || 0) + 1;
  update(ref(db, 'game/skee/m' + m.i), { left: m.myLeft, t: serverNow() }).catch(() => {});
  set(ref(db, 'game/skee/r' + m.i), r).catch(() => {});
  m.seen = r.t;
  showAim(null);
}
function redo(m) {   // your ball rolled all the way back down the runway: it doesn't count, you get it back
  m.rolling--;
  m.myLeft++;
  const d = m.data;
  if (d && d.id === myId) update(ref(db, 'game/skee/m' + m.i), { left: m.myLeft, t: serverNow() }).catch(() => {});
  opts.banner && opts.banner('↩ It came back! Roll it again', 2);
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
  if (pts >= 60) opts.banner && opts.banner(pts === 150 ? '💥💥 JACKPOT · 150! 💥💥' : pts === 75 ? '🔥 75!' : '✨ 60!', pts === 150 ? 3 : 2);
  if (over) {
    onDisconnect(ref(db, 'game/skee/m' + m.i)).cancel();
    if (m.score > 0) push(ref(db, 'game/skee/best'), { name: S.myName, score: m.score, t: Date.now() }).catch(() => {});
    const place = best.filter(b => b.score >= m.score).length;
    sfx.skeeOver(m.score >= (best[0] ? best[0].score : 1));
    const newPb = m.score > pb;
    if (newPb) { pb = m.score; try { localStorage.setItem('skeePB', String(pb)); } catch (e) {} }
    setTimeout(() => { if (my === m) showOver(m.score, newPb, place < 16 && m.score > 0 ? place + 1 : 0); }, 1500);   // once the last number's landed
  }
}
function claim(m) {   // start a game on this machine (if nobody else is playing it)
  if (!S.myName) return;
  const r = ref(db, 'game/skee/m' + m.i);
  runTransaction(r, cur => {
    if (cur && cur.id && cur.id !== myId && !stale(cur)) return;   // someone's playing: leave it alone
    return { id: myId, name: S.myName, score: 0, left: BALLS, g: Date.now(), t: serverNow() };
  }).then(res => {
    if (!res.committed) { opts.banner && opts.banner(`${(res.snapshot.val() || {}).name || 'Someone'} is playing that one`, 3); if (!my) goFull(false); return; }
    hideOver(); showTitle();   // the controls flash up once at the start of every game
    m.score = 0; m.rolling = 0; m.myLeft = BALLS;
    onDisconnect(r).update({ done: true });
    if (my !== m) enter(m);
  }).catch(() => opts.banner && opts.banner('Could not start a game (check the database rules)', 4));
}
// ---------- The split screen while you play: the whole board big across the top, and a strip along the bottom of
// your end (your ball, the aim arrow and the balls in both walls). The lane in between is left out. ----------
const NEAR_EYE = new THREE.Vector3(0, 1.55, 1.05), NEAR_LOOK = new THREE.Vector3(0, 0.82, -0.2);
const GOAL_EYE = new THREE.Vector3(0, YB + 0.75, -(L + HU - 1.8)), GOAL_LOOK = new THREE.Vector3(0, YB + 0.25, -(B0 + 0.5));   // low and back, looking up the board with depth
// What the top view has to show, edge to edge: the launch hump at the bottom, the whole board, and the top of the walls
// round it. The view is fitted tight round these on any screen, so the board fills it.
const GOAL_BOX = [];
for (const sd of [-1, 1]) GOAL_BOX.push(new THREE.Vector3(sd * 0.3, H(L + 0.2), -(L + 0.2)), new THREE.Vector3(sd * OUT, YB, -B0),
  new THREE.Vector3(sd * OUT, H(B1) + BACK_H * 0.5, -B1));
let goalPts = [];
// The full view (V switches to the split screen): one view up the whole lane from a few steps behind your ball, low down,
// so the runway runs away from you and the board stands up big at the far end. It's fitted so the board reaches right
// across the screen, from your ball at the bottom to the top of the board.
const DEEP_EYE = new THREE.Vector3(0, 1.3, 2.6), DEEP_LOOK = new THREE.Vector3(0, YB, -(B0 - 0.3));
const DEEP_BOX = [], DEEP_WIDE = [];
for (const sd of [-1, 1]) {
  DEEP_BOX.push(new THREE.Vector3(sd * 0.25, H(-0.02), 0.04), new THREE.Vector3(sd * OUT, H(B1) + BACK_H * 0.5, -B1));
  DEEP_WIDE.push(new THREE.Vector3(sd * OUT, YB, -B0));
}
let deepPts = [], deepWide = [];
let mode = 'deep';   // the full view up the lane, unless you've switched to the split screen
try { if (localStorage.getItem('skeeView') === 'split') mode = 'split'; } catch (e) {}
function setMode(md) {
  mode = md;
  try { localStorage.setItem('skeeView', md); } catch (e) {}
  for (const mm of machines) for (const p of mm.pops) if (p.el) p.done = true;
}
const nearCam = new THREE.PerspectiveCamera(30, 1, 0.05, 40), goalCam = new THREE.PerspectiveCamera(50, 1, 0.05, 40);
const deepCam = new THREE.PerspectiveCamera(50, 1, 0.05, 40);
const STRIP = 0.3;   // how much of the screen's height the bottom strip takes
function placeCams(m) {
  m.g.updateMatrixWorld();
  for (const [cam, eye, look] of [[nearCam, NEAR_EYE, NEAR_LOOK], [goalCam, GOAL_EYE, GOAL_LOOK], [deepCam, DEEP_EYE, DEEP_LOOK]]) {
    cam.position.copy(m.g.localToWorld(eye.clone()));
    cam.lookAt(m.g.localToWorld(look.clone()));
  }
  goalPts = GOAL_BOX.map(p => m.g.localToWorld(p.clone()));
  deepPts = DEEP_BOX.map(p => m.g.localToWorld(p.clone()));
  deepWide = DEEP_WIDE.map(p => m.g.localToWorld(p.clone()));
}
const cp = new THREE.Vector3();
function pageBits() { return [document.querySelector('#ui h1'), document.getElementById('hint')].filter(Boolean); }
function spread(cam, pts) {   // how far across and up these points reach, as seen from the camera
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    cp.copy(p).applyMatrix4(cam.matrixWorldInverse);
    const x = cp.x / -cp.z, y = cp.y / -cp.z;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}
function frameGoal(cam, aspect, pts = goalPts, wide = null) {   // a view, from where the camera stands, that holds all these points
  cam.updateMatrixWorld();
  const { x0, x1, y0, y1 } = spread(cam, pts), pad = 0.015;
  let mx = (x0 + x1) / 2, my2 = (y0 + y1) / 2, hw = (x1 - x0) / 2 + pad, hh = (y1 - y0) / 2 + pad;
  if (hw / hh < aspect) hw = hh * aspect; else hh = hw / aspect;   // the screen's leftover room goes to the sides (or top and bottom)
  if (wide) {   // better: just as wide as these, edge to edge, if everything still fits top to bottom (the near walls run off the sides)
    const w = spread(cam, wide), fw = (w.x1 - w.x0) / 2, fh = fw / aspect;
    if (2 * fh >= (y1 - y0) + 2 * pad) { mx = (w.x0 + w.x1) / 2; hw = fw; hh = fh; my2 = y1 + pad - fh; }
  }
  const n = cam.near;
  cam.aspect = aspect;
  cam.projectionMatrix.makePerspective((mx - hw) * n, (mx + hw) * n, (my2 + hh) * n, (my2 - hh) * n, n, cam.far);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}
function fit(cam, aspect, wide, tall) {   // a field of view that shows at least this wide and this tall (degrees)
  cam.aspect = aspect;
  const byWide = 2 * Math.atan(Math.tan(wide * Math.PI / 360) / aspect) * 180 / Math.PI;
  cam.fov = Math.max(tall, byWide);
  cam.updateProjectionMatrix();
}
function renderSplit() {   // draws the two views; false when you're not playing (so the room draws as usual)
  if (!my || !view || view.t < 1) return false;
  const w = window.innerWidth, h = window.innerHeight, hb = Math.round(h * STRIP), gap = 3;
  for (const el of pageBits()) el.style.visibility = 'hidden';   // the room's name and walking tips aren't needed while you play
  hud.style.display = 'block';
  if (mode === 'deep') {   // the one deep view
    frameGoal(deepCam, w / h, deepPts, deepWide);
    renderer.render(scene, deepCam);
    return true;
  }
  frameGoal(goalCam, w / (h - hb - gap));
  fit(nearCam, w / hb, 82, 18);
  renderer.setScissorTest(true);
  renderer.setViewport(0, hb + gap, w, h - hb - gap); renderer.setScissor(0, hb + gap, w, h - hb - gap);
  renderer.render(scene, goalCam);
  renderer.setViewport(0, 0, w, hb); renderer.setScissor(0, 0, w, hb);
  renderer.render(scene, nearCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  return true;
}
function enter(m) {
  my = m;
  playMode(true);
  placeCams(m);
  const to = nearCam.position.clone(), toQ = nearCam.quaternion.clone();   // glide down to your end, then the screen splits
  view = { t: 0, fromP: camera.position.clone(), fromQ: camera.quaternion.clone(), to, toQ, fromF: camera.fov };
  opts.enter && opts.enter(to.x, to.z);
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
  drawGauge(null);
  playMode(false);
  hideOver(); showMenu(false); goFull(false);
  for (const el of pageBits()) el.style.visibility = '';
  hud.style.display = 'none';
  for (const mm of machines) for (const p of mm.pops) if (p.el) p.done = true;   // (big numbers still on the screen go)
  camera.fov = BASE_FOV; camera.updateProjectionMatrix();
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
    if (playing && (!was || was.g !== m.data.g)) {   // a new game: full channels
      for (const l of m.live) l.mesh.visible = false;
      m.live = []; m.hand = null;
      if (my === m) { showAim(null); drawGauge(null); }
      m.tray = m.data.left;
      const n = BALLS - m.data.left;
      showLayout(m, m.data.g, n, !!m.lay);
      if (m.data.left === BALLS) sfx.skeePour(0, near(m));
    }
    if (!playing && !m.live.length && !m.hand) m.tray = BALLS;   // between games the channels sit full
    placeTray(m);
  }, () => {});
  let first = true;
  onValue(ref(db, 'game/skee/r' + m.i), s => {
    const r = s.val();
    if (first) { first = false; return; }   // an old roll from before you came in
    if (!r || r.by === myId || !m.data || r.g !== m.data.g) return;
    if (r.t === m.seen) return;   // (each roll is known by when it was rolled: a redo is the same ball number again)
    m.seen = r.t;
    const num = (x, lo, hi) => Math.max(lo, Math.min(hi, +x || 0));
    launch(m, { n: Math.round(num(r.n, 0, BALLS - 1)), g: r.g, u: num(r.u, -HALF + R, HALF - R), p: num(r.p, 0, 1),
                a: num(r.a, -AIM_MAX, AIM_MAX), s: num(r.s, -1, 1) });
  }, () => {});
});

// ---------- Every frame ----------
let blinkT = 0;
const PACE = 0.95;   // the balls, the pockets and the big numbers all play out a touch slower than real time
function updateAll(dt) {
  blinkT += dt;
  spaceU.uTime.value = blinkT; vortexU.uTime.value = blinkT; holoU.uTime.value = blinkT;
  vortexU.uPulse.value = Math.max(0, vortexU.uPulse.value - dt * 1.2);   // the galaxy's glow fading back
  holoU.uBurst.value = Math.max(0, holoU.uBurst.value - dt * 0.9);   // the walls' burst of light fading as it rushes toward you
  burstT += dt; holoU.uBurstZ.value = FRONT_Z - VB + burstT * 3.5;
  stepSparks(dt);
  const sdt = dt * PACE;
  let roll = 0;
  for (const m of machines) {
    roll = Math.max(roll, updateLive(m, sdt));
    stepPop(m, sdt);
    stepPops(m, sdt);
    // the score on the board counts up as each big number lands in it (points still flying up aren't on it yet)
    const flying = m.pops.reduce((a, p) => a + (p.done ? 0 : p.pts), 0);
    const target = Math.max(0, (m.data && !m.data.done ? m.data.score || 0 : m.data ? m.data.score || 0 : 0) - flying);
    if (target >= m.shown || target === 0) m.shown += (target - m.shown) * Math.min(1, dt * 8);   // (it never counts backwards)
    if (Math.abs(target - m.shown) < 0.5) m.shown = target;
  }
  if (my) {
    readyBall(my);
    const h = my.hand;
    if (h && h.stage === 'power') { h.t += dt; h.pw = (1 - Math.cos(h.t / SWEEP * Math.PI)) / 2; placeHand(h); }   // the power meter sweeping up and down
    showAim(h); drawGauge(h); paintHud(my);
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
    start(i) { const m = machines[i]; if (!m || my === m) return; if (wantFull) goFull(true); claim(m); },   // (full screen has to start right on the click)
    down, move, up, leave,
    render: renderSplit
  };
}