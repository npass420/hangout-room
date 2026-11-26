// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/portalframe.js <<<<<
// The portal frame (from your Kindroid pictures, refs/portal_frame and refs/portal_swirl): a tall frame of chunky
// glossy black stone blocks, a little rough-hewn, with gold running through every seam and a few cracks across them,
// a stepped inner edge, a thin gold trim round the opening, gold caps on the four corners and a gold keystone on top
// with a soft glow over it. Inside, the portal: neon rings of hot pink, teal and violet spiraling slowly inward to a
// bright white core, stardust twinkling through it, the whole thing gently breathing. Its light spills pink onto the
// gold and the black gloss.
//   makePortalFrame()   { group (standing on y = 0, centered, facing +z), update(t), flare(k): 0 .. 1 brighter }
//     everything in it is marked userData.portalFrame, for clicking
//   build()             the Workshop's look at it (it runs itself)
// =====================================================================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GOLD } from './goldjewel.js';

const W = 1.8, H = 2.7, D = 0.3, OW = 1.04, OH = 1.94, LIFT = 0.12;   // outside size, depth, the opening, how high it stands
const STONE = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0e, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
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

// the portal: a spiral of neon rings drawn in its own light
const PORTAL_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const PORTAL_FS = `
  uniform float time, flare, aspect; varying vec2 vUv;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main() {
    vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
    float r = length(p), a = atan(p.y, p.x);
    float breathe = 1.0 + 0.04 * sin(time * 1.1);
    float rr = r / breathe;
    // the rings: a spiral pulled slowly inward, each band broken into streaks along its way round
    float sp = rr * 7.0 + a / 6.2831853 * 2.0 + time * 0.55;
    float band = pow(abs(sin(sp * 3.14159265)), 18.0);
    float streak = smoothstep(0.25, 0.75, n(vec2(a * 6.0 - time * 1.6 + rr * 9.0, rr * 14.0)));
    float rings = band * (0.35 + 0.9 * streak);
    vec3 pink = vec3(1.0, 0.32, 0.82), teal = vec3(0.25, 0.95, 1.0), violet = vec3(0.6, 0.38, 1.0);
    vec3 ringCol = mix(teal, pink, smoothstep(0.18, 0.5, rr));
    ringCol = mix(ringCol, violet, smoothstep(0.75, 1.1, rr) * 0.6);
    ringCol = mix(ringCol, teal, step(0.5, n(vec2(floor(sp), 3.0))) * smoothstep(0.55, 0.9, rr) * 0.7);   // (some outer rings teal)
    // the deep glow behind the rings, and the bright core
    vec3 col = mix(vec3(0.55, 0.22, 0.6), vec3(0.12, 0.05, 0.2), smoothstep(0.0, 1.2, rr)) * 0.75;
    col += ringCol * rings * 1.9;
    float core = exp(-rr * rr * 26.0);
    col += vec3(0.75, 0.95, 1.0) * smoothstep(0.17, 0.12, abs(rr - 0.2)) * 0.9;   // (the teal ring hugging the core)
    col += vec3(1.0, 0.92, 1.0) * core * 1.6;
    // stardust, drifting inward and twinkling
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      vec2 q = vec2(a * (5.0 + fi * 3.0) / 6.2831853 * 6.0, log(rr + 0.05) * (6.0 + fi * 2.0) + time * (0.5 + fi * 0.3));
      vec2 id = floor(q), f = fract(q) - 0.5;
      float s = h(id + fi * 7.0);
      if (s > 0.86) col += vec3(1.0, 0.95, 1.0) * smoothstep(0.12, 0.0, length(f - (vec2(h(id + 1.3), h(id + 4.1)) - 0.5) * 0.6))
                       * (0.5 + 0.5 * sin(time * (3.0 + s * 6.0) + s * 30.0)) * 1.2;
    }
    col *= 1.0 + flare * 1.2;
    col += vec3(1.0, 0.7, 0.35) * pow(max(abs(vUv.x - 0.5) * 2.0, abs(vUv.y - 0.5) * 2.0), 14.0) * 0.7;   // (warm light at the trim)
    gl_FragColor = vec4(col, 1.0);
  }`;

