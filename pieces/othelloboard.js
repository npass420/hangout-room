// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/othelloboard.js <<<<<
// The Othello board, from the user's Kindroid picture (its two front sides, carried right round):
//   the squares     8 by 8, checkered black and white crystal, each with a flat polished top and a chamfered edge.
//                   They're space you look down into: black is deep starry night, its nebula slowly drifting and its
//                   stars twinkling (othello_crystal_black_deep.jpg under othello_crystal_black_stars.jpg); white is
//                   frosted crystal (othello_crystal_white.jpg) with a soft white light glowing in its middle, breathing.
//                   The layers sit at different depths, so they slide past each other as you move.
//   the band        glossy black obsidian right round the squares, polished like still water, with a fine gold line
//                   along its inner edge and a row of gold beads along its outer edge. Gold filigree lies on it: a big
//                   spray of scrolls and leaves round each corner, and a smaller one at the middle of each side, all
//                   cast here in code (raised, polished, darker in its hollows).
//   the medallions  a round gold medallion at each inside corner, ringed, with a warm golden white light in its middle.
//   the gold light  a bright golden yellow strip glowing all the way round between the band and the crystal.
//   the crystal     a thick border of rough-cut ice-clear crystal, real see-through glass, faceted, glowing softly
//                   white from within with tiny sparkles, and taller chunky blocks of it at the four corners.
//   the glow        the crystal's soft white light spilling onto whatever the board stands on.
//   makeOthelloBoard({ size })   size: the board across, crystal and all (meters); gives back
//     { group, materials, CELL, TOP }: the group stands on y = 0, centered; CELL: one square; TOP: the squares' top
//   build()                      the Workshop's look at it: the board, with a soft key and edge light of its own
// =====================================================================================================================
import * as THREE from 'three';
import { softEnv } from '../checkers/pieceenv.js';

// ---------- sizes (meters) ----------
const BASE_H = 0.02;      // the crystal base's thickness
const BASE_MARGIN = 0.031;    // how far the crystal base reaches out past the black board
const BOARD_H = 0.052;    // the black board's thickness, on the base
const BAND_W = 0.068;     // the black band round the squares
const GAP = 0.0022;       // the seam between squares
const TILE_D = 0.012, TILE_B = 0.0024;   // a square's thickness and chamfer
const TEX_SPAN = 0.32;    // how far one crystal picture reaches across the squares

const loader = new THREE.TextureLoader();
const pics = {};
function pic(name) {
  if (!pics[name]) {
    const t = loader.load(new URL('textures/' + name, import.meta.url).href);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    t.anisotropy = 8;
    pics[name] = t;
  }
  return pics[name];
}
const shared = { uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() } };   // (every material's clock and where the board is)

// a block from a flat outline, given thickness, standing on y = 0, every edge chamfered (the outline's y runs toward -z)
function block(shape, depth, bevel, segments = 1) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: segments, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}
const outline = pts => { const s = new THREE.Shape(); s.moveTo(...pts[0]); for (let i = 1; i < pts.length; i++) s.lineTo(...pts[i]); s.closePath(); return s; };
// the four mitred pieces of a ring between in (from the middle) and out, as the far side's piece (turned for the rest)
const ringPiece = (inner, outer) => outline([[-inner, inner], [inner, inner], [outer, outer], [-outer, outer]]);

