// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/summoningplate.js <<<<<
// The summoning circle: the round obsidian plate from your Kindroid picture, set in the middle of the marble table,
// where games will be summoned. Glossy black volcanic glass; its carved lines burn gold, flickering and smoldering like
// embers in the same pale warm gold as the jewels. Inside the bright inner ring the stone opens into a portal onto a sky of black clouds, drifting slowly in
// layers at different depths (the far ones deeper down), lit from below by the ring's ember glow, so as you move it
// looks like looking down into a well of sky, not a flat moving picture.
// The plate is inlaid: its outer rim lies flush with the table's top (y = 0 here), and everything inside the ridge
// is sunk a little below it, so the circle sits down in the stone.
//   plate({ size, side })   the plate, lying flat, its rim at y = 0 (size: across, meters; 0.75 unless told);
//                           side: its outer edge showing below (for when it isn't set into a table)
//   build()           the Workshop's look at it: one plate on its own
// It animates itself as it's drawn, so it moves wherever it's placed (the Workshop or the gallery).
// =====================================================================================================================
import * as THREE from 'three';

const WINDOW = 0.506;                 // the portal's edge, as a part of the plate's radius (inside the bright ring)
const RIDGE = 0.912;                  // the ridge, as a part of the plate's radius: outside it the rim, flush with the table
const SINK = 0.018;                   // how far the inside sits down below the rim
const THICK = 0.03;                   // how deep the plate's outer side goes (seen only when it stands on its own)
const loader = new THREE.TextureLoader();
const picture = (file, color = true) => {
  const t = loader.load(new URL(file, import.meta.url).href);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
};

