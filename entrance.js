// =====================================================================
// entrance.js — the way into a room. Outside the entry wall stands the front of the building (a Kindroid picture), and set
// back in its doorway (a real tunnel through the wall, with a step at the bottom) hang two solid, built doors in the same
// style as the picture. They swing open on springs as you walk in (a little nudge as the latch lets go, a swing, a settle)
// and shut behind you with a thud, each style with its own sounds. Inside, a real built surround frames the doorway.
// Three styles: 'tavern' (planks and iron under a gnarled timber arch), 'gallery' (black lacquer and gold between
// pilasters) and 'frog' (puffy quilted vinyl that wobbles, under an arch of glowing pink puffs).
// The rooms call open() and close() during their walk in, and update(dt) every frame.
// =====================================================================
import * as THREE from 'three';
import { scene, envMap } from './core.js';
import { sfx } from './sounds.js';

const DEPTH = 0.3;   // how thick the wall is: the doorway is a short tunnel this deep, with the picture on its outer end
const STYLE = {      // per style: how thick the doors are, how far the inside surround reaches past the doorway, the springs
  tavern:  { thick: 0.07, frame: 0.24, k: 18, c: 6.4 },   // heavy wood: slow, settles with a small sway
  gallery: { thick: 0.06, frame: 0.33, k: 22, c: 8.6 },   // smooth and well hung
  frog:    { thick: 0.09, frame: 0.48, k: 30, c: 5.2 }    // light and bouncy
};
const SWING = 1.42;  // how far the doors swing open (radians)
const V = (x, y) => new THREE.Vector2(x, y);
const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// A doorway traced point by point (door.points: its left side, from the bottom corner up to the top middle, as parts of the
// picture's size) becomes a smooth curve, mirrored for the right side; its box (x0, x1, top, bottom) is worked out from it.
function traced(d) {
  if (!d.points || d.curve) return d;
  const half = new THREE.SplineCurve(d.points.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(48);
  const xs = half.map(p => p.x), ys = half.map(p => p.y);
  d.x0 = Math.min(...xs); d.x1 = 1 - d.x0; d.top = Math.min(...ys); d.bottom = Math.max(...ys);
  d.curve = half;
  return d;
}
// The doorway in meters, measured from the middle of its bottom: its left half (bottom outer corner up to the top middle),
// the whole outline (up the left, over the top, down the right), its half width, and how high the top is at any spot
function measure(spec) {
  if (spec._m) return spec._m;
  const d = traced(spec.door), S = spec.height / (d.bottom - d.top), mid = (d.x0 + d.x1) / 2, Hd = spec.height;
  let half;
  if (d.curve) half = d.curve.map(p => V((p.x - mid) * S, (d.bottom - p.y) * S));
  else {
    const w = (d.x1 - d.x0) / 2 * S;
    if (d.spring == null) half = [V(-w, 0), V(-w, Hd), V(-w * 0.5, Hd), V(0, Hd)];
    else {
      const springH = (d.bottom - d.spring) * S, archH = Hd - springH;
      half = [V(-w, 0), V(-w, springH * 0.5)];
      for (let i = 0; i <= 32; i++) { const a = Math.PI - i / 32 * Math.PI / 2; half.push(V(w * Math.cos(a), springH + archH * Math.sin(a))); }
    }
  }
  half[0].y = 0; half[half.length - 1].x = 0;
  const lw = Math.max(...half.map(p => -p.x));
  let wi = 0;
  half.forEach((p, i) => { if (-p.x >= lw - 1e-4) wi = i; });
  const upper = half.slice(wi);   // the top edge, from the widest spot up to the middle
  const topAt = xl => {           // how high the doorway is at xl meters in from its outer edge
    const x = xl - lw;
    for (let i = 1; i < upper.length; i++) if (x <= upper[i].x) {
      const a = upper[i - 1], b = upper[i], k = Math.max(0, Math.min(1, (x - a.x) / Math.max(1e-6, b.x - a.x)));
      return a.y + (b.y - a.y) * k;
    }
    return Hd;
  };
  const full = [...half, ...half.slice(0, -1).reverse().map(p => V(-p.x, p.y))];
  return (spec._m = { d, S, mid, Hd, lw, half, full, topAt });
}
// How far the inside surround reaches out from the doorway's middle, in meters, so the room can stop its rails and baseboards at it
export function doorSpan(spec) { return measure(spec).lw + STYLE[spec.style || 'tavern'].frame; }

// A line pushed out away from the opening (the outline runs up the left, over the top and down the right)
function pushOut(pts, r) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = V(b.x - a.x, b.y - a.y).normalize();
    return V(p.x - t.y * r, p.y + t.x * r);
  });
}
// A smooth path through those points, in the room (on the wall at depth z)
function path3(pts, x0, z) {
  return new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(x0 + p.x, p.y, z)), false, 'centripetal');
}
function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function paint(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return canvasTex(c, srgb);
}

