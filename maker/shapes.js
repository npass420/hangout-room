// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/maker/shapes.js <<<<<
// The Maker's shapes, and how a made object is put together. Plain math, no three.js (maker/parts.js turns the
// result into something you can see).
//   SHAPES       the twelve simple shapes in the tray: { name, icon, polys() }, each about 1 m across, centered,
//                its bottom at y = -0.5 (so a shape scaled to 0.4 is 40 cm)
//   solid(node)  every polygon of a part, in the part's own space (its own place, turn and size not applied yet)
// A part is written down as a small recipe, so saves stay tiny and anything can be pulled apart again:
//   a shape:     { s: which shape, c: color, f: finish, t: place }
//   two joined:  { o: 'j', a: part, b: part, t: place }     (a and b as one solid)
//   one cut:     { o: 'c', a: part, b: part, t: place }     (a with b carved out of it; the cut faces take a's look)
//   place t:     [x, y, z,  qx, qy, qz, qw,  sx, sy, sz]    (where, which way turned, how big each way)
// =====================================================================================================================
import { join, cut } from './csg.js';

// ---------- Building blocks ----------
const C = (p, n) => ({ p, n });
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
function flat(points, tag = 0) {   // a flat face: every corner gets the face's own normal
  const a = points[0], b = points[1], c = points[2];
  const n = norm([(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
                  (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
                  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]);
  return { v: points.map(p => C(p, n)), tag };
}
const ring = (r, y, seg, k) => { const a = (k % seg) / seg * Math.PI * 2; return [Math.cos(a) * r, y, -Math.sin(a) * r]; };   // (counterclockwise seen from above)

// a disc lying flat at height y, facing up (up = true) or down: one polygon (it's convex)
function disc(r, y, seg, up) {
  const pts = [];
  for (let k = 0; k < seg; k++) pts.push(ring(r, y, seg, k));
  return flat(up ? pts : pts.reverse());
}
// a smooth band between two rings (radius r0 at y0, r1 at y1), facing out; nOut(k, i): the normal at each ring
function band(r0, y0, r1, y1, seg, n0, n1, out = []) {
  for (let k = 0; k < seg; k++) {
    const a0 = ring(r0, y0, seg, k), a1 = ring(r0, y0, seg, k + 1), b0 = ring(r1, y1, seg, k), b1 = ring(r1, y1, seg, k + 1);
    const na0 = n0(k), na1 = n0(k + 1), nb0 = n1(k), nb1 = n1(k + 1);
    if (r1 < 1e-9) out.push({ v: [C(a0, na0), C(a1, na1), C(b0, nb0)], tag: 0 });        // (closing to a point on top)
    else if (r0 < 1e-9) out.push({ v: [C(a0, na0), C(b1, nb1), C(b0, nb0)], tag: 0 });   // (opening from a point below)
    else out.push({ v: [C(a0, na0), C(a1, na1), C(b1, nb1), C(b0, nb0)], tag: 0 });
  }
  return out;
}
const radial = (seg, ny = 0) => k => { const a = (k % seg) / seg * Math.PI * 2; return norm([Math.cos(a), ny, -Math.sin(a)]); };

// a round surface from a profile (points [r, y] going up its side), spun round the middle, smooth all over
function spun(profile, seg) {
  const out = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    const nAt = (j) => {   // (the profile's own normal at point j, from its neighbors: out and a little up or down)
      const [pr, py] = profile[Math.max(0, j - 1)], [nr, ny] = profile[Math.min(profile.length - 1, j + 1)];
      const dr = nr - pr, dy = ny - py;
      return [dy, -dr];   // (along the profile is (dr, dy); its outward normal is (dy, -dr))
    };
    const m0 = nAt(i), m1 = nAt(i + 1);
    band(r0, y0, r1, y1, seg, k => norm([Math.cos((k % seg) / seg * Math.PI * 2) * m0[0], m0[1], -Math.sin((k % seg) / seg * Math.PI * 2) * m0[0]]),
      k => norm([Math.cos((k % seg) / seg * Math.PI * 2) * m1[0], m1[1], -Math.sin((k % seg) / seg * Math.PI * 2) * m1[0]]), out);
  }
  return out;
}

// ---------- The twelve shapes ----------
function box() {
  const h = 0.5, P = (x, y, z) => [x * h, y * h, z * h];
  return [[P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)], [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)],
          [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)], [P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)],
          [P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1)], [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)]].map(f => flat(f));
}
function sphere() {
  const prof = [];
  for (let j = 0; j <= 16; j++) { const th = Math.PI * (1 - j / 16); prof.push([Math.sin(th) * 0.5, Math.cos(th) * 0.5]); }
  prof[0][0] = 0; prof[16][0] = 0;
  return spun(prof, 32).map(q => ({ v: q.v.map(c => C(c.p, norm(c.p))), tag: 0 }));   // (a sphere's normal: straight out from its middle)
}
function cylinder() {
  const seg = 40;
  return band(0.5, -0.5, 0.5, 0.5, seg, radial(seg), radial(seg)).concat(disc(0.5, 0.5, seg, true), disc(0.5, -0.5, seg, false));
}
function cone() {
  const seg = 40, slope = norm([1, 0.5, 0]);   // (its side leans in: 0.5 out for every 1 up)
  return band(0.5, -0.5, 0, 0.5, seg, radial(seg, slope[1] / slope[0]), radial(seg, slope[1] / slope[0])).concat(disc(0.5, -0.5, seg, false));
}
function pyramid() {
  const b = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]], top = [0, 0.5, 0];
  return [flat([b[0], b[1], b[2], b[3]]), flat([b[3], b[2], top]), flat([b[2], b[1], top]), flat([b[1], b[0], top]), flat([b[0], b[3], top])];
}
function wedge() {   // a ramp: tall at the back (-z), down to nothing at the front (+z)
  const A = [-0.5, -0.5, -0.5], B = [0.5, -0.5, -0.5], Cc = [0.5, -0.5, 0.5], D = [-0.5, -0.5, 0.5], E = [-0.5, 0.5, -0.5], F = [0.5, 0.5, -0.5];
  return [flat([A, B, Cc, D]), flat([A, E, F, B]), flat([D, Cc, F, E]), flat([A, D, E]), flat([B, F, Cc])];
}
function torus() {   // a ring lying flat: 1 m across, 30 cm thick
  const R = 0.35, r = 0.15, seg = 40, tube = 20, out = [];
  const pt = (i, j) => {
    const u = (i % seg) / seg * Math.PI * 2, v = (j % tube) / tube * Math.PI * 2;
    const n = [Math.cos(v) * Math.cos(u), Math.sin(v), -Math.cos(v) * Math.sin(u)];
    return C([(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), -(R + r * Math.cos(v)) * Math.sin(u)], n);
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) out.push({ v: [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)], tag: 0 });
  return out;
}
function tube() {   // a pipe: 1 m across, walls 12 cm thick
  const seg = 40, R = 0.5, r = 0.38, out = band(R, -0.5, R, 0.5, seg, radial(seg), radial(seg));
  const inward = k => { const n = radial(seg)(k); return [-n[0], 0, -n[2]]; };
  band(r, 0.5, r, -0.5, seg, inward, inward, out);   // (the inside wall, facing in)
  for (let k = 0; k < seg; k++) {   // (the two flat rings, top and bottom)
    out.push(flat([ring(r, 0.5, seg, k), ring(r, 0.5, seg, k + 1), ring(R, 0.5, seg, k + 1), ring(R, 0.5, seg, k)].reverse()));
    out.push(flat([ring(R, -0.5, seg, k), ring(R, -0.5, seg, k + 1), ring(r, -0.5, seg, k + 1), ring(r, -0.5, seg, k)].reverse()));
  }
  return out;
}
function capsule() {   // a pill standing up: 1 m tall, 50 cm across
  const r = 0.25, prof = [];
  for (let j = 0; j <= 8; j++) { const a = -Math.PI / 2 + j / 8 * Math.PI / 2; prof.push([Math.cos(a) * r, -0.5 + r + Math.sin(a) * r]); }
  for (let j = 0; j <= 8; j++) { const a = j / 8 * Math.PI / 2; prof.push([Math.cos(a) * r, 0.5 - r + Math.sin(a) * r]); }
  prof[0][0] = 0; prof[prof.length - 1][0] = 0;
  const out = spun(prof, 32);
  return out.map(q => ({ v: q.v.map(c => {   // (true round normals on the two ends)
    const y = c.p[1], cy = y > 0.5 - r ? 0.5 - r : y < -0.5 + r ? -0.5 + r : y;
    return C(c.p, norm([c.p[0], y - cy, c.p[2]]));
  }), tag: 0 }));
}
function dome() {   // half a sphere sitting on its flat base: 1 m across, 50 cm tall
  const prof = [];
  for (let j = 0; j <= 8; j++) { const th = j / 8 * Math.PI / 2; prof.push([Math.cos(th) * 0.5, -0.5 + Math.sin(th) * 0.5]); }
  prof[8][0] = 0;
  const out = spun(prof, 32).map(q => ({ v: q.v.map(c => C(c.p, norm([c.p[0], c.p[1] + 0.5, c.p[2]]))), tag: 0 }));
  out.push(disc(0.5, -0.5, 32, false));
  return out;
}
function prism(sides) {   // a straight-sided prism, flat faces all round
  const out = [disc(0.5, 0.5, sides, true), disc(0.5, -0.5, sides, false)];
  for (let k = 0; k < sides; k++) out.push(flat([ring(0.5, -0.5, sides, k), ring(0.5, -0.5, sides, k + 1), ring(0.5, 0.5, sides, k + 1), ring(0.5, 0.5, sides, k)]));
  return out;
}
function star() {   // a five-pointed star, 30 cm thick
  const pts = [];
  for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.21 : 0.5, a = Math.PI / 2 + k / 10 * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  const z = 0.15, out = [];
  for (let k = 0; k < 10; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % 10];
    out.push(flat([[0, 0, z], [x0, y0, z], [x1, y1, z]]));              // (the front, a fan from the middle)
    out.push(flat([[0, 0, -z], [x1, y1, -z], [x0, y0, -z]]));           // (the back)
    out.push(flat([[x0, y0, -z], [x1, y1, -z], [x1, y1, z], [x0, y0, z]]));   // (the edge)
  }
  return out;
}

