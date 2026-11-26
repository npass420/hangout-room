// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/denvanish.js <<<<<
// The den vanishing, as seen from out in the gallery (from the user's Kindroid picture): a bright gold ring lights on
// the floor round the black glass column's foot, with gold glitter scattered round it; gold glitter creeps up the
// glass from the bottom until it coats the column, sparkling; then the column dissolves from the top down, each part
// breaking into gold dust and little star flares that stream upward in a narrowing plume and fade away. Then the ring
// fades. Coming back runs it all backwards: the dust falls back into place, the glass forms, the glitter fades off it.
// It stands its own copy of the curtain's black glass, so the den itself is simply hidden while this plays.
//   makeDenVanish({ radius, height })   the column (its middle at x = 0, z = 0, standing on y = 0)
//     .group                  add it to the scene
//     .out({ onStart, onGone })   onStart: hide the den now (this copy stands in); onGone: the column is all gone
//     .in({ onDone })             onDone: the copy is whole again: show the den
//     .update(dt)             every frame
//   build()                   the Workshop's look at it: the column vanishing, four nodes appearing, then back
// =====================================================================================================================
import * as THREE from 'three';
import { makePortalNode } from './portalnode.js';

// the timeline, in seconds (coming back runs it backwards)
const T = { ring: 0.5, coatFrom: 0.2, coatTo: 1.7, cutFrom: 1.7, cutTo: 3.6, ringOut: 3.4, end: 6.2 };

