// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/curtain.js <<<<<
// The game curtain: a round curtain of glossy black glass that slides down from the ring light to the floor when a
// game starts, closing the table and its players in. From outside it's a tall column of black glass, catching the
// room's light. Inside, once it's down, the glass fades into a sky: deep space full of stars, soft drifting nebula,
// all the way round and closing overhead, so the gallery is gone and the players are somewhere else. When the game
// ends, the sky fades back to black glass and the curtain rises back into the ring.
// A fine glowing line runs round its bottom edge as it moves.
// The floating lamp (hanginglamp.js), no cord: it waits up in the ring and lowers over the
// table once the sky is in; clicking it changes the sky.
//   makeCurtain({ radius, top })   radius: the curtain's (meters), top: where it hangs from (the ring's height)
//     .group                       add it to the scene (it stands centered on x = 0, z = 0)
//     .close() / .open()           drop it and fade in the sky / fade the sky out and lift it
//     .toggle()                    whichever of those it isn't doing
//     .nextSky()                   the next background (violet nebula, green aurora, ember gold)
//     .update(dt)                  every frame
// =====================================================================================================================
import * as THREE from 'three';
import { makeLamp } from './hanginglamp.js';

const DROP = 2.6;                     // seconds for the curtain to come down (and to go up)
const FADE = 1.8;                     // seconds for the sky to fade in (and out)
const SKIES = [                       // the backgrounds: the nebula's two colors, and the stars' tint
  { a: [0.32, 0.12, 0.55], b: [0.08, 0.16, 0.45], stars: [0.85, 0.9, 1.0] },     // violet nebula
  { a: [0.05, 0.45, 0.3], b: [0.12, 0.2, 0.5], stars: [0.85, 1.0, 0.92] },       // green aurora
  { a: [0.6, 0.28, 0.06], b: [0.3, 0.08, 0.04], stars: [1.0, 0.9, 0.75] }        // ember gold
];

const SKY_SHADER = `
  uniform float time, reveal; uniform vec3 colA, colB, starTint;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), u.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), u.x), u.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), u.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), u.x), u.y), u.z);
  }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.02; a *= 0.5; } return s; }
  float stars(vec3 d, float scale, float keep) {   // (tiny points of light, each twinkling on its own)
    vec3 p = d * scale, id = floor(p), f = fract(p) - 0.5;
    float h = hash(id);
    if (h < keep) return 0.0;
    vec3 at = (vec3(hash(id + 3.1), hash(id + 7.7), hash(id + 1.3)) - 0.5) * 0.7;
    float r = length(f - at);
    float tw = 0.6 + 0.4 * sin(time * (1.0 + h * 3.0) + h * 40.0);
    return smoothstep(0.08, 0.0, r) * tw * (h - keep) / (1.0 - keep);
  }
  void main() {
    vec3 d = normalize(vDir);
    vec3 drift = vec3(time * 0.004, 0.0, time * 0.002);
    float n = fbm(d * 2.2 + drift), m = fbm(d * 4.5 - drift * 1.7 + 5.0);
    vec3 neb = colA * smoothstep(0.45, 0.85, n) * 0.55 + colB * smoothstep(0.4, 0.9, m) * 0.45;
    vec3 col = vec3(0.004, 0.004, 0.01) + neb * 0.6;
    col += starTint * (stars(d, 60.0, 0.965) * 1.8 + stars(d, 90.0, 0.93) * 1.4 + stars(d, 140.0, 0.93) * 1.0
                     + stars(d, 220.0, 0.94) * 0.8 + stars(d, 330.0, 0.95) * 0.65 + stars(d, 500.0, 0.96) * 0.5
                     + stars(d, 750.0, 0.965) * 0.4 + stars(d, 1100.0, 0.97) * 0.3 + stars(d, 1600.0, 0.975) * 0.22);   // (nine layers, near to far)
    vec3 glass = vec3(0.006, 0.006, 0.009);   // (the black glass, seen from inside)
    gl_FragColor = vec4(mix(glass, col, reveal), 1.0);
    #include <colorspace_fragment>
  }`;

