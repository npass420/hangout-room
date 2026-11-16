// ===================================================================================================================
// Workshop/pieces/stand.js: the table's center stand, in deep oxblood lacquer, after the Kindroid picture.
// From the floor up: a square foot, its top edge sloping like the table's; a round collar with a gold ring; three thick
// rounded bands twisting tightly round one another, three dark ruby orbs glowing in the hollow, evenly spaced; a neck with
// a gold ring, flaring out to a round top plate with a thin gold rim, which holds up the tabletop.
// Made as one piece: makeStand(THREE, options) gives back { group, materials, top, update }. The group stands with its
// foot at y = 0, centered; top is the height of its top plate (where the tabletop sits).
// options: loader, anisotropy, onReady, glowLayer, envCube (as for the table); tall: the height of its top plate (default
// 1.4: the bands lengthen or shorten to suit, keeping the twist as tight).
// VERSION 6
// ===================================================================================================================
import { squareSweep, wrapStone } from './shapes.js';
import { makeWood } from './wood.js';
import { makeJewels } from './jewels.js';

export function makeStand(THREE, { loader, anisotropy = 8, onReady = () => {}, glowLayer = 1, envCube = null, tall = 1.4 } = {}) {
  const group = new THREE.Group();
  const W = makeWood(THREE, { loader, anisotropy, onReady, kind: 'stand' });   // (the oxblood lacquer)
  const LIFT = tall - 0.70;   // (the bands longer by this much than first made, everything above them raised)
  const add = (geo, m) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh; };

  // ---------- The foot: one square plate, its top edge sloping down and out like the table's ----------
  const foot = squareSweep(THREE, [[0, 0.07, 0], [0.58, 0.07, 0.006], [0.61, 0.045, 0.005], [0.61, 0, 0.004], [0, 0, 0]]);   // (1.22 m across)
  wrapStone(foot, 0.5);   // (half a meter of lacquer to the picture, everywhere on the stand)
  add(foot, W.material(1, 1));
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8a64a, metalness: 1, roughness: 0.2, envMapIntensity: 0.78 });
  const ring = (r, y, thick) => { const g = add(new THREE.TorusGeometry(r, thick, 16, 160), gold); g.rotation.x = Math.PI / 2; g.position.y = y; };

  // ---------- Turned parts: a shape across (out from the middle, up) spun round ----------
  const turned = (pts, along) => add(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 96), W.material(1.6, along));
  // the round collar the bands rise from: a rounded swell, with a gold ring round its top
  turned([[0.24, 0.07], [0.245, 0.078], [0.243, 0.092], [0.232, 0.106], [0.212, 0.118], [0.19, 0.126], [0.182, 0.132],
          [0.182, 0.142], [0.172, 0.148], [0.14, 0.152], [0, 0.152]], 0.12);
  ring(0.184, 0.137, 0.007);
  // the neck at the top of the bands, with a gold ring, flaring out to the top plate
  turned([[0.14, 0.606], [0.172, 0.61], [0.178, 0.618], [0.176, 0.628], [0.17, 0.632], [0.178, 0.638], [0.2, 0.646],
          [0.232, 0.652], [0.262, 0.656], [0.27, 0.66], [0, 0.66]].map(([r, y]) => [r, y + LIFT]), 0.12);
  ring(0.179, 0.622 + LIFT, 0.0065);
  // the round top plate, its edges softly rounded
  const TOP = 0.70 + LIFT;
  turned([[0, 0.66], [0.312, 0.66], [0.32, 0.666], [0.322, 0.674], [0.322, 0.69], [0.318, 0.697], [0.31, 0.70], [0, 0.70]]
    .map(([r, y]) => [r, y + LIFT]), 0.2);
  const rim = add(new THREE.TorusGeometry(0.3225, 0.0045, 12, 160), gold);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.686 + LIFT;

  // ---------- The three bands, spiraling round one another with open space between ----------
  const Y0 = 0.142, Y1 = 0.616 + LIFT;  // (each band's ends tucked into the collar and the neck)
  const R = 0.088, BAND = 0.05;         // how far out from the middle each band runs, and how thick it is
  const TURNS = 1.5 * (Y1 - Y0) / 0.474; // how far round each band winds, bottom to top (a tight, bold twist, as tight at any height)
  class Spiral extends THREE.Curve {
    constructor(phase) { super(); this.phase = phase; }
    getPoint(t, out = new THREE.Vector3()) {
      const a = this.phase + t * Math.PI * 2 * TURNS;
      const swell = 1 + 0.18 * Math.sin(t * Math.PI);   // (wider round the middle, like your picture)
      return out.set(Math.cos(a) * R * swell, Y0 + t * (Y1 - Y0), Math.sin(a) * R * swell);
    }
  }
  const length = Math.hypot(2 * Math.PI * R * TURNS * 1.1, Y1 - Y0);
  const bandWood = W.material(length / 0.5, 2 * Math.PI * BAND / 0.5);   // (the faint streaks running along each band)
  for (let i = 0; i < 3; i++) add(new THREE.TubeGeometry(new Spiral(i * Math.PI * 2 / 3), 400, BAND, 32), bandWood);

  // ---------- The ruby orbs in the hollow between the bands ----------
  const materials = [gold];
  const J = makeJewels(THREE, { size: 1, materials, glowLayer, envCube });
  for (const f of [0.25, 0.5, 0.75]) J.orb(0, Y0 + (Y1 - Y0) * f, 0, 0.04);   // (three, evenly spaced up the hollow)
  group.add(J.group);

  return { group, get materials() { return [...W.materials, ...materials]; }, top: TOP, update: J.update };
}
// ===================================================================================================================
// END OF Workshop/pieces/stand.js
// ===================================================================================================================
