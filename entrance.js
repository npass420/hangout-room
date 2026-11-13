// =====================================================================
// entrance.js — the way into a room. Outside the entry wall stands the front of the building (a Kindroid picture), and set
// back in its doorway (a short tunnel through the wall, with a step at the bottom) hang its two doors: solid slabs cut out
// of the picture itself, so they look exactly like the picture's doors, from outside and in. They swing open on springs as
// you walk in (a little nudge as the latch lets go, a swing, a settle) and shut behind you with a thud, each kind of door
// with its own sounds.
// Inside, the picture's own surround (the carved timber arch, the frog's padded mouth, the black and gold pilasters) is
// cut out along its real edge and fixed to the wall as a thick piece with a soft shadow behind it, so it looks attached.
// The rooms call open() and close() during their walk in, and update(dt) every frame.
// =====================================================================
import * as THREE from 'three';
import { scene } from './core.js';
import { sfx } from './sounds.js';

const DEPTH = 0.3;     // how thick the wall is: the doorway is a short tunnel this deep, with the picture on its outer end
const THICK = 0.05;    // how thick the doors are
const FRAME_D = 0.09;  // how far the surround stands out from the wall inside (a little more than the doors, so they sit in it)
// Per kind of door: the surround's outer edge in the picture (its left side, from the bottom corner up to the top middle,
// as parts of the picture's size; straight: corners instead of curves), the color of its cut edges, how much the picture
// glows on its own inside (so its colors hold up in a dark room), and the doors' springs
const STYLE = {
  tavern:  { frame: [[0.152, 0.95], [0.152, 0.80], [0.158, 0.70], [0.15, 0.55], [0.158, 0.45], [0.162, 0.35], [0.167, 0.27],
                     [0.18, 0.20], [0.22, 0.15], [0.27, 0.115], [0.33, 0.09], [0.40, 0.068], [0.45, 0.058], [0.50, 0.055]],
             edge: 0x3a2616, glow: 0.18, k: 18, c: 6.4 },   // heavy wood: slow, settles with a small sway
  gallery: { frame: [[0.045, 0.95], [0.045, 0.012], [0.50, 0.012]], straight: true,
             edge: 0x0e0d0d, glow: 0.3, k: 22, c: 8.6 },   // smooth and well hung
  frog:    { frame: [[0.17, 0.95], [0.16, 0.80], [0.155, 0.70], [0.16, 0.60], [0.17, 0.50], [0.19, 0.43], [0.22, 0.38],
                     [0.27, 0.335], [0.33, 0.31], [0.40, 0.295], [0.50, 0.29]],
             edge: 0x2f8f6a, glow: 0.45, k: 30, c: 5.2 }    // light and bouncy
};
const SWING = 1.42;  // how far the doors swing open (radians)
const V = (x, y) => new THREE.Vector2(x, y);
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

// The surround's outer edge in meters, measured like the doorway (up the left, over the top, down the right)
function frameOutline(spec) {
  if (spec._f) return spec._f;
  const st = STYLE[spec.style || 'tavern'], m = measure(spec);
  const pts = st.frame.map(([x, y]) => V((x - m.mid) * m.S, Math.max(0, (m.d.bottom - y) * m.S)));
  const half = st.straight ? pts : new THREE.SplineCurve(pts).getPoints(48);
  half[half.length - 1].x = 0;
  for (const p of half) if (p.y < 0.001) p.y = 0;
  return (spec._f = [...half, ...half.slice(0, -1).reverse().map(p => V(-p.x, p.y))]);
}
// How far the inside surround reaches out from the doorway's middle, in meters, so the room can stop its rails and baseboards at it
export function doorSpan(spec) { return Math.max(...frameOutline(spec).map(p => Math.abs(p.x))); }

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

