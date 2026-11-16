// ===================================================================================================================
// Workshop/pieces/wood.js: the lacquered finishes the table and its stand are made of: the polished dark red wood of
// the tabletop, and the stand's deep oxblood lacquer (a fine dark mottle under a thick glossy coat). Both are finished
// like lacquered furniture: the grain has a faint feel to it under a clear, smooth, glossy coat, and the dark grain is a touch duller
// than the lighter wood beneath that coat.
// makeWood(THREE, { loader, anisotropy, onReady, kind }) gives back { material(across, along), materials }
// (kind: 'table' for the wood, 'stand' for the oxblood lacquer):
//   material(across, along): the wood for one part, the picture shown that many times across and along its surface
//   (1, 1 for a part laid out over the whole picture, like the tabletop); materials: every one made, so they reflect
//   the room. onReady is called as each picture arrives (so the room can take a new reflection snapshot).
// Pictures: textures/table/table_wood_red.jpg (the wood), with _bump (the grain's feel) and _rough (where it's duller
//   or brighter); textures/stand/stand_lacquer_red.jpg (the oxblood lacquer, seamless), with _bump and _rough.
// VERSION 3
// ===================================================================================================================
const KINDS = {
  table: { folder: 'textures/table/', name: 'table_wood_red', bright: 0.86, roughness: 0.46, coat: 0.6, coatRough: 0.135 },
  stand: { folder: 'textures/stand/', name: 'stand_lacquer_red', bright: 1, roughness: 0.5, coat: 1, coatRough: 0.05 }   // (a thick, wet looking coat)
};
export function makeWood(THREE, { loader, anisotropy = 8, onReady = () => {}, kind = 'table' } = {}) {
  const K = KINDS[kind], folder = K.folder, BRIGHT = K.bright;
  const parts = [];      // [material, across, along]
  const pictures = {};   // slot: texture, once loaded
  function dress(m, across, along) {   // give a part the pictures, at its own size
    for (const [slot, t] of Object.entries(pictures)) {
      const p = t.clone();
      p.wrapS = p.wrapT = THREE.RepeatWrapping;
      p.repeat.set(across, along);
      p.needsUpdate = true;
      m[slot] = p;
    }
    if (pictures.map) m.color.setScalar(BRIGHT);
    m.needsUpdate = true;
  }
  function material(across = 1, along = 1) {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x3a0a08,
      roughness: K.roughness,      // (times the roughness picture)
      bumpScale: 1,
      clearcoat: K.coat,           // the lacquer: a clear coat over the grain, smooth and glossy
      clearcoatRoughness: K.coatRough,
      envMapIntensity: 0.72
    });
    parts.push([m, across, along]);
    dress(m, across, along);
    return m;
  }
  const files = { map: K.name + '.jpg', bumpMap: K.name + '_bump.jpg', roughnessMap: K.name + '_rough.jpg' };
  for (const [slot, file] of Object.entries(files)) loader.load(folder + file, t => {
    if (slot === 'map') t.colorSpace = THREE.SRGBColorSpace;   // (the others are plain values, not colors)
    t.anisotropy = anisotropy;
    pictures[slot] = t;
    for (const [m, a, b] of parts) dress(m, a, b);
    onReady();
  });
  return { material, get materials() { return parts.map(p => p[0]); } };
}
// ===================================================================================================================
// END OF Workshop/pieces/wood.js
// ===================================================================================================================
