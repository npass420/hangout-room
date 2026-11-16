// ===================================================================================================================
// Workshop/pieces/rug.js: the rug that lies under the game table: soft black velvet with stardust through it, fine gold
// stitched stars joined by thin gold lines, and a thin gold line round its edge (their Kindroid picture).
// A thick plush rug with softly rounded edges, the velvet rolling over them; the velvet's fine nap raised a little so
// it reads as deep fibers, with a soft sheen where light grazes it; the gold thread and stardust shine like real metal.
// makeRug(THREE, { loader, anisotropy, onReady, size }) gives back { group, materials, top }: the group lies on y = 0,
// size meters square (default 2), about 1.6 centimeters thick.
// Pictures (in textures/rug): rug_velvet_black.jpg (the rug), with _metal (where the gold thread and stardust are),
// _rough (the gold smoother than the velvet) and _bump (the velvet's nap and the stitching, raised).
// VERSION 3
// ===================================================================================================================
export function makeRug(THREE, { loader, anisotropy = 8, onReady = () => {}, size = 2 } = {}) {
  const folder = 'textures/rug/';
  const CORE = 0.006, ROLL = 0.005, THICK = CORE + ROLL * 2;   // (the rug's middle, and the rounded edge above and below)
  let left = 4;
  const load = (file, color) => {
    const t = loader.load(folder + file, () => { if (--left === 0) onReady(); });
    t.anisotropy = anisotropy;
    t.repeat.set(1 / size, 1 / size); t.offset.set(0.5, 0.5);   // (the picture spread once over the rug, edge to edge)
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const velvet = new THREE.MeshPhysicalMaterial({
    map: load('rug_velvet_black.jpg', true),
    metalnessMap: load('rug_velvet_black_metal.jpg'), metalness: 1,       // (only where the gold and the stardust are)
    roughnessMap: load('rug_velvet_black_rough.jpg'), roughness: 1,
    bumpMap: load('rug_velvet_black_bump.jpg'), bumpScale: 2.5,
    sheen: 1, sheenColor: new THREE.Color(0x4a4452), sheenRoughness: 0.4,   // (velvet's soft glow where light grazes it)
    envMapIntensity: 0.8
  });
  // the rug: a square with softly rounded edges, the velvet picture rolling over them
  const R2 = size / 2, shape = new THREE.Shape();
  shape.moveTo(-R2, -R2); shape.lineTo(R2, -R2); shape.lineTo(R2, R2); shape.lineTo(-R2, R2); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: CORE, bevelEnabled: true, bevelThickness: ROLL, bevelSize: ROLL,
    bevelOffset: -ROLL, bevelSegments: 6, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, ROLL, 0);
  const rug = new THREE.Mesh(geo, velvet);
  rug.receiveShadow = true;
  const group = new THREE.Group();
  group.add(rug);
  return { group, materials: [velvet], top: THICK };
}
// ===================================================================================================================
// END OF Workshop/pieces/rug.js
// ===================================================================================================================
