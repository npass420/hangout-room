// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/checkers/pieceenv.js <<<<<
import * as THREE from 'three';
// What the pieces' polish reflects: a dark room with a few soft round lights (the room's own reflection picture has
// square light panels, which showed as square glares on the pieces); made once
let pieceEnv = null;
export function softEnv(renderer) {
  if (pieceEnv) return pieceEnv;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#2a2630'); sky.addColorStop(0.45, '#0e0c12'); sky.addColorStop(1, '#030304');
  g.fillStyle = sky; g.fillRect(0, 0, 1024, 512);
  const blob = (x, y, r, rgb, a) => {
    for (const dx of [-1024, 0, 1024]) {
      const s = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      s.addColorStop(0, `rgba(${rgb},${a})`); s.addColorStop(0.5, `rgba(${rgb},${a * 0.3})`); s.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = s; g.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  };
  // (lights kept away from straight overhead, where the picture gets squeezed into blocky shapes, and soft all the way through)
  blob(512, 150, 120, '255,246,235', 0.55);
  blob(180, 190, 60, '255,240,225', 0.45);
  blob(760, 200, 50, '235,225,255', 0.4);
  blob(330, 260, 120, '120,40,60', 0.3);    // (faint warm and violet color low down)
  blob(640, 270, 120, '70,40,120', 0.3);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  const gen = new THREE.PMREMGenerator(renderer);
  pieceEnv = gen.fromEquirectangular(t).texture;
  gen.dispose(); t.dispose();
  return pieceEnv;
}
// >>>>> END OF FILE: HangoutRoom/checkers/pieceenv.js <<<<<