const HASH = `float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

export function makeDenVanish({ radius = 1.97, height = 3.28, count = 3200 } = {}) {
  const group = new THREE.Group();
  const U = { coat: { value: -1 }, cut: { value: height + 1 }, time: { value: 0 } };

  // ---------- the column: the curtain's black glass, with glitter creeping up it and its top dissolving ----------
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x040407, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide });
  glass.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uCoat: U.coat, uCut: U.cut, uTime: U.time });
    sh.vertexShader = 'varying vec3 vCol;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vCol = position;');
    sh.fragmentShader = `varying vec3 vCol; uniform float uCoat, uCut, uTime;\n${HASH}\n` + sh.fragmentShader
      .replace('void main() {', `void main() {
        float yy = vCol.y;
        if (yy > uCut) discard;   // (dissolved away)`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float ang = atan(vCol.z, vCol.x) * ${radius.toFixed(3)};
          vec2 cell = vec2(ang, yy) * 260.0, id = floor(cell), f = fract(cell);
          float h = h21(id), h2 = h21(id + 17.0);
          float dotk = smoothstep(0.32, 0.0, length(f - vec2(h, h2)));
          float tw = pow(0.5 + 0.5 * sin(uTime * (3.0 + h * 9.0) + h2 * 60.0), 2.0);
          float coat = 1.0 - smoothstep(uCoat - 0.35, uCoat, yy);           // (coated below the creeping line, thinning at it)
          float thick = mix(0.86, 0.6, smoothstep(0.8, 0.0, yy));          // (thickest at the foot)
          float glit = dotk * step(thick, h) * (0.3 + 0.7 * tw) * coat;
          float edge = smoothstep(0.12, 0.0, uCut - yy) * step(uCut, ${(height + 0.5).toFixed(2)});   // (the dissolving edge burns bright)
          vec3 gold = vec3(1.0, 0.68, 0.24);
          totalEmissiveRadiance += gold * (glit * 3.5 + coat * 0.05 + edge * (1.2 + 3.0 * dotk));
        }`);
  };
  glass.customProgramCacheKey = () => 'denvanish';
  const column = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 160, 24, true).translate(0, height / 2, 0), glass);
  column.visible = false;
  group.add(column);

  // ---------- the ring on the floor round its foot, the light it throws, and glitter scattered round it ----------
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.72, 0.28).multiplyScalar(2.6), transparent: true, opacity: 0,
    depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.06, 0.012, 8, 220), ringMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.012;
  group.add(ring);
  const washU = { op: { value: 0 } };
  const wash = new THREE.Mesh(new THREE.RingGeometry(radius * 0.7, radius * 1.7, 160, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: washU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float op; varying vec3 vP;
      void main() { float d = abs(length(vP.xz) - ${(radius * 1.06).toFixed(3)}); float a = exp(-d * d / 0.03) * 0.55 + exp(-d * d / 0.003) * 0.6;
        a *= op; gl_FragColor = vec4(vec3(1.0, 0.66, 0.25) * a, a); }`
  }));
  wash.position.y = 0.006;
  group.add(wash);

  // ---------- the dust: shed from the glass as the dissolving edge passes, streaming up in a narrowing plume ----------
  // plus glitter lying on the floor round the ring
  const home = new Float32Array(count * 3), info = new Float32Array(count * 4);   // info: release time, life, rise speed, seed
  const FLOOR = Math.floor(count * 0.18);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, s = Math.random();
    if (i < FLOOR) {   // (on the floor round the ring)
      const r = radius * (1.06 + (Math.random() - 0.35) * 0.35 * Math.pow(Math.random(), 1.5) * 2);
      home.set([Math.cos(a) * r, 0.01, Math.sin(a) * r], i * 3);
      info.set([-1, 0, 0, s], i * 4);
    } else {
      const y = Math.random() * height, r = radius * (1.0 + (Math.random() - 0.5) * 0.02);
      home.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      const release = T.cutFrom + (1 - y / height) * (T.cutTo - T.cutFrom) + (Math.random() - 0.5) * 0.12;
      info.set([release, 1.6 + Math.random() * 1.0, 0.4 + Math.random() * 1.1, s], i * 4);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(home, 3));
  geo.setAttribute('info', new THREE.BufferAttribute(info, 4));
  const DU = { t: { value: 0 }, time: { value: 0 }, floorOp: { value: 0 }, px: { value: 400 } };
  const dust = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: DU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float t, time, floorOp, px; attribute vec4 info; varying float vA, vSeed, vTw;
      void main() {
        vec3 p = position;
        float s = info.w;
        vSeed = s;
        vTw = pow(0.5 + 0.5 * sin(time * (4.0 + s * 10.0) + s * 70.0), 2.0);
        if (info.x < 0.0) {   // (floor glitter: there while the ring is)
          vA = floorOp * (0.25 + 0.75 * vTw);
        } else {
          float age = t - info.x;
          if (age < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }   // (still part of the glass)
          float k = clamp(age / info.y, 0.0, 1.0);
          float rise = info.z * age + 0.25 * age * age;                       // (speeding up a little as it rises)
          float inward = 1.0 - 0.7 * (1.0 - exp(-age * 0.9));                   // (the plume narrows as it goes)
          float sw = age * (0.25 + s * 0.6);
          float c = cos(sw), sn = sin(sw);
          vec2 xz = vec2(c * p.x - sn * p.z, sn * p.x + c * p.z) * inward;
          xz += vec2(sin(s * 40.0 + age * 2.0), cos(s * 31.0 + age * 1.7)) * 0.08 * age;   // (a little wander)
          p = vec3(xz.x, p.y + rise, xz.y);
          vA = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.08, age) * (0.35 + 0.65 * vTw);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float big = step(0.93, s);                                              // (a few big star flares among the dust)
        gl_PointSize = px * (0.012 + 0.03 * s * s + big * 0.09) * (0.5 + 0.7 * vTw) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA, vSeed, vTw;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float core = exp(-dot(q, q) * 70.0);
        float beams = exp(-abs(q.x) * 34.0) * exp(-abs(q.y) * 5.0) + exp(-abs(q.y) * 34.0) * exp(-abs(q.x) * 5.0);   // (a four point star)
        float star = core + beams * step(0.8, vSeed) * vTw;
        vec3 col = mix(vec3(1.0, 0.66, 0.22), vec3(1.0, 0.93, 0.78), step(0.9, vSeed));   // (mostly gold, a few white)
        float a = star * vA;
        gl_FragColor = vec4(col * a * 2.2, a);
      }`
  }));
  dust.frustumCulled = false;
  dust.visible = false;
  group.add(dust);

  let mode = null, t = 0, cb = {};
  const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  function show(t) {   // (everything as it is t seconds into the vanishing)
    const ringK = sm(t / T.ring) * (1 - sm((t - T.ringOut) / 0.9));
    ringMat.opacity = ringK; washU.op.value = ringK; DU.floorOp.value = ringK;
    ring.visible = wash.visible = ringK > 0.001;
    U.coat.value = -0.4 + (height + 0.8) * sm((t - T.coatFrom) / (T.coatTo - T.coatFrom));
    U.cut.value = t < T.cutFrom ? height + 1 : height * (1 - (t - T.cutFrom) / (T.cutTo - T.cutFrom));
    column.visible = U.cut.value > 0.001;
    DU.t.value = t;
    dust.visible = ringK > 0.001 || (t > T.cutFrom && t < T.end);
  }
  return {
    group,
    out({ onStart, onGone } = {}) { mode = 'out'; t = 0; cb = { onGone, gone: false }; show(0); if (onStart) onStart(); },
    in({ onDone } = {}) { mode = 'in'; t = T.end; cb = { onDone }; show(t); },
    get playing() { return !!mode; },
    update(dt) {
      U.time.value += dt; DU.time.value += dt;
      DU.px.value = (window.innerHeight || 800) * Math.min(window.devicePixelRatio || 1, 2) * 0.5;
      if (!mode) return;
      if (mode === 'out') {
        t += dt; show(t);
        if (!cb.gone && t >= T.cutTo) { cb.gone = true; if (cb.onGone) cb.onGone(); }
        if (t >= T.end) { mode = null; column.visible = dust.visible = ring.visible = wash.visible = false; }
      } else {
        t -= dt * 1.35; show(Math.max(0, t));   // (coming back a little quicker)
        if (t <= 0) { mode = null; column.visible = dust.visible = ring.visible = wash.visible = false; if (cb.onDone) cb.onDone(); }
      }
    }
  };
}

// ---------- The Workshop's look at it: the column vanishing, nodes appearing where it was, then it all coming back ----------
export function build() {
  const R = 1.4, H = 2.4;
  const holder = new THREE.Group();
  const column = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 160, 1, true), new THREE.MeshPhysicalMaterial({
    color: 0x040407, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide }));
  column.position.y = H / 2;
  holder.add(column);
  const v = makeDenVanish({ radius: R, height: H, count: 2600 });
  holder.add(v.group);
  const nodes = [0, 1, 2, 3].map(k => {
    const n = makePortalNode({ floorDrop: 1.0 }), a = k * Math.PI / 2;
    n.group.position.set(Math.sin(a) * R * 0.55, 1.0, Math.cos(a) * R * 0.55);
    n.appear(0); n.group.visible = false;
    holder.add(n.group);
    return { n, k: 0 };
  });
  let t = 0, last = performance.now(), want = 0, step = -1;
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false;   // (an invisible speck, drawn every frame, so it's driven by its own drawing and stops when unloaded)
  holder.add(ticker);
  ticker.onBeforeRender = () => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    t += dt;
    const cycle = t % 16;
    if (cycle < 1 && step !== 0) { step = 0; v.out({ onStart: () => { column.visible = false; }, onGone: () => { want = 1; } }); }
    if (cycle > 10 && step !== 1) { step = 1; want = 0; v.in({ onDone: () => { column.visible = true; } }); }
    for (const o of nodes) {
      o.k += Math.sign(want - o.k) * Math.min(Math.abs(want - o.k), dt / (want ? 0.6 : 0.3));
      o.n.group.visible = o.k > 0.001;
      o.n.appear(o.k); o.n.update(t);
    }
    v.update(dt);
  };
  return holder;
}
// >>>>> END OF FILE: HangoutRoom/pieces/denvanish.js <<<<<