export const SHAPES = [
  { name: 'Cube', icon: '■', polys: box },
  { name: 'Sphere', icon: '●', polys: sphere },
  { name: 'Cylinder', icon: '▮', polys: cylinder },
  { name: 'Cone', icon: '▲', polys: cone },
  { name: 'Pyramid', icon: '◭', polys: pyramid },
  { name: 'Wedge', icon: '◺', polys: wedge },
  { name: 'Ring', icon: '◯', polys: torus },
  { name: 'Tube', icon: '◎', polys: tube },
  { name: 'Capsule', icon: '⬮', polys: capsule },
  { name: 'Dome', icon: '◓', polys: dome },
  { name: 'Hex', icon: '⬢', polys: () => prism(6) },
  { name: 'Star', icon: '★', polys: star }
];
const shapeCache = SHAPES.map(() => null);
function shapePolys(i) {   // (each shape made once, then shared)
  if (!shapeCache[i]) shapeCache[i] = SHAPES[i].polys();
  return shapeCache[i];
}

// ---------- Places: moving, turning and sizing polygons ----------
export const IDENTITY = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1];
export function matrixOf(t) {   // (a 3x4 matrix: turn and size, then move)
  const [x, y, z, qx, qy, qz, qw, sx, sy, sz] = t;
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  const R = [[1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy)], [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx)], [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)]];
  return { R, s: [sx, sy, sz], p: [x, y, z] };
}
function placed(polys, t) {
  const { R, s, p } = matrixOf(t);
  const flipped = s[0] * s[1] * s[2] < 0;   // (mirrored: the faces would turn inside out, so their order flips back)
  return polys.map(q => {
    const v = q.v.map(c => {
      const a = [c.p[0] * s[0], c.p[1] * s[1], c.p[2] * s[2]];
      const m = [c.n[0] / s[0], c.n[1] / s[1], c.n[2] / s[2]];   // (normals stretch the other way)
      return C([R[0][0] * a[0] + R[0][1] * a[1] + R[0][2] * a[2] + p[0], R[1][0] * a[0] + R[1][1] * a[1] + R[1][2] * a[2] + p[1], R[2][0] * a[0] + R[2][1] * a[1] + R[2][2] * a[2] + p[2]],
        norm([R[0][0] * m[0] + R[0][1] * m[1] + R[0][2] * m[2], R[1][0] * m[0] + R[1][1] * m[1] + R[1][2] * m[2], R[2][0] * m[0] + R[2][1] * m[1] + R[2][2] * m[2]]));
    });
    return { v: flipped ? v.reverse() : v, tag: q.tag };
  });
}

