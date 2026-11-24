// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/gameboard.js <<<<<
// The den's checkerboard with its checkers set out for a new game, to judge their look in the Workshop: the same
// board (checkers/checkerboard.js, 1.15 m, as summoned onto the table) and the same pieces (checkers/checkerset.js,
// with each jewel's own light), so what you tune here is what's played on.
//   build()   the board on y = 0, centered, with crimson's three rows at +x and violet's at -x
// =====================================================================================================================
import * as THREE from 'three';
import { makeCheckerboard, SQUARES_TOP } from '../checkers/checkerboard.js';
import { makeCheckerSet } from '../checkers/checkerset.js';

const BOARD = 1.15;
export function build() {
  const g = new THREE.Group();
  const board = makeCheckerboard(THREE, { loader: new THREE.TextureLoader(), folder: new URL('../checkers/textures/checker/', import.meta.url).href, size: BOARD });
  g.add(board.group);
  const PLAY = (BOARD / 2 - 0.0254) / (0.5 + 0.151), SQ = PLAY / 8;
  const set = makeCheckerSet(THREE, { glowLayer: 1, light: false });   // (as in the game)
  g.add(set.group);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    if ((r + c) % 2 === 1 && (r < 3 || r > 4)) set.piece((r - 3.5) * SQ, (3.5 - c) * SQ, SQUARES_TOP, SQ * 0.82, r > 4 ? 'crimson' : 'violet');
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false;   // (drawn every frame: it keeps the pieces' glitter and glow alive)
  g.add(ticker);
  const t0 = performance.now();
  ticker.onBeforeRender = () => set.update((performance.now() - t0) / 1000);
  return g;
}
// >>>>> END OF FILE: HangoutRoom/pieces/gameboard.js <<<<<
