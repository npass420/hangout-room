// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/portalframe.js <<<<<
// The portal frame (from your Kindroid pictures, refs/portal_frame and refs/portal_swirl): a tall frame of chunky
// glossy black stone blocks, a little rough-hewn, with gold running through every seam and a few cracks across them,
// a stepped inner edge, a thin gold trim round the opening, gold caps on the four corners and a gold keystone on top
// with a soft glow over it. Inside, the portal (from your Kindroid portal picture): a dark void full of drifting,
// twinkling stars, lined with glow at the opening, a tilted loop of light slowly rocking in it, its strands' bright
// heads racing round and trailing off, and a little pool of light rippling at the bottom. In gold, purple or blue; its
// light spills that color onto the gold and the black gloss.
//   makePortalFrame({ swirl })   swirl: 'gold' (the Maker's), 'purple' (Blocks, the Game Room's) or 'blue' (the
//                       Scene Room's): the color of the light inside; the frame is the same for all
//                       { group (its middle at 0, facing +z, SIZE of the built size, with its picture lamp; hang it with
//                       its middle WALL out from the wall), update(t), flare(k): 0 .. 1 brighter }
//     everything in it is marked userData.portalFrame, for clicking
//   build()             the Workshop's look at it, 3x close-up, standing on y = 0 (it runs itself)
// =====================================================================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GOLD as GOLD_SHARED } from './goldjewel.js';
import { softEnv } from '../checkers/pieceenv.js';

const OW = 1.04, OH = 1.94, D = 0.3;   // the opening, and the depth (built big, then shrunk)
const K = 2 / 3;                        // how chunky the border is (two thirds of its first, chunkier size)
const W = OW + 0.76 * K, H = OH + 0.76 * K;   // outside size
export const SIZE = 0.3;   // how big it hangs: 0.3 of the built size, about 54 x 81 cm, a picture on the wall
const WALL = 0.045;        // how far its middle stands out from the wall it hangs on
const STONE = new THREE.MeshPhysicalMaterial({ color: 0x17171c, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
const GOLD = GOLD_SHARED.clone();   // (its own copy: the reflections set on it below stay on this frame)
const GOLD_DARK = new THREE.MeshPhysicalMaterial({ color: 0x8a5e1c, metalness: 1, roughness: 0.35 });

function seeded(n) { let a = n >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// one rough-hewn black block: a rounded box with its faces gently dented, so the gloss catches it unevenly
function stone(w, h, d, rand) {
  const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.12);
  const p = g.attributes.position, seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, [(rand() - 0.5) * 0.018, (rand() - 0.5) * 0.018, (rand() - 0.5) * 0.01]);
    const [dx, dy, dz] = seen.get(key);
    p.setXYZ(i, p.getX(i) + dx, p.getY(i) + dy, p.getZ(i) + (p.getZ(i) > 0 ? dz : 0));
  }
  g.computeVertexNormals();
  return g;
}

// the portal: a loop of light in a starry void, drawn in its own light
const PORTAL_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const PORTAL_FS = `
  uniform float time, flare, aspect; uniform vec3 cMain, cHot, cDeep, cDust; varying vec2 vUv;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  // one strand of the loop: a tilted oval of light whose brightest point runs round it, trailing a fading tail
  float strand(vec2 p, float rx, float ry, float tilt, float speed, float phase, float width) {
    vec2 e = (rot(tilt) * p) / vec2(rx, ry);
    float d = abs(length(e) - 1.0) * min(rx, ry);
    float behind = mod(time * speed + phase - atan(e.y, e.x), 6.2831853);
    return exp(-d * d / (width * width)) * (0.15 + 0.85 * exp(-behind * 0.55));
  }
  void main() {
    vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
    float edge = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0;
    // the dark void, a little brighter toward the frame, and a glow lining the opening
    vec3 col = cDeep * (0.55 + 0.45 * smoothstep(0.2, 1.0, edge));
    col += cMain * pow(edge, 10.0) * 1.2;
    // stars drifting slowly up through it, twinkling
    vec2 g = p * 22.0 + vec2(0.0, time * 0.05), id = floor(g);
    float s = h(id);
    if (s > 0.9) col += cDust * smoothstep(0.18, 0.0, length(fract(g) - 0.5 - (vec2(h(id + 1.3), h(id + 4.1)) - 0.5) * 0.6))
                     * (0.4 + 0.6 * sin(time * (2.0 + s * 5.0) + s * 40.0)) * 1.1;
    // the loop of light: a few strands round a tilted oval, slowly rocking, their bright heads racing round
    float tilt = 0.35 + 0.12 * sin(time * 0.3);
    float ring = strand(p, 0.42, 0.68, tilt, 1.1, 0.0, 0.018)
               + strand(p, 0.44, 0.70, tilt + 0.05, 1.1, 0.6, 0.010) * 0.7
               + strand(p, 0.40, 0.65, tilt - 0.04, 1.1, 2.4, 0.012) * 0.5;
    float halo = strand(p, 0.42, 0.68, tilt, 1.1, 0.0, 0.08) * 0.35;
    col *= 1.0 - smoothstep(1.0, 0.6, length((rot(tilt) * p) / vec2(0.42, 0.68))) * 0.35;   // (darker in its heart)
    col += cMain * (ring * 1.6 + halo) + cHot * ring * 0.9;
    // a little pool of light rippling at the bottom
    float br = length((p - vec2(0.0, -0.88)) * vec2(1.0, 4.0));
    col += cMain * (0.5 + 0.5 * sin(br * 18.0 - time * 3.0)) * smoothstep(0.5, 0.0, br) * 0.6;
    col *= 1.0 + flare * 1.2;
    gl_FragColor = vec4(col, 1.0);
  }`;