// ---------- the squares: space you look down into ----------
function squareMat(kind, cell) {
  const black = kind === 'black';
  const m = new THREE.MeshPhysicalMaterial({ color: black ? 0x05050b : 0xb8bfd2, roughness: black ? 0.12 : 0.22,
    clearcoat: black ? 0.7 : 0.55, clearcoatRoughness: black ? 0.1 : 0.16, envMapIntensity: black ? 0.9 : 0.45 });   // (the white softer polished: no glare)
  const deep = pic(black ? 'othello_crystal_black_deep.jpg' : 'othello_crystal_white_stardust.jpg');   // (white: the user's frosted crystal with black stardust)
  const top = pic('othello_crystal_black_stars.jpg');   // (the black squares' stars; on the white ones, printed in black)
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, shared, { tDeep: { value: deep }, tTop: { value: top } });
    sh.vertexShader = 'varying vec3 vSqP; varying vec3 vSqN;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
       vSqP = (modelMatrix * vec4(transformed, 1.0)).xyz; vSqN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = `varying vec3 vSqP; varying vec3 vSqN; uniform sampler2D tDeep, tTop; uniform float uTime; uniform vec3 uOrigin;
      float sqH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        const float CELL = ${cell.toFixed(6)}, SPAN = ${TEX_SPAN.toFixed(3)};
        vec3 V = normalize(cameraPosition - vSqP);
        vec2 w = vSqP.xz - uOrigin.xz;
        vec2 cell = floor(w / CELL);
        vec2 cut = vec2(sqH(cell), sqH(cell + 3.7)) * 0.8;               // (each square its own cut)
        float up = clamp(vSqN.y, 0.0, 1.0);
        vec2 par = -V.xz / max(V.y, 0.3) * up;                             // (deeper layers shift more as you look round)
        float t = uTime;
        vec2 driftA = vec2(t * 0.0021, t * 0.0013), driftB = vec2(-t * 0.0012, t * 0.0019);   // (the space drifting, slowly)
        vec3 dp = texture2D(tDeep, (w + par * 0.017) / SPAN * 0.8 + cut + driftA).rgb;
        vec3 md = texture2D(tDeep, (w + par * 0.009) / SPAN * 1.35 + cut * 1.3 + 0.37 + driftB).rgb;
        vec2 tuv = (w + par * 0.0015) / SPAN + cut.yx + driftA * 0.4;
        vec3 tp = texture2D(tTop, tuv).rgb;
        float tw = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(t * (1.5 + sqH(floor(tuv * 260.0)) * 4.0) + sqH(floor(tuv * 260.0) + 1.3) * 40.0), 2.0);   // (each star twinkling)
        vec2 lc = fract(w / CELL) - 0.5;                                    // (where in its square, -0.5 to 0.5)
        float breath = 0.82 + 0.18 * sin(t * 0.75 + sqH(cell) * 6.28);
        ${black
          ? `totalEmissiveRadiance += (dp * 0.55 + md * 0.2 + max(tp - 0.15, 0.0) * 1.7 * tw) * breath;`
          : `// white crystal, from the user's tile: frosted lavender white, fractured like ice, black stardust inside it.
             // Its surface layer, and the same crystal again deeper down (larger, dimmer), so you look down into it.
             const float WSPAN = 0.21;
             vec3 wt = texture2D(tDeep, (w + par * 0.0025) / WSPAN + cut).rgb;
             vec3 wd = texture2D(tDeep, (w + par * 0.013) / WSPAN * 0.62 + cut * 1.7 + 0.31).rgb;
             float deepLight = smoothstep(0.55, 0.95, dot(wd, vec3(0.333)));
             diffuseColor.rgb = wt * 0.9;
             float d = length(lc);
             float heart = exp(-d * d * 16.0) * 0.16;                                // (a soft light in its middle)
             float glit = 0.0;                                                    // (a few fine white glints, twinkling)
             { vec2 gp = (w + par * 0.002) * 900.0, gi = floor(gp), gf = fract(gp);
               float gh = sqH(gi), gd = length(gf - vec2(sqH(gi + 1.7), sqH(gi + 8.1)));
               float gt = pow(0.5 + 0.5 * sin(t * (2.0 + gh * 6.0) + gh * 50.0), 3.0);
               glit = step(0.975, gh) * smoothstep(0.3, 0.0, gd) * (0.3 + 0.7 * gt); }
             float specks = 1.0 - smoothstep(0.25, 0.5, dot(wt, vec3(0.333)));     // (no glow over its black stardust)
             totalEmissiveRadiance += (vec3(0.82, 0.84, 1.0) * (heart * breath * up + deepLight * 0.07 * breath) + vec3(1.0) * glit * 0.6) * (1.0 - specks);`}
      }`);
  };
  m.customProgramCacheKey = () => 'othelloSquare' + kind;
  return m;
}

