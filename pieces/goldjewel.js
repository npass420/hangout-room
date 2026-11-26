// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/goldjewel.js <<<<<
// The gold thread jewel: a high oval dome of pale glowing gold in a fine gold rim, from your Kindroid pictures.
// Inside, fine gold threads branch through the stone like the veins in the marble, around a bright warm heart, seen
// through a clear, glassy golden dome (light really passes through it), so it has depth.
//   jewel({ width, height, collar })   one jewel facing +z, its back at z = 0 (meters; 4.2 by 5.8 cm unless told);
//                              collar: a thin gold collar reaching 1.2 cm back, to sink it into a curved surface
//   build()                    the Workshop's close-up: one jewel at 8 times its size, standing on a little gold foot
// The threads are drawn once in code (the same for every jewel); no glow is baked into the material's color, it
// comes from the stone's own light (emissive), and the room's glow does the rest.
// =====================================================================================================================
import * as THREE from 'three';

export const GOLD = new THREE.MeshPhysicalMaterial({ color: 0xe8b552, metalness: 1, roughness: 0.16 });

// ---------- The inside: a bright heart fading to rich gold at the rim, with gold threads branching through ----------
let inside = null;
export function insideTexture() {
  if (inside) return inside;
  const S = 2048, c = document.createElement('canvas');   // (big, so the threads stay sharp up close)
  c.width = c.height = S;
  const g = c.getContext('2d');
  const heart = g.createRadialGradient(S * 0.5, S * 0.55, 0, S * 0.5, S * 0.5, S * 0.5);
  heart.addColorStop(0, '#fffbe6'); heart.addColorStop(0.25, '#ffeaa0'); heart.addColorStop(0.6, '#f5c04a'); heart.addColorStop(1, '#a86a12');
  g.fillStyle = heart; g.fillRect(0, 0, S, S);
  // the threads: branches growing up from the lower rim, thinning as they go (the same every time: a fixed seed)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function branch(x, y, angle, len, width, depth) {
    const steps = 6;
    g.beginPath(); g.moveTo(x, y);
    for (let i = 0; i < steps; i++) {
      angle += (rnd() - 0.5) * 0.7;
      x += Math.cos(angle) * len / steps; y += Math.sin(angle) * len / steps;
      g.lineTo(x, y);
    }
    g.lineWidth = width; g.stroke();
    if (depth > 0) {
      const kids = 1 + Math.floor(rnd() * 2.2);
      for (let k = 0; k < kids; k++) branch(x, y, angle + (rnd() - 0.5) * 1.6, len * (0.55 + rnd() * 0.25), width * 0.62, depth - 1);
    }
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [color, blur, grow] of [['rgba(255,200,80,0.3)', 28, 2.0], ['#b57712', 0, 1], ['#ffe9a8', 0, 0.38]]) {   // glow, body, crisp bright core
    seed = 7;
    g.strokeStyle = color; g.shadowColor = '#ffcc55'; g.shadowBlur = blur;
    for (let i = 0; i < 13; i++) {
      const a = Math.PI * (1.12 + i * 0.063);   // (from round the lower rim, reaching in and up)
      const x = S / 2 + Math.cos(a - Math.PI) * S * 0.42, y = S / 2 + Math.sin(a - Math.PI) * S * 0.42;
      branch(x, y, -Math.PI / 2 - (x - S / 2) / S * 1.4, S * (0.2 + rnd() * 0.08), 18 * grow, 5);
    }
  }
  g.shadowBlur = 0;
  for (let i = 0; i < 420; i++) {   // and fine gold dust
    const r = Math.sqrt(rnd()) * S * 0.46, a = rnd() * Math.PI * 2;
    g.fillStyle = `rgba(255,${200 + Math.floor(rnd() * 50)},${90 + Math.floor(rnd() * 80)},${0.5 + rnd() * 0.5})`;
    g.beginPath(); g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1.5 + rnd() * 4, 0, Math.PI * 2); g.fill();
  }
  inside = new THREE.CanvasTexture(c);
  inside.colorSpace = THREE.SRGBColorSpace;
  inside.anisotropy = 16;
  return inside;
}