// The portal's colors: gold (the Maker's), purple (Blocks, the Game Room's) and blue (the Scene Room's)
const SWIRLS = {
  gold:   { cMain: [1.0, 0.68, 0.2], cHot: [1.0, 0.95, 0.75], cDeep: [0.08, 0.045, 0.01], cDust: [1.0, 0.9, 0.6], light: 0xffb040 },
  purple: { cMain: [0.62, 0.3, 1.0], cHot: [0.95, 0.85, 1.0], cDeep: [0.06, 0.02, 0.12], cDust: [0.9, 0.8, 1.0], light: 0xa060ff },
  blue:   { cMain: [0.25, 0.55, 1.0], cHot: [0.85, 0.95, 1.0], cDeep: [0.02, 0.05, 0.14], cDust: [0.8, 0.9, 1.0], light: 0x4d9fff }
};

export function makePortalFrame({ swirl = 'purple' } = {}) {
  const look = SWIRLS[swirl] || SWIRLS.purple;
  const group = new THREE.Group(), rand = seeded(7);
  const solid = [];   // (meshes to merge? kept separate: few enough, and each block needs its own dents)

  // the gold behind everything: shows in every seam between the blocks
  const back = new THREE.Shape([new THREE.Vector2(-W / 2 + 0.02, 0.02), new THREE.Vector2(W / 2 - 0.02, 0.02), new THREE.Vector2(W / 2 - 0.02, H - 0.02), new THREE.Vector2(-W / 2 + 0.02, H - 0.02)]);
  back.holes.push(new THREE.Path([new THREE.Vector2(-OW / 2, (H - OH) / 2), new THREE.Vector2(-OW / 2, (H + OH) / 2), new THREE.Vector2(OW / 2, (H + OH) / 2), new THREE.Vector2(OW / 2, (H - OH) / 2)]));
  const backGeo = new THREE.ExtrudeGeometry(back, { depth: D * 0.8, bevelEnabled: false });
  backGeo.translate(0, 0, -D * 0.4);
  solid.push(new THREE.Mesh(backGeo, GOLD_DARK));

  // the outer ring of blocks, then the stepped inner ring (thinner, set back), each side its own run of uneven blocks
  const GAP = 0.016;
  function run(x0, y0, x1, y1, thick, depth, z) {   // (blocks along a straight edge, from one corner to the other)
    const len = Math.hypot(x1 - x0, y1 - y0), horiz = Math.abs(y1 - y0) < 1e-6;
    let at = 0;
    while (at < len - 0.05) {
      let l = (0.24 + rand() * 0.26) * K;
      if (len - at - l < 0.18 * K) l = len - at;
      const mid = at + l / 2, t = mid / len, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
      const g = horiz ? stone(l - GAP, thick - GAP, depth, rand) : stone(thick - GAP, l - GAP, depth, rand);
      const m = new THREE.Mesh(g, STONE);
      m.position.set(cx, cy, z + (rand() - 0.5) * 0.012);
      solid.push(m);
      at += l;
    }
  }
  const T2 = 0.13 * K, T1 = (W - OW) / 2 - T2;   // (outer ring's thickness, inner ring's)
  const ix = OW / 2 + T2, iy0 = (H - OH) / 2 - T2, iy1 = (H + OH) / 2 + T2;   // (the inner ring's outside edge)
  run(-W / 2, T1 / 2, W / 2, T1 / 2, T1, D, 0);                       // bottom
  run(-W / 2, H - T1 / 2, W / 2, H - T1 / 2, T1, D, 0);               // top
  run(-W / 2 + T1 / 2, T1, -W / 2 + T1 / 2, H - T1, T1, D, 0);        // left
  run(W / 2 - T1 / 2, T1, W / 2 - T1 / 2, H - T1, T1, D, 0);          // right
  const z2 = -0.045, d2 = D * 0.72;
  run(-ix, iy0 + T2 / 2, ix, iy0 + T2 / 2, T2, d2, z2);
  run(-ix, iy1 - T2 / 2, ix, iy1 - T2 / 2, T2, d2, z2);
  run(-ix + T2 / 2, iy0 + T2, -ix + T2 / 2, iy1 - T2, T2, d2, z2);
  run(ix - T2 / 2, iy0 + T2, ix - T2 / 2, iy1 - T2, T2, d2, z2);

  // gold cracks running across some of the blocks' faces
  for (let i = 0; i < 16; i++) {
    const side = Math.floor(rand() * 4), along = 0.1 + rand() * 0.8;
    let x, y;
    if (side < 2) { x = -W / 2 + W * along; y = side === 0 ? T1 / 2 : H - T1 / 2; }
    else { y = H * (0.08 + along * 0.84); x = side === 2 ? -W / 2 + T1 / 2 : W / 2 - T1 / 2; }
    let px = x + (rand() - 0.5) * 0.08 * K, py = y + (rand() - 0.5) * 0.08 * K;
    for (let k = 0; k < 3; k++) {   // (a short wandering crack, three little legs)
      const ang = rand() * Math.PI * 2, len = (0.05 + rand() * 0.07) * K;
      const c = new THREE.Mesh(new THREE.BoxGeometry(len, 0.008 + rand() * 0.006, 0.012), GOLD);
      c.position.set(px + Math.cos(ang) * len / 2, py + Math.sin(ang) * len / 2, D / 2 + 0.002);
      c.rotation.z = ang;
      solid.push(c);
      px += Math.cos(ang) * len; py += Math.sin(ang) * len;
    }
  }

  // the gold trim round the opening
  const tr = 0.035 * K, tz = z2 + d2 / 2 + 0.006;
  for (const [w, h2, x, y] of [[OW + tr * 2, tr, 0, (H - OH) / 2 - tr / 2], [OW + tr * 2, tr, 0, (H + OH) / 2 + tr / 2], [tr, OH, -OW / 2 - tr / 2, H / 2], [tr, OH, OW / 2 + tr / 2, H / 2]]) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h2, 0.05, 2, 0.01), GOLD);
    m.position.set(x, y, tz);
    solid.push(m);
  }
  // gold caps on the corners: a little stepped gold triangle over each corner
  for (const sx of [-1, 1]) for (const sy of [0, 1]) {
    const cap = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.24 * K, 0), new THREE.Vector2(0, 0.24 * K)]);
    const g = new THREE.ExtrudeGeometry(cap, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
    const m = new THREE.Mesh(g, GOLD);
    m.scale.set(-sx, sy ? -1 : 1, 1);
    m.position.set(sx * (W / 2 - 0.005), sy ? H - 0.005 : 0.005, D / 2 - 0.01);
    solid.push(m);
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22 * K, D * 0.9), GOLD);   // (and down the corner's side)
    side.position.set(sx * (W / 2 + 0.003), sy ? H - 0.12 * K : 0.12 * K, 0);
    solid.push(side);
  }
  // the keystone on top: a gold block with a recessed panel and a shield, a soft glow above it
  const key = new THREE.Mesh(new RoundedBoxGeometry(0.3 * K, 0.38 * K, D + 0.12, 3, 0.03 * K), GOLD);
  key.position.set(0, H - 0.12 * K, 0.04);
  solid.push(key);
  const panel = new THREE.Mesh(new RoundedBoxGeometry(0.2 * K, 0.27 * K, 0.04, 2, 0.01), GOLD_DARK);
  panel.position.set(0, H - 0.12 * K, D / 2 + 0.1);
  solid.push(panel);
  const shield = new THREE.Shape([new THREE.Vector2(-0.055, 0.05), new THREE.Vector2(0.055, 0.05), new THREE.Vector2(0.055, -0.01), new THREE.Vector2(0, -0.075), new THREE.Vector2(-0.055, -0.01)]);
  const sh = new THREE.Mesh(new THREE.ExtrudeGeometry(shield, { depth: 0.02, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 }), GOLD);
  sh.position.set(0, H - 0.11 * K, D / 2 + 0.115); sh.scale.set(K, K, 1);
  solid.push(sh);
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.3, 'rgba(255,200,120,0.5)'); gr.addColorStop(1, 'rgba(255,180,80,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.scale.set(0.5 * K, 0.5 * K, 1); glow.position.set(0, H + 0.1 * K, 0.06);

  for (const m of solid) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  group.add(glow);

  // the portal itself, and its light spilling out
  const U = { time: { value: 0 }, flare: { value: 0 }, aspect: { value: OW / OH } };
  for (const k of ['cMain', 'cHot', 'cDeep', 'cDust']) U[k] = { value: new THREE.Vector3(...look[k]) };
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(OW, OH), new THREE.ShaderMaterial({ uniforms: U, vertexShader: PORTAL_VS, fragmentShader: PORTAL_FS, toneMapped: false }));
  portal.position.set(0, H / 2, z2 - d2 / 2 + 0.06);
  group.add(portal);
  const light = new THREE.PointLight(look.light, 0.25, 4 * SIZE + 0.4, 1.5);
  light.position.set(0, H / 2, 0.6);
  group.add(light);

  // the black gloss and the gold need something to reflect, or they read as flat black: the soft dark studio picture
  // the game pieces use, set the first time it's drawn (that's when the renderer is at hand)
  const shiny = [STONE, GOLD, GOLD_DARK];
  let envSet = false;
  portal.onBeforeRender = (renderer) => {
    if (envSet) return; envSet = true;
    const e = softEnv(renderer);
    for (const m of shiny) { m.envMap = e; m.envMapIntensity = m === STONE ? 2.2 : 2.4; m.needsUpdate = true; }
  };

  group.scale.setScalar(SIZE);
  group.position.y = -H * SIZE / 2;   // (centered on its own middle: set the outer group's height where it hangs)
  const outer = new THREE.Group();
  outer.add(group);

  // the picture lamp over it, like the gallery's frames have: a brass bar on a little arm, glowing underneath, a soft
  // pool of light down the wall behind, and a warm spot on the frame so the black gloss and the gold show
  {
    const fw = W * SIZE, fh = H * SIZE, ly = fh / 2 + 0.16, lz = 0.13 - WALL;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, fw * 0.95, 16), GOLD);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, ly, lz);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.9, 0.006, 0.02), new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false }));
    bulb.position.set(0, ly - 0.02, lz);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.13, 8), GOLD);
    arm.rotation.x = Math.PI / 2; arm.position.set(0, ly, lz - 0.065);
    // the light on the wall: a soft dome of light arching up over the lamp, and a long fall of it down behind the
    // frame, brightest at the lamp, fading to nothing all the way round (no hard edge anywhere)
    const UP = 0.32, DOWN = ly + fh / 2 + 0.3, PW = fw * 2.3, ph = UP + DOWN;   // (meters: above the lamp, below it, wide, tall)
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = Math.round(256 * ph / PW);
    const g = cv.getContext('2d'), cx = cv.width / 2, cy = cv.height * UP / ph, rx = cv.width * 0.48;
    for (const [top, ry] of [[true, cv.height * UP / ph * 0.95], [false, cv.height * DOWN / ph * 0.97]]) {
      g.save();
      g.beginPath(); g.rect(0, top ? 0 : cy, cv.width, top ? cy : cv.height - cy); g.clip();   // (each half its own height)
      g.translate(cx, cy); g.scale(1, ry / rx);
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      grd.addColorStop(0, 'rgb(255,236,200)'); grd.addColorStop(0.18, 'rgb(200,175,135)'); grd.addColorStop(0.5, 'rgb(80,68,50)'); grd.addColorStop(1, 'rgb(0,0,0)');
      g.fillStyle = grd; g.fillRect(-rx, -rx, rx * 2, rx * 2);
      g.restore();
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(PW, ph), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.4,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    pool.position.set(0, ly + UP - ph / 2, -WALL + 0.004);
    const spot = new THREE.SpotLight(0xffe2b8, 9, 2.6, 0.8, 0.7, 1);
    spot.position.set(0, ly - 0.03, lz + 0.05);
    spot.target.position.set(0, -fh * 0.15, 0);
    const fill = new THREE.PointLight(0xffe6c8, 0.9, 1.8, 1);   // (and a gentle warm light from the front, so the whole frame reads)
    fill.position.set(0, 0.1, 0.55);
    outer.add(bar, bulb, arm, pool, spot, spot.target, fill);
  }
  outer.traverse(o => { o.userData.portalFrame = true; });
  return {
    group: outer,
    update(t) { U.time.value = t; light.intensity = 0.22 + 0.05 * Math.sin(t * 1.1) + U.flare.value * 0.6; glow.material.opacity = 0.75 + 0.25 * Math.sin(t * 1.7); },
    flare(k) { U.flare.value = k; }
  };
}

// ---------- The Workshop's look at it: the portal turning on its own ----------
export function build() {
  const f = makePortalFrame();
  f.group.scale.setScalar(3); f.group.position.y = H * SIZE / 2 * 3 + 0.1;
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false;
  const t0 = performance.now();
  ticker.onBeforeRender = () => f.update((performance.now() - t0) / 1000);
  f.group.add(ticker);
  return f.group;
}
// >>>>> END OF FILE: HangoutRoom/pieces/portalframe.js <<<<<
