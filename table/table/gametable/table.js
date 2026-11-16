// ===================================================================================================================
// Workshop/pieces/table.js: a square tabletop of polished dark red wood, edged like the checkerboard: flat, then a
// slightly rounded one inch slope down to a thin upright edge. Finished like lacquered furniture: the grain has a faint
// feel to it under a clear, smooth, glossy coat, and the dark grain is a touch duller than the lighter wood beneath
// that coat. It can wear jewels (a line of ovals along each side and a ruby crest in each corner), or not.
// Made as one piece: makeTable(THREE, options) gives back { group, materials, top, update }. The group sits with its
// underside at y = 0, centered; top is the height of its top surface, for setting things on it.
// options: loader (a THREE.TextureLoader), anisotropy (texture sharpness),
//          onReady (called each time a picture has loaded, so the room can take a new reflection snapshot),
//          size (across the top, edge to edge, in meters), jewels (true to set the jewels in it),
//          glowLayer (the room's glow layer, for the rubies), envCube (the room's snapshot, for the rubies); update(seconds) is to be called every frame.
// Pictures (in textures/table): table_wood_red.jpg (the wood), table_wood_red_bump.jpg (the grain's feel),
//          table_wood_red_rough.jpg (where the wood is duller or brighter).
// VERSION 19
// ===================================================================================================================
import { squareSweep, wrapStone } from './shapes.js';
import { makeJewels } from './jewels.js';
import { makeWood } from './wood.js';

export function makeTable(THREE, { loader, anisotropy = 8, onReady = () => {}, size = 2, jewels = false, glowLayer = 1, envCube = null } = {}) {
  const THICK = 0.045;         // the top's thickness
  const SLOPE = 0.0254;        // the edge's slope, one inch out
  const DROP = 0.018;          // how far the slope falls

  const group = new THREE.Group();
  const W = makeWood(THREE, { loader, anisotropy, onReady, kind: 'table' });
  const wood = W.material(1, 1);   // (the top is laid out over the whole picture)
  const materials = [wood];

  const R = size / 2, TOP = R - SLOPE;
  const geo = squareSweep(THREE, [   // [out from the middle, height, how much to round this corner]
    [0, THICK, 0], [TOP, THICK, 0.005], [R, THICK - DROP, 0.004], [R, 0, 0.003], [0, 0, 0]
  ]);
  wrapStone(geo, size + 0.1);   // (the picture spread over the whole top, so the grain runs unbroken edge to edge)
  const top = new THREE.Mesh(geo, wood);
  top.castShadow = true; top.receiveShadow = true;
  group.add(top);

  let update = () => {};
  if (jewels) {
    // A line of ovals runs along each side, seven to a side, dark ruby and onyx by turns, the same from the middle out
    // to both ends. In each corner, where two lines would meet, a large dark ruby crest points out along the diagonal.
    const J = makeJewels(THREE, { size: 1.4, materials, glowLayer, envCube });
    group.add(J.group);
    const LINE = TOP - 0.162,   // (the ovals' line about 2 cm out from the board's edge)
          CREST = TOP - 0.11, N = 3, REACH = LINE - 0.21;   // (the end ovals clear of the corner crests)
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) J.crest(sx * CREST, sz * CREST, Math.atan2(-sx, -sz), THICK, 1.25);
    for (const [ox, oz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const tx = oz !== 0 ? 1 : 0, tz = ox !== 0 ? 1 : 0, turn = ox !== 0 ? Math.PI / 2 : 0;   // along the side
      for (let i = -N; i <= N; i++) {
        const t = i * REACH / N;
        J.oval(ox * LINE + tx * t, oz * LINE + tz * t, turn, THICK, i % 2 === 0 ? J.RUBY : J.ONYX, 1.8);   // (half again their first size: about 10.5 cm long)
      }
    }
    update = J.update;
  }


  return { group, materials, top: THICK, update };
}
// ===================================================================================================================
// END OF Workshop/pieces/table.js
// ===================================================================================================================