// ---- One door: a solid slab, its front and back each a fine grid (so they can puff up), joined round the edge ----
// x runs from the hinge (0) to the middle of the doorway (lw); the top follows the doorway's shape.
// front(x, y, top) and back(x, y, top) say how far each face puffs out. Groups: 0 front, 1 back, 2 edge.
function leafGeometry(m, lw, thick, nx, ny, front, back) {
  const pos = [], uv = [], idx = [];
  const grid = sign => {
    const start = pos.length / 3;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const x = i / nx * lw, top = m.topAt(x * m.lw / lw), y = j / ny * top;
      pos.push(x, y, sign > 0 ? front(x, y, top) : -thick - back(x, y, top));
      uv.push(x / lw, y / m.Hd);
    }
    const at = (i, j) => start + j * (nx + 1) + i, g0 = idx.length;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      if (sign > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    return { at, g0, n: idx.length - g0 };
  };
  const F = grid(1), B = grid(-1);
  const loop = [];   // round the edge: along the bottom, up the middle, back over the top, down the hinge side
  for (let i = 0; i <= nx; i++) loop.push([i, 0]);
  for (let j = 1; j <= ny; j++) loop.push([nx, j]);
  for (let i = nx - 1; i >= 0; i--) loop.push([i, ny]);
  for (let j = ny - 1; j >= 0; j--) loop.push([0, j]);
  const r0 = idx.length, rimStart = pos.length / 3;
  let s = 0, prev = null;
  for (const [i, j] of loop) {
    const f = F.at(i, j) * 3, b = B.at(i, j) * 3;
    if (prev) s += Math.hypot(pos[f] - prev[0], pos[f + 1] - prev[1]);
    prev = [pos[f], pos[f + 1]];
    pos.push(pos[f], pos[f + 1], pos[f + 2], pos[b], pos[b + 1], pos[b + 2]);
    uv.push(s, 1, s, 0);
  }
  for (let k = 0; k < loop.length - 1; k++) {
    const f0 = rimStart + k * 2, k0 = f0 + 1, f1 = f0 + 2, k1 = f0 + 3;
    idx.push(f0, k0, k1, f0, k1, f1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(F.g0, F.n, 0); g.addGroup(B.g0, B.n, 1); g.addGroup(r0, idx.length - r0, 2);
  g.computeVertexNormals();
  return g;
}

// ---- Materials ----
const iron = new THREE.MeshStandardMaterial({ color: 0x1e1c1b, metalness: 0.75, roughness: 0.5, envMap, envMapIntensity: 0.6 });
const gold = new THREE.MeshStandardMaterial({ color: 0xe0ab48, metalness: 1, roughness: 0.24, envMap, envMapIntensity: 1.3 });
const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x0b0a0a, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, envMap, envMapIntensity: 0.6 });
const vinylTeal = () => new THREE.MeshPhysicalMaterial({ color: 0x33a486, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.1, envMap, envMapIntensity: 0.8 });
const vinylPink = new THREE.MeshPhysicalMaterial({ color: 0xff8da0, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.12, envMap, envMapIntensity: 0.7,
  emissive: 0xff5a7a, emissiveIntensity: 0.12 });
const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, toneMapped: false });
const glassMat = new THREE.MeshBasicMaterial({ color: 0xffc35c, toneMapped: false, side: THREE.DoubleSide });