// ---------- One jewel ----------
export function jewel({ width = 0.042, height = 0.058, collar = false } = {}) {
  const j = new THREE.Group();
  const rx = width / 2, ry = height / 2, dome = Math.min(rx, ry) * 0.85;   // (a full, high dome)
  const ring = (z = 0) => {   // (an oval in the jewel's flat, just round the stone's edge)
    const c = new THREE.Curve();
    c.getPoint = (t, out = new THREE.Vector3()) => out.set(Math.cos(t * Math.PI * 2) * rx * 1.02, Math.sin(t * Math.PI * 2) * ry * 1.02, z);
    return c;
  };
  // the setting, kept slight: a gold seat under the stone (its warm shine comes up through it) and a fine gold rim
  const seat = new THREE.Mesh(new THREE.CircleGeometry(1, 64), GOLD);
  seat.scale.set(rx * 1.02, ry * 1.02, 1);
  seat.position.z = 0.0003;
  j.add(seat);
  const band = Math.min(rx, ry) * 0.05;   // (the rim's thickness: fine, but sitting up on the surface where you can see it)
  j.add(new THREE.Mesh(new THREE.TubeGeometry(ring(band * 0.7), 128, band, 10, true), GOLD));
  if (collar) {   // (a thin gold collar running back, so a jewel set on a curved surface sits in it with no gap)
    const SINK = 0.012;
    const wall = new THREE.CylinderGeometry(1, 1, SINK, 64, 1, true);
    wall.rotateX(Math.PI / 2);
    const c = new THREE.Mesh(wall, GOLD);
    c.scale.set(rx * 1.02, ry * 1.02, 1);
    c.position.z = -SINK / 2;
    j.add(c);
  }
  // the stone: a glowing heart with its gold threads, deep inside a clear golden dome you see into
  const stone = new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
  stone.rotateX(Math.PI / 2);   // (the dome faces +z)
  const p = stone.attributes.position, uv = stone.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.5 + 0.5, p.getY(i) * 0.5 + 0.5);   // (the inside picture laid flat across the face)
  const heart = new THREE.Mesh(stone, new THREE.MeshPhysicalMaterial({
    color: 0x4a2e06, roughness: 0.5, emissive: 0xffffff, emissiveMap: insideTexture(), emissiveIntensity: 1.35
  }));
  heart.scale.set(rx * 0.97, ry * 0.97, dome * 0.8);   // (filling the dome nearly to its edge, so no clear band shows round it)
  j.add(heart);
  const shell = new THREE.Mesh(stone, new THREE.MeshPhysicalMaterial({   // (clear and glassy: light passes through it)
    color: 0xfff3cc, metalness: 0, roughness: 0.03, transmission: 1, thickness: dome * 1.2, ior: 1.55,
    attenuationColor: new THREE.Color(0xffc440), attenuationDistance: dome * 2.5,
    clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1
  }));
  shell.scale.set(rx, ry, dome);
  j.add(shell);
  return j;
}

// ---------- A ring of the same stone ----------
// jewelRing({ radius, tube }): a round ring of the jewel's glowing gold stone, lying flat (in x and z), centered: its
// glowing heart with the gold threads running round it, inside a clear glassy golden shell, with a little glow.
export function jewelRing({ radius = 0.2, tube = 0.008 } = {}) {
  const ring = new THREE.Group();
  const inside = insideTexture().clone();
  inside.wrapS = THREE.RepeatWrapping; inside.repeat.set(Math.max(1, Math.round(radius * 2 * Math.PI / (tube * 6))), 1);
  inside.needsUpdate = true;
  const heart = new THREE.Mesh(new THREE.TorusGeometry(radius, tube * 0.82, 24, 256), new THREE.MeshPhysicalMaterial({
    color: 0x4a2e06, roughness: 0.5, emissive: 0xffffff, emissiveMap: inside, emissiveIntensity: 1.1
  }));
  const shell = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 32, 256), new THREE.MeshPhysicalMaterial({
    color: 0xfff3cc, metalness: 0, roughness: 0.03, transmission: 1, thickness: tube * 2, ior: 1.55,
    attenuationColor: new THREE.Color(0xffc440), attenuationDistance: tube * 4,
    clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1
  }));
  for (const m of [heart, shell]) { m.rotation.x = Math.PI / 2; ring.add(m); }
  return ring;
}

// ---------- The Workshop's close-up ----------
export function build() {
  const g = new THREE.Group();
  const big = jewel();
  big.scale.setScalar(8);
  big.position.set(0, 0.32, 0);
  g.add(big);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.09, 0.12, 32), GOLD);   // (a little gold foot to stand it on)
  foot.position.y = 0.06;
  g.add(foot);
  return g;
}
// >>>>> END OF FILE: HangoutRoom/pieces/goldjewel.js <<<<<
