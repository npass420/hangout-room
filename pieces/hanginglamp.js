// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/hanginglamp.js <<<<<
// The floating lamp, from your Kindroid picture: a thin porcelain teardrop with a glowing core.
//   1  the shell: real thin porcelain (your kintsugi tile: ivory glaze, cracks mended in raised gold), about 6 mm
//      thick, its upper cone cut in flat facets melting into the round bulb
//   2  the windows: four leaning teardrop windows, a quarter turn apart (a cross), cut clean through the shell; the cut edge is
//      rounded over, so you see the shell is one thin solid piece
//   3  inside, floating free: a cylinder core of fogged glass from top to bottom, with a soft flicker behind the fog;
//      no bulb, no glare; a hidden light under it lets the glow fall onto the table
//   no cord: it floats like a flame, drifting up and down and swaying; its top is cut flat with a table corner jewel on it
// It turns very slowly, so everyone round the table sees a window come by.
//   makeLamp()   { group, parts, light }: the lamp with its top at y = 0, hanging down (meters, half a meter tall);
//                parts: its meshes (to click); light: its glow (set .userData.level; it flickers round that)
//   build()      the Workshop's look: the lamp floating above the stand
// =====================================================================================================================
import * as THREE from 'three';
import { make } from './materials.js';
import { jewel } from './goldjewel.js';

const GOLD = new THREE.MeshPhysicalMaterial({ color: 0xe8b552, metalness: 1, roughness: 0.16 });
// The teardrop's outline, from its rounded bottom up to the neck at its top (half its width, height), meters
const FLAME = [[0.0005, 0], [0.06, 0.008], [0.11, 0.03], [0.145, 0.07], [0.16, 0.12], [0.155, 0.17], [0.135, 0.23],
               [0.105, 0.3], [0.07, 0.37], [0.04, 0.43], [0.022, 0.48], [0.017, 0.5]];
const H = 0.5;
// The top is cut flat, just low enough to seat one of the table's corner jewels lying on it
const JEWEL = { width: 0.054, height: 0.0765 };   // (the table's corner jewel, 10% smaller)
const OVAL = { x: JEWEL.width / 2 + 0.0015, z: JEWEL.height / 2 + 0.0015 };   // (the flat top: the jewel's own oval, a hair wider, flush)
const TOP_AT = 0.452, OVAL_FROM = 0.37;   // (how high the flat top sits, and where the cone starts turning into its oval)
const SEG = 180, ROWS = 140;          // (round, and up)
const SIZE = 0.9;                     // (the whole lamp's scale: 10% smaller than first built)
const THICK = 0.006;                  // (the porcelain's thickness)
const CORE = { r: 0.042, y0: 0.035, y1: 0.36 };   // (the glass core: its radius, and its bottom and top up from the lamp's bottom)

// ---------- The outline, smooth ----------
let curve = null;
function radiusAt(v) {   // (half width and height at a point up the outline, v from 0 to 1, along a smooth curve)
  if (!curve) curve = new THREE.SplineCurve(FLAME.map(([r, y]) => new THREE.Vector2(r, y)));
  const p = curve.getPoint(Math.min(1, Math.max(0, v)));
  return [Math.max(0.0005, p.x), p.y];
}
let VTOP = 1, TOPY = H, VOVAL = 1;
(() => {
  const vAt = y => { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (radiusAt(m)[1] < y) lo = m; else hi = m; } return lo; };
  VTOP = vAt(TOP_AT); TOPY = radiusAt(VTOP)[1]; VOVAL = vAt(OVAL_FROM);
})();
function ovalR(phi) { const sx = Math.sin(phi), cz = Math.cos(phi); return 1 / Math.sqrt(sx * sx / (OVAL.x * OVAL.x) + cz * cz / (OVAL.z * OVAL.z)); }
const FACETS = 9;
function facet(phi, v) {   // (how far in the stone sits at this angle and height: 1 round, less on a facet's flat middle)
  const t = Math.min(1, Math.max(0, (v - 0.4) / 0.32)), f = t * t * (3 - 2 * t), step = Math.PI * 2 / FACETS;
  const a = (phi % step + step) % step;
  return 1 + f * (Math.cos(Math.PI / FACETS) / Math.cos(a - Math.PI / FACETS) - 1);
}
function at(u, v, inset = 0) {   // (a point on the shell: u round from the back (0.5 the front), v up; inset: how far in)
  const phi = Math.PI + u * Math.PI * 2, [r0, y] = radiusAt(v);
  const t = Math.min(1, Math.max(0, (v - VOVAL) / (VTOP - VOVAL))), b = t * t * (3 - 2 * t);   // (near the top, the cone turns into the jewel's oval)
  const r = (Math.max(0.002, r0 - inset) * facet(phi, v)) * (1 - b) + Math.max(0.002, ovalR(phi) - inset) * b;
  return new THREE.Vector3(Math.sin(phi) * r, y - TOPY, Math.cos(phi) * r);   // (its flat top at y = 0)
}

