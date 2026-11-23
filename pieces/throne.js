// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/throne.js <<<<<
// The white marble throne, from your Kindroid picture, at a seat height that pulls up to the marble table: just white
// marble and glowing gold thread jewels (goldjewel.js), no gold banding.
//   Back: a tall shaped marble plate (narrow at the waist, swelling at the shoulders, arching to a peak), squared off,
//         with a plump back cushion of black stardust velvet on its front, a big jewel set into the cushion and a
//         small one on the marble at the peak
//   Arms: a rounded marble arm rest on each pillar, a plump velvet pillow set flush into its flat top, a
//         jewel set in its flat front inside a carved rim, and a
//         small jewel at each pillar's foot
//   Seat: a plump cushion of black stardust velvet on a marble box, all on a low marble base
// All of it your white marble with real gold veins and a soft glow (materials.js), laid on by place like the table.
//   throne()   one throne facing +z, standing on y = 0, centered (meters)
//   build()    the Workshop's look at it
// =====================================================================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { make } from './materials.js';
import { jewel } from './goldjewel.js';
import { byPlace } from './marbletable.js';

const BASE_H = 0.08;                  // the low base under it all
const SEAT_TOP = 0.5;                 // the cushion's top (a normal sitting height for the table)
const SEAT_W = 0.5, SEAT_D = 0.48;    // the seat
const ARM_X = 0.33, ARM_W = 0.12, ARM_TOP = 0.68;   // each arm: its middle across, its width, the top of its roll
const BACK_Z = -0.3, BACK_T = 0.08;   // the back: where it stands, and its thickness
const BACK_BOTTOM = 0.36;             // where the back starts, behind the seat
// The back's outline, its right half from the bottom up to the peak (meters across from the middle, up from its
// bottom); the left half is the same, mirrored
const OUTLINE = [[0.27, 0], [0.26, 0.18], [0.255, 0.38], [0.27, 0.58], [0.295, 0.76], [0.31, 0.88], [0.3, 0.97],
                 [0.265, 1.02], [0.2, 1.06], [0.13, 1.1], [0.06, 1.15], [0, 1.17]];

const box = (w, h, d, r, marble, x, y, z, parent) => {   // (a softly rounded marble block, marble laid on by place)
  const m = new THREE.Mesh(byPlace(new RoundedBoxGeometry(w, h, d, 4, r), [x, y, z]), marble);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
};
const both = pts => {   // (the full outline: up the right, over the peak, down the left)
  const right = pts.map(([x, y]) => new THREE.Vector2(x, y));
  const left = pts.slice(0, -1).reverse().map(([x, y]) => new THREE.Vector2(-x, y));
  return [...right, ...left];
};

