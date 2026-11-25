// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/portalnode.js <<<<<
// Portal node (from the user's Kindroid sphere): a floating sphere of dark smoky glass with real depth inside it, where
// fine gold glitter swirls in a slow spiral band like a tiny galaxy, with one hot bright spot of gold in it. A big soft
// white reflection rides its top, a dark mirror sheen its sides. A wide glossy black band hugs it on a tilt, edged with
// two glowing gold lines, slowly turning. Soft gold motes drift round it, and a pool of gold glitter twinkles on the
// floor beneath it. Out in the gallery while the den's curtain is down, one floats where each open throne was: click
// it to port into that throne.
//   makePortalNode({ floorDrop })   floorDrop: how far below the node the floor is (for its glitter pool)
//     gives back { group, update(t), appear(k) }
//     appear(k)        0 gone .. 1 there (it swells in with a little overshoot)
//   build()            the Workshop's look at it: one node, 2.5 times its size, floating
// =====================================================================================================================
import * as THREE from 'three';

const R = 0.1;   // the sphere's radius (meters)
const HASH = `
  float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  vec3 h33(vec3 p) { return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453); }`;

function softDot(hard) {   // (a round dot: soft for bokeh, tighter for glints)
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hard) { grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.4)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); }
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let BOKEH = null, GLOW = null;