// ---------- gold relief, cast here: a height picture from drawn shapes, then its normals, color and polish ----------
function relief(mask, W, H, blurPx, strength) {
  const soft = document.createElement('canvas'); soft.width = W; soft.height = H;
  const sg = soft.getContext('2d');
  sg.filter = `blur(${blurPx}px)`; sg.drawImage(mask, 0, 0);
  const hd = sg.getImageData(0, 0, W, H).data, md = mask.getContext('2d').getImageData(0, 0, W, H).data;
  const h = (x, y) => hd[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4 + 3] / 255;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const nC = mk(), cC = mk(), rC = mk(), aC = mk();
  const nD = nC.getContext('2d').createImageData(W, H), cD = cC.getContext('2d').createImageData(W, H);
  const rD = rC.getContext('2d').createImageData(W, H), aD = aC.getContext('2d').createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, v = h(x, y), a = md[i + 3];
    let nx = (h(x - 1, y) - h(x + 1, y)) * strength, ny = (h(x, y - 1) - h(x, y + 1)) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nD.data[i] = (nx / l * 0.5 + 0.5) * 255; nD.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; nD.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; nD.data[i + 3] = 255;
    const k = 0.55 + 0.45 * v;   // (darker in the hollows)
    cD.data[i] = 242 * k; cD.data[i + 1] = 196 * k; cD.data[i + 2] = 104 * k; cD.data[i + 3] = 255;
    const r = (0.48 - 0.34 * v) * 255; rD.data[i] = rD.data[i + 1] = rD.data[i + 2] = r; rD.data[i + 3] = 255;
    aD.data[i] = aD.data[i + 1] = aD.data[i + 2] = a; aD.data[i + 3] = 255;
  }
  nC.getContext('2d').putImageData(nD, 0, 0); cC.getContext('2d').putImageData(cD, 0, 0);
  rC.getContext('2d').putImageData(rD, 0, 0); aC.getContext('2d').putImageData(aD, 0, 0);
  const T = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 1, map: T(cC, true), normalMap: T(nC), roughnessMap: T(rC),
    alphaMap: T(aC), alphaTest: 0.45, normalScale: new THREE.Vector2(1.3, 1.3), envMapIntensity: 2.0,
    emissive: new THREE.Color(0.1, 0.075, 0.035), emissiveMap: T(cC, true),   // (a warm glow of its own, so it reads on the black)
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}
// filigree drawing: a scroll (a spiral that tapers as it curls in) with leaves off its outside, and leaves on their own
function leaf(g, x, y, ang, len, wid) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(0, 0);
  g.bezierCurveTo(len * 0.3, -wid, len * 0.75, -wid * 0.8, len, 0);
  g.bezierCurveTo(len * 0.75, wid * 0.55, len * 0.3, wid * 0.7, 0, 0);
  g.fill();
  for (let i = 1; i <= 3; i++) {   // (its lobes, so it reads as acanthus)
    const t = i / 4;
    g.beginPath(); g.ellipse(len * t, -wid * (0.75 - t * 0.25), wid * 0.32, wid * 0.22, -0.5, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
function scroll(g, cx, cy, r0, a0, turns, dir, width, leaves = true) {
  const N = 90;
  let px = cx + Math.cos(a0) * r0, py = cy + Math.sin(a0) * r0;
  for (let i = 1; i <= N; i++) {
    const t = i / N, r = r0 * (1 - t * 0.86), a = a0 + dir * t * turns * Math.PI * 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    g.lineWidth = Math.max(1.5, width * (1 - t * 0.75)); g.lineCap = 'round';
    g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
    if (leaves && i % 18 === 9 && t < 0.7) leaf(g, x, y, a + dir * 0.35, r0 * 0.55 * (1 - t * 0.6), r0 * 0.2 * (1 - t * 0.5));
    px = x; py = y;
  }
  g.beginPath(); g.arc(px, py, width * 0.35, 0, Math.PI * 2); g.fill();   // (a bead at its heart)
}
// along a band (drawn left to right, centered on y = mid): a vine with scrolls curling off it, both ways
function vineRun(g, x0, x1, mid, bw, flip) {
  const A = bw * 0.16;
  g.lineWidth = bw * 0.1; g.lineCap = 'round';
  g.beginPath();
  for (let x = x0; x <= x1; x += 3) { const y = mid + Math.sin((x - x0) / (x1 - x0) * Math.PI * 2) * A * flip; if (x === x0) g.moveTo(x, y); else g.lineTo(x, y); }
  g.stroke();
  const n = 3;
  for (let k = 0; k < n; k++) {
    const x = x0 + (k + 0.5) / n * (x1 - x0), up = (k % 2 ? 1 : -1) * flip;
    const y = mid + Math.sin((k + 0.5) / n * Math.PI * 2) * A * flip;
    scroll(g, x + bw * 0.06, y + up * bw * 0.17, bw * 0.19, up > 0 ? -Math.PI / 2 : Math.PI / 2, 1.15, up, bw * 0.09);
    leaf(g, x - bw * 0.1, y, Math.PI + up * 0.5, bw * 0.32, bw * 0.11);
  }
}
let filigreeCache = null;
function filigree(bandPx, cornerPx) {   // the corner spray (square) and the side spray (band shaped), as gold materials
  if (filigreeCache) return filigreeCache;
  // the corner: its outer corner at the picture's top right; drawn along the top arm, then mirrored onto the right arm
  const S = cornerPx, bw = bandPx;
  const cm = document.createElement('canvas'); cm.width = cm.height = S;
  const g = cm.getContext('2d');
  g.fillStyle = g.strokeStyle = '#fff';
  const medR = bw * 0.36;
  for (const mirror of [false, true]) {
    g.save();
    if (mirror) g.setTransform(0, -1, -1, 0, S, S);   // (across the corner's diagonal)
    g.beginPath(); g.rect(0, 0, S - bw, bw); g.clip();   // (only on the band)
    const mx = S - bw / 2, my = bw / 2;
    scroll(g, mx - medR - bw * 0.42, my, bw * 0.34, Math.PI * 0.5, 1.3, 1, bw * 0.11);   // a big curl beside the medallion
    leaf(g, mx - medR - bw * 0.1, my - bw * 0.17, Math.PI * 1.15, bw * 0.48, bw * 0.16);
    leaf(g, mx - medR - bw * 0.1, my + bw * 0.17, Math.PI * 0.85, bw * 0.48, bw * 0.16);
    vineRun(g, S - bw - bw * 0.95 - (S - bw * 2.2) * 0.62, S - bw - bw * 0.85, my, bw, 1);
    g.restore();
  }
  for (let k = 0; k < 8; k++) leaf(g, S - bw / 2, bw / 2, k * Math.PI / 4 + Math.PI / 8, bw * 0.3, bw * 0.1);   // a rosette in the corner
  g.beginPath(); g.arc(S - bw / 2, bw / 2, bw * 0.08, 0, Math.PI * 2); g.fill();
  // the side: symmetric about its middle, a little fan of leaves in the middle and scrolls running out both ways
  const SW = cornerPx, sm = document.createElement('canvas'); sm.width = SW; sm.height = bw;
  const s = sm.getContext('2d');
  s.fillStyle = s.strokeStyle = '#fff';
  for (const side of [1, -1]) {
    s.save(); if (side < 0) s.setTransform(-1, 0, 0, 1, SW, 0);
    for (let k = 0; k < 3; k++) leaf(s, SW / 2, bw / 2, -Math.PI / 2 + (k - 1) * 0.5 + 0.25, bw * 0.42, bw * 0.14);   // (the fan)
    scroll(s, SW / 2 + bw * 0.38, bw / 2 + bw * 0.04, bw * 0.27, Math.PI, 1.2, -1, bw * 0.09);
    vineRun(s, SW / 2 + bw * 0.62, SW - bw * 0.15, bw / 2, bw, -1);
    s.restore();
  }
  s.beginPath(); s.arc(SW / 2, bw / 2, bw * 0.07, 0, Math.PI * 2); s.fill();   // (the bead at its heart)
  filigreeCache = { corner: relief(cm, S, S, 3, 7), side: relief(sm, SW, bw, 3, 7) };
  return filigreeCache;
}

// ---------- the crystal: rough-cut, see-through, faceted, glowing soft white with tiny sparkles ----------
function crystalMat(frost = 0) {   // frost: 0 clear ice .. 1 frosted, glowing ice (the corner guards)
  const m = new THREE.MeshPhysicalMaterial({ color: 0xe4eaff, transmission: 0.72 - frost * 0.22, thickness: 0.06 + frost * 0.05, ior: 1.46, roughness: 0.14 + frost * 0.22,
    attenuationColor: new THREE.Color(0xc8d0ff), attenuationDistance: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.1,
    flatShading: true, envMapIntensity: 0.8, specularIntensity: 0.6 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = 'varying vec3 vCxP;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
       vCxP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = `varying vec3 vCxP; uniform float uTime; uniform vec3 uOrigin;
      float cxH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }\n` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 p = vCxP - uOrigin;
        float breath = 0.85 + 0.15 * sin(uTime * 0.6 + p.x * 4.0 + p.z * 3.0);
        float fres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);          // (brightest at its edges and facets turned away)
        float crack = 0.0;
        {   // (fine fractures running through it, like real ice: the borders between random cells)
          vec3 q = p * 46.0, qi = floor(q), qf = fract(q);
          float f1 = 8.0, f2 = 8.0;
          for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) {
            vec3 o = vec3(float(a), float(b), float(c));
            vec3 r = o + vec3(cxH(qi + o), cxH(qi + o + 7.1), cxH(qi + o + 13.7)) - qf;
            float dd = dot(r, r);
            if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
          }
          crack = (1.0 - smoothstep(0.0, 0.045, sqrt(f2) - sqrt(f1))) * step(0.45, cxH(qi + 3.3));   // (only some cells' edges: broken, not a net)
        }
        float low = ${frost > 0 ? '1.0 - smoothstep(0.03, 0.08, p.y)' : '0.0'};   // (frosted ice glows brightest at its foot)
        totalEmissiveRadiance += vec3(0.82, 0.86, 1.0) * (0.02 + ${(frost * 0.1).toFixed(3)} + fres * (0.11 + ${(frost * 0.2).toFixed(3)}) + crack * (0.05 + ${(frost * 0.14).toFixed(3)}) + low * 0.1) * breath;   // (the soft white glow in it)
        vec3 g = p * 520.0, id = floor(g), f = fract(g);
        float h = cxH(id), tw = pow(0.5 + 0.5 * sin(uTime * (1.2 + h * 5.0) + h * 60.0), 6.0);
        float dot0 = smoothstep(0.32, 0.0, length(f - vec3(cxH(id + 1.1), cxH(id + 2.3), cxH(id + 3.7))));
        totalEmissiveRadiance += vec3(1.0) * step(0.996, h) * dot0 * tw * 1.6;           // (tiny sparkles flashing in it)
      }`);
  };
  m.customProgramCacheKey = () => 'othelloCrystal' + frost;
  return m;
}
// a crystal block, roughened into facets: every point nudged by a field that depends only on where it is (so faces
// still meet), the bottom kept flat, then each face lit on its own
function roughBlock(w, h, d, segs, amp, seed) {
  const g = new THREE.BoxGeometry(w, h, d, ...segs);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position, v = new THREE.Vector3();
  const f = (x, y, z, k) => Math.sin(x * 61.3 + seed * 1.7 + k) * Math.cos(z * 47.1 - y * 33.9 + k * 2.3) + Math.sin((x + z) * 23.7 + y * 51.1 + k * 4.1) * 0.6;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const atBottom = v.y < 1e-4 ? 0 : 1, lift = Math.min(1, v.y / h);
    p.setXYZ(i, v.x + f(v.x, v.y, v.z, 1) * amp * atBottom, v.y + f(v.x, v.y, v.z, 2) * amp * 0.8 * atBottom * lift, v.z + f(v.x, v.y, v.z, 3) * amp * atBottom);
  }
  const flat = g.toNonIndexed(); flat.computeVertexNormals();
  return flat;
}

// the board's side: dark engraved gold scrolls, low relief, running along it (repeats along the side)
let engraveCache = null;
function sideEngraving() {
  if (engraveCache) return engraveCache;
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = g.strokeStyle = '#fff';
  g.fillRect(0, 8, W, 10); g.fillRect(0, H - 18, W, 10);   // (fine rails top and bottom)
  for (const off of [-W, 0, W]) { g.save(); g.translate(off, 0); vineRun(g, 0, W, H * 0.24, H * 0.42, 1); vineRun(g, 0, W, H * 0.76, H * 0.42, -1); g.restore(); }
  const m = relief(c, W, H, 2, 5);
  for (const t of [m.map, m.normalMap, m.roughnessMap, m.alphaMap, m.emissiveMap]) { t.wrapS = THREE.RepeatWrapping; }
  m.color.setRGB(0.55, 0.42, 0.25);                // (darker than the gold on top: aged, in the stone's shadow)
  m.emissive.setRGB(0.12, 0.07, 0.02);
  m.normalMap.repeat = m.roughnessMap.repeat = m.alphaMap.repeat = m.emissiveMap.repeat = m.map.repeat;   // (one repeat for all)
  engraveCache = m;
  return m;
}

export function makeOthelloBoard({ size = 1.15 } = {}) {
  const group = new THREE.Group(), materials = [];
  const HALF = size / 2;
  const BH = HALF - BASE_MARGIN;                  // the black board's half width (it sits on the crystal base, inset)
  const BB = BH - 0.0006;                         // the band's outer edge (right out to the board's side)
  const A = BB - BAND_W;                          // the squares' area, out from the middle
  const SQ = 2 * A / 8;
  const Y0 = BASE_H, TOP = Y0 + BOARD_H;          // the board's bottom (on the base) and its top
  const SLAB = TOP - 0.014;                       // the slab's top, where the squares and the band sit

  // ---------- the crystal base: rough-cut ice, wider than the board ----------
  const ice = crystalMat();
  materials.push(ice);
  const bk = HALF - 0.003;
  const base = new THREE.Mesh(block(outline([[-bk, -bk], [bk, -bk], [bk, bk], [-bk, bk]]), BASE_H, 0.003, 2), ice);   // (cleanly cut, finely chamfered)
  group.add(base);

  // ---------- the thick black board ----------
  const obsidian = new THREE.MeshPhysicalMaterial({ color: 0x020205, roughness: 0.22, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 0.9 });
  obsidian.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vObP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObP = position + vec3(modelMatrix[3].xyz);');
    sh.fragmentShader = 'varying vec3 vObP;\n' + sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float ob1 = sin(vObP.x * 41.0 + sin(vObP.z * 23.0) * 2.2 + vObP.y * 30.0), ob2 = sin(vObP.z * 37.0 + sin(vObP.x * 19.0) * 1.9);
        float vein = smoothstep(0.9, 1.0, 1.0 - abs(ob1 * ob2));
        roughnessFactor = clamp(roughnessFactor + (ob1 * 0.5 + 0.5) * 0.08 - vein * 0.1, 0.04, 1.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
`);
  };
  obsidian.customProgramCacheKey = () => 'othelloObsidian';
  materials.push(obsidian);
  const slab = new THREE.Mesh(block(outline([[-BH + 0.003, -BH + 0.003], [BH - 0.003, -BH + 0.003], [BH - 0.003, BH - 0.003], [-BH + 0.003, BH - 0.003]]), SLAB - Y0, 0.003, 2), obsidian);
  slab.position.y = Y0; group.add(slab);

  // the squares, set into its top
  const blackSq = squareMat('black', SQ), whiteSq = squareMat('white', SQ);
  materials.push(blackSq, whiteSq);
  const k = SQ / 2 - GAP / 2 - TILE_B;
  const tileGeo = block(outline([[-k, -k], [k, -k], [k, k], [-k, k]]), TILE_D, TILE_B);
  const tiles = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const t = new THREE.Mesh(tileGeo, (r + c) % 2 === 0 ? blackSq : whiteSq);
    t.position.set(-A + SQ * (c + 0.5), SLAB, -A + SQ * (r + 0.5));
    group.add(t);
    tiles.push({ mesh: t, own: t.material, flick: null });
  }
  // flood(kind): the game's won: every square glitches over to the winner's crystal ('white' or 'black'), rippling out
  // from the middle, each one flickering between the two a few times before it settles; restore(): back to checkered
  function flood(kind) {
    const to = kind === 'white' ? whiteSq : blackSq, from = to === whiteSq ? blackSq : whiteSq;
    for (const tl of tiles) {
      if (tl.mesh.material === to) continue;
      const d = Math.hypot(tl.mesh.position.x, tl.mesh.position.z) / (A * 1.42);
      tl.flick = { t0: clock.getElapsedTime() + d * 1.1 + Math.random() * 0.25, to, from, n: 3 + Math.floor(Math.random() * 4) };
    }
  }
  function restore() { for (const tl of tiles) { tl.flick = null; tl.mesh.material = tl.own; } }
  // the black band round them, a little proud of the squares
  const bandGeo = block(ringPiece(A + 0.0008, BB - 0.0006), TOP - SLAB, 0.0016, 2);
  for (let s = 0; s < 4; s++) { const m = new THREE.Mesh(bandGeo, obsidian); m.position.y = SLAB; m.rotation.y = s * Math.PI / 2; group.add(m); }

  // ---------- gold: the fine line along the band's inner edge, the beads along its outer edge ----------
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xe9ad4c, metalness: 1, roughness: 0.17, envMapIntensity: 1.6 });
  materials.push(gold);
  for (let s = 0; s < 4; s++) {
    const side = new THREE.Group(); side.rotation.y = s * Math.PI / 2; group.add(side);
    const line = new THREE.Mesh(new THREE.BoxGeometry(2 * (A + 0.004), 0.0012, 0.0024), gold);
    line.position.set(0, TOP + 0.0004, -(A + 0.004)); side.add(line);
  }
  const BEAD = 0.0021, beadStep = 0.0062, beadLine = BB - 0.0045;
  const nb = Math.floor((2 * beadLine) / beadStep);
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(BEAD, 10, 6), gold, nb * 4);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 0.7, 1);
  let bi = 0;
  for (let s = 0; s < 4; s++) for (let i = 0; i < nb; i++) {
    const along = -beadLine + (i + 0.5) * (2 * beadLine / nb), a = s * Math.PI / 2;
    const x = along * Math.cos(a) - beadLine * Math.sin(a), z = -along * Math.sin(a) - beadLine * Math.cos(a);
    mtx.compose(new THREE.Vector3(x, TOP + BEAD * 0.35, z), q, one); beads.setMatrixAt(bi++, mtx);
  }
  group.add(beads);

  // ---------- the gold filigree on the band ----------
  const DC = 0.24;   // (the corner spray reaches this far along each arm, corner included)
  const fil = filigree(256, Math.round(256 * DC / BAND_W));
  materials.push(fil.corner, fil.side);
  for (let s = 0; s < 4; s++) {
    const turn = new THREE.Group(); turn.rotation.y = s * Math.PI / 2; group.add(turn);
    const cd = new THREE.Mesh(new THREE.PlaneGeometry(DC, DC).rotateX(-Math.PI / 2), fil.corner);   // (its outer corner at +x, -z)
    cd.position.set(BB - DC / 2, TOP + 0.0006, -(BB - DC / 2)); turn.add(cd);
    const sd = new THREE.Mesh(new THREE.PlaneGeometry(DC, BAND_W).rotateX(-Math.PI / 2), fil.side);   // (the far side's middle)
    sd.position.set(0, TOP + 0.0006, -(A + BAND_W / 2)); turn.add(sd);
  }

  // ---------- the board's sides: dark engraved gold, and the rim light, a glowing golden bar set into each side ----------
  const rimMat = new THREE.MeshPhysicalMaterial({ color: 0xf0b850, metalness: 0.5, roughness: 0.25, emissive: new THREE.Color(1.0, 0.72, 0.28), emissiveIntensity: 0.5 });
  materials.push(rimMat);
  const engr = sideEngraving();
  materials.push(engr);
  const sideH = TOP - Y0, RIM_Y = Y0 + 0.0072, RIM_H = 0.0085;   // (the rim light runs low along the side, just above the crystal, right round the corners)
  for (let s = 0; s < 4; s++) {
    const side = new THREE.Group(); side.rotation.y = s * Math.PI / 2; group.add(side);
    const L = 2 * BH - 0.006;
    const engLo = RIM_Y + RIM_H / 2 + 0.0026, engHi = TOP - 0.003;   // (the engraving above the rim light, up to the top's edge)
    const eng = new THREE.Mesh(new THREE.PlaneGeometry(L, engHi - engLo), engr);   // (facing out, the far side)
    eng.rotation.y = Math.PI; eng.position.set(0, (engLo + engHi) / 2, -(BH + 0.0004)); side.add(eng);
    engr.map.repeat.set(L / 0.16, 1);
    // (inlaid flush in the block's side, so it's all one solid piece: only a hair proud of the stone)
    const bar = new THREE.Mesh(new THREE.BoxGeometry(L + 0.006, RIM_H, 0.006), rimMat);
    bar.position.set(0, RIM_Y, -(BH - 0.0027)); side.add(bar);
    for (const dy of [-1, 1]) {   // (fine gold lines either side of it, flush too)
      const lip = new THREE.Mesh(new THREE.BoxGeometry(L + 0.006, 0.0016, 0.006), gold);
      lip.position.set(0, RIM_Y + dy * (RIM_H / 2 + 0.0008), -(BH - 0.0027)); side.add(lip);
    }
  }
  // its warm light falling on the crystal base round the board
  const warm = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: shared,
    vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vP;
      void main() { float d = max(abs(vP.x), abs(vP.y)) - ${BH.toFixed(4)};
        float a = d < 0.0 ? 0.0 : exp(-d / 0.018) * 0.18 * (0.92 + 0.08 * sin(uTime * 0.9));
        gl_FragColor = vec4(vec3(1.0, 0.72, 0.32) * a, a); }`
  }));
  warm.position.y = BASE_H + 0.006; group.add(warm);

  // ---------- the corners: a clear crystal block behind each, and a big ringed gold medallion glowing on the board's corner ----------
  const frostIce = crystalMat(1);
  materials.push(frostIce);
  base.material = frostIce;   // (all the crystal the clasps' frosted ice)
  // the corner clasps: frosted crystal in two stepped tiers, an L over each corner of the black board, their outer
  // faces flush with its sides; the jewel sits inside with clear room all round
  const CT = 0.015;   // (the clasp's thickness)
  // an L: its inside corner at (inE, inE), its outside corner at (outE, outE), its arms running back to armE (at +x, +z)
  const L = (inE, outE, armE) => outline([[armE, -inE], [inE, -inE], [inE, -armE], [outE, -armE], [outE, -outE], [armE, -outE]]);
  // the clasp's blocky layers, stepping out over the board's corner and down its sides to the base's outside edge:
  //   a foot standing on the base round the board's corner, a wide layer over the corner out to the base's edge, a smaller one on top
  // one solid piece: the layers are cut sharp where they meet (no seams), overlapping a hair so no line shows; only the
  // top layer's edges are chamfered, its outline drawn in by the chamfer so nothing sticks out
  const sharp = (shape, depth) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 }); g.rotateX(-Math.PI / 2); return g; };
  const CB = 0.0022;
  const tierFoot = sharp(L(BH + 0.0002, HALF, BH - 0.12), TOP);                       // (from the floor, round the base's corner and the board's)
  const tierLow = sharp(L(BH - CT, HALF, BH - 0.1), 0.0125);
  const tierHigh = block(L(BH - CT + CB, HALF - 0.009 - CB, BH - 0.066 + CB), 0.0095, CB, 2);
  // the jewel's setting: a gold collar of stacked round rings on a thin flange, a fine lip at the top holding the stone
  const ring = (rIn, y0, h, n) => { const pts = []; for (let k = 0; k <= n; k++) { const a = -Math.PI / 2 + Math.PI * k / n; pts.push([rIn + h * 0.55 * Math.cos(a), y0 + h / 2 + h / 2 * Math.sin(a)]); } return pts; };
  const RH = 0.0021, R0 = 0.0016, RTOP = R0 + RH * 3;
  const bezelProf = [[0, 0], [0.0262, 0], [0.0266, 0.0007], [0.026, 0.0014], [0.0236, R0],
    ...ring(0.0228, R0, RH, 10), ...ring(0.0228, R0 + RH, RH, 10), ...ring(0.0228, R0 + RH * 2, RH, 10),
    [0.0226, RTOP + 0.0006], [0.0214, RTOP + 0.0006], [0.0208, RTOP - 0.0006], [0, RTOP - 0.0006]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const bezelGeo = new THREE.LatheGeometry(bezelProf, 96);
  // the jewel: a polished amber dome, warm light glowing from deep inside it, fine gold glitter floating all through it
  // and settled thicker near its floor (the glitter drawn at its real depth inside the stone, so it moves as you look round)
  const STONE_R = 0.0212, STONE_SY = 0.6, JS = 0.78;
  const jewelMat = new THREE.MeshPhysicalMaterial({ color: 0x7a3e08, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.2 });
  jewelMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = 'varying vec3 vWp; varying vec3 vCen;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vCen = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;`);
    sh.fragmentShader = `uniform float uTime; varying vec3 vWp; varying vec3 vCen;
      float jh(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        const float R = ${(STONE_R * JS).toFixed(5)}, RY = ${(STONE_R * JS * STONE_SY).toFixed(5)};
        vec3 rd = normalize(vWp - cameraPosition);
        float breath = 0.88 + 0.12 * sin(uTime * 1.1);
        // the glitter: specks in a fine grid of cells, looked for at several depths along the view into the stone
        float gl = 0.0;
        for (int i = 0; i < 7; i++) {
          vec3 p = vWp + rd * (0.0008 + float(i) * 0.0019);
          vec3 l = p - vCen;
          float inside = step(length(vec3(l.x, l.y * R / RY, l.z)), R * 0.97) * step(0.0002, l.y);
          vec3 q = p / 0.00065, id = floor(q), f = fract(q) - 0.5;
          float h = jh(id);
          vec3 o = (vec3(jh(id + 1.3), jh(id + 2.7), jh(id + 5.1)) - 0.5) * 0.6;
          float thr = mix(0.62, 0.9, smoothstep(0.0, RY * 0.55, l.y));   // (thicker near the floor)
          float s = step(thr, h) * smoothstep(0.2, 0.02, length(f - o));
          float tw = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(uTime * (1.5 + h * 2.0) + h * 70.0), 2.0);
          gl += s * tw * inside * (1.0 - float(i) * 0.1);
        }
        // the warm heart: brightest where the view passes nearest the stone's low middle
        vec3 c = vCen + vec3(0.0, RY * 0.18, 0.0);
        float t = max(dot(c - vWp, rd), 0.0);
        float d = length(vWp + rd * t - c);
        float core = exp(-d * d / (R * R * 0.14));
        float face = pow(abs(dot(normal, normalize(vViewPosition))), 2.0);
        totalEmissiveRadiance += vec3(1.0, 0.52, 0.1) * (0.05 + face * 0.18 + core * 0.75) * breath;
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.35) * min(gl, 1.5) * 0.9;
      }`);
  };
  jewelMat.customProgramCacheKey = () => 'othelloJewel2';
  materials.push(jewelMat);
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.93, 0.78).multiplyScalar(0.75), toneMapped: false });
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glows = [], lights = [];
  [[1, 1], [1, -1], [-1, -1], [-1, 1]].forEach(([sx, sz], i) => {
    const clasp = new THREE.Group(); clasp.rotation.y = i * Math.PI / 2; group.add(clasp);   // (built at +x, +z; turned for the rest)
    const foot = new THREE.Mesh(tierFoot, frostIce); foot.position.y = 0; clasp.add(foot);
    const lo = new THREE.Mesh(tierLow, frostIce); lo.position.y = TOP - 0.0005; clasp.add(lo);
    const hi = new THREE.Mesh(tierHigh, frostIce); hi.position.y = TOP + 0.0115; clasp.add(hi);
    const JW = BH - CT - 0.0055 - 0.0275;   // (its middle: clear of the clasp's inside by a little)
    const j = new THREE.Group(); j.position.set(sx * JW, TOP + 0.0006, sz * JW); j.scale.setScalar(JS); group.add(j);

    j.add(new THREE.Mesh(bezelGeo, gold));
    const stone = new THREE.Mesh(new THREE.SphereGeometry(STONE_R, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), jewelMat);   // (the amber dome)
    stone.scale.y = STONE_SY; stone.position.y = RTOP - 0.0012; j.add(stone);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc770, transparent: true, opacity: 0.6, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false }));
    glow.scale.set(0.075, 0.075, 1); glow.position.y = 0.012; glow.visible = false; glows.push(glow);   // (no drawn glow: the jewel itself is enough)

  });

  // ---------- the crystal's soft white light, spilling onto whatever the board stands on ----------
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.5, size * 1.5).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: shared,
    vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vP;
      void main() { float d = max(abs(vP.x), abs(vP.y)) - ${HALF.toFixed(4)};
        float a = d < -0.01 ? 0.0 : exp(-max(d, 0.0) / 0.04) * 0.1 * (0.9 + 0.1 * sin(uTime * 0.6));
        gl_FragColor = vec4(vec3(0.72, 0.78, 1.0) * a, a); }`
  }));
  spill.position.y = 0.0015; group.add(spill);

  // ---------- kept alive: the clock, where the board is, the soft reflections ----------
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false; group.add(ticker);
  const clock = new THREE.Clock();
  let envSet = false;
  ticker.onBeforeRender = renderer => {
    const t = clock.getElapsedTime();
    shared.uTime.value = t;
    for (const tl of tiles) {   // (squares glitching over to the winner's crystal)
      const f = tl.flick; if (!f || t < f.t0) continue;
      const k = Math.floor((t - f.t0) / 0.055);
      if (k >= f.n * 2) { tl.mesh.material = f.to; tl.flick = null; } else tl.mesh.material = k % 2 ? f.from : f.to;
    }
    group.getWorldPosition(shared.uOrigin.value);
    glows.forEach((g, i) => { const p = 0.9 + 0.1 * Math.sin(t * 1.3 + i * 1.7);  });
    if (!envSet) { envSet = true; const e = softEnv(renderer); for (const m of materials) { m.envMap = e; m.needsUpdate = true; } }
  };

  return { group, materials, CELL: SQ, TOP: SLAB + TILE_D, flood, restore };
}

// ---------- The Workshop's look at it: the board on its own (no lights of its own: their reflections glared) ----------
export function build() { return makeOthelloBoard({ size: 1.15 }).group; }
// >>>>> END OF FILE: HangoutRoom/pieces/othelloboard.js <<<<<
