// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/maker/csg.js <<<<<
// Cutting and joining solid shapes (the Maker's ✂ cut and 🔗 join). Plain math, no three.js: a shape is a list of
// polygons, each a list of corners { p: [x, y, z], n: [nx, ny, nz] } plus a tag (its color and finish).
// It works by sorting every polygon of both shapes into a tree of the planes they lie on (a BSP tree), then keeping
// only the pieces of each shape that are outside (join) or inside (cut) the other. Cut faces come out where the
// cutter was, facing into the hole.
//   join(a, b)   a and b as one solid (where they overlap, the inside goes)
//   cut(a, b)    a with b carved out of it
//   meet(a, b)   only the part where a and b overlap
// a and b are arrays of polygons: { v: [corner, corner, corner, ...], tag }. Nothing passed in is changed.
// =====================================================================================================================
const EPS = 1e-5;
const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function corner(p, n) { return { p, n }; }
function between(a, b, t) {   // (a new corner part way along an edge, its normal blended)
  const n = lerp(a.n, b.n, t), l = Math.hypot(n[0], n[1], n[2]) || 1;
  return corner(lerp(a.p, b.p, t), [n[0] / l, n[1] / l, n[2] / l]);
}

// ---------- A polygon, and the plane it lies on ----------
class Poly {
  constructor(v, tag, plane, src) {
    this.v = v; this.tag = tag;
    this.plane = plane || Plane.from(v);
    this.src = src || this;   // (the whole polygon this one was split from, to put it back together after)
  }
  flipped() {
    return new Poly(this.v.slice().reverse().map(c => corner(c.p, [-c.n[0], -c.n[1], -c.n[2]])), this.tag, this.plane.flipped(), this.src);
  }
}
class Plane {
  constructor(n, w) { this.n = n; this.w = w; }
  static from(v) {   // (from the polygon's corners: the widest corner fan, so thin slivers still get a true plane)
    let best = null, bestLen = 0;
    const a = v[0].p;
    for (let i = 1; i < v.length - 1; i++) {
      const c = cross(sub(v[i].p, a), sub(v[i + 1].p, a)), l = Math.hypot(c[0], c[1], c[2]);
      if (l > bestLen) { bestLen = l; best = c; }
    }
    if (!best || bestLen < 1e-12) return null;
    const n = [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
    return new Plane(n, dot(n, a));
  }
  flipped() { return new Plane([-this.n[0], -this.n[1], -this.n[2]], -this.w); }
  // put the polygon (or its pieces) into the right list: on this plane facing the same way, on it facing away, in
  // front, or behind
  split(poly, coFront, coBack, front, back) {
    let kind = 0;
    const types = new Array(poly.v.length);
    for (let i = 0; i < poly.v.length; i++) {
      const t = dot(this.n, poly.v[i].p) - this.w;
      const type = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
      kind |= type; types[i] = type;
    }
    if (kind === COPLANAR) (dot(this.n, poly.plane.n) > 0 ? coFront : coBack).push(poly);
    else if (kind === FRONT) front.push(poly);
    else if (kind === BACK) back.push(poly);
    else {
      const f = [], b = [];
      for (let i = 0; i < poly.v.length; i++) {
        const j = (i + 1) % poly.v.length, ti = types[i], tj = types[j], vi = poly.v[i], vj = poly.v[j];
        if (ti !== BACK) f.push(vi);
        if (ti !== FRONT) b.push(vi);
        if ((ti | tj) === SPANNING) {
          const t = (this.w - dot(this.n, vi.p)) / dot(this.n, sub(vj.p, vi.p));
          const c = between(vi, vj, t);
          f.push(c); b.push(c);
        }
      }
      if (f.length >= 3) front.push(new Poly(f, poly.tag, poly.plane, poly.src));
      if (b.length >= 3) back.push(new Poly(b, poly.tag, poly.plane, poly.src));
    }
  }
}

// ---------- The tree of planes ----------
// (built and walked with lists instead of calling itself, so a big shape can't run the browser out of room)
class Node {
  constructor(polys) {
    this.plane = null; this.front = null; this.back = null; this.polys = [];
    if (polys) this.build(polys);
  }
  build(polys) {
    const jobs = [[this, polys]];
    while (jobs.length) {
      const [node, list] = jobs.pop();
      if (!list.length) continue;
      if (!node.plane) node.plane = list[0].plane;
      const f = [], b = [];
      for (const p of list) node.plane.split(p, node.polys, node.polys, f, b);
      if (f.length) { if (!node.front) node.front = new Node(); jobs.push([node.front, f]); }
      if (b.length) { if (!node.back) node.back = new Node(); jobs.push([node.back, b]); }
    }
  }
  invert() {   // (inside becomes outside)
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      node.polys = node.polys.map(p => p.flipped());
      if (node.plane) node.plane = node.plane.flipped();
      const t = node.front; node.front = node.back; node.back = t;
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
  }
  clip(polys) {   // (the pieces of these polygons that are outside this tree's solid)
    const out = [];
    const jobs = [[this, polys]];
    while (jobs.length) {
      const [node, list] = jobs.pop();
      if (!node.plane) { for (const p of list) out.push(p); continue; }
      let f = [], b = [];
      for (const p of list) node.plane.split(p, f, b, f, b);
      if (node.front) jobs.push([node.front, f]); else for (const p of f) out.push(p);
      if (node.back) jobs.push([node.back, b]);   // (behind every plane with nothing further: inside, dropped)
    }
    return out;
  }
  clipTo(tree) {
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      node.polys = tree.clip(node.polys);
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
  }
  all() {
    const out = [], stack = [this];
    while (stack.length) {
      const node = stack.pop();
      for (const p of node.polys) out.push(p);
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
    return out;
  }
}

function toPolys(list) {
  const out = [];
  for (const q of list) {
    const pl = Plane.from(q.v);
    if (pl) out.push(new Poly(q.v.map(c => corner(c.p.slice(), c.n.slice())), q.tag, pl));   // (slivers with no area are left out)
  }
  return out;
}
// Back out as plain polygons. A polygon that only got split into pieces (every piece kept, none cut away) goes back
// out whole, as it came in, so shapes don't fill up with needless slivers as cuts pile up.
function area(v) {
  let x = 0, y = 0, z = 0;
  const a = v[0].p;
  for (let i = 1; i < v.length - 1; i++) { const c = cross(sub(v[i].p, a), sub(v[i + 1].p, a)); x += c[0]; y += c[1]; z += c[2]; }
  return Math.hypot(x, y, z) / 2;
}
function fromPolys(list) {
  const bySrc = new Map();
  for (const p of list) {
    let g = bySrc.get(p.src);
    if (!g) bySrc.set(p.src, g = []);
    g.push(p);
  }
  const out = [];
  for (const [src, pieces] of bySrc) {
    if (pieces.length > 1) {
      const same = pieces.every(p => dot(p.plane.n, pieces[0].plane.n) > 0);
      let total = 0;
      for (const p of pieces) total += area(p.v);
      const whole = area(src.v);
      if (same && Math.abs(total - whole) <= whole * 1e-6 + 1e-12) {
        const turned = dot(pieces[0].plane.n, src.plane.n) < 0;
        out.push({ v: turned ? src.v.slice().reverse().map(c => corner(c.p, [-c.n[0], -c.n[1], -c.n[2]])) : src.v, tag: src.tag });
        continue;
      }
    }
    for (const p of pieces) out.push({ v: p.v, tag: p.tag });
  }
  return out;
}

// ---------- Only the parts that could touch get worked on ----------
// Polygons wholly outside the other shape's box can't be cut or joined into, so they pass straight through untouched.
// That keeps the work small and the shapes clean (no needless splitting far from the cut).
function boxOf(list) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const q of list) for (const c of q.v) for (let k = 0; k < 3; k++) { if (c.p[k] < lo[k]) lo[k] = c.p[k]; if (c.p[k] > hi[k]) hi[k] = c.p[k]; }
  return [lo, hi];
}
function sortByBox(list, [lo, hi]) {   // -> [near (touching the box), far (clear of it)]
  const near = [], far = [];
  for (const q of list) {
    let qlo = [Infinity, Infinity, Infinity], qhi = [-Infinity, -Infinity, -Infinity];
    for (const c of q.v) for (let k = 0; k < 3; k++) { if (c.p[k] < qlo[k]) qlo[k] = c.p[k]; if (c.p[k] > qhi[k]) qhi[k] = c.p[k]; }
    let clear = false;
    for (let k = 0; k < 3; k++) if (qhi[k] < lo[k] - 1e-4 || qlo[k] > hi[k] + 1e-4) clear = true;
    (clear ? far : near).push(q);
  }
  return [near, far];
}
function overlaps([alo, ahi], [blo, bhi]) {
  for (let k = 0; k < 3; k++) if (ahi[k] < blo[k] - 1e-4 || alo[k] > bhi[k] + 1e-4) return false;
  return true;
}

// The classic steps (clip each shape by the other's tree, flipping in between so faces lying flat on each other
// come out right), worked through by hand so the trees that decide inside and outside are built from the whole
// shapes, while only the polygons near the other shape are actually cut up and kept.
const flip = list => list.map(p => p.flipped());
function tree(list, inverted) { const t = new Node(toPolys(list)); if (inverted) t.invert(); return t; }

export function join(a, b) {
  const ba = boxOf(a), bb = boxOf(b);
  if (!overlaps(ba, bb)) return a.concat(b);
  const [an, af] = sortByBox(a, bb), [bn, bf] = sortByBox(b, ba);
  const TA = tree(a), TB = tree(b);
  const keepA = TB.clip(toPolys(an));                       // (a's skin outside b)
  const keepB = flip(TA.clip(flip(TA.clip(toPolys(bn)))));  // (b's skin outside a, minus faces lying on a's)
  return fromPolys(keepA).concat(fromPolys(keepB), af, bf);
}
export function cut(a, b) {
  const ba = boxOf(a), bb = boxOf(b);
  if (!overlaps(ba, bb)) return a.slice();
  const [an, af] = sortByBox(a, bb), [bn] = sortByBox(b, ba);
  const TB = tree(b), TAi = tree(a, true);
  const keepA = flip(TB.clip(flip(toPolys(an))));           // (a's skin outside b)
  const hole = TAi.clip(flip(TAi.clip(toPolys(bn))));       // (b's skin inside a, turned to face into the hole)
  return fromPolys(keepA).concat(fromPolys(hole), af);
}
export function meet(a, b) {
  const ba = boxOf(a), bb = boxOf(b);
  if (!overlaps(ba, bb)) return [];
  const [an] = sortByBox(a, bb), [bn] = sortByBox(b, ba);
  const TAi = tree(a, true), TBi = tree(b, true);
  const b2 = flip(TAi.clip(toPolys(bn)));
  const a1 = TBi.clip(flip(toPolys(an)));
  const b3 = TAi.clip(b2);
  return fromPolys(flip(a1)).concat(fromPolys(flip(b3)));
}
// >>>>> END OF FILE: HangoutRoom/maker/csg.js <<<<<