export function makeCurtain({ radius = 2.0, top = 3.3, ceiling = top + 0.7, lampLow = 1.75 } = {}) {
  const group = new THREE.Group();
  group.position.y = top;
  const hang = new THREE.Group();   // (everything that drops: scaled from 0 to full height, from the top down)
  group.add(hang);
  const H = top;                    // (all the way to the floor)
  // outside: glossy black glass
  const wall = new THREE.CylinderGeometry(radius, radius, H, 160, 1, true);
  wall.translate(0, -H / 2, 0);
  const outside = new THREE.Mesh(wall, new THREE.MeshPhysicalMaterial({
    color: 0x040407, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.FrontSide
  }));
  hang.add(outside);
  // inside: black glass that fades into the sky (and a lid of sky overhead, inside the ring)
  const sky = SKIES[0];
  const uniforms = {
    time: { value: 0 }, reveal: { value: 0 },
    colA: { value: new THREE.Vector3(...sky.a) }, colB: { value: new THREE.Vector3(...sky.b) }, starTint: { value: new THREE.Vector3(...sky.stars) }
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, fragmentShader: SKY_SHADER,
    vertexShader: `varying vec3 vDir;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - vec3(0.0, 1.4, 0.0); gl_Position = projectionMatrix * viewMatrix * w; }`
  });
  const inside = new THREE.Mesh(wall, skyMat);
  inside.scale.setScalar(0.998);
  hang.add(inside);
  const lid = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), skyMat.clone());
  lid.material.uniforms = uniforms;
  lid.material.side = THREE.DoubleSide;
  lid.rotation.x = Math.PI / 2;     // (facing down)
  lid.position.y = 0.02;            // (just above the ring)
  lid.visible = false;
  group.add(lid);
  // the fine glowing line round the bottom edge
  const edge = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.008, 8, 200),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.5).multiplyScalar(2.2) }));
  edge.rotation.x = Math.PI / 2;
  group.add(edge);

  // ---------- the floating lamp (hanginglamp.js), no cord: it waits up at the ring and
  // lowers over the table once the sky is in. Click it to change the sky.
  const GOLD = new THREE.MeshPhysicalMaterial({ color: 0xe8b552, metalness: 1, roughness: 0.16 });
  const { group: lamp, parts: lampParts, light: glow } = makeLamp();
  group.add(lamp);
  const lampTop = 0.0, lampBottom = lampLow - top;   // (where the orb hangs: up in the ring, or low over the table)
  const ceil = ceiling - top;

  let drop = 0, fade = 0, closing = false, skyIndex = 0;   // (drop: 0 up .. 1 down; fade: 0 glass .. 1 sky)
  const ease = k => k * k * (3 - 2 * k);
  function show() {
    const d = ease(drop);
    hang.scale.y = Math.max(0.0001, d);
    hang.visible = drop > 0.001;
    edge.position.y = -H * d;
    edge.visible = drop > 0.001 && drop < 0.999;
    uniforms.reveal.value = ease(fade);
    lid.visible = fade > 0.001;
    const ly = lampTop + (lampBottom - lampTop) * ease(fade);   // (the light lowers as the sky comes in)
    lamp.position.y = ly + 0.5;   // (the lamp's top; it hangs half a meter down from there)
    glow.userData.level = 0.8 + 2.4 * ease(fade);   // (the lamp flickers around this itself)
  }
  show();
  return {
    group,
    get closed() { return closing; },
    close() { closing = true; },
    open() { closing = false; },
    toggle() { closing = !closing; },
    nextSky() {
      skyIndex = (skyIndex + 1) % SKIES.length;
      const s = SKIES[skyIndex];
      uniforms.colA.value.set(...s.a); uniforms.colB.value.set(...s.b); uniforms.starTint.value.set(...s.stars);
    },
    lamp: lampParts,   // (what to click to change the sky)
    update(dt) {
      uniforms.time.value += dt;
      if (closing) {   // (down first, then the sky fades in)
        if (drop < 1) drop = Math.min(1, drop + dt / DROP);
        else fade = Math.min(1, fade + dt / FADE);
      } else {         // (the sky fades out first, then up)
        if (fade > 0) fade = Math.max(0, fade - dt / FADE);
        else drop = Math.max(0, drop - dt / DROP);
      }
      show();
    }
  };
}

// ---------- The Workshop's look at it: it drops, shows its sky for a while, then lifts, over and over ----------
export function build() {
  const c = makeCurtain({ radius: 1.6, top: 2.6, ceiling: 5.0, lampLow: 1.1 });   // (sized to hang round the Workshop's disc, down onto it)
  let t = 0, last = performance.now();
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false;   // (an invisible speck, drawn every frame, so the curtain is driven by its own drawing and stops when unloaded)
  c.group.add(ticker);
  ticker.onBeforeRender = () => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    t += dt;
    const cycle = t % 16;
    if (cycle < 8) c.close(); else c.open();
    if (cycle > 7.9 && cycle < 8 + dt) c.nextSky();   // (a different sky each time round)
    c.update(dt);
  };
  return c.group;
}
// >>>>> END OF FILE: HangoutRoom/pieces/curtain.js <<<<<
