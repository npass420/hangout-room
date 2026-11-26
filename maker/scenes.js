// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/maker/scenes.js <<<<<
// The holodeck's finished scenes: the ones everyone can switch to, online and here. Each is a walls picture (round
// the wall and up the dome; walls2, if given, on every copy round but the first) and, if it has one, a dome picture (the top, seen from beneath), plus the night color the
// sky fades to. The pictures live with the site's pieces (pieces/textures), so they upload with the site.
// A new scene: put its pictures in pieces/textures and add a line here. A pair of wide panoramas made to meet
// (the second the first's other half) can add copies: 2, so they go once round with no repeats.
// (Running here through the Workshop's launchers, the holodeck window also lets you try any of your Assets pictures,
// just for you, before making them a scene.)
// =====================================================================================================================
const pic = f => new URL('../pieces/textures/' + f, import.meta.url).href;

export const SCENES = [
  { name: 'Lantern lagoon', walls: pic('sky_island.jpg'), walls2: pic('sky_island_nomoon.jpg'), night: [0.0052, 0.022, 0.067] },
  { name: 'Castle hall', walls: pic('castle_window.jpg'), walls2: pic('castle_fire.jpg'), dome: pic('castle_vault.jpg'), night: [0.006, 0.004, 0.006] },
  { name: 'Star belt', walls: pic('sky_belt.jpg'), night: [0.008, 0.01, 0.03] }
];
// >>>>> END OF FILE: HangoutRoom/maker/scenes.js <<<<<