// (soft noise, shared by the burning and the clouds)
const NOISE = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float clouds(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }`;

export function plate({ size = 0.75, side = false } = {}) {
  const r = size / 2, g = new THREE.Group();
  const time = { value: 0 };
  // the obsidian: glossy black glass (the picture, the portal cut out of it)
  const stone = new THREE.MeshPhysicalMaterial({
    map: picture('textures/plate_obsidian_summoning.webp'), alphaTest: 0.5,
    roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, ior: 1.5
  });
  // the burning: the picture's gold light laid over the stone, each bit flickering and smoldering on its own
  const burn = new THREE.ShaderMaterial({
    uniforms: { time, glow: { value: picture('textures/plate_obsidian_summoning_glow.jpg') }, crop: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D glow; uniform float time, crop;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        vec2 uv = 0.5 + (vUv - 0.5) * crop;
        if (length(uv - 0.5) < 0.5 * ${WINDOW} * 0.97) discard;   // (nothing over the portal: its sky stays black)
        vec3 g = texture2D(glow, uv).rgb;
        float b = noise(uv * 38.0 + vec2(0.0, -time * 1.6)) * 0.6 + noise(uv * 90.0 - time * 2.3) * 0.4;
        g *= (0.55 + 0.9 * b + 0.15 * sin(time * 1.3)) * 1.7;
        g = dot(g, vec3(0.3, 0.55, 0.15)) * vec3(1.0, 0.84 + 0.06 * b, 0.52) * 0.95;   // (all of it lit like the jewels: pale warm gold)
        float rr = length(uv - 0.5);
        g *= 1.0 - 0.05 * smoothstep(0.245, 0.255, rr) * (1.0 - smoothstep(0.285, 0.295, rr));   // (the bright inner ring, 5% softer)
        g *= 0.7 + 0.6 * noise(uv * 7.0 + vec2(time * 0.9, -time * 0.7));   // (whole patches slowly brightening and dimming)
        gl_FragColor = vec4(g, 1.0);
      }`
  });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x050608, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide });
  const rim = new THREE.Mesh(new THREE.RingGeometry(r * RIDGE, r, 128, 1), stone);   // (flush with the table)
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.0005;
  g.add(rim);
  const rimBurn = new THREE.Mesh(rim.geometry, burn);
  rimBurn.rotation.x = -Math.PI / 2;
  rimBurn.position.y = 0.0008;
  g.add(rimBurn);
  const inner = new THREE.CircleGeometry(r * RIDGE, 128);   // (sunk below the rim; its picture lined up with the rim's)
  const iuv = inner.attributes.uv;
  for (let i = 0; i < iuv.count; i++) iuv.setXY(i, 0.5 + (iuv.getX(i) - 0.5) * RIDGE, 0.5 + (iuv.getY(i) - 0.5) * RIDGE);
  const floor = new THREE.Mesh(inner, stone);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -SINK;
  g.add(floor);
  const floorBurn = new THREE.Mesh(inner, burn);   // (its picture already lined up, so the burning matches)
  floorBurn.rotation.x = -Math.PI / 2;
  floorBurn.position.y = -SINK + 0.0003;
  g.add(floorBurn);
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(r * RIDGE, r * RIDGE, SINK, 128, 1, true), glass);   // (the step down)
  ridge.position.y = -SINK / 2;
  g.add(ridge);
  if (side) {
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(r, r, THICK, 128, 1, true), glass);
    edge.position.y = -THICK / 2;
    g.add(edge);
  }
  // the portal: black clouds in layers, drifting, deep below the stone, lit from underneath by ember light at the rim
  const sky = new THREE.ShaderMaterial({
    uniforms: { time, size: { value: size * WINDOW } },
    vertexShader: `
      varying vec2 vUv; varying vec3 vToEye;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vToEye = cameraPosition - world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform float time, size;
      varying vec2 vUv; varying vec3 vToEye;
      ${NOISE}
      void main() {
        vec2 c = vUv - 0.5;
        float rr = length(c);
        if (rr > 0.5) discard;
        vec3 v = normalize(vToEye);
        vec2 look = vec2(v.x, -v.z) / max(v.y, 0.2);          // (deeper layers shift more as you look in at an angle)
        vec3 col = vec3(0.004, 0.003, 0.006);                 // (the darkest deep)
        for (int k = 0; k < 4; k++) {                         // (far to near: each layer of cloud nearer and faster)
          float f = float(k);
          float depth = 0.9 - f * 0.2;
          vec2 p = (c - look * depth * 0.08 / size) * (2.2 + f * 0.9) + time * vec2(0.012 + f * 0.006, 0.005 - f * 0.002) + f * 3.1;
          float d = clouds(p);
          float shape = smoothstep(0.42, 0.78, d);            // (the cloud's body)
          float lit = smoothstep(0.55, 0.95, clouds(p + vec2(0.04, 0.03)) ) ;   // (its edges catching the light)
          float ember = smoothstep(0.15, 0.5, rr) * (0.5 + 0.5 * f / 3.0);    // (ember light from the ring, strongest near the rim)
          vec3 body = vec3(0.016, 0.015, 0.019) + vec3(0.05, 0.048, 0.056) * (1.0 - d);
          vec3 glow = vec3(1.0, 0.42, 0.08) * ember * lit * 0.12 + vec3(0.09, 0.085, 0.1) * lit * 0.3;
          col = mix(col, body + glow, shape * (0.55 + f * 0.12));
        }
        float flicker = 0.85 + 0.15 * noise(vec2(time * 1.7, 4.0));
        col += vec3(1.0, 0.35, 0.05) * pow(smoothstep(0.42, 0.5, rr), 2.0) * 0.12 * flicker;   // (the ring's light falling in)
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`
  });
  const well = new THREE.Mesh(new THREE.CircleGeometry(r * WINDOW * 1.02, 96), sky);
  well.rotation.x = -Math.PI / 2;
  well.position.y = -SINK - 0.003;
  g.add(well);
  // moving: the clouds drift and the ring burns
  const start = performance.now();
  well.onBeforeRender = () => { time.value = (performance.now() - start) / 1000; };
  return g;
}

export function build() {   // (on its own, raised so its outer edge shows)
  const p = plate({ side: true });
  p.position.y = THICK;
  return p;
}
// >>>>> END OF FILE: HangoutRoom/pieces/summoningplate.js <<<<<
