// ===================================================================================================================
// Workshop/pieces/checkerboard.js: a checkerboard of polished red and black marble, set in one flat top of black marble
// with red veins, its border sloping down and out an inch all the way round in the same stone. Every square is cut from
// a different part of its stone, so no two squares match.
// Made as one piece: makeCheckerboard(THREE, options) gives back { group, materials }. The group sits with its
// bottom at y = 0, centered, the playing squares facing up; materials lists everything that should reflect the room.
// options: loader (a THREE.TextureLoader), anisotropy (texture sharpness), folder (where its pictures are),
//          onReady (called each time a picture has loaded, so the room can take a new reflection snapshot),
//          size (the whole board across, edge to edge, in meters).
// Pictures (in textures/checker): checker_marble_red.jpg (red marble), checker_marble_black.jpg (black marble, red veins).
// VERSION 11
// ===================================================================================================================
import { squareSweep, wrapStone } from './shapes.js';

export function makeCheckerboard(THREE, { loader, anisotropy = 8, folder = 'textures/checker/', onReady = () => {}, size = 1.5 } = {}) {
  const N = 8;                 // squares along each side
  const SLOPE = 0.0254;        // the border's slope, one inch out
  const RIM = 0.151;           // the flat black top round the squares, as a share of the playing area's width
  const PLAY = (size / 2 - SLOPE) / (0.5 + RIM);   // the playing area (so the whole board comes to 'size' across)
  const SQ = PLAY / N;         // one square
  const GAP = 0.0016;          // the fine dark seam between squares
  const TILE_D = 0.012;        // how thick a square is
  const TILE_B = 0.0022;       // a square's rounded edge
  const UNDER = 0.011;         // the dark bed the squares sit in (its top is where the squares start)
  const FH = 0.03;             // the black top's height (a little above the squares)

  const group = new THREE.Group();
  const materials = [];
  const mat = (o) => { const m = new THREE.MeshStandardMaterial(o); materials.push(m); return m; };

  // a block with softly rounded edges: the shape given thickness, its top face at y = 0, facing up
  function block(shape, depth, bevel) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 1 });
    g.translate(0, 0, -depth + bevel);
    g.rotateX(-Math.PI / 2);   // (the shape's x stays x; its y now runs toward -z)
    return g;
  }
  function picture(name, ready) {   // load one of the board's pictures, then hand it to ready
    loader.load(folder + name, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = anisotropy;
      ready(t);
      onReady();
    });
  }
  let seed = 11;
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // ---------- The dark bed under the squares, reaching in under the black top (shows as the fine seams between them) ----------
  const bed = new THREE.Mesh(new THREE.BoxGeometry(PLAY + 0.004, UNDER, PLAY + 0.004), mat({ color: 0x050506, roughness: 0.5 }));
  bed.position.y = UNDER / 2;
  group.add(bed);

  // ---------- The squares: red marble and black marble, each cut from its own part of the stone ----------
  const h = (SQ - GAP) / 2, k = h - TILE_B;
  const sq = new THREE.Shape();
  sq.moveTo(-k, -k); sq.lineTo(k, -k); sq.lineTo(k, k); sq.lineTo(-k, k); sq.closePath();
  const tileGeo = block(sq, TILE_D, TILE_B);   // (its top face runs from -h to h each way)
  const STONES = {
    red:   { file: 'checker_marble_red.jpg',   cut: 300, edge: 0x3a0608, roughness: 0.2 },    // cut: how many pixels of the picture a 6 cm square shows
    black: { file: 'checker_marble_black.jpg', cut: 520, edge: 0x060607, roughness: 0.18 }
  };
  const faces = { red: [], black: [] };
  const edges = {};
  for (const [name, S] of Object.entries(STONES)) edges[name] = mat({ color: S.edge, roughness: S.roughness, envMapIntensity: 0.7 });
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const name = (r + c) % 2 === 0 ? 'black' : 'red';   // (dark square in each near left corner, as on a real board)
    const face = mat({ color: 0x000000, roughness: STONES[name].roughness, envMapIntensity: 0.7 });
    faces[name].push(face);
    const tile = new THREE.Mesh(tileGeo, [face, edges[name]]);
    tile.position.set(-PLAY / 2 + SQ * (c + 0.5), UNDER + TILE_D, -PLAY / 2 + SQ * (r + 0.5));
    group.add(tile);
  }
  for (const [name, S] of Object.entries(STONES)) picture(S.file, t => {
    const W = t.image.width, H = t.image.height;
    for (const face of faces[name]) {   // a different cut of the stone for each square
      const p = t.clone();
      const cut = Math.min(S.cut * SQ / 0.062, 0.9 * Math.min(W, H));   // (bigger squares show more of the stone)
      p.repeat.set(cut / W / (2 * h), cut / H / (2 * h));
      p.offset.set((cut / 2 + random() * (W - cut)) / W, (cut / 2 + random() * (H - cut)) / H);
      p.needsUpdate = true;
      face.map = p; face.color.set(0xffffff); face.needsUpdate = true;
    }
  });

  // ---------- The top and its border: one piece of black marble with red veins, right round the squares ----------
  // Its shape across (from the squares outward): up from the squares' bed to the flat top, out across the top, then a
  // slope down and out an inch, then a thin upright edge to the bottom. Every edge along the way is very slightly
  // rounded. That shape is carried round all four sides, meeting itself in a clean line at each corner.
  const IN = PLAY / 2 + 0.0006;   // where it starts, from the middle (right against the squares)
  const TOP = size / 2 - SLOPE;   // where the flat top ends and the slope starts
  const LIP = 0.004;              // the thin upright edge at the bottom of the slope
  {
    const R = TOP + SLOPE;
    const geo = squareSweep(THREE, [   // [out from the middle, height, how much to round this corner]
      [IN, UNDER, 0], [IN, FH, 0.0025], [TOP, FH, 0.004], [R, LIP, 0.003], [R, 0, 0]
    ]);
    wrapStone(geo, size + 0.1);
    const face = mat({ color: 0x0a0a0b, roughness: 0.16, envMapIntensity: 0.8 });
    group.add(new THREE.Mesh(geo, face));
    picture('checker_marble_black.jpg', t => {
      const p = t.clone(); p.needsUpdate = true;   // (its own copy, so it can show a different part of the stone from the squares)
      p.repeat.set(0.9, 0.9); p.offset.set(0.05, 0.05);
      face.map = p; face.color.set(0xffffff); face.needsUpdate = true;
    });
  }

  return { group, materials };
}
// ===================================================================================================================
// END OF Workshop/pieces/checkerboard.js
// ===================================================================================================================
