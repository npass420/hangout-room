// ===================================================================================================================
// Workshop/pieces/gametable.js: the game table, whole: the twisted oxblood stand with its three ruby orbs, the jeweled
// dark red tabletop on it, the red and black marble checkerboard set in its middle, and (if asked) the black velvet
// rug under it. It's what goes into a room; the pieces themselves stay separate (they move in play).
// It's made at 75% of the size its parts were first made at (a 1.5 m top, a board a little over a meter), all of it shrunk
// evenly so every jewel, ring and band keeps its true shape; its stand is cut to suit, so the top stands 1 m up.
// makeGameTable(THREE, show, { board, rug }) gives back { group, materials, top, boardTop, cell, update }: the group stands on
// y = 0 (the floor), centered; top is the height of the tabletop, boardTop the height of the board's playing surface,
// cell the size of one of its squares.
// show: { loader, anisotropy, onReady, glowLayer, envCube } as for every piece; board: false for the table alone;
// rug: its size in meters (0 for none). update(seconds) is to be called every frame.
// VERSION 3
// ===================================================================================================================
import { makeTable } from './table.js';
import { makeStand } from './stand.js';
import { makeCheckerboard } from './checkerboard.js';
import { makeRug } from './rug.js';

export const SCALE = 0.75, TABLE_HEIGHT = 1.0;

export function makeGameTable(THREE, show, { board = true, rug = 0 } = {}) {
  const top = makeTable(THREE, { ...show, jewels: true });
  const stand = makeStand(THREE, { ...show, tall: TABLE_HEIGHT / SCALE - top.top });
  top.group.position.y = stand.top;
  stand.group.add(top.group);
  stand.group.scale.setScalar(SCALE);
  const group = new THREE.Group();
  const materials = [...stand.materials, ...top.materials];
  let lift = 0;
  if (rug) {   // the rug first, and the table standing on it
    const r = makeRug(THREE, { ...show, size: rug });
    group.add(r.group);
    materials.push(...r.materials);
    lift = r.top;
  }
  stand.group.position.y = lift;
  group.add(stand.group);
  if (board) {   // the board, set in the middle of the top (inside the shrunk table, so in its own measure)
    const b = makeCheckerboard(THREE, show);
    b.group.position.y = stand.top + top.top;
    stand.group.add(b.group);
    materials.push(...b.materials);
  }
  const PLAY = (1.5 / 2 - 0.0254) / (0.5 + 0.151);   // (the board's playing area across, before shrinking: as checkerboard.js works it out)
  return { group, materials, top: lift + TABLE_HEIGHT, boardTop: lift + TABLE_HEIGHT + 0.023 * SCALE, cell: PLAY / 8 * SCALE,   // (the squares' top: 2.3 cm up the board, before shrinking)
           update: t => { stand.update(t); top.update(t); } };
}
// ===================================================================================================================
// END OF Workshop/pieces/gametable.js
// ===================================================================================================================