// ---------- A part's solid (worked out once, then kept until it changes) ----------
export const tagOf = (c, f) => c * 8 + f;            // (color 0 .. 15, finish 0 .. 4)
export const lookOf = tag => [Math.floor(tag / 8), tag % 8];
const solids = new Map();
const keyOf = node => JSON.stringify(node.o ? { o: node.o, a: node.a, b: node.b } : { s: node.s, c: node.c, f: node.f });
export function solid(node) {
  const key = keyOf(node);
  let got = solids.get(key);
  if (got) { solids.delete(key); solids.set(key, got); return got; }   // (kept fresh: the oldest go first)
  if (!node.o) {
    const tag = tagOf(node.c | 0, node.f | 0);
    got = shapePolys(Math.max(0, Math.min(SHAPES.length - 1, node.s | 0))).map(q => ({ v: q.v, tag }));
  } else {
    const a = placed(solid(node.a), node.a.t), b = placed(solid(node.b), node.b.t);
    if (node.o === 'c') {
      const tag = mainTag(a);
      got = cut(a, b.map(q => ({ v: q.v, tag })));   // (the cut faces take the look of what was cut)
    } else got = join(a, b);
  }
  solids.set(key, got);
  while (solids.size > 300) solids.delete(solids.keys().next().value);
  return got;
}
function mainTag(polys) {   // (the look most of it has)
  const count = new Map();
  for (const q of polys) count.set(q.tag, (count.get(q.tag) || 0) + 1);
  let best = 0, most = -1;
  for (const [tag, n] of count) if (n > most) { most = n; best = tag; }
  return best;
}
// every shape in a part, deepest first (for painting a whole part at once)
export function leaves(node, out = []) {
  if (node.o) { leaves(node.a, out); leaves(node.b, out); } else out.push(node);
  return out;
}
// >>>>> END OF FILE: HangoutRoom/maker/shapes.js <<<<<