// ---------- The windows, on the shell unrolled ----------
function windowLine() {   // (a leaning teardrop: round at the bottom, rising to a point that leans left, on the bulb's middle)
  const v0 = 0.34, v1 = 0.68, N = 120, L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, v = v0 + t * (v1 - v0);
    const half = 0.056 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.6)), 0.85) * (1 - 0.45 * t);
    const mid = 0.512 - 0.045 * t * t;   // (the lean: the point drifts left as it rises)
    L.push([mid - half, v]); R.push([mid + half, v]);
  }
  return L.concat(R.reverse());
}
const WINDOWS = (() => { const w = windowLine(); return [0, 0.25, 0.5, 0.75].map(d => w.map(([u, v]) => [u - d, v])); })();   // (four, a quarter turn apart: a cross)
let cutTex = null;
function cutouts() {   // (the shell unrolled: white where it's solid, black where it's cut away)
  if (cutTex) return cutTex;
  const W = 2048, c = document.createElement('canvas'); c.width = c.height = W;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, W); g.fillStyle = '#000';
  for (const line of WINDOWS) for (const sh of [-1, 0, 1]) {   // (shifted a turn each way, so one crossing the back seam is whole)
    g.beginPath(); line.forEach(([u, v], i) => i ? g.lineTo((u + sh) * W, (1 - v) * W) : g.moveTo((u + sh) * W, (1 - v) * W));
    g.closePath(); g.fill();
  }
  cutTex = new THREE.CanvasTexture(c);
  cutTex.channel = 1;   // (it reads the shell's unrolled layout, kept in its second set of coordinates)
  return cutTex;
}

// The fogged glass inside: warm frosted glass lit from within, a soft mottled mist, brightest at the front of the bulb
let fogTex = null;
function fog() {
  if (fogTex) return fogTex;
  const W = 1024, c = document.createElement('canvas'); c.width = c.height = W;
  const g = c.getContext('2d');
  const base = g.createLinearGradient(0, W, 0, 0);
  base.addColorStop(0, '#f6c878'); base.addColorStop(0.3, '#fff0c8'); base.addColorStop(0.62, '#ffe2a0'); base.addColorStop(1, '#c8903e');
  g.fillStyle = base; g.fillRect(0, 0, W, W);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {   // (the mist: many soft clouds, pale and amber)
    const x = rnd() * W, y = rnd() * W, r = 10 + rnd() * 70, pale = rnd() < 0.55;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, pale ? 'rgba(255,250,235,0.10)' : 'rgba(220,150,60,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const hot = g.createRadialGradient(W * 0.5, W * 0.62, 0, W * 0.5, W * 0.62, W * 0.42);   // (warmest at the front, low on the bulb)
  hot.addColorStop(0, 'rgba(255,248,225,0.45)'); hot.addColorStop(1, 'rgba(255,248,225,0)');
  g.fillStyle = hot; g.fillRect(0, 0, W, W);
  fogTex = new THREE.CanvasTexture(c); fogTex.colorSpace = THREE.SRGBColorSpace;
  return fogTex;
}

// ---------- The shell: an outer and an inner surface, the same layout, THICK apart ----------
function surface(inset) {
  const g = new THREE.PlaneGeometry(1, 1, SEG, ROWS), pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * VTOP);   // (up only as far as the flat top)
  for (let i = 0; i < pos.count; i++) { const p = at(uv.getX(i), uv.getY(i), inset); pos.setXYZ(i, p.x, p.y, p.z); }
  g.setAttribute('uv1', uv.clone());   // (the unrolled layout, for the windows)
  const tex = new Float32Array(uv.count * 2);   // (the porcelain picture: twice round, once up; mirrored, so no seam)
  for (let i = 0; i < uv.count; i++) { tex[i * 2] = uv.getX(i) * 2; tex[i * 2 + 1] = uv.getY(i) * 1.1; }
  g.setAttribute('uv', new THREE.BufferAttribute(tex, 2));
  g.computeVertexNormals();
  return g;
}