export function makePortalNode({ floorDrop = 1.15 } = {}) {
  if (!BOKEH) { BOKEH = softDot(false); GLOW = softDot(true); }
  const group = new THREE.Group();
  const body = new THREE.Group();   // (it bobs; the floor pool stays put)
  group.add(body);
  const seed = Math.random() * 50;
  const uniforms = { time: { value: 0 }, seed: { value: seed } };

  // ---------- the sphere: smoky glass, looked into: gold glitter swirling inside, then its surface sheen ----------
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vObj, vCam, vN, vV;
      void main() {
        vObj = position;
        vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float time, seed; varying vec3 vObj, vCam, vN, vV;
      ${HASH}
      const float R = ${R.toFixed(4)};
      vec3 swirl(vec3 p) {   // (turned about a tilted axis, the middle faster than the outside: a slow spiral)
        float c0 = cos(0.42), s0 = sin(0.42);
        p = vec3(p.x, c0 * p.y - s0 * p.z, s0 * p.y + c0 * p.z);
        float r = length(p.xz) / R, a = time * 0.35 * (1.5 - r) + seed;
        float c = cos(a), s = sin(a);
        return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
      }
      void main() {
        vec3 d = normalize(vObj - vCam);
        float len = max(-2.0 * dot(vObj, d), 0.0);   // (through the sphere and out its far side)
        vec3 glit = vec3(0.0); float haze = 0.0;
        const int STEPS = 26;
        vec3 hotAt = vec3(-0.35, -0.05, 0.25) * R;
        for (int i = 0; i < STEPS; i++) {
          vec3 p = vObj + d * len * (float(i) + 0.5) / float(STEPS);
          vec3 q = swirl(p);
          float r = length(q.xz) / R;
          float arm = 0.5 + 0.5 * sin(atan(q.z, q.x) * 2.0 - r * 7.0);          // (two spiral arms)
          float band = exp(-pow(q.y / (R * 0.2), 2.0)) * (0.35 + 0.65 * arm) * smoothstep(1.0, 0.75, r);
          vec3 cell = q / (R * 0.075), id = floor(cell), f = fract(cell);
          vec3 at = h33(id + seed);
          float h = h31(id + 7.3);
          float dd = length(f - at);
          float tw = 0.55 + 0.45 * sin(time * (2.0 + h * 6.0) + h * 40.0);
          float keep = mix(0.82, 0.45, band);                                   // (thicker glitter in the band)
          glit += vec3(1.0, 0.72, 0.3) * smoothstep(0.16, 0.0, dd) * step(keep, h) * tw * (0.25 + band) * 1.4;
          haze += band * 0.035;
          glit += vec3(1.0, 0.82, 0.5) * exp(-pow(length(p - hotAt) / (R * 0.09), 2.0)) * 0.35;   // (the hot spot)
        }
        glit /= float(STEPS) * 0.18;
        vec3 n = normalize(vN), v = normalize(vV);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 2.5);
        vec3 col = vec3(0.012, 0.011, 0.014) + glit + vec3(0.9, 0.55, 0.2) * haze * 0.6;
        col *= 1.0 - fres * 0.55;                                                     // (the edges darker: smoky glass)
        vec3 rd = reflect(-v, n);
        float top = smoothstep(0.55, 0.95, dot(rd, normalize(vec3(0.35, 0.9, 0.25))));   // (the big soft reflection up top)
        col += vec3(0.85, 0.86, 0.9) * top * 0.55 * (0.4 + 0.6 * fres);
        col += vec3(1.0) * pow(max(dot(rd, normalize(vec3(-0.45, 0.35, 0.82))), 0.0), 220.0) * 1.4;   // (one small sharp glint)
        col += vec3(0.25, 0.27, 0.32) * fres * 0.35;                                  // (the dark mirror sheen round its sides)
        col += vec3(1.0, 0.7, 0.3) * pow(fres, 4.0) * 0.25;                           // (a faint warm rim from the band's light)
        gl_FragColor = vec4(col, 1.0);
      }`
  }));
  body.add(sphere);

  // ---------- the band: glossy black, hugging the sphere on a tilt, edged with two glowing gold lines ----------
  const bandHolder = new THREE.Group();
  bandHolder.rotation.set(0.38, 0, -0.22);
  const spinBand = new THREE.Group();
  bandHolder.add(spinBand);
  const BH = R * 0.24, BR = R * 1.035;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(BR, BR, BH, 96, 1, true), new THREE.MeshPhysicalMaterial({
    color: 0x030304, roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide,
    emissive: 0x120a03 }));
  spinBand.add(band);
  const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.68, 0.25).multiplyScalar(2.6), toneMapped: false });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.TorusGeometry(BR + 0.0006, 0.0022, 8, 128), edgeMat);
    e.rotation.x = Math.PI / 2; e.position.y = s * BH / 2;
    spinBand.add(e);
  }
  body.add(bandHolder);

  // ---------- soft gold motes drifting round it (blurry bokeh), and a glow ----------
  const MOTES = 18, mo = new Float32Array(MOTES * 4);
  for (let i = 0; i < MOTES; i++) mo.set([Math.random() * 6.283, R * (1.8 + Math.random() * 2.2), (Math.random() - 0.5) * R * 3.0, 0.08 + Math.random() * 0.2], i * 4);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  moteGeo.setAttribute('orbit', new THREE.BufferAttribute(mo, 4));
  const pointMat = (vert, frag, map) => new THREE.ShaderMaterial({ uniforms: { time: uniforms.time, fade: { value: 1 }, map: { value: map } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: vert, fragmentShader: frag });
  const motes = new THREE.Points(moteGeo, pointMat(
    `uniform float time; attribute vec4 orbit; varying float vA;
     void main() {
       float a = orbit.x + time * orbit.w;
       vec3 p = vec3(cos(a) * orbit.y, orbit.z + sin(time * 0.4 + orbit.x * 3.0) * 0.02, sin(a) * orbit.y);
       vec4 mv = modelViewMatrix * vec4(p, 1.0);
       vA = 0.35 + 0.3 * sin(time * 0.8 + orbit.x * 5.0);
       gl_PointSize = (6.0 + 8.0 * fract(orbit.x)) * 1.6 / -mv.z;
       gl_Position = projectionMatrix * mv;
     }`,
    `uniform sampler2D map; uniform float fade; varying float vA;
     void main() { float a = texture2D(map, gl_PointCoord).a * vA * fade; gl_FragColor = vec4(vec3(1.0, 0.66, 0.25) * a * 1.5, a); }`, BOKEH));
  motes.frustumCulled = false;
  body.add(motes);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffa940, transparent: true, opacity: 0.3,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.scale.set(0.5, 0.5, 1);
  body.add(glow);
  const light = new THREE.PointLight(0xffb052, 0.45, 2.4, 2);
  body.add(light);

  // ---------- the glitter pool on the floor beneath it ----------
  const POOL = 260, pp = new Float32Array(POOL * 3), ps = new Float32Array(POOL);
  for (let i = 0; i < POOL; i++) {
    const a = Math.random() * 6.283, r = Math.pow(Math.random(), 1.6) * 0.42;
    pp.set([Math.cos(a) * r, 0, Math.sin(a) * r * 0.85], i * 3); ps[i] = Math.random();
  }
  const poolGeo = new THREE.BufferGeometry();
  poolGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  poolGeo.setAttribute('seed', new THREE.BufferAttribute(ps, 1));
  const pool = new THREE.Points(poolGeo, pointMat(
    `uniform float time; attribute float seed; varying float vA;
     void main() {
       vec4 mv = modelViewMatrix * vec4(position, 1.0);
       float tw = pow(0.5 + 0.5 * sin(time * (2.0 + seed * 7.0) + seed * 50.0), 3.0);
       vA = (0.25 + 0.75 * tw) * (1.0 - length(position.xz) / 0.45);
       gl_PointSize = (2.0 + 5.0 * seed * tw) * 1.4 / -mv.z;
       gl_Position = projectionMatrix * mv;
     }`,
    `uniform sampler2D map; uniform float fade; varying float vA;
     void main() { float a = texture2D(map, gl_PointCoord).a * vA * fade; gl_FragColor = vec4(vec3(1.0, 0.75, 0.32) * a * 2.0, a); }`, GLOW));
  pool.frustumCulled = false;
  pool.position.y = -floorDrop + 0.004;
  group.add(pool);
  const poolGlow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: GLOW, color: 0xff9a30, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  poolGlow.position.y = -floorDrop + 0.003;
  group.add(poolGlow);

  let shown = 1;
  return {
    group,
    appear(k) {
      k = Math.max(0, Math.min(1, k));
      const c = 1.7, e = k >= 1 ? 1 : 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);   // (a little overshoot)
      shown = k;
      body.scale.setScalar(Math.max(0.0001, e));
      pool.material.uniforms.fade.value = k;
      pool.visible = poolGlow.visible = k > 0.01;
      poolGlow.material.opacity = 0.22 * k;
    },
    update(t) {
      uniforms.time.value = t;
      body.position.y = 0.03 * Math.sin(t * 1.1 + seed);
      bandHolder.rotation.y = t * 0.18 + seed;
      spinBand.rotation.y = t * 0.6;
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.7 + seed);
      glow.material.opacity = 0.3 * pulse * shown;
      light.intensity = 0.45 * pulse * shown;
    }
  };
}

// ---------- The Workshop's look at it: one node, 2.5 times its size, floating over the platform ----------
export function build() {
  const holder = new THREE.Group();
  const big = new THREE.Group();
  big.scale.setScalar(2.5);
  big.position.y = 0.6;
  const n = makePortalNode({ floorDrop: 0.6 / 2.5 });
  big.add(n.group);
  holder.add(big);
  let t = 0, last = performance.now();
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false;   // (an invisible speck, drawn every frame, so the node is driven by its own drawing)
  holder.add(ticker);
  ticker.onBeforeRender = () => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    t += dt;
    n.update(t);
  };
  return holder;
}
// >>>>> END OF FILE: HangoutRoom/pieces/portalnode.js <<<<<
