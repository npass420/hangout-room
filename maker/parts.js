// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/maker/parts.js <<<<<
// What a Maker part looks like: its colors, its finishes, and the mesh built from its solid (maker/shapes.js).
//   COLORS     the 16 colors, the same ones the Game Room's blocks use: [name, hex]
//   FINISHES   the 5 basic finishes: Matte, Glossy, Metal, Glass, Glow (real materials come later, in the Workshop)
//   meshOf(node)      a new mesh of the part (its own place not applied: set that on the mesh)
//   outlineOf(node)   a thin glowing box hugging the part (the picked part's outline)
//   placeOn(obj, t)   put a mesh where t says: [x, y, z, qx, qy, qz, qw, sx, sy, sz]
// One part can wear several colors and finishes (joined parts keep their own), so each part is one mesh with a group
// per finish, the colors painted on its corners.
// =====================================================================================================================
import * as THREE from 'three';
import { solid, lookOf } from './shapes.js';

export const COLORS = [
  ['Cream', 0xf3ead2], ['Sky', 0x8cc8f0], ['Lavender', 0xb7a3e6], ['Pink', 0xf3a6c4],
  ['Mint', 0x9adbbd], ['Butter', 0xf6d97a], ['Coral', 0xf08a72], ['Charcoal', 0x3d3f47],
  ['Red', 0xe23b3f], ['Orange', 0xf5862a], ['Yellow', 0xffd02e], ['Green', 0x46b856],
  ['Teal', 0x22b5ad], ['Blue', 0x3a78e6], ['Purple', 0x8a4bd6], ['White', 0xffffff]
];
export const FINISHES = ['Matte', 'Glossy', 'Metal', 'Glass', 'Glow'];

// ---------- The finishes ----------
const MATS = [
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),                            // Matte: soft, like clay
  new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }),   // Glossy: a clear lacquer
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 1 }),                              // Metal: polished
  new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.04, transmission: 1, thickness: 0.25, ior: 1.45,   // Glass: clear, tinted by its color
    clearcoat: 1, clearcoatRoughness: 0.02, attenuationDistance: 0.6 }),
  new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })                                               // Glow: lit from inside
];
// (the glow is its color pushed past white, so the room's bloom makes it shine)
MATS[4].onBeforeCompile = sh => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= 2.4;');
};
// (glass: its color tints the light that comes through it, by itself)
export const finishMaterials = MATS;

const LINEAR = COLORS.map(([, hex]) => new THREE.Color(hex));   // (THREE.Color takes the hex as sRGB and keeps it linear)

// ---------- A part's mesh ----------
const geoms = new Map();   // (each different part's mesh is built once and shared: copies of a part cost nothing)
function geometryOf(node) {
  const key = JSON.stringify(node.o ? { o: node.o, a: node.a, b: node.b } : { s: node.s, c: node.c, f: node.f });
  let g = geoms.get(key);
  if (g) return g;
  const polys = solid(node);
  const byFinish = [[], [], [], [], []];
  for (const q of polys) { const [, f] = lookOf(q.tag); (byFinish[Math.min(4, f)] || byFinish[0]).push(q); }
  const pos = [], nrm = [], col = [];
  g = new THREE.BufferGeometry();
  let start = 0;
  byFinish.forEach((list, f) => {
    for (const q of list) {
      const c = LINEAR[lookOf(q.tag)[0]] || LINEAR[0];
      for (let i = 1; i < q.v.length - 1; i++) {   // (each polygon as a fan of triangles: they're all flat and convex)
        for (const v of [q.v[0], q.v[i], q.v[i + 1]]) { pos.push(...v.p); nrm.push(...v.n); col.push(c.r, c.g, c.b); }
      }
    }
    const count = pos.length / 3 - start;
    if (count) g.addGroup(start, count, f);
    start += count;
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingBox(); g.computeBoundingSphere();
  geoms.set(key, g);
  if (geoms.size > 400) geoms.delete(geoms.keys().next().value);   // (the oldest forgotten; anything still showing keeps its own)
  return g;
}
export function meshOf(node) {
  const m = new THREE.Mesh(geometryOf(node), MATS);
  m.castShadow = m.receiveShadow = false;
  return m;
}

// ---------- The picked part's outline: a thin glowing box hugging it ----------
// (a box rather than its edges: cut parts are made of many small faces, and their edges would scribble all over it)
const outlineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.35, 0.7, 1.0).multiplyScalar(2.2), toneMapped: false, transparent: true, depthTest: false });
export function outlineOf(node) {
  const b = geometryOf(node).boundingBox, pad = 0.01;
  const lo = b.min.clone().subScalar(pad), hi = b.max.clone().addScalar(pad);
  const c = [];
  for (let i = 0; i < 8; i++) c.push(new THREE.Vector3(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z));
  const pts = [];
  for (const [a, d] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) pts.push(c[a], c[d]);
  const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), outlineMat.clone());
  l.renderOrder = 5;
  return l;
}

export function placeOn(obj, t) {
  obj.position.set(t[0], t[1], t[2]);
  obj.quaternion.set(t[3], t[4], t[5], t[6]);
  obj.scale.set(t[7], t[8], t[9]);
}
// >>>>> END OF FILE: HangoutRoom/maker/parts.js <<<<<