export function makeLamp() {
  const group = new THREE.Group();
  const porcelain = make('Porcelain, gold kintsugi');
  porcelain.alphaMap = cutouts(); porcelain.alphaTest = 0.5; porcelain.side = THREE.DoubleSide;
  const outer = new THREE.Mesh(surface(0), porcelain);
  // (the inside face: warm, lit only by the core's glow; real lights would blow it white this close)
  const inner = new THREE.Mesh(surface(THICK), new THREE.MeshBasicMaterial({ map: porcelain.map, color: new THREE.Color(0.95, 0.74, 0.46),
    alphaMap: porcelain.alphaMap, alphaTest: 0.5, side: THREE.DoubleSide }));
  group.add(outer, inner);
  // the cut edge: rounded over smoothly from the outer face to the inner, so it reads as one thin solid piece
  const edgeMat = porcelain.clone(); edgeMat.alphaMap = null; edgeMat.alphaTest = 0;
  for (const line of WINDOWS) {
    const n = line.length, ROUND = 10, pos = [], idx = [], tex = [];
    const O = line.map(([u, v]) => at(u, v, 0)), I = line.map(([u, v]) => at(u, v, THICK));
    const mid = O.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / n);
    for (let k = 0; k < n; k++) {
      const c = O[k].clone().add(I[k]).multiplyScalar(0.5), half = O[k].clone().sub(c);
      const into = new THREE.Vector3().crossVectors(half, O[(k + 1) % n].clone().sub(O[(k - 1 + n) % n])).normalize();
      if (into.dot(mid.clone().sub(O[k])) < 0) into.negate();
      for (let j = 0; j <= ROUND; j++) {
        const a = j / ROUND * Math.PI, p = c.clone().addScaledVector(half, Math.cos(a)).addScaledVector(into, THICK * 0.6 * Math.sin(a));
        pos.push(p.x, p.y, p.z); tex.push(line[k][0] * 2, line[k][1] * 1.1);
      }
    }
    for (let k = 0; k < n; k++) for (let j = 0; j < ROUND; j++) {
      const a = k * (ROUND + 1) + j, b = ((k + 1) % n) * (ROUND + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(tex, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, edgeMat));
  }
  // the core: a standing cylinder of fogged glass, lit from within, a soft flicker behind the fog
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(CORE.r, CORE.r, CORE.y1 - CORE.y0, 64, 24, true), new THREE.MeshPhysicalMaterial({
    color: 0x1a140c, roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.28,
    emissive: 0xffd89a, emissiveMap: fog(), emissiveIntensity: 1.35 }));
  glass.position.y = (CORE.y0 + CORE.y1) / 2 - TOPY;
  group.add(glass);
  const flick = { value: 0 };
  glass.material.onBeforeCompile = sh => {
    sh.uniforms.uFlick = flick;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLampPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLampPos = transformed;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vLampPos; uniform float uFlick;
      float fh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float fn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 q = vLampPos * vec3(14.0, 9.0, 14.0) - vec3(0.0, uFlick * 1.6, 0.0);
        float n = fn(q) * 0.6 + fn(q * 2.1 + 7.0) * 0.4;                    // (the crawling flicker)
        float breathe = 0.93 + 0.07 * sin(uFlick * 7.3) * sin(uFlick * 3.1 + 1.0);   // (and the whole glow breathing)
        totalEmissiveRadiance *= breathe * (0.8 + 0.38 * n);
      }`);
  };
  // the flat top: porcelain, closing the shell (its rim follows the facets), with a table corner jewel lying on it
  const ring = [];
  for (let i = 0; i <= SEG; i++) ring.push(at(i / SEG, VTOP, 0));
  const lid = new THREE.BufferGeometry(), lp = [0, 0, 0], luv = [0.5, 0.5], li = [];
  ring.forEach(p => { lp.push(p.x, 0, p.z); luv.push(0.5 + p.x * 6, 0.5 + p.z * 6); });
  for (let i = 1; i <= SEG; i++) li.push(0, i + 1, i);
  lid.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lid.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
  lid.setIndex(li); lid.computeVertexNormals();
  const lidMat = porcelain.clone(); lidMat.alphaMap = null; lidMat.alphaTest = 0;
  group.add(new THREE.Mesh(lid, lidMat));
  const gem = jewel(JEWEL);
  gem.rotation.x = -Math.PI / 2;   // (lying flat, the dome up, like on the table)
  gem.position.y = 0.0002;
  group.add(gem);
  // the hidden light inside, so the glow falls out through the windows onto the table
  // (a soft spot just under its bottom, shining down: it lights the table, never the lamp itself)
  const light = new THREE.SpotLight(0xffd59a, 0.8, 4, 1.15, 1, 2);
  light.position.y = -TOPY - 0.005;
  light.target.position.y = -TOPY - 1;
  group.add(light, light.target);
  // all of it in a body that floats: the lamp group keeps its place (and turns), the body drifts inside it
  const body = new THREE.Group();
  while (group.children.length) body.add(group.children[0]);
  group.add(body);
  body.scale.setScalar(SIZE);   // (the whole lamp, scaled from its top)
  const parts = [];
  group.traverse(o => { if (o.isMesh) { o.userData.curtainLamp = true; parts.push(o); } });
  // it turns very slowly, and the flicker runs
  let last = performance.now();
  const base = light.intensity;
  outer.onBeforeRender = () => {
    const now = performance.now(), t = now / 1000;
    group.rotation.y += Math.min(0.1, (now - last) / 1000) * 0.12; last = now;
    flick.value = t;
    // it floats like a flame: drifting up and down and swaying a little, never quite repeating
    body.position.y = 0.012 * Math.sin(t * 0.71) + 0.007 * Math.sin(t * 1.13 + 1.7) + 0.004 * Math.sin(t * 2.31 + 0.4);
    body.rotation.x = 0.03 * Math.sin(t * 0.53 + 0.9) + 0.012 * Math.sin(t * 1.37);
    body.rotation.z = 0.025 * Math.sin(t * 0.81 + 2.1) + 0.01 * Math.sin(t * 1.71 + 0.3);
    light.intensity = (light.userData.level ?? base) * (0.9 + 0.06 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1.0) + 0.04 * Math.sin(t * 13.7));
  };
  return { group, parts, light };
}

export function build() {   // (the Workshop's look: the lamp floating above the stand, like over the table)
  const g = new THREE.Group(), { group } = makeLamp();
  group.position.y = 1.45;
  g.add(group);
  return g;
}
// >>>>> END OF FILE: HangoutRoom/pieces/hanginglamp.js <<<<<