// ---- One door: a solid slab, its front and back each a grid, joined round the edge ----
// x runs from the hinge (0) to the middle of the doorway (lw); the top follows the doorway's shape.
// front(x, y, top) and back(x, y, top) say how far each face puffs out (flat here). Groups: 0 front, 1 back, 2 edge.
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

// Old dark bark, streaked along its length (for the sides of the tavern's doorway)
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

// =====================================================================
// spec: { style: 'tavern' | 'gallery' | 'frog', file (the picture), x, z (the doorway's middle on the entry wall),
//         height (of the doors), roomHalf, roomHeight,
//         door: { x0, x1, top, bottom, spring } where the doors sit in the picture, as parts of its size (spring: where a
//         round top starts curving; leave it out for square doors), or door: { points } for a doorway traced point by point }
// =====================================================================
export function makeEntrance(spec) {
  const style = spec.style || 'tavern', ST = STYLE[style];
  const m = measure(spec), { d, S, mid, Hd, lw } = m;
  const Z = spec.z;
  const add = (o, parent = scene) => { parent.add(o); o.traverse(c => { c.userData.door = true; }); return o; };   // all of it counts as the door when clicked
  const picTex = new THREE.Texture();   // the whole picture, for the surround inside
  picTex.colorSpace = THREE.SRGBColorSpace; picTex.anisotropy = 8;
  const edgeMat = new THREE.MeshStandardMaterial({ color: ST.edge, roughness: 0.7 });

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
      pos.push(p.x, p.y, -FRAME_D, p.x, p.y, DEPTH + 0.01);
      uv.push(s / 0.8, 0, s / 0.8, (DEPTH + FRAME_D) / 0.8);
    });
    for (let i = 0; i < m.full.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const mat = style === 'tavern' ? new THREE.MeshStandardMaterial({ map: barkTex(), color: 0xb09080, roughness: 0.85 })
              : style === 'gallery' ? new THREE.MeshStandardMaterial({ color: 0x0c0b0b, roughness: 0.45 })
              : new THREE.MeshStandardMaterial({ color: 0xe9849a, roughness: 0.45 });
    mat.side = THREE.DoubleSide;
    const sides = new THREE.Mesh(g, mat);
    sides.position.set(spec.x, 0, Z);
    add(sides);
    const stepMat = style === 'tavern' ? new THREE.MeshStandardMaterial({ color: 0x3e3b37, roughness: 0.95, map: paint(256, 64, (g, w, h) => {
                      g.fillStyle = '#9a958c'; g.fillRect(0, 0, w, h);   // worn stone
                      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${hash(i) > 0.5 ? '40,38,35' : '200,195,185'},${0.05 + hash(i + 1) * 0.12})`; g.fillRect(hash(i + 2) * w, hash(i + 3) * h, 2 + hash(i + 4) * 9, 1 + hash(i + 5) * 4); }
                      g.fillStyle = 'rgba(20,18,16,0.7)'; g.fillRect(w * 0.48, 0, 2, h);
                    }) })
                  : style === 'gallery' ? new THREE.MeshPhysicalMaterial({ color: 0x141211, roughness: 0.25, clearcoat: 1 })
                  : new THREE.MeshPhysicalMaterial({ color: 0xf3b59a, roughness: 0.5, clearcoat: 0.6 });
    const step = new THREE.Mesh(new THREE.BoxGeometry(lw * 2 + 0.14, 0.035, DEPTH + FRAME_D), stepMat);   // from the surround out to the picture
    step.position.set(spec.x, 0.0175, Z + (DEPTH - FRAME_D) / 2 - 0.006);
    step.receiveShadow = true;
    add(step);
  }
  // A light just outside, so the doors show on the way in; and a warm one just inside, over the doorway
  const outLight = new THREE.PointLight({ tavern: 0xffc98a, gallery: 0xffe6c0, frog: 0xffc4e2 }[style], style === 'gallery' ? 1.6 : 3.2, 2.8, 1.6);
  outLight.position.set(spec.x, Hd * 0.8, Z + DEPTH + 1.1);
  scene.add(outLight);
  const glow = new THREE.PointLight(style === 'frog' ? 0xffb0d0 : 0xffd29a, 5, 4.5, 2);
  glow.position.set(spec.x, Hd + 0.35, Z - 0.9);
  scene.add(glow);

  // ---- The two doors: solid slabs cut to their halves of the doorway, the picture's own doors on both faces ----
  const leafW = lw - 0.004;   // a hair's gap where they meet
  const leaves = [], picCanvases = [];
  for (const s of [-1, 1]) {
    const left = s < 0;
    const hinge = new THREE.Group();
    hinge.position.set(spec.x + s * lw, 0.035, Z - 0.004);   // standing on the step
    scene.add(hinge);
    const holder = new THREE.Group();
    if (!left) holder.scale.x = -1;   // the right door is the left one's mirror image
    hinge.add(holder);
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * Hd / leafW);
    const tex = canvasTex(c);
    picCanvases.push({ c, tex, left });
    const slab = new THREE.Mesh(leafGeometry(m, leafW, THICK, 16, 56, () => 0, () => 0), [
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),       // outside: exactly the picture
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: ST.glow }),   // inside: the same, lit by the room
      edgeMat]);
    slab.castShadow = true;
    add(slab, holder);
    leaves.push({ hinge, s });
  }

  // ---- Inside: the picture's surround, cut out along its real edge, standing out from the wall with a shadow behind ----
  {
    const outer = frameOutline(spec);
    const sh = new THREE.Shape(outer);   // up the outside, over, and down; then back up the doorway's edge, over and down
    for (let i = m.full.length - 1; i >= 0; i--) sh.lineTo(m.full[i].x, m.full[i].y);
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: FRAME_D - 0.012, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01,
      bevelSegments: 3, curveSegments: 4 });
    const p = geo.attributes.position, uvs = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uvs.setXY(i, mid + p.getX(i) / S, 1 - (d.bottom - p.getY(i) / S));   // where each spot is in the picture
    const frame = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ map: picTex, roughness: 0.65, emissive: 0xffffff, emissiveMap: picTex,
      emissiveIntensity: ST.glow }), edgeMat]);
    frame.position.set(spec.x, 0, Z + 0.001);
    frame.scale.z = -1;   // standing out into the room
    frame.castShadow = true; frame.receiveShadow = true;
    add(frame);
    // Its soft shadow on the wall
    const w = Math.max(...outer.map(q => q.x)) * 2 + 0.6, h = Math.max(...outer.map(q => q.y)) + 0.3;
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
    const g = c.getContext('2d'), k = c.width / w;
    g.filter = 'blur(14px)'; g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    outer.forEach((q, i) => (i ? g.lineTo : g.moveTo).call(g, (q.x + w / 2) * k, c.height - (q.y + 0.04) * k));
    g.closePath(); g.fill();
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true, depthWrite: false }));
    shadow.rotation.y = Math.PI;
    shadow.position.set(spec.x, h / 2 - 0.02, Z - 0.003);
    scene.add(shadow);
  }

  // ---- The picture arrives: cut the doorway out of the front, give each door its half, and dress the surround ----
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
      picTex.image = img; picTex.needsUpdate = true;
      done();
    };
    img.onerror = () => { console.warn(spec.file + ' did not load'); frontMat.color.setHex(0x0a0806); done(); };
    img.src = spec.file;
  });

  // ---- Swinging: each door hangs on a spring. open() lets the latch go with a little nudge, then they swing wide and
  // settle; close() lets them swing shut, and they bump against the frame with a thud. ----
  const st = { a: 0, v: 0, target: 0, hold: 0, shut: true };
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
    for (const l of leaves) l.hinge.rotation.y = -l.s * SWING * st.a;
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
    }
    place();
  }

  return { loaded, open, close, update, setOpen };
}