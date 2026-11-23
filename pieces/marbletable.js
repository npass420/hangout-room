// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/marbletable.js <<<<<
// The white marble game table, for four, from your Kindroid picture with the braids taken out: a thick squared slab
// with softly rounded edges and a small stepped lip under it, on four tall faceted legs that swell in the middle and
// narrow under the top, each standing on a solid block. Gold thread jewels (goldjewel.js): a bigger one set into the
// top's surface near each corner, lying flat with its length pointing at the corner, and one set into every outward
// side of every leg (its gold collar sinking it into the curve), near the top: twelve in all. In the middle of the top
// sits the summoning circle (summoningplate.js), where games will be summoned.
// All of it is your white Calacatta marble with real gold veins (materials.js). The marble is laid on by where each
// surface is in the table, one copy of the picture across the whole top, so the veins run through the stone instead
// of being squashed onto each part.
//   build()   the table: 1.4 m square, its top 0.85 m up, centered, standing on y = 0
// =====================================================================================================================
import * as THREE from 'three';
import { make } from './materials.js';
import { jewel } from './goldjewel.js';
import { plate } from './summoningplate.js';

const SIZE = 1.4;                     // the top, meters square
const TOP = 0.85;                     // the top's height off the floor
const SLAB = 0.13;                    // the slab's thickness
const LIP = [0.035, 0.03];            // the stepped lip under it: its thickness, and how far in from the slab's edge
const CORNER = 0;                     // the top's corners: cut back this far each way (0: square)
const CIRCLE = 0.8;                   // the summoning circle across, set into the middle of the top
const CORNER_IN = 0.08;               // the corner jewels: how far in from each edge
const LEG_AT = SIZE / 2 - 0.17;       // each leg's middle, in from the edges
const MARBLE_SPAN = SIZE;             // one copy of the marble picture covers this many meters

// The leg's outline from the floor up (height, half its width), smoothed into a curve: a solid block at the bottom,
// then in, a full swell through the middle, a narrow neck, and out again to meet the lip
const LEG = [[0, 0.135], [0.1, 0.135], [0.118, 0.112], [0.16, 0.098], [0.3, 0.126], [0.43, 0.108], [0.53, 0.086],
             [0.6, 0.094], [0.65, 0.118], [0.665, 0.13]];
const CUT = 0.32;                     // the cut corners: this much of each half width (eight sided)
const JEWEL_Y = 0.545;                // where the jewels sit up the leg (in the bottom of its narrow neck, where the side runs nearly straight up)

export function build() {
  const marble = make('White marble, gold veins');
  const table = new THREE.Group();
  const legH = TOP - SLAB - LIP[0];
  // the slab, and the stepped lip under it
  const slab = new THREE.Mesh(byPlace(block(SIZE / 2, CORNER, SLAB, 0.022, CIRCLE / 2)), marble);   // (with the circle's hole)
  slab.position.y = TOP - SLAB / 2;
  table.add(slab);
  const lipHalf = SIZE / 2 - LIP[1];
  const lip = new THREE.Mesh(byPlace(block(lipHalf, CORNER, LIP[0], 0.01), [0, TOP - SLAB - LIP[0] / 2, 0]), marble);
  lip.position.y = TOP - SLAB - LIP[0] / 2;
  table.add(lip);
  // the summoning circle in the middle of the top: the obsidian plate with its burning ring and its portal of black sky
  const circle = plate({ size: CIRCLE });   // (set into its hole, its rim flush with the top)
  circle.position.y = TOP;
  table.add(circle);
  // a bigger jewel set into the top's surface near each corner, lying flat, its length pointing at the corner
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const at = new THREE.Group();
    at.position.set(sx * (SIZE / 2 - CORNER_IN), TOP, sz * (SIZE / 2 - CORNER_IN));
    at.rotation.y = Math.atan2(sx, sz);   // (turned toward its corner)
    const j = jewel({ width: 0.06, height: 0.085 });
    j.rotation.x = -Math.PI / 2;          // (lying flat, the dome up, its length along the diagonal)
    j.position.y = 0.0002;                // (sitting right on the stone, its gold band showing all round)
    at.add(j);
    table.add(at);
  }
  // the legs, each with a jewel on its two outward sides
  const profile = new THREE.CatmullRomCurve3(LEG.map(([y, w]) => new THREE.Vector3(w, y * legH / 0.665, 0)))
    .getPoints(140).map(p => [Math.max(0, Math.min(legH, p.y)), p.x]);
  const legGeo = leg(profile);
  const jy = JEWEL_Y * legH / 0.665;
  let neck = 0;   // (the leg's widest point across the jewel's height, so the jewel stands clear of the curve all over)
  for (let y = jy - 0.03; y <= jy + 0.03; y += 0.002) neck = Math.max(neck, widthAt(profile, y));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const l = new THREE.Mesh(byPlace(legGeo.clone(), [sx * LEG_AT, 0, sz * LEG_AT]), marble);
    l.position.set(sx * LEG_AT, 0, sz * LEG_AT);
    table.add(l);
    for (const [nx, nz] of [[sx, 0], [0, sz]]) {   // (the two sides facing out of the table)
      const j = jewel({ collar: true });
      j.position.set(sx * LEG_AT + nx * (neck + 0.001), jy, sz * LEG_AT + nz * (neck + 0.001));
      j.rotation.y = Math.atan2(nx, nz);   // (turned to face out)
      table.add(j);
    }
  }
  return table;
}

// ---------- A slab: square, its corners cut back into small flats, every edge softly rounded ----------
// half: half its width; cut: how far each corner is cut back; thick: its thickness; round: how round its edges are
function block(half, cut, thick, round, hole = 0) {   // (hole: a round hole through the middle, this radius)
  const h = half - round, c = cut;   // (the outline sits in by the rounding, which grows it back out to size)
  const corners = c > 0 ? [[h - c, -h], [h, -h + c], [h, h - c], [h - c, h], [-h + c, h], [-h, h - c], [-h, -h + c], [-h + c, -h]]
                        : [[h, -h], [h, h], [-h, h], [-h, -h]];
  const shape = new THREE.Shape(corners.map(([x, y]) => new THREE.Vector2(x, y)));
  if (hole > 0) { const h2 = new THREE.Path(); h2.absarc(0, 0, hole, 0, Math.PI * 2, true); shape.holes.push(h2); }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick - round * 2, bevelEnabled: true, bevelThickness: round,
    bevelSize: round, bevelSegments: 5, curveSegments: 128 });
  g.translate(0, 0, -(thick - round * 2) / 2);
  g.rotateX(-Math.PI / 2);   // (lying flat: its thickness is up and down)
  g.computeVertexNormals();
  return g;
}

// ---------- A faceted leg: eight flat sides, smooth up and down its curve ----------
function leg(profile) {
  const ring = w => {   // (the eight corners at half width w, going round)
    const c = w * CUT;
    return [[w - c, w], [w, w - c], [w, c - w], [w - c, -w], [c - w, -w], [-w, c - w], [-w, w - c], [c - w, w]];
  };
  const pos = [], idx = [];
  for (let f = 0; f < 8; f++) {   // (each side its own strip, so the edges between sides stay crisp)
    const base = pos.length / 3;
    for (const [y, w] of profile) {
      const r = ring(w), a = r[f], b = r[(f + 1) % 8];
      pos.push(a[0], y, a[1], b[0], y, b[1]);
    }
    for (let i = 0; i < profile.length - 1; i++) {
      const k = base + i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const foot = pos.length / 3;   // (the bottom, flat on the floor)
  for (const [x, z] of ring(profile[0][1])) pos.push(x, profile[0][0], z);
  for (let i = 1; i < 7; i++) idx.push(foot, foot + i + 1, foot + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  fixFacing(g);
  return g;
}
function fixFacing(g) {   // (every triangle turned to face away from the leg's middle line)
  const p = g.attributes.position, idx = g.index.array, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let flipped = false;
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(p, idx[t]); b.fromBufferAttribute(p, idx[t + 1]); c.fromBufferAttribute(p, idx[t + 2]);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const mid = a.clone().add(b).add(c).divideScalar(3);
    const out = mid.y < 0.001 && Math.abs(n.y) > Math.hypot(n.x, n.z) ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(mid.x, 0, mid.z);
    if (n.dot(out) < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; flipped = true; }
  }
  if (flipped) { g.index.needsUpdate = true; g.computeVertexNormals(); }
}
function widthAt(profile, y) {   // (the leg's half width at height y, on its flat sides)
  for (let i = 1; i < profile.length; i++) if (profile[i][0] >= y) {
    const [y0, w0] = profile[i - 1], [y1, w1] = profile[i], k = (y - y0) / Math.max(1e-6, y1 - y0);
    return w0 + (w1 - w0) * k;
  }
  return profile[profile.length - 1][1];
}

// ---------- Laying the marble on by place: each surface takes the part of the picture where it sits ----------
// Flat-ish tops and bottoms take it from above (across x and z), sides from the side, so the veins carry on round
// edges and corners as if the whole table were cut from one block.
export function byPlace(geo, at = [0, 0, 0]) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + at[0], y = p.getY(i) + at[1], z = p.getZ(i) + at[2];
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = -z; }
    else if (ax >= az) { u = z * Math.sign(n.getX(i)) * -1; v = y; }
    else { u = x * Math.sign(n.getZ(i)); v = y; }
    uv[i * 2] = u / MARBLE_SPAN + 0.5; uv[i * 2 + 1] = v / MARBLE_SPAN + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
// >>>>> END OF FILE: HangoutRoom/pieces/marbletable.js <<<<<