export function makePortalFrame() {
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
      let l = 0.24 + rand() * 0.26;
      if (len - at - l < 0.18) l = len - at;
      const mid = at + l / 2, t = mid / len, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
      const g = horiz ? stone(l - GAP, thick - GAP, depth, rand) : stone(thick - GAP, l - GAP, depth, rand);
      const m = new THREE.Mesh(g, STONE);
      m.position.set(cx, cy, z + (rand() - 0.5) * 0.012);
      solid.push(m);
      at += l;
    }
  }
  const T1 = (W - OW) / 2 - 0.13, T2 = 0.13;   // (outer ring's thickness, inner ring's)
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
    let px = x + (rand() - 0.5) * 0.08, py = y + (rand() - 0.5) * 0.08;
    for (let k = 0; k < 3; k++) {   // (a short wandering crack, three little legs)
      const ang = rand() * Math.PI * 2, len = 0.05 + rand() * 0.07;
      const c = new THREE.Mesh(new THREE.BoxGeometry(len, 0.008 + rand() * 0.006, 0.012), GOLD);
      c.position.set(px + Math.cos(ang) * len / 2, py + Math.sin(ang) * len / 2, D / 2 + 0.002);
      c.rotation.z = ang;
      solid.push(c);
      px += Math.cos(ang) * len; py += Math.sin(ang) * len;
    }
  }

  // the gold trim round the opening
  const tr = 0.035, tz = z2 + d2 / 2 + 0.006;
  for (const [w, h2, x, y] of [[OW + tr * 2, tr, 0, (H - OH) / 2 - tr / 2], [OW + tr * 2, tr, 0, (H + OH) / 2 + tr / 2], [tr, OH, -OW / 2 - tr / 2, H / 2], [tr, OH, OW / 2 + tr / 2, H / 2]]) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h2, 0.05, 2, 0.01), GOLD);
    m.position.set(x, y, tz);
    solid.push(m);
  }
  // gold caps on the corners: a little stepped gold triangle over each corner
  for (const sx of [-1, 1]) for (const sy of [0, 1]) {
    const cap = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.24, 0), new THREE.Vector2(0, 0.24)]);
    const g = new THREE.ExtrudeGeometry(cap, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
    const m = new THREE.Mesh(g, GOLD);
    m.scale.set(-sx, sy ? -1 : 1, 1);
    m.position.set(sx * (W / 2 - 0.005), sy ? H - 0.005 : 0.005, D / 2 - 0.01);
    solid.push(m);
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, D * 0.9), GOLD);   // (and down the corner's side)
    side.position.set(sx * (W / 2 + 0.003), sy ? H - 0.12 : 0.12, 0);
    solid.push(side);
  }
  // the keystone on top: a gold block with a recessed panel and a shield, a soft glow above it
  const key = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.38, D + 0.12, 3, 0.03), GOLD);
  key.position.set(0, H - 0.12, 0.04);
  solid.push(key);
  const panel = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.27, 0.04, 2, 0.01), GOLD_DARK);
  panel.position.set(0, H - 0.12, D / 2 + 0.1);
  solid.push(panel);
  const shield = new THREE.Shape([new THREE.Vector2(-0.055, 0.05), new THREE.Vector2(0.055, 0.05), new THREE.Vector2(0.055, -0.01), new THREE.Vector2(0, -0.075), new THREE.Vector2(-0.055, -0.01)]);
  const sh = new THREE.Mesh(new THREE.ExtrudeGeometry(shield, { depth: 0.02, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 }), GOLD);
  sh.position.set(0, H - 0.11, D / 2 + 0.115);
  solid.push(sh);
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.3, 'rgba(255,200,120,0.5)'); gr.addColorStop(1, 'rgba(255,180,80,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.scale.set(0.5, 0.5, 1); glow.position.set(0, H + 0.1, 0.06);

  for (const m of solid) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  group.add(glow);

  // the portal itself, and its light spilling out
  const U = { time: { value: 0 }, flare: { value: 0 }, aspect: { value: OW / OH } };
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(OW, OH), new THREE.ShaderMaterial({ uniforms: U, vertexShader: PORTAL_VS, fragmentShader: PORTAL_FS, toneMapped: false }));
  portal.position.set(0, H / 2, z2 - d2 / 2 + 0.06);
  group.add(portal);
  const light = new THREE.PointLight(0xff5fc8, 1.4, 4, 1.5);
  light.position.set(0, H / 2, 0.6);
  group.add(light);

  group.position.y = LIFT;
  const outer = new THREE.Group();
  outer.add(group);
  outer.traverse(o => { o.userData.portalFrame = true; });
  return {
    group: outer,
    update(t) { U.time.value = t; light.intensity = 1.2 + 0.3 * Math.sin(t * 1.1) + U.flare.value * 3; glow.material.opacity = 0.75 + 0.25 * Math.sin(t * 1.7); },
    flare(k) { U.flare.value = k; }
  };
}

// ---------- The Workshop's look at it: the portal turning on its own ----------
export function build() {
  const f = makePortalFrame();
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false;
  const t0 = performance.now();
  ticker.onBeforeRender = () => f.update((performance.now() - t0) / 1000);
  f.group.add(ticker);
  return f.group;
}
// >>>>> END OF FILE: HangoutRoom/pieces/portalframe.js <<<<<