export function throne() {
  const marble = make('White marble, gold veins');
  const t = new THREE.Group();
  // ---------- the base, and the seat on it ----------
  const baseBack = BACK_Z - 0.006, baseFront = 0.01 + (SEAT_D + 0.04) / 2 + 0.03;   // (flush with the back plate behind; the same small ledge in front as at the sides)
  box(ARM_X * 2 + ARM_W + 0.06, BASE_H, baseFront - baseBack, 0.02, marble, 0, BASE_H / 2, (baseFront + baseBack) / 2, t);
  const seatBody = SEAT_TOP - 0.1 - BASE_H;
  box(SEAT_W, seatBody, SEAT_D, 0.015, marble, 0, BASE_H + seatBody / 2, 0, t);
  const velvet = make('Velvet, black stardust');   // (the cushion: plump black velvet with ultra fine stardust)
  box(SEAT_W + 0.01, 0.11, SEAT_D + 0.01, 0.05, velvet, 0, SEAT_TOP - 0.055, 0.005, t);
  // ---------- the arms ----------
  for (const s of [-1, 1]) {
    const x = s * ARM_X, pillarH = ARM_TOP - 0.12 - BASE_H;
    box(ARM_W, pillarH, SEAT_D, 0.02, marble, x, BASE_H + pillarH / 2, 0, t);
    // the arm rest: one rounded marble block on the pillar, a little proud of it at the front, its front face flat
    const REST_H = 0.16, EDGE = 0.015, front = 0.01 + (SEAT_D + 0.04) / 2;
    box(ARM_W + 0.04, REST_H, SEAT_D + 0.04, EDGE, marble, x, ARM_TOP - REST_H / 2, 0.01, t);
    // a plump pillow of black stardust velvet on top, fitted to the rest's flat top and set flush into it: only its
    // rounded top shows, curving straight up out of the marble
    const PILLOW = 0.075, SOFT = 0.03;
    const pw = (ARM_W + 0.04) / 2 - EDGE, pd = (SEAT_D + 0.04) / 2 - EDGE, rc = 0.03;
    const ps = new THREE.Shape();
    ps.moveTo(-pw + rc, -pd); ps.lineTo(pw - rc, -pd); ps.quadraticCurveTo(pw, -pd, pw, -pd + rc);
    ps.lineTo(pw, pd - rc); ps.quadraticCurveTo(pw, pd, pw - rc, pd); ps.lineTo(-pw + rc, pd);
    ps.quadraticCurveTo(-pw, pd, -pw, pd - rc); ps.lineTo(-pw, -pd + rc); ps.quadraticCurveTo(-pw, -pd, -pw + rc, -pd);
    const pillow = new THREE.ExtrudeGeometry(ps, { depth: PILLOW - SOFT * 2, bevelEnabled: true, bevelThickness: SOFT,
      bevelSize: SOFT, bevelOffset: -SOFT, bevelSegments: 8, curveSegments: 12 });
    pillow.rotateX(-Math.PI / 2);   // (lying flat on the arm)
    pillow.translate(x, ARM_TOP - (PILLOW - SOFT * 2), 0.01);   // (sunk so only its rounded top rises out of the marble)
    t.add(new THREE.Mesh(byPlace(pillow), velvet));
    const jy = ARM_TOP - REST_H / 2;
    const armJewel = jewel({ width: 0.045, height: 0.065 });   // (set into that flat front)
    armJewel.position.set(x, jy, front);
    t.add(armJewel);
    const carve = new THREE.Curve();   // (a carved marble rim round it)
    carve.getPoint = (u, out = new THREE.Vector3()) => out.set(x + Math.cos(u * Math.PI * 2) * 0.034, jy + Math.sin(u * Math.PI * 2) * 0.046, front + 0.002);
    t.add(new THREE.Mesh(byPlace(new THREE.TubeGeometry(carve, 96, 0.006, 10, true)), marble));
    const footJewel = jewel({ width: 0.028, height: 0.036 });
    footJewel.position.set(x, BASE_H + 0.05, SEAT_D / 2 + 0.002);
    t.add(footJewel);
  }
  // ---------- the back ----------
  const back = new THREE.Group();
  back.position.set(0, BACK_BOTTOM, BACK_Z);
  t.add(back);
  const outline = both(OUTLINE);
  const shape = new THREE.Shape(new THREE.SplineCurve(outline).getPoints(160));
  // the marble back plate: squared off, its edges only slightly eased
  const slab = new THREE.ExtrudeGeometry(shape, { depth: BACK_T - 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 1 });
  back.add(new THREE.Mesh(byPlace(slab, [0, BACK_BOTTOM, BACK_Z]), marble));
  const faceZ = BACK_T - 0.006;   // (the plate's front face)
  // the back cushion on its front: a plump pad of black stardust velvet following the plate's shape, a little inside its
  // edge and rounding over flat just under the small jewel at the peak, its edges rolled thick and soft
  const PAD = 0.07, ROUND = 0.03;   // (how thick it stands off the plate, and how round its edges are)
  // (its own outline, right half from the bottom up: following the plate a little inside its edge, then rounding over
  // into a broad, nearly flat top just under the small jewel)
  const padLine = [[0.215, 0.06], [0.206, 0.24], [0.203, 0.42], [0.218, 0.6], [0.24, 0.76], [0.25, 0.86], [0.24, 0.93],
                   [0.205, 0.975], [0.14, 1.0], [0.07, 1.01], [0, 1.012]];
  const padShape = new THREE.Shape(new THREE.SplineCurve(both(padLine)).getPoints(160));
  const padGeo = new THREE.ExtrudeGeometry(padShape, { depth: PAD - ROUND * 2, bevelEnabled: true, bevelThickness: ROUND,
    bevelSize: ROUND, bevelOffset: -ROUND, bevelSegments: 8, curveSegments: 1 });
  padGeo.translate(0, 0, faceZ - 0.004 + ROUND);
  back.add(new THREE.Mesh(byPlace(padGeo, [0, BACK_BOTTOM, BACK_Z]), velvet));
  const padFront = faceZ - 0.004 + PAD;
  // the big jewel set into the cushion, high up
  const big = jewel({ width: 0.13, height: 0.17, collar: true });
  big.position.set(0, 0.72, padFront - 0.003);
  back.add(big);
  // and a small jewel on the marble at the peak, above the cushion
  const crestJewel = jewel({ width: 0.035, height: 0.05 });
  crestJewel.position.set(0, 1.07, faceZ + 0.001);
  back.add(crestJewel);
  return t;
}

export function build() { return throne(); }
// >>>>> END OF FILE: HangoutRoom/pieces/throne.js <<<<<