// Old dark bark, streaked along its length (for the timber arch and the doorway's sides)
function barkTex() {
  return paint(512, 128, (g, w, h) => {
    g.fillStyle = '#3d2c1f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 420; i++) {
      const y = hash(i) * h, x = hash(i + 0.5) * w, len = 30 + hash(i + 0.7) * 200, lt = hash(i + 0.9);
      g.strokeStyle = lt > 0.6 ? `rgba(120,92,66,${0.25 + lt * 0.3})` : `rgba(14,9,6,${0.3 + lt * 0.5})`;
      g.lineWidth = 0.6 + hash(i + 1.3) * 2.2;
      g.beginPath(); g.moveTo(x, y);
      g.bezierCurveTo(x + len * 0.3, y + (hash(i + 2) - 0.5) * 8, x + len * 0.6, y + (hash(i + 3) - 0.5) * 8, x + len, y + (hash(i + 4) - 0.5) * 6);
      g.stroke();
    }
    for (let i = 0; i < 9; i++) {   // knots
      const x = hash(i + 50) * w, y = hash(i + 60) * h, r = 4 + hash(i + 70) * 7;
      for (let k = 3; k > 0; k--) { g.strokeStyle = `rgba(12,8,5,${0.25 * k})`; g.lineWidth = 1.2; g.beginPath(); g.ellipse(x, y, r * k * 0.9, r * k * 0.5, 0, 0, 7); g.stroke(); }
    }
  });
}
// Plain planks for the inside of the tavern doors, in the same brown as the picture's doors
function plankTex(base) {
  return paint(256, 1024, (g, w, h) => {
    const n = 5, pw = w / n;
    for (let p = 0; p < n; p++) {
      const k = 0.85 + hash(p + 3) * 0.3;
      g.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
      g.fillRect(p * pw, 0, pw, h);
      for (let i = 0; i < 40; i++) {   // grain
        const x = p * pw + hash(p * 100 + i) * pw, dark = hash(p * 100 + i + 0.5) > 0.5;
        g.strokeStyle = dark ? 'rgba(20,12,6,0.35)' : 'rgba(150,110,75,0.18)'; g.lineWidth = 0.6 + hash(i + p) * 1.4;
        g.beginPath(); g.moveTo(x, 0);
        for (let y = 0; y <= h; y += 64) g.lineTo(x + Math.sin(y * 0.01 + i + p) * 3, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(8,5,3,0.9)'; g.fillRect(p * pw, 0, 2.5, h);   // the gap between planks
    }
  });
}

// =====================================================================
// spec: { style: 'tavern' | 'gallery' | 'frog', file (the picture), x, z (the doorway's middle on the entry wall),
//         height (of the doors), roomHalf, roomHeight,
//         door: { x0, x1, top, bottom, spring } where the doors sit in the picture, as parts of its size (spring: where a
//         round top starts curving; leave it out for square doors), or door: { points } for a doorway traced point by point }
// =====================================================================
export function makeEntrance(spec) {
  const style = spec.style || 'tavern', ST = STYLE[style];
  const m = measure(spec), { d, S, mid, Hd, lw } = m;
  const thick = ST.thick, Z = spec.z;
  const add = (o, parent = scene) => { parent.add(o); o.traverse(c => { c.userData.door = true; }); return o; };   // all of it counts as the door when clicked

  // ---- Outside: the front of the building, on the outer end of the doorway, with the doorway cut out of it ----
  const P = 2048;
  const front = document.createElement('canvas'); front.width = front.height = P;
  const frontMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaTest: 0.5, toneMapped: false });
  const facade = new THREE.Mesh(new THREE.PlaneGeometry(S, S), frontMat);
  facade.position.set(spec.x + (0.5 - mid) * S, (d.bottom - 0.5) * S, Z + DEPTH);
  add(facade);
  {   // dark wall all around the picture, out past the corners of the room (only seen on the way in)
    const dark = new THREE.MeshBasicMaterial({ color: 0x050403 });
    const fx = facade.position.x, fy = facade.position.y, L = -spec.roomHalf, R = spec.roomHalf, top = spec.roomHeight + 1, low = -3;
    const side = (x0, x1, y0, y1) => {
      if (x1 <= x0 || y1 <= y0) return;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), dark);
      w.position.set((x0 + x1) / 2, (y0 + y1) / 2, Z + DEPTH + 0.002);
      scene.add(w);
    };
    side(L - 2, fx - S / 2 + 0.01, low, top);
    side(fx + S / 2 - 0.01, R + 2, low, top);
    side(fx - S / 2, fx + S / 2, fy + S / 2 - 0.01, top);
    side(fx - S / 2, fx + S / 2, low, fy - S / 2 + 0.01);
  }

  // ---- The doorway: its sides and top run back through the wall, and a step lies across the bottom ----
  {
    const pos = [], uv = [], idx = [];
    let s = 0;
    m.full.forEach((p, i) => {
      if (i) s += p.distanceTo(m.full[i - 1]);
      pos.push(p.x, p.y, 0, p.x, p.y, DEPTH + 0.01);
      uv.push(s / 0.8, 0, s / 0.8, (DEPTH + 0.01) / 0.8);
    });
    for (let i = 0; i < m.full.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const mat = style === 'tavern' ? new THREE.MeshStandardMaterial({ map: barkTex(), color: 0xb09080, roughness: 0.85, side: THREE.DoubleSide })
              : style === 'gallery' ? new THREE.MeshStandardMaterial({ color: 0x0c0b0b, roughness: 0.45 }) : vinylPink.clone();
    mat.side = THREE.DoubleSide;
    const sides = new THREE.Mesh(g, mat);
    sides.position.set(spec.x, 0, Z);
    add(sides);
    const stepMat = style === 'tavern' ? new THREE.MeshStandardMaterial({ color: 0x3e3b37, roughness: 0.95, map: paint(256, 64, (g, w, h) => {
                      g.fillStyle = '#9a958c'; g.fillRect(0, 0, w, h);   // worn stone
                      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${hash(i) > 0.5 ? '40,38,35' : '200,195,185'},${0.05 + hash(i + 1) * 0.12})`; g.fillRect(hash(i + 2) * w, hash(i + 3) * h, 2 + hash(i + 4) * 9, 1 + hash(i + 5) * 4); }
                      g.fillStyle = 'rgba(20,18,16,0.7)'; g.fillRect(w * 0.48, 0, 2, h);
                    }) })
                  : style === 'gallery' ? new THREE.MeshPhysicalMaterial({ color: 0x141211, roughness: 0.25, clearcoat: 1 }) : new THREE.MeshPhysicalMaterial({ color: 0xf3b59a, roughness: 0.5, clearcoat: 0.6 });
    const step = new THREE.Mesh(new THREE.BoxGeometry(lw * 2 + 0.14, 0.035, DEPTH + 0.1), stepMat);   // from just inside to the picture
    step.position.set(spec.x, 0.0175, Z + (DEPTH - 0.1) / 2 - 0.006);
    step.receiveShadow = true;
    add(step);
  }
  // A light just outside, so the doors show their shape on the way in; and a warm one just inside, over the doorway
  const outLight = new THREE.PointLight({ tavern: 0xffc98a, gallery: 0xffe6c0, frog: 0xffc4e2 }[style], style === 'gallery' ? 1.6 : 3.2, 2.8, 1.6);
  outLight.position.set(spec.x, Hd * 0.8, Z + DEPTH + 1.1);
  scene.add(outLight);
  const glow = new THREE.PointLight(style === 'frog' ? 0xffb0d0 : 0xffd29a, 5, 4.5, 2);
  glow.position.set(spec.x, Hd + 0.35, Z - 0.9);
  scene.add(glow);

  // ---- The two doors ----
  const leafW = lw - 0.004;   // a hair's gap where they meet
  const leaves = [], picCanvases = [];
  const P2 = (px, py, left) => [(left ? px - d.x0 : d.x1 - px) * S, (d.bottom - py) * S];   // a spot in the picture, in door meters
  for (const s of [-1, 1]) {
    const left = s < 0;
    const hinge = new THREE.Group();
    hinge.position.set(spec.x + s * lw, 0.035, Z - 0.004);   // standing on the step
    scene.add(hinge);
    const holder = new THREE.Group();
    if (!left) holder.scale.x = -1;   // the right door is the left one's mirror image
    hinge.add(holder);
    const leaf = { hinge, holder, s, left, parts: [], bend: { value: 0 } };
    leaves.push(leaf);
    const part = (o, x = 0) => { o.userData.bx = x; o.userData.bz = o.position.z; leaf.parts.push(o); add(o, holder); o.castShadow = true; return o; };

    if (style === 'tavern') {
      // Front: the picture's own planks (with their grain raised), back: plain planks with battens and a brace
      const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * Hd / leafW);
      const pic = canvasTex(c);
      picCanvases.push({ c, tex: pic, left });
      const frontMat = new THREE.MeshStandardMaterial({ map: pic, bumpMap: pic, bumpScale: 4, roughness: 0.78 });
      const backMat = new THREE.MeshStandardMaterial({ map: plankTex([96, 66, 42]), roughness: 0.8 });
      const edgeMat = new THREE.MeshStandardMaterial({ color: 0x2c1c10, roughness: 0.8 });
      const battenMat = new THREE.MeshStandardMaterial({ color: 0x4e3420, roughness: 0.82 });
      part(new THREE.Mesh(leafGeometry(m, leafW, thick, 14, 48, () => 0, () => 0), [frontMat, backMat, edgeMat]));
      // Iron straps across the front (right over the painted ones), each ending in a spear point, with rivets
      const straps = left ? [[0.550, 0.230, 0.411], [0.745, 0.236, 0.415]] : [[0.550, 0.781, 0.541], [0.745, 0.781, 0.590]];
      for (const [py, a, b] of straps) {
        const [, y] = P2(a, py, left), L = Math.abs(b - a) * S + 0.02, h = 0.062;
        const sh = new THREE.Shape();
        sh.moveTo(-0.03, -h / 2); sh.lineTo(L - 0.09, -h / 2); sh.lineTo(L - 0.055, -h * 0.8); sh.lineTo(L, 0);
        sh.lineTo(L - 0.055, h * 0.8); sh.lineTo(L - 0.09, h / 2); sh.lineTo(-0.03, h / 2);
        const strap = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 2 }), iron);
        strap.position.set(0, y, 0.003);
        part(strap);
        for (let x = 0.05; x < L - 0.1; x += 0.13) {   // rivets
          const r = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 6), iron);
          r.scale.z = 0.6; r.position.set(x, y, 0.013);
          part(r, x);
        }
        const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 14), iron);   // where it wraps round the hinge pin
        knuckle.position.set(-0.012, y, -0.01);
        part(knuckle);
        // and inside, a batten at the same height
        const batten = new THREE.Mesh(new THREE.BoxGeometry(leafW - 0.06, 0.12, 0.028), battenMat);
        batten.position.set(leafW / 2, y, -thick - 0.014);
        part(batten, leafW / 2);
      }
      {   // a brace between the battens, the way plank doors are built
        const [, y1] = P2(0, 0.745, left), [, y2] = P2(0, 0.550, left);
        const x1 = 0.08, x2 = leafW - 0.08, len = Math.hypot(x2 - x1, y2 - y1);
        const brace = new THREE.Mesh(new THREE.BoxGeometry(len - 0.08, 0.1, 0.026), battenMat);
        brace.position.set((x1 + x2) / 2, (y1 + y2) / 2, -thick - 0.013);
        brace.rotation.z = Math.atan2(y2 - y1, x2 - x1);
        part(brace, leafW / 2);
      }
      if (left) {
        // The ring knocker: a plate and a heavy ring hanging from it
        const [kx, ky] = P2(0.463, 0.515, true), [, ry] = P2(0, 0.612, true);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.17, 0.014), iron);
        plate.position.set(kx, ky, 0.007);
        part(plate, kx);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.013, 10, 32), iron);
        ring.position.set(kx, ry, 0.024); ring.rotation.x = -0.12;
        part(ring, kx);
        // The little window: amber glass in an iron frame with a cross, through both sides
        const [wx, wy] = P2(0.373, 0.370, true), hw = 0.095, hh = 0.215;
        const almond = new THREE.Shape();
        almond.moveTo(0, -hh); almond.quadraticCurveTo(hw * 2, 0, 0, hh); almond.quadraticCurveTo(-hw * 2, 0, 0, -hh);
        const pts = almond.getPoints(24).map(p => new THREE.Vector3(p.x, p.y, 0));
        for (const [z, ry2] of [[0.004, 0], [-thick - 0.004, Math.PI]]) {
          const win = new THREE.Group();
          win.position.set(wx, wy, z); win.rotation.y = ry2;
          win.add(new THREE.Mesh(new THREE.ShapeGeometry(almond, 24), glassMat));
          win.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, 0.013, 8, true), iron));
          const v = new THREE.Mesh(new THREE.BoxGeometry(0.012, hh * 1.9, 0.012), iron), h2 = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.9, 0.012, 0.012), iron);
          win.add(v, h2);
          part(win, wx);
        }
        // Inside: an iron latch bar to lift
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.025), iron);
        bar.position.set(leafW - 0.18, ky - 0.08, -thick - 0.03);
        part(bar, leafW - 0.18);
      } else {
        const [kx, ky] = P2(0.536, 0.489, false);   // the round knob, and its twin inside
        for (const [z, dir] of [[0, 1], [-thick, -1]]) {
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.04, 12), iron);
          stem.rotation.x = Math.PI / 2; stem.position.set(kx, ky, z + dir * 0.02);
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.052, 20, 14), iron);
          knob.scale.z = 0.75; knob.position.set(kx, ky, z + dir * 0.062);
          part(stem, kx); part(knob, kx);
        }
      }
    }

    if (style === 'gallery') {
      // Black lacquer, three raised and beveled panels each side, each ringed in gold, gold bar handles, a gold kick plate
      part(new THREE.Mesh(leafGeometry(m, leafW, thick, 4, 4, () => 0, () => 0), [lacquer, lacquer, lacquer]));
      const x0 = leafW * 0.13, x1 = leafW * (1 - 0.165);
      for (const [a, b] of [[0.096, 0.318], [0.358, 0.639], [0.686, 0.968]]) {
        const pw = x1 - x0, ph = (b - a) * Hd, cx = (x0 + x1) / 2, cy = (a + b) / 2 * Hd;
        const rect = (w, h) => { const sh = new THREE.Shape(); sh.moveTo(-w / 2, -h / 2); sh.lineTo(w / 2, -h / 2); sh.lineTo(w / 2, h / 2); sh.lineTo(-w / 2, h / 2); sh.lineTo(-w / 2, -h / 2); return sh; };
        const panelGeo = new THREE.ExtrudeGeometry(rect(pw - 0.07, ph - 0.07), { depth: 0.004, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.03, bevelSegments: 3 });
        const ring = rect(pw + 0.035, ph + 0.035);
        ring.holes.push(rect(pw + 0.005, ph + 0.005));
        const ringGeo = new THREE.ExtrudeGeometry(ring, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2 });
        const inner = rect(pw - 0.115, ph - 0.115); inner.holes.push(rect(pw - 0.135, ph - 0.135));
        const innerGeo = new THREE.ExtrudeGeometry(inner, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
        for (const [z, ry] of [[0.014, 0], [-thick - 0.014, Math.PI]]) {
          const g = new THREE.Group();
          g.position.set(cx, cy, z); g.rotation.y = ry;
          const p = new THREE.Mesh(panelGeo, lacquer);
          const r = new THREE.Mesh(ringGeo, gold); r.position.z = -0.012;
          const i2 = new THREE.Mesh(innerGeo, gold); i2.position.z = 0.02;
          g.add(p, r, i2);
          part(g, cx);
        }
      }
      for (const [z, ry] of [[0, 0], [-thick, Math.PI]]) {
        const kick = new THREE.Mesh(new THREE.BoxGeometry(leafW - 0.01, 0.16, 0.006), gold);
        kick.position.set(leafW / 2, 0.08, z + (ry ? -0.003 : 0.003));
        part(kick, leafW / 2);
        const h = new THREE.Group();   // the handle: a fluted gold bar on two posts, with a finial at each end
        h.position.set(leafW - 0.075, 0.448 * Hd, z); h.rotation.y = ry;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 16), gold); bar.position.z = 0.055;
        const mid2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 16), gold); mid2.position.z = 0.055;
        h.add(bar, mid2);
        for (const sgn of [-1, 1]) {
          const fin = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.05, 12), gold);
          fin.position.set(0, sgn * 0.125, 0.055); fin.rotation.z = sgn > 0 ? 0 : Math.PI;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.05, 10), gold);
          post.rotation.x = Math.PI / 2; post.position.set(0, sgn * 0.085, 0.028);
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 8), gold); ball.position.set(0, sgn * 0.1, 0.055);
          h.add(fin, post, ball);
        }
        part(h, leafW - 0.075);
      }
      for (const y of [0.18, 0.5, 0.85]) {   // hinge knuckles
        const k = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 12), gold);
        k.position.set(-0.01, y * Hd, -thick / 2 - 0.02);
        part(k);
      }
    }

    if (style === 'frog') {
      // Quilted vinyl: three puffy columns each side, pinched in rows by gold buttons, with gold handles.
      // It's soft, so it wobbles as it swings.
      const puff = (x, y, top) => {
        const e = smooth(0, 0.08, Math.min(x, leafW - x, y, top - y));
        const cu = (x / leafW) * 3, col = Math.pow(Math.sin(Math.PI * (cu - Math.floor(cu))), 0.6);
        const rv = y / 0.46 - Math.floor(y / 0.46), row = 0.7 + 0.3 * smooth(0, 0.22, Math.min(rv, 1 - rv));
        return 0.06 * col * row * e;
      };
      const mats = [vinylTeal(), vinylTeal(), vinylTeal()];
      mats[2].color.multiplyScalar(0.8);
      for (const mt of mats) mt.onBeforeCompile = sh => {
        sh.uniforms.uBend = leaf.bend;
        sh.vertexShader = 'uniform float uBend;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          `#include <begin_vertex>\n  transformed.z += uBend * pow(clamp(position.x / ${leafW.toFixed(3)}, 0.0, 1.0), 2.0);`);
      };
      part(new THREE.Mesh(leafGeometry(m, leafW, thick, 48, 110, puff, (x, y, t) => puff(x, y, t) * 0.7), mats));
      for (let k = 1; k < 3; k++) for (let y = 0.46; y < Hd; y += 0.46) {   // the buttons, where the columns and rows pinch
        const x = leafW * k / 3;
        if (y > m.topAt(x * m.lw / leafW) - 0.1) continue;
        for (const z of [0.006, -thick - 0.006]) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), gold);
          b.scale.z = 0.6; b.position.set(x, y, z);
          part(b, x);
        }
      }
      const hy = 1.25 * Hd / 2.6;
      for (const [z, ry] of [[0.055, 0], [-thick - 0.04, Math.PI]]) {
        const h = new THREE.Group();   // the handle: a gold pill in an oval gold rim
        h.position.set(leafW - 0.14, hy, z); h.rotation.y = ry;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 12, 36), gold); rim.scale.y = 2.4;
        const pill = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.17, 8, 16), gold); pill.scale.z = 0.7; pill.position.z = 0.01;
        h.add(rim, pill);
        part(h, leafW - 0.14);
      }
    }
  }

  // ---- Inside: a real surround, built in the style of the picture's ----
  const zIn = Z - 0.02;
  if (style === 'tavern') {
    // A gnarled timber arch, knotted and twisting, half sunk into the wall, and a rough log across above it
    const bark = barkTex();
    const gnarl = (geo, curve, segs, radial, amount) => {
      const p = geo.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
      for (let i = 0; i <= segs; i++) {
        curve.getPointAt(i / segs, c);
        const knot = Math.max(0, Math.sin(i * 0.23 + 1.7) * Math.sin(i * 0.071 + 0.4)) * 0.5;
        for (let j = 0; j <= radial; j++) {
          const k = i * (radial + 1) + j;
          v.fromBufferAttribute(p, k).sub(c);
          const n = 1 + amount * (0.55 * Math.sin(j * 0.9 + i * 0.31) * Math.sin(i * 0.13 + j * 0.4) + 0.35 * (hash(i * 7.3 + (j % radial)) - 0.5) + knot);
          v.multiplyScalar(n).add(c);
          p.setXYZ(k, v.x, v.y, v.z);
        }
      }
      geo.computeVertexNormals();
    };
    const arcPts = pushOut(m.full, 0.13);
    arcPts[0].y = arcPts[arcPts.length - 1].y = -0.05;
    const curve = path3(arcPts, spec.x, zIn - 0.02);
    const segs = 220, len = curve.getLength();
    const tube = new THREE.TubeGeometry(curve, segs, 0.13, 14, false);
    gnarl(tube, curve, segs, 14, 0.3);
    const t1 = bark.clone(); t1.wrapS = t1.wrapT = THREE.RepeatWrapping; t1.repeat.set(len / 0.7, 1); t1.needsUpdate = true;
    const arch = new THREE.Mesh(tube, new THREE.MeshStandardMaterial({ map: t1, bumpMap: t1, bumpScale: 3, roughness: 0.85, color: 0xc8b0a0 }));
    arch.castShadow = true;
    add(arch);
    const L = lw * 2 + 0.95, logY = Hd + 0.36;
    const logCurve = new THREE.LineCurve3(new THREE.Vector3(spec.x - L / 2, logY, zIn - 0.02), new THREE.Vector3(spec.x + L / 2, logY + 0.03, zIn - 0.02));
    const logGeo = new THREE.TubeGeometry(logCurve, 60, 0.1, 14, false);
    gnarl(logGeo, logCurve, 60, 14, 0.16);
    const t2 = bark.clone(); t2.wrapS = t2.wrapT = THREE.RepeatWrapping; t2.repeat.set(L / 0.7, 1); t2.needsUpdate = true;
    add(new THREE.Mesh(logGeo, new THREE.MeshStandardMaterial({ map: t2, bumpMap: t2, bumpScale: 3, roughness: 0.85, color: 0xb09888 })));
    for (const sx of [-1, 1]) {   // the log's sawn ends
      const end = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9 }));
      end.position.set(spec.x + sx * L / 2, logY + (sx > 0 ? 0.03 : 0), zIn - 0.02); end.rotation.y = sx * Math.PI / 2;
      add(end);
    }
  }
  if (style === 'gallery') {
    // A stepped casing round the doors, fluted pilasters with gold capitals and bases, and an entablature with a cornice
    const B = (w, h, dd, mat, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), mat); b.position.set(x, y, z); b.castShadow = true; return add(b); };
    const cw = 0.09, pw = 0.2, pTop = Hd + 0.2;
    for (const sx of [-1, 1]) {
      const cxs = spec.x + sx * (lw + cw / 2);
      B(cw, Hd + cw, 0.05, lacquer, cxs, (Hd + cw) / 2, zIn - 0.025);
      B(0.012, Hd + 0.02, 0.008, gold, spec.x + sx * (lw + 0.02), (Hd + 0.02) / 2, zIn - 0.052);
      const px = spec.x + sx * (lw + cw + pw / 2);
      B(pw, pTop, 0.08, lacquer, px, pTop / 2, zIn - 0.04);
      for (const f of [-0.06, 0, 0.06]) B(0.008, pTop - 0.5, 0.006, gold, px + f, pTop / 2 + 0.03, zIn - 0.082);
      B(pw + 0.04, 0.2, 0.11, lacquer, px, 0.1, zIn - 0.055);           // base
      B(pw + 0.05, 0.025, 0.115, gold, px, 0.21, zIn - 0.057);
      B(pw + 0.05, 0.05, 0.11, gold, px, pTop + 0.025, zIn - 0.055);    // capital
      B(pw + 0.07, 0.025, 0.12, lacquer, px, pTop + 0.0625, zIn - 0.06);
    }
    B(lw * 2 + cw * 2, cw, 0.05, lacquer, spec.x, Hd + cw / 2, zIn - 0.025);
    B(lw * 2 + 0.04, 0.012, 0.008, gold, spec.x, Hd + 0.02, zIn - 0.052);
    const EW = lw * 2 + (cw + pw) * 2 + 0.07, eY = pTop + 0.075;
    B(EW, 0.26, 0.1, lacquer, spec.x, eY + 0.13, zIn - 0.05);
    B(EW, 0.014, 0.104, gold, spec.x, eY + 0.07, zIn - 0.052);
    B(EW + 0.1, 0.06, 0.16, lacquer, spec.x, eY + 0.29, zIn - 0.08);   // cornice
    B(EW + 0.1, 0.012, 0.164, gold, spec.x, eY + 0.255, zIn - 0.082);
    const rose = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 10, 32), gold);
    rose.position.set(spec.x, eY + 0.16, zIn - 0.105);
    add(rose);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 10), gold);
    boss.scale.z = 0.6; boss.position.set(spec.x, eY + 0.16, zIn - 0.105);
    add(boss);
  }
  if (style === 'frog') {
    // A chain of puffy pink cushions round the doorway, a little light on each, and a fat teal roll around the outside
    const inner = path3(pushOut(m.full, 0.15), spec.x, zIn - 0.03);
    const n = Math.round(inner.getLength() / 0.2), seg = new THREE.SphereGeometry(1, 24, 16), bulb = new THREE.SphereGeometry(0.024, 12, 8);
    const t = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1), nrm = new THREE.Vector3(), mtx = new THREE.Matrix4();
    for (let i = 0; i <= n; i++) {
      const p = inner.getPointAt(i / n);
      inner.getTangentAt(i / n, t);
      nrm.crossVectors(up, t).normalize();
      const s = new THREE.Mesh(seg, vinylPink);
      mtx.makeBasis(t, nrm, up);
      s.quaternion.setFromRotationMatrix(mtx);
      s.scale.set(0.105, 0.15, 0.095);
      s.position.copy(p);
      s.castShadow = true;
      add(s);
      const b = new THREE.Mesh(bulb, bulbMat);
      b.position.copy(p).addScaledVector(nrm, -0.02); b.position.z -= 0.09;
      add(b);
    }
    const outer = path3(pushOut(m.full, 0.36), spec.x, zIn - 0.01);
    const roll = new THREE.Mesh(new THREE.TubeGeometry(outer, 160, 0.115, 16, false), vinylTeal());
    roll.castShadow = true;
    add(roll);
    for (const sx of [-1, 1]) {   // round caps where the roll meets the floor
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 10), roll.material);
      const pt = outer.getPointAt(sx < 0 ? 0 : 1);
      cap.position.copy(pt);
      add(cap);
    }
  }

  // ---- The picture arrives: cut the doorway out of the front, and give the tavern doors their halves of it ----
  const loaded = new Promise(done => {
    const img = new Image();
    img.onload = () => {
      const N = img.width, g = front.getContext('2d');
      g.drawImage(img, 0, 0, P, P);
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      const tuck = 0.985, cx = mid * P, by = d.bottom * P;   // pulled in a little, so the picture's edge overlaps the doorway's sides
      m.full.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, cx + p.x / S * P * tuck, by - p.y / S * P * tuck + 1));
      g.closePath(); g.fill();
      frontMat.map = canvasTex(front); frontMat.color.setHex(0xffffff); frontMat.needsUpdate = true;
      for (const lp of picCanvases) {   // this door's half of the doorway (the right half flipped, since that door is a mirror image)
        const lg = lp.c.getContext('2d'), W = lp.c.width, H = lp.c.height, sw = (mid - d.x0) * N;
        if (!lp.left) { lg.translate(W, 0); lg.scale(-1, 1); }
        lg.drawImage(img, (lp.left ? d.x0 : mid) * N, d.top * N, sw, (d.bottom - d.top) * N, 0, 0, W, H);
        lp.tex.needsUpdate = true;
      }
      done();
    };
    img.onerror = () => { console.warn(spec.file + ' did not load'); frontMat.color.setHex(0x0a0806); done(); };
    img.src = spec.file;
  });

  // ---- Swinging: each door hangs on a spring. open() lets the latch go with a little nudge, then they swing wide and
  // settle; close() lets them swing shut, and they bump against the frame with a thud. ----
  const st = { a: 0, v: 0, target: 0, hold: 0, wob: 0, wv: 0, shut: true };
  function setOpen(k) { st.a = st.target = k; st.v = 0; st.hold = 0; st.shut = k === 0; place(); }
  function open() {
    if (st.target === 1) return;
    st.target = 0.035; st.hold = 0.16;   // the nudge as the latch lets go
    st.shut = false;
    sfx.doorOpen(style);
  }
  function close() {
    if (st.target <= 0) return;
    st.target = -0.15; st.hold = 0;   // aimed a little past shut, so they swing home with some weight and stay there
    sfx.doorSwing(style);
  }
  function place() {
    for (const l of leaves) {
      l.hinge.rotation.y = -l.s * SWING * st.a;
      if (style === 'frog') {
        l.bend.value = st.wob * l.s * -1;
        for (const p of l.parts) if (p.userData.bx) p.position.z = p.userData.bz + l.bend.value * Math.pow(Math.min(1, p.userData.bx / leafW), 2);
      }
    }
  }
  function update(dt) {
    if (dt <= 0) return;
    const n = Math.ceil(dt / 0.006), h = dt / n;
    for (let i = 0; i < n; i++) {
      if (st.hold > 0) { st.hold -= h; if (st.hold <= 0) st.target = 1; }
      const acc = ST.k * (st.target - st.a) - ST.c * st.v;
      st.v += acc * h; st.a += st.v * h;
      if (st.a < 0) {   // against the frame: it can't go any further
        if (st.v < -0.35 && !st.shut) sfx.doorThud(style, Math.min(1, -st.v / 2));
        if (st.target <= 0) st.shut = true;
        st.a = 0; st.v = -st.v * (style === 'frog' ? 0.35 : 0.18);
        if (Math.abs(st.v) < 0.05) st.v = 0;
      }
      if (style === 'frog') {   // the soft vinyl lags behind and wobbles
        st.wv += (-260 * st.wob - 5 * st.wv - acc * 0.012) * h;
        st.wob = Math.max(-0.07, Math.min(0.07, st.wob + st.wv * h));
      }
    }
    place();
  }

  return { loaded, open, close, update, setOpen };
}   