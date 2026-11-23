// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/materials.js <<<<<
// The material library: every material the site's pieces are made of, shared by the gallery and the Workshop (whose
// material loader, key 3, lists them). Materials have no glow built in: glow is an effect a piece adds on top.
//   LIST        folders of material names (what the Workshop's loader shows)
//   make(name)  a new material by that name (its pictures fill in as they load)
// Pictures sit in pieces/textures (or with the room that already has them).
// =====================================================================================================================
import * as THREE from 'three';

export const LIST = {
  'Stone': ['White marble, gold veins', 'Black marble, gold veins', 'Porcelain, gold kintsugi'],
  'Metal': ['Gold, polished'],
  'Fabric': ['Velvet, black stardust']
};

const loader = new THREE.TextureLoader();
const cache = {};
function picture(file, color = true) {   // (each picture loaded once, shared by every material using it)
  if (!cache[file]) {
    const t = loader.load(new URL(file, import.meta.url).href);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;   // (if it repeats, it mirrors, so there's no seam)
    t.anisotropy = 8;
    cache[file] = t;
  }
  return cache[file];
}

export function make(name) {
  switch (name) {
    case 'White marble, gold veins':   // (your white Calacatta tile: polished stone, its gold veins real gold, softly luminous)
      return new THREE.MeshPhysicalMaterial({
        map: picture('textures/marble_white_gold.jpg'),
        roughnessMap: picture('textures/marble_white_gold_mr.jpg', false), roughness: 1,   // (green: how rough)
        metalnessMap: picture('textures/marble_white_gold_mr.jpg', false), metalness: 1,   // (blue: where the gold is)
        clearcoat: 0.6, clearcoatRoughness: 0.06,
        color: new THREE.Color(0.97, 0.99, 1.04),                                     // (a touch cool, so warm rooms don't turn it cream)
        emissive: 0xffffff, emissiveMap: picture('textures/marble_white_gold.jpg'), emissiveIntensity: 0.16   // (a soft glow of its own)
      });
    case 'Porcelain, gold kintsugi':   // (your porcelain tile: glossy ivory glaze, its cracks mended in raised real gold)
      return new THREE.MeshPhysicalMaterial({
        map: picture('textures/porcelain_kintsugi.jpg'),
        roughnessMap: picture('textures/porcelain_kintsugi_mr.jpg', false), roughness: 1,   // (green: how rough)
        metalnessMap: picture('textures/porcelain_kintsugi_mr.jpg', false), metalness: 1,   // (blue: where the gold is)
        bumpMap: picture('textures/porcelain_kintsugi_bump.jpg', false), bumpScale: 1.5,     // (the gold stands up a little)
        clearcoat: 1, clearcoatRoughness: 0.04,
        color: new THREE.Color(1.18, 1.15, 1.12),                                       // (lifted to a warm porcelain white)
        sheen: 0.25, sheenColor: new THREE.Color(0xfff1dc), sheenRoughness: 0.5,
        emissive: 0xd9a548, emissiveMap: picture('textures/porcelain_kintsugi_bump.jpg'), emissiveIntensity: 0.45   // (the gold veins keep a warm shine even facing dark)
      });
    case 'Black marble, gold veins':   // (the gallery's own marble)
      return new THREE.MeshPhysicalMaterial({
        map: picture('../studio/marble.jpg'), roughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.06
      });
    case 'Velvet, black stardust': {   // (black velvet with ultra fine stardust only: soft sheen, and tiny specks that glint as you move)
      const m = new THREE.MeshPhysicalMaterial({
        map: picture('textures/velvet_black_stardust.jpg'),
        bumpMap: picture('textures/velvet_black_stardust_bump.jpg', false), bumpScale: 1.2,
        roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0x4a4452), sheenRoughness: 0.4
      });
      m.onBeforeCompile = sh => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec3 vWPos;
            float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
          .replace('#include <opaque_fragment>', `#include <opaque_fragment>
            {
              float far = length(cameraPosition - vWPos);
              vec3 fn = abs(normalize(cross(dFdx(vWPos), dFdy(vWPos))));   // (which way this bit of cloth faces, so the specks lie flat on it)
              vec2 pl = fn.y > max(fn.x, fn.z) ? vWPos.xz : (fn.x > fn.z ? vWPos.zy : vWPos.xy);
              vec2 g = pl * 900.0, id = floor(g);   // (ultra fine)
              float h = hash2(id), h2 = hash2(id + 17.3);
              if (h > 0.7) {
                vec2 at = fract(g) - 0.5 - (vec2(h2, fract(h * 13.7)) - 0.5) * 0.5;
                float fleck = smoothstep(0.28, 0.0, length(at));
                vec3 tilt = normalize(vec3(h2 - 0.5, 1.3, fract(h * 7.1) - 0.5));
                float flash = pow(max(0.0, sin(dot(normalize(cameraPosition - vWPos), tilt) * 46.0 + h * 40.0)), 14.0);
                vec3 col = mix(vec3(0.82, 0.88, 1.0), vec3(1.0, 0.86, 0.58), step(0.62, h2));
                gl_FragColor.rgb += col * fleck * (0.06 + 1.6 * flash) * smoothstep(3.0, 0.5, far);
              }
            }`);
      };
      m.customProgramCacheKey = () => 'velvet-stardust';
      return m;
    }
    case 'Gold, polished':
      return new THREE.MeshPhysicalMaterial({ color: 0xe6b450, metalness: 1, roughness: 0.18 });
  }
  return new THREE.MeshStandardMaterial({ color: 0xff00ff });   // (a name not in the library: bright pink, easy to spot)
}
// >>>>> END OF FILE: HangoutRoom/pieces/materials.js <<<<<
