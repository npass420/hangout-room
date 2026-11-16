// ===================================================================================================================
// Workshop/pieces/chair.js: a tall chair for the game table (after their Kindroid picture), in the stand's deep oxblood
// lacquer. From the floor up: twisted spiral front legs and plain, gently curved back legs; a plump black velvet seat
// edged with a fine gold beaded line; a tall back that narrows at its waist and flares at the top into a pointed crest,
// its lacquered frame lined inside with a fine gold beaded line round a black velvet panel; and on the crest a small gold
// fan holding a round dark ruby that glows like the table's.
// makeChair(THREE, show, { seat }) gives back { group, materials, update }: the group stands on y = 0, facing +z (the
// way you face sitting in it), centered on its seat; seat is the seat's height (default 0.68 m, for a 1 m table).
// show: { loader, anisotropy, onReady, glowLayer, envCube } as for every piece. update(seconds) is to be called every
// frame (the ruby's glow breathes).
// VERSION 1
// ===================================================================================================================
import { makeWood } from './wood.js';
import { makeJewels } from './jewels.js';

export function makeChair(THREE, { loader, anisotropy = 8, onReady = () => {}, glowLayer = 1, envCube = null } = {}, { seat = 0.68 } = {}) {
  const group = new THREE.Group();
  const W = makeWood(THREE, { loader, anisotropy, onReady, kind: 'stand' });   // (the stand's oxblood lacquer)
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8a64a, metalness: 1, roughness: 0.22, envMapIntensity: 0.8 });
  const velvet = new THREE.MeshPhysicalMaterial({ color: 0x0b090b, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0x4a4250),
    sheenRoughness: 0.4, envMapIntensity: 0.4 });
  const add = (geo, m, parent = group) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

  const SW = 0.48, SD = 0.46;          // the seat, across and front to back
  const APRON = 0.07;                  // the lacquered frame under the cushion
  const CUSH = 0.075;                  // the velvet cushion's thickness
  const FRAME_TOP = seat - CUSH * 0.6; // (the cushion sits down into its frame a little)
  const LEG = FRAME_TOP - APRON;       // how tall the legs are, to the bottom of the frame

  const rounded = (w, d, r) => {       // a rounded rectangle, centered
    const s = new THREE.Shape(), x = w / 2 - r, y = d / 2 - r;
    s.moveTo(-x, -d / 2); s.lineTo(x, -d / 2); s.quadraticCurveTo(w / 2, -d / 2, w / 2, -y);
    s.lineTo(w / 2, y); s.quadraticCurveTo(w / 2, d / 2, x, d / 2); s.lineTo(-x, d / 2);
    s.quadraticCurveTo(-w / 2, d / 2, -w / 2, y); s.lineTo(-w / 2, -y); s.quadraticCurveTo(-w / 2, -d / 2, -x, -d / 2);
    return s;
  };
  const slab = (shape, depth, bevel, m) => {   // a flat shape given thickness, lying flat (its bottom at y = 0)
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(depth - bevel * 2, 0.001), bevelEnabled: true,
      bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 12 });
    g.rotateX(-Math.PI / 2); g.translate(0, bevel, 0);
    return add(g, m);
  };
  const lineAlong = (pts, r, closed, parent) => {   // a fine gold beaded line along a path
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
    return add(new THREE.TubeGeometry(curve, 240, r, 6, closed), gold, parent);
  };

  // ---------- The seat: a lacquered frame, and a plump velvet cushion on it with a fine gold edge ----------
  slab(rounded(SW, SD, 0.03), APRON, 0.008, W.material(2, 2)).position.y = LEG;
  const cushion = slab(rounded(SW - 0.02, SD - 0.02, 0.06), CUSH, 0.03, velvet);
  cushion.position.y = FRAME_TOP - CUSH * 0.4;
  {
    const ring = [], N = 64, w = SW / 2 - 0.006, d = SD / 2 - 0.006;
    for (let i = 0; i < N; i++) {   // (round the top edge of the frame, where the cushion meets it)
      const a = i / N * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const k = 1 / Math.pow(Math.pow(Math.abs(c), 6) + Math.pow(Math.abs(s), 6), 1 / 6);   // (a rounded square)
      ring.push(new THREE.Vector3(c * k * w, FRAME_TOP + 0.003, s * k * d));
    }
    lineAlong(ring, 0.0035, true);
  }

  // ---------- The legs ----------
  // the front legs: turned, with a long spiral twist (three bands winding round, like the stand), a collar at the top
  // and a small turned foot
  function twistedLeg(x, z) {
    const prof = [[0.0, 0], [0.024, 0], [0.028, 0.012], [0.022, 0.03], [0.018, 0.05], [0.024, 0.07], [0.026, 0.09],
                  [0.026, LEG - 0.1], [0.03, LEG - 0.08], [0.024, LEG - 0.06], [0.028, LEG - 0.04], [0.03, LEG], [0, LEG]];
    const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 96);
    // carve the twist: between the foot and the collar, three rounded grooves wind round the leg
    const p = g.attributes.position, Y0 = 0.09, Y1 = LEG - 0.1, TURNS = 3.2;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y <= Y0 || y >= Y1) continue;
      const vx = p.getX(i), vz = p.getZ(i), r = Math.hypot(vx, vz);
      if (r < 1e-5) continue;
      const a = Math.atan2(vz, vx), t = (y - Y0) / (Y1 - Y0);
      const edge = Math.min(1, t * 8, (1 - t) * 8);   // (the twist eases in and out at its ends)
      const k = 1 - 0.16 * edge * (0.5 - 0.5 * Math.cos(3 * (a - t * TURNS * Math.PI * 2)));
      p.setXYZ(i, vx * k, y, vz * k);
    }
    g.computeVertexNormals();
    add(g, W.material(1.2, 3)).position.set(x, 0, z);
  }
  const LX = SW / 2 - 0.04, LZ = SD / 2 - 0.04;
  twistedLeg(-LX, LZ); twistedLeg(LX, LZ);
  // the back legs: plain and tapered, curving gently back toward the floor
  for (const sx of [-1, 1]) {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(sx * LX, LEG + 0.01, -LZ),
      new THREE.Vector3(sx * LX, LEG * 0.45, -LZ - 0.01), new THREE.Vector3(sx * LX, 0, -LZ - 0.06));
    const g = new THREE.TubeGeometry(curve, 40, 0.022, 20, false);
    const pos = g.attributes.position, c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {   // (tapering toward the floor)
      const t = Math.floor(i / 21) / 40; curve.getPointAt(t, c);
      const k = 1 - 0.35 * t;
      pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, pos.getY(i), c.z + (pos.getZ(i) - c.z) * k);
    }
    g.computeVertexNormals();
    add(g, W.material(1.2, 3));
  }

  // ---------- The back: tall, narrowing at its waist, flaring at the top into a pointed crest ----------
  const BH = 0.86;                              // how tall the back stands above the seat frame
  const back = new THREE.Group();
  back.position.set(0, FRAME_TOP - 0.01, -SD / 2 + 0.02);
  back.rotation.x = -0.12;                      // (leaning back a little)
  group.add(back);
  const halfW = t => {                          // the back's half width, from the bottom (0) to the top (1)
    const pts = [[0, 0.2], [0.25, 0.17], [0.55, 0.135], [0.8, 0.165], [0.94, 0.215], [1, 0.22]];
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) {
      const [t0, w0] = pts[i - 1], [t1, w1] = pts[i], u = (t - t0) / (t1 - t0), e = u * u * (3 - 2 * u);
      return w0 + (w1 - w0) * e;
    }
    return 0.22;
  };
  const outline = (inset, peak) => {            // the back's outline, brought in by inset (up the right side, over the crest, down the left)
    const right = [], N = 30;
    for (let i = 0; i <= N; i++) { const t = i / N; right.push(new THREE.Vector2(halfW(t) - inset, inset + t * (BH - inset * 2))); }
    const top = BH - inset, w = halfW(1) - inset, crest = [];
    for (let i = 1; i < 16; i++) {               // the crest: rising from each top corner in a soft curve to a point
      const u = i / 16, x = w * (1 - 2 * u), lift = peak * Math.pow(Math.sin(Math.PI * u), 1.4) + 0.012 * Math.sin(Math.PI * u * 3);
      crest.push(new THREE.Vector2(x, top + lift));
    }
    const left = right.map(v => new THREE.Vector2(-v.x, v.y)).reverse();
    return [...right, ...crest, ...left];
  };
  const FRAME_W = 0.034, FRAME_D = 0.036;
  {
    const shape = new THREE.Shape(outline(0, 0.09));
    shape.holes.push(new THREE.Path(outline(FRAME_W, 0.06)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: FRAME_D - 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006,
      bevelSegments: 4, curveSegments: 12 });
    g.translate(0, 0, -FRAME_D / 2);
    add(g, W.material(2, 2), back);
    // the velvet panel inside the frame, padded a little
    const panel = new THREE.ExtrudeGeometry(new THREE.Shape(outline(FRAME_W - 0.004, 0.06)), { depth: 0.006, bevelEnabled: true,
      bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 5, curveSegments: 12 });
    panel.translate(0, 0, -0.008);
    add(panel, velvet, back);
    // the fine gold beaded line just inside the frame
    lineAlong(outline(FRAME_W + 0.008, 0.055).map(v => new THREE.Vector3(v.x, v.y, FRAME_D / 2 - 0.004)), 0.003, true, back);
  }

  // ---------- The crest: a small gold fan holding a round dark ruby that glows ----------
  const materials = [gold];
  const J = makeJewels(THREE, { size: 0.5, materials, glowLayer, envCube });
  const CY = BH + 0.035, CZ = FRAME_D / 2 + 0.006;
  {
    const fan = new THREE.Group();
    fan.position.set(0, CY, CZ - 0.008);
    back.add(fan);
    const disc = add(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 40), gold, fan);
    disc.rotation.x = Math.PI / 2;
    for (let i = 0; i < 9; i++) {   // the fan's leaves, spreading up and out behind the ruby
      const a = -1.25 + 2.5 * i / 8, leaf = add(new THREE.SphereGeometry(1, 16, 10), gold, fan);
      leaf.scale.set(0.009, 0.034, 0.005);
      leaf.position.set(Math.sin(a) * 0.036, Math.cos(a) * 0.036, -0.002);
      leaf.rotation.z = -a;
    }
    for (const sx of [-1, 1]) {     // two small gold scrolls curling out at its sides
      const s = add(new THREE.TorusGeometry(0.012, 0.0035, 8, 24, Math.PI * 1.4), gold, fan);
      s.position.set(sx * 0.045, -0.012, 0); s.rotation.z = sx > 0 ? -0.6 : Math.PI + 0.6;
    }
  }
  J.orb(0, CY, CZ + 0.012, 0.019);
  back.add(J.group);

  return { group, get materials() { return [...W.materials, velvet, ...materials]; }, update: J.update };
}
// ===================================================================================================================
// END OF Workshop/pieces/chair.js
// ===================================================================================================================
