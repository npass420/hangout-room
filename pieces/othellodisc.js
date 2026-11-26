// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/othellodisc.js <<<<<
// The Othello discs: a rounded glossy disc, one half pearly white porcelain and one half deep glossy black, pressed
// together. Where the two halves meet, right round the middle of its edge, a thin neon rim light glows out of the
// seam: golden yellow while white is up, purple while black is up.
// A flip: the disc lifts, turns over and settles, and a wave of the new color sweeps across it as it turns (the rim
// light changing color as the wave passes).
//   makeOthelloDisc({ cell, white })   cell: one square across (meters); white: white side up. Gives back
//     { group, flip(), update(t), materials }: the group stands on y = 0, centered; flip() starts a flip;
//     update(t) runs it (t: seconds)
//   makeOthelloPlay(...)               the discs on a board, playing moves out (see below)
//   build()                            the Workshop's look: a whole game playing itself out slowly (beams, captures)
// =====================================================================================================================
import * as THREE from 'three';
import { softEnv } from '../checkers/pieceenv.js';
import { makeOthelloBoard } from './othelloboard.js';

const YELLOW = new THREE.Color(0.44, 0.18, 0.0), PURPLE = new THREE.Color(0.06, 0.0, 0.4);   // (a deeper violet, as bright as before)   // (deep, so they stay colored when bright)
const FLIP_TIME = 0.95;   // (seconds)
const loader = new THREE.TextureLoader();
const pics = {};
function energy(name) {   // (the river's pictures: mirrored as they repeat, so no seams)
  const t = pic(name); t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; return t;
}
function pic(name) {   // (the faces: pearl porcelain with gold veins, black onyx with gold veins, from the user's tiles)
  if (!pics[name]) {
    const t = loader.load(new URL('textures/' + name, import.meta.url).href);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; pics[name] = t;
  }
  return pics[name];
}

// ---------- the shape: one half of a disc, from its seam (y = 0) up to its gently domed face ----------
function halfGeometry(R, H) {
  const E = H * 0.42;          // (the rounded edge's radius)
  const GROOVE = 0.0013;       // (how far the seam is set in, for the rim light to sit in)
  const SEAM = H * 0.45;       // (the seam's half height: room for the band, about half the disc's edge)
  const pts = [[0, H + H * 0.16]];
  for (let k = 1; k <= 12; k++) { const r = (R - E) * k / 12; pts.push([r, H + H * 0.16 * (1 - (r / (R - E)) ** 2)]); }   // (the domed face)
  for (let k = 1; k <= 14; k++) {                                                                                       // (the rounded edge)
    const a = (Math.PI / 2) * k / 14;
    pts.push([R - E + E * Math.sin(a), H - E + E * Math.cos(a)]);
  }
  pts.push([R, SEAM + 0.0004], [R - GROOVE * 0.4, SEAM], [R - GROOVE, SEAM], [R - GROOVE, 0]);   // (into the seam)
  const g = new THREE.LatheGeometry(pts.reverse().map(([r, y]) => new THREE.Vector2(r, y)), 96);
  g.computeVertexNormals();
  const p = g.attributes.position, uv = g.attributes.uv;   // (the picture laid flat across the face from above, round the edge too)
  // the picture unrolled over the face and on down the rounded side (no streaks), as if the side were laid out flat
  const S = R + H;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z) || 1e-6;
    const sAlong = r + Math.max(0, H - p.getY(i));
    uv.setXY(i, 0.5 + (x / r) * sAlong / (2.02 * S), 0.5 + (z / r) * sAlong / (2.02 * S));
  }
  return g;
}

// ---------- the materials: glossy porcelain halves that take the flip's color wave ----------
function halfMat(white, wave) {
  const m = new THREE.MeshPhysicalMaterial(white
    ? { map: pic('othello_disc_white2.jpg'), bumpMap: pic('othello_disc_white2.jpg'), bumpScale: 2.2, color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.08, roughness: 0.22, clearcoat: 0.85, clearcoatRoughness: 0.07, envMapIntensity: 1.0 }
    : { map: pic('othello_disc_black2.jpg'), bumpMap: pic('othello_disc_black2.jpg'), bumpScale: 2.6, color: 0xffffff, roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.07, envMapIntensity: 1.2 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, wave);
    sh.uniforms.uGold = { value: energy('othello_energy_gold.jpg') }; sh.uniforms.uPurp = { value: energy('othello_energy_purple.jpg') };
    sh.vertexShader = 'varying vec3 vDl; varying vec3 vWp; varying vec3 vCen;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vDl = position;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vCen = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        {
          vec3 tc = diffuseColor.rgb;   // (the picture's color here: gold veins are warm and saturated)
          float goldv = smoothstep(0.35, 0.6, (max(tc.r, tc.b) - min(tc.g, min(tc.r, tc.b))) / (max(tc.r, tc.b) + 0.001)) * smoothstep(0.06, 0.2, max(tc.r, tc.b));
          metalnessFactor = mix(metalnessFactor, 0.3, goldv);
          // shading: the stone's own marks rougher and darker, the cracks sunk in (dark seams lit only by their energy)
          float sl = dot(tc, vec3(0.3, 0.59, 0.11));
          roughnessFactor = mix(clamp(roughnessFactor + (${white ? '0.75 - sl' : 'sl - 0.03'}) * 0.35, 0.08, 0.7), 0.35, goldv);
          diffuseColor.rgb = mix(pow(diffuseColor.rgb, vec3(1.12)), diffuseColor.rgb * ${white ? '1.15' : '0.22'}, goldv);   // (white: bright gold lines; black: dark seams lit by their energy)
        }`);
    sh.fragmentShader = `uniform float uWave; uniform vec3 uWaveCol; uniform vec3 uRimCol; uniform float uR; uniform float uH; uniform float uTime; uniform float uFlare; uniform sampler2D uGold, uPurp;
      uniform float uForm, uFill, uFillAmt, uFillSide, uGlitch; uniform vec2 uFillDir;
      varying vec3 vDl; varying vec3 vWp; varying vec3 vCen;
      float dh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
      float dn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(dh(i), dh(i + vec2(1, 0)), f.x), mix(dh(i + vec2(0, 1)), dh(i + vec2(1, 1)), f.x), f.y); }
      vec3 energyOf(float side, vec2 u) {   // (the river's energy pictures, gold or violet, the violet's core kept colored)
        vec3 p = texture2D(uPurp, u).rgb; p = p / (1.0 + dot(p, vec3(0.3, 0.3, 0.4)) * 1.6) * 1.5;
        return mix(texture2D(uGold, u).rgb * 0.85, p, side);
      }
` + sh.fragmentShader
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        // forming: blocky glitches, square bits of the disc flickering in and out
        if (uForm >= 0.0 && uForm < 1.0) {
          vec2 blk = floor((vWp.xz - vCen.xz) / 0.007);
          float h = dh(blk + floor(uTime * 22.0) * 1.73);
          if (h < 0.5 * (1.0 - smoothstep(0.2, 0.7, uForm))) discard;
        }
        if (uGlitch > 0.0) {   // (taken at the game's end: glitching as it goes over)
          float h2 = dh(floor((vWp.xz - vCen.xz) / 0.007) + floor(uTime * 22.0) * 2.37);
          if (h2 < uGlitch * 0.35) discard;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        // the rim light's color washing up over the disc from its seam, brightest at the edge, a slow shimmer running round
        float rr = length(vDl.xz) / uR;
        float fromSeam = 1.0 - clamp(vDl.y / uH, 0.0, 1.0);
        float shimmer = 0.75 + 0.25 * sin(atan(vDl.z, vDl.x) * 3.0 + uTime * 1.4);
        float spill = pow(fromSeam, 10.0) * shimmer;   // (only a thin glow on the edge right by the band)
        // the veins glowing lightly in the band's color (gold or purple), a slow light drifting along them
        vec3 dc = diffuseColor.rgb;
        float veins = smoothstep(0.35, 0.6, (max(dc.r, dc.b) - min(dc.g, min(dc.r, dc.b))) / (max(dc.r, dc.b) + 0.001)) * smoothstep(0.06, 0.2, max(dc.r, dc.b));
        // a soft glow spreading out round each crack: the cracks looked for all round this spot in the picture
        float halo = 0.0;
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 0.5236, rad = (i % 2 == 0) ? 0.006 : 0.013;
          vec3 c = texture2D(map, vMapUv + vec2(cos(a), sin(a)) * rad).rgb;
          halo += smoothstep(0.35, 0.6, (max(c.r, c.b) - min(c.g, min(c.r, c.b))) / (max(c.r, c.b) + 0.001)) * smoothstep(0.06, 0.2, max(c.r, c.b));
        }
        halo = min(halo / 4.0, 1.0);
        float drift = 0.7 + 0.3 * sin(uTime * 1.3);   // (every crack breathing together, gently)
        // the river's own energy burning in the cracks: the same gold or violet pictures, slowly flowing along
        float sideE = clamp(uRimCol.b / (uRimCol.b + uRimCol.r + 0.0001) / 0.87, 0.0, 1.0);
        vec2 eu = vMapUv * 2.0 + vec2(uTime * 0.02, uTime * 0.013);
        vec3 enP = texture2D(uPurp, eu).rgb; enP = enP / (1.0 + dot(enP, vec3(0.3, 0.3, 0.4)) * 1.6) * 1.5;
        vec3 en = mix(texture2D(uGold, eu).rgb * 0.8, enP * 0.9, sideE);
        en = max(en, uRimCol * 0.6);   // (never dark inside a crack)
        totalEmissiveRadiance += en * (veins * ${white ? '0.45' : '1.6'} + halo * ${white ? '0.0' : '0.24'}) * drift * (1.0 + uFlare * 2.0);

        totalEmissiveRadiance += uRimCol * spill * 0.25;
        vec2 rel = (vWp - vCen).xz;
        // forming: a white silhouette flashes in, the energy's light grows out from the middle to fill the shape,
        // then it all fades away and the stone shows
        if (uForm >= 0.0 && uForm < 1.0) {
          float flash = smoothstep(0.0, 0.06, uForm) * (1.0 - smoothstep(0.12, 0.4, uForm));
          float grow = (uForm - 0.12) / 0.33, rn = length(rel) / uR;
          float light = smoothstep(grow + 0.08, grow - 0.08, rn) * (1.0 - smoothstep(0.55, 1.0, uForm));
          float cover = 1.0 - smoothstep(0.5, 1.0, uForm);
          float blink = step(0.88, dh(floor(rel / 0.007) + floor(uTime * 22.0) * 3.1)) * (1.0 - smoothstep(0.3, 0.75, uForm));
          diffuseColor.rgb *= 1.0 - cover * 0.92;
          vec3 ec = energyOf(sideE, rel * 30.0 + uTime * 0.1);
          vec3 hot = mix(ec * 1.6 + uRimCol * 0.8, vec3(1.0), 0.18);   // (its own energy's color, bright: gold or violet)
          totalEmissiveRadiance += hot * (flash * 2.2 + blink * 1.5) + ec * light * 2.2 + (ec * 0.5 + uRimCol * 0.4) * cover * 0.8;
        }
        // taken: the new color's energy pouring in from the side the beam hit, flowing across like liquid until the
        // whole disc glows, then fading back to show the stone in its new color
        if (uFillAmt > 0.0) {
          float dp = dot(rel, uFillDir);
          float front = mix(-uR * 1.35, uR * 1.35, uFill) + (dn(rel * 160.0 + vec2(uTime * 4.0, 0.0)) - 0.5) * uR * 0.55;
          float m = smoothstep(front + 0.003, front - 0.003, dp) * uFillAmt;
          float lip = exp(-pow((dp - front) / 0.0035, 2.0)) * uFillAmt * step(uFill, 1.0);
          vec3 fc = energyOf(uFillSide, rel * 26.0 + vec2(uTime * 0.18, uTime * 0.11) + (dn(rel * 90.0 + uTime) - 0.5) * 0.08);
          diffuseColor.rgb *= 1.0 - m * 0.9;
          totalEmissiveRadiance += fc * m * 1.7 + fc * lip * 2.8;
        }
        if (uGlitch > 0.0) totalEmissiveRadiance += mix(uRimCol * 2.0, vec3(1.0), 0.2) * step(0.9, dh(floor(rel / 0.007) + floor(uTime * 22.0) * 5.3)) * uGlitch * 1.4;
        // the flip's color wash: a wide wave of the new color sweeping right across, the whole disc tinted while it turns
        if (uWave > 0.0 && uWave < 1.0) {
          float c = mix(-uR * 1.6, uR * 1.6, uWave);
          float band = exp(-pow((vDl.x - c) / (uR * 0.6), 2.0));
          float swell = sin(3.14159 * uWave);
          totalEmissiveRadiance += uWaveCol * (band * 1.6 + 0.3) * swell * ${white ? '0.8' : '1.3'};
        }
      }`);
  };
  m.customProgramCacheKey = () => white ? 'othelloDiscW' : 'othelloDiscB';
  return m;
}

export function makeOthelloDisc({ cell = 0.119, white = true } = {}) {
  const R = cell * 0.41, H = cell * 0.075;       // (the disc's radius and each half's height)
  const group = new THREE.Group(), spin = new THREE.Group();
  spin.position.y = H + H * 0.16; group.add(spin);   // (it turns about its own middle)
  const ringCol = (white ? YELLOW : PURPLE).clone();   // (the rim light's color right now, shared by the ring, its glow and the halves)
  const wave = { uWave: { value: 0 }, uWaveCol: { value: YELLOW.clone() }, uRimCol: { value: ringCol }, uR: { value: R }, uH: { value: H * 1.16 }, uTime: { value: 0 }, uFlare: { value: 0 },
    uForm: { value: -1 }, uFill: { value: 0 }, uFillAmt: { value: 0 }, uFillSide: { value: 0 }, uFillDir: { value: new THREE.Vector2(1, 0) }, uGlitch: { value: 0 } };
  const whiteMat = halfMat(true, wave), blackMat = halfMat(false, wave);
  const geo = halfGeometry(R, H);
  // a soft shadow where the disc sits, so it rests on the board instead of floating
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.5, R * 2.5).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vU; void main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vU; void main() { float d = length(vU - 0.5) * 2.0; float a = smoothstep(1.0, 0.62, d) * 0.55; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }'
  }));
  shadow.position.y = 0.0005; group.add(shadow);
  const top = new THREE.Mesh(geo, whiteMat); top.rotation.y = Math.random() * Math.PI * 2; spin.add(top);   // (each disc turned its own way, so no two look alike)                                     // (white half, up)
  const bot = new THREE.Mesh(geo, blackMat); bot.rotation.set(Math.PI, Math.random() * Math.PI * 2, 0); spin.add(bot);         // (black half, down)
  // the rim light: a thin neon band in the seam, round the middle of the edge
  // the band: a thin river of plasma in the seam, glowing streams of color flowing round and round the disc, brighter
  // threads twisting through darker currents
  const ringMat = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.8 });   // (wet and glossy)
  ringMat.onBeforeCompile = sh => {
    sh.uniforms.uBand = { value: ringCol }; sh.uniforms.uTime = wave.uTime; sh.uniforms.uFlare = wave.uFlare; sh.uniforms.uFillAmt = wave.uFillAmt;
    sh.uniforms.uGold = { value: energy('othello_energy_gold.jpg') }; sh.uniforms.uPurp = { value: energy('othello_energy_purple.jpg') };
    sh.vertexShader = 'varying vec2 vBu;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBu = uv;');
    sh.fragmentShader = `uniform vec3 uBand; uniform float uTime; uniform float uFlare; uniform float uFillAmt; uniform sampler2D uGold, uPurp; varying vec2 vBu;
      float bh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
      float bn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(bh(i), bh(i + vec2(1, 0)), f.x), mix(bh(i + vec2(0, 1)), bh(i + vec2(1, 1)), f.x), f.y); }
` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        // the river: the user's energy pictures flowing round the band, two currents at different speeds, gently
        // rippled so it moves like liquid; gold or purple (blending between them as the rim light changes)
        float side = clamp(uBand.b / (uBand.b + uBand.r + 0.0001) / 0.87, 0.0, 1.0);
        vec2 rip = vec2(bn(vec2(vBu.x * 60.0 - uTime * 0.8, vBu.y * 2.0)), bn(vec2(vBu.x * 45.0 + 3.0, vBu.y * 2.0 + uTime * 0.5))) - 0.5;
        vec2 u1 = vec2(vBu.x * 7.0 - uTime * 0.05, 0.3 + vBu.y * 0.4) + rip * 0.05;
        vec2 u2 = vec2(vBu.x * 5.0 - uTime * 0.032 + 0.37, 0.25 + vBu.y * 0.5) + rip.yx * 0.06;
        vec3 g = max(texture2D(uGold, u1).rgb, texture2D(uGold, u2).rgb * 0.85);
        vec3 pu = max(texture2D(uPurp, u1).rgb, texture2D(uPurp, u2).rgb * 0.85);
        float edge = smoothstep(0.0, 0.25, vBu.y) * smoothstep(1.0, 0.75, vBu.y);   // (a little dimmer at its edges)
        pu = pu / (1.0 + dot(pu, vec3(0.3, 0.3, 0.4)) * 1.6) * 1.5;   // (its bright core kept colored, not white)
        vec3 river = mix(g * 0.8, pu * 0.9, side) * (0.7 + 0.3 * edge);
        diffuseColor.rgb = river * 0.1;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += river * (1.0 + uFlare * 1.5 + uFillAmt * 1.6);`);
  };
  ringMat.customProgramCacheKey = () => 'othelloRiver';
  // the liquid fills the whole channel between the halves, wall to wall, its surface swelling gently out to the rim
  const SEAM_H = H * 0.45, IN = R - 0.0013;
  const liquid = [];
  for (let k = 0; k <= 16; k++) {
    const y = -SEAM_H + (2 * SEAM_H) * k / 16, f = y / SEAM_H;
    liquid.push(new THREE.Vector2(IN + (R - 0.0001 - IN) * Math.sqrt(Math.max(0, 1 - f * f * 0.85)), y));
  }
  liquid[0].x = IN; liquid[16].x = IN;   // (meeting the channel's walls)
  const ring = new THREE.Mesh(new THREE.LatheGeometry(liquid, 192), ringMat);
  spin.add(ring);
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.0008, R + 0.0008, 0.012, 96, 1, true), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: ringCol } },   // (the same color as the rim light, always)
    vertexShader: 'varying float vY; void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uCol; varying float vY; void main() { float a = exp(-pow(vY / 0.0014, 2.0)) * 0.2; gl_FragColor = vec4(uCol * a, a); }'
  }));
  spin.add(halo);   // (a faint glow just outside the seam)

  let up = white, start = -1;
  if (!up) spin.rotation.z = Math.PI;
  const colFor = w => (w ? YELLOW : PURPLE);

  function flip() { if (start < 0) { start = -2; up = !up; wave.uWaveCol.value.copy(colFor(up)); } }
  let landed = -10;
  // materialize(t): form out of light from now; take(t, dirX, dirZ, white): the beam's energy pours in (from that world
  // direction) and the disc becomes that color
  const FORM_TIME = 0.95, FILL_TIME = 0.42, FADE_TIME = 0.55;
  let formT = -1, fillT = -1, fillWhite = true, swapped = false;
  function materialize(t) { formT = t; wave.uForm.value = 0; ring.visible = halo.visible = shadow.visible = false; }
  function take(t, dx, dz, w) { fillT = t; fillWhite = w; swapped = false; wave.uFillDir.value.set(dx, dz).normalize(); wave.uFillSide.value = w ? 0 : 1; }
  // conquer(t, w): taken at the game's end: the winner's energy (w: white's gold) floods it from a random side while
  // it glitches, and it turns the winner's color
  let glitchT = -1;
  function conquer(t, w) { const a = Math.random() * Math.PI * 2; take(t, Math.cos(a), Math.sin(a), w); glitchT = t; }
  function update(t) {
    wave.uTime.value = t;
    if (glitchT >= 0) {
      const e = t - glitchT;
      wave.uGlitch.value = e < 0 ? 0 : Math.sin(Math.min(e / 1.1, 1) * Math.PI);
      if (e > 1.1) { glitchT = -1; wave.uGlitch.value = 0; }
    }
    if (formT >= 0) {
      const k = (t - formT) / FORM_TIME;
      wave.uForm.value = k < 1 ? Math.max(k, 0) : -1;
      ring.visible = halo.visible = shadow.visible = k > 0.5;
      if (k >= 1) formT = -1;
    }
    if (fillT >= 0) {
      const e = t - fillT;
      if (e < FILL_TIME) { wave.uFill.value = Math.max(e, 0) / FILL_TIME; wave.uFillAmt.value = e < 0 ? 0 : 1; }
      else {
        if (!swapped) { swapped = true; setWhite(fillWhite); }   // (hidden in the glow: underneath, it's the new color now)
        wave.uFill.value = 1.3;
        wave.uFillAmt.value = Math.max(0, 1 - (e - FILL_TIME) / FADE_TIME);
        if (e >= FILL_TIME + FADE_TIME) { fillT = -1; wave.uFillAmt.value = 0; }
      }
    }
    const dt = t - landed;   // (the burst: up fast as it lands, then fading away)
    wave.uFlare.value = dt < 0 ? 0 : THREE.MathUtils.smoothstep(dt, 0, 0.07) * Math.exp(-dt * 2.6);
    if (start === -2) start = t;
    if (start < 0) return;
    const k = Math.min((t - start) / FLIP_TIME, 1);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // (eased)
    const from = up ? Math.PI : 0;
    spin.rotation.z = from + (up ? -Math.PI : Math.PI) * e;
    spin.position.y = H * 1.16 + Math.sin(Math.PI * k) * cell * 0.45;   // (a little lift)
    wave.uWave.value = k;
    ringCol.copy(colFor(!up)).lerp(colFor(up), THREE.MathUtils.smoothstep(k, 0.35, 0.65));
    if (k >= 1) { landed = t; start = -1; wave.uWave.value = 0; spin.position.y = H * 1.16; spin.rotation.z = up ? 0 : Math.PI; }
  }
  // setWhite(w): straight to that side, no turning (a disc re-forming as the new color); pulse(t): flare its energy now
  function setWhite(w) { up = w; start = -1; spin.rotation.z = w ? 0 : Math.PI; spin.position.y = H * 1.16; ringCol.copy(colFor(w)); wave.uWaveCol.value.copy(colFor(w)); }
  function pulse(t) { landed = t; }
  return { group, flip, update, setWhite, pulse, materialize, take, conquer, materials: [whiteMat, blackMat, ringMat], get white() { return up; } };
}

// ---------- Playing it out: the discs on a board, and every move's beams, fills and forming ----------
// Used by the game (checkers/othello.js) and by the Workshop's self-playing game below.
// A move: a beam of the mover's energy fires from their own disc at the far end of every line the move takes, through
// each disc it takes (the energy pouring into it like liquid, turning it the mover's color), to the empty square,
// where the new disc forms out of a white flash and its energy's light, with blocky glitches.
//   makeOthelloPlay({ cell, top, cellPos })   cell: one square; top: the squares' top; cellPos(c, r) -> [x, z]
//     .group                 add it where the board is
//     .set(grid, form)       the discs to match grid[r][c] (0 empty, 1 white, 2 black) at once (form: each forms in)
//     .move(c, r, white, lines)   play a move out (lines: [{ dc, dr, run: [[c, r], ...], end: [c, r] }])
//     .takeAll(loserWhite)   the game's won: every one of the loser's discs is taken, glitching, into the winner's color
//     .dissolveAll()         every disc breaks into sparks and goes
//     .clear()   .busy()    every disc away;  whether a move is still playing out
export const BEAM_GOLD = new THREE.Color(1.0, 0.62, 0.16), BEAM_PURPLE = new THREE.Color(0.5, 0.12, 1.0);
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const BEAM_SPEED = 0.55;    // (meters a second)
export function captures(grid, c, r, p) {   // the lines a move at (c, r) for p (1 white, 2 black) would take
  if (grid[r][c]) return [];
  const lines = [];
  for (const [dc, dr] of DIRS) {
    const run = [];
    let x = c + dc, y = r + dr;
    while (x >= 0 && x < 8 && y >= 0 && y < 8 && grid[y][x] === 3 - p) { run.push([x, y]); x += dc; y += dr; }
    if (run.length && x >= 0 && x < 8 && y >= 0 && y < 8 && grid[y][x] === p) lines.push({ dc, dr, run, end: [x, y] });
  }
  return lines;
}
export function legalMoves(grid, p) {
  const out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const lines = captures(grid, c, r, p);
    if (lines.length) out.push({ c, r, lines, n: lines.reduce((s, l) => s + l.run.length, 0) });
  }
  return out;
}
export function cpuPick(list) {   // (a fair player: likes corners and big takes, with some chance in it)
  const w = list.map(m => Math.pow(m.n + 1, 1.3) * ((m.c % 7 === 0 && m.r % 7 === 0) ? 4 : 1) * (0.5 + Math.random()));
  return list[w.indexOf(Math.max(...w))];
}
function sparkTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c);
}

export function makeOthelloPlay({ cell, top, cellPos }) {
  const group = new THREE.Group();
  const BEAM_Y = top + cell * 0.075 * 1.16;   // (the discs' middle: where their rivers run)
  const pos = (c, r) => cellPos(c, r);

  // ---------- sparks: bits of energy flying off as discs form and fill ----------
  const N = 900;
  const sp = { pos: new Float32Array(N * 3), col: new Float32Array(N * 3), vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), seed: new Float32Array(N) };
  for (let i = 0; i < N; i++) { sp.pos[i * 3 + 1] = -100; sp.seed[i] = Math.random(); }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sp.pos, 3));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sp.col, 3));
  sGeo.setAttribute('seed', new THREE.BufferAttribute(sp.seed, 1));
  // (stardust: mostly fine twinkling glitter, now and then a star flare with little beams)
  const SD = { sdTime: { value: 0 }, sdPx: { value: 400 } };
  const sparks = new THREE.Points(sGeo, new THREE.ShaderMaterial({
    uniforms: SD, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float sdTime, sdPx; attribute vec3 color; attribute float seed; varying vec3 vC; varying float vS, vTw;
      void main() {
        vC = color; vS = seed; vTw = pow(0.5 + 0.5 * sin(sdTime * (6.0 + seed * 12.0) + seed * 70.0), 2.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = sdPx * (0.003 + 0.007 * seed * seed + step(0.92, seed) * 0.018) * (0.5 + 0.7 * vTw) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vC; varying float vS, vTw;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float core = exp(-dot(q, q) * 70.0);
        float beams = exp(-abs(q.x) * 34.0) * exp(-abs(q.y) * 5.0) + exp(-abs(q.y) * 34.0) * exp(-abs(q.x) * 5.0);
        float a = (core + beams * step(0.85, vS) * vTw) * (0.35 + 0.65 * vTw);
        gl_FragColor = vec4(mix(vC, vec3(1.0) * max(vC.r, max(vC.g, vC.b)), step(0.9, vS) * 0.4) * a * 2.2, a);
      }`
  }));
  sparks.frustumCulled = false; group.add(sparks);
  let nextSpark = 0;
  function burst(x, y, z, color, count, speed, inward) {   // (inward: gathering in to the spot instead of flying out)
    for (let k = 0; k < count; k++) {
      const i = nextSpark; nextSpark = (nextSpark + 1) % N;
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = speed * (0.4 + Math.random() * 0.8);
      const dx = Math.cos(a) * Math.sqrt(1 - u * u), dy = Math.abs(u) * 0.6, dz = Math.sin(a) * Math.sqrt(1 - u * u);
      const life = 0.35 + Math.random() * 0.4;
      if (inward) { sp.pos.set([x + dx * s * life, y + dy * s * life, z + dz * s * life], i * 3); sp.vel.set([-dx * s, -dy * s, -dz * s], i * 3); }
      else { sp.pos.set([x, y, z], i * 3); sp.vel.set([dx * s, dy * s, dz * s], i * 3); }
      const b = 0.6 + Math.random() * 0.6;
      sp.col.set([color.r * b, color.g * b, color.b * b], i * 3);
      sp.life[i] = life; sp.max[i] = life;
    }
  }
  // ---------- glitch blocks: little squares of energy flickering and jumping about round a disc as it forms ----------
  const GB = 160;
  const gbMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), GB);
  gbMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GB * 3), 3);
  gbMesh.frustumCulled = false; group.add(gbMesh);
  const gb = Array.from({ length: GB }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, cx: 0, cz: 0, w: 0.01 }));
  let nextGb = 0;
  const gbM = new THREE.Matrix4(), gbQ = new THREE.Quaternion(), gbS = new THREE.Vector3(), gbP = new THREE.Vector3(), gbC = new THREE.Color();
  function glitchBlocks(x, y, z, color, count) {
    for (let k = 0; k < count; k++) {
      const i = nextGb, b = gb[i]; nextGb = (nextGb + 1) % GB;
      b.cx = x; b.cz = z; b.y0 = y;
      b.x = x + (Math.random() - 0.5) * cell * 0.9; b.z = z + (Math.random() - 0.5) * cell * 0.9; b.y = y + Math.random() * cell * 0.35;
      b.w = cell * (0.03 + Math.random() * 0.07); b.h = b.w * (0.3 + Math.random() * 0.9);
      b.life = b.max = 0.5 + Math.random() * 0.6;
      gbC.copy(color).lerp(new THREE.Color(1, 1, 1), Math.random() * 0.3).multiplyScalar(1.3);
      gbMesh.setColorAt(i, gbC);
    }
    gbMesh.instanceColor.needsUpdate = true;
  }
  function stepGlitch(dt) {
    for (let i = 0; i < GB; i++) {
      const b = gb[i];
      let sx = 1e-5;
      if (b.life > 0) {
        b.life -= dt;
        if (Math.random() < 0.15) { b.x = b.cx + (Math.random() - 0.5) * cell * 0.9; b.z = b.cz + (Math.random() - 0.5) * cell * 0.9; b.y = b.y0 + Math.random() * cell * 0.35; }   // (jumping)
        if (Math.random() < 0.55) sx = b.w * Math.min(1, b.life / b.max * 2);   // (flickering)
      }
      gbP.set(b.x, b.y, b.z); gbS.set(sx, sx > 1e-4 ? b.h * Math.min(1, b.life / b.max * 2) : 1e-5, sx);
      gbM.compose(gbP, gbQ, gbS); gbMesh.setMatrixAt(i, gbM);
    }
    gbMesh.instanceMatrix.needsUpdate = true;
  }
  function stepSparks(dt) {
    SD.sdTime.value += dt;
    SD.sdPx.value = (window.innerHeight || 800) * Math.min(window.devicePixelRatio || 1, 2) * 0.5;
    stepGlitch(dt);
    for (let i = 0; i < N; i++) {
      if (sp.life[i] <= 0) { sp.pos[i * 3 + 1] = -100; continue; }
      sp.life[i] -= dt;
      for (let k = 0; k < 3; k++) sp.pos[i * 3 + k] += sp.vel[i * 3 + k] * dt;
      sp.vel[i * 3 + 1] -= 0.12 * dt;
      const fade = Math.max(sp.life[i] / sp.max[i], 0);
      for (let k = 0; k < 3; k++) sp.col[i * 3 + k] *= 0.985 + fade * 0.015;
    }
    sGeo.attributes.position.needsUpdate = true; sGeo.attributes.color.needsUpdate = true;
  }

  // ---------- the beams ----------
  const beamMat = color => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: color.clone() }, uFade: { value: 1 }, uTime: { value: 0 }, uLen: { value: 0.01 } },
    vertexShader: 'varying vec2 vU; varying float vX; void main() { vU = uv; vX = position.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uCol; uniform float uFade, uTime, uLen; varying vec2 vU; varying float vX;
      void main() {
        float across = abs(vU.y - 0.5) * 2.0;
        float core = exp(-across * across * 30.0), glow = exp(-across * across * 4.0);
        float x = vX * uLen;
        float flow = 0.75 + 0.25 * sin(x * 260.0 - uTime * 30.0) * sin(x * 97.0 + uTime * 11.0);
        float head = smoothstep(0.0, 0.03, uLen - x) * 0.6 + 0.4;   // (brightest just behind its tip)
        vec3 c = uCol * glow * 0.9 * flow + vec3(1.0, 0.95, 0.9) * core * 0.8;
        gl_FragColor = vec4(c * uFade * head, 1.0);
      }`
  });
  const beamGeo = new THREE.PlaneGeometry(1, 0.016).translate(0.5, 0, 0);
  const beams = [];
  function fireBeam(x0, z0, dc, dr, color, t) {
    const m = beamMat(color), b = new THREE.Group();
    const p1 = new THREE.Mesh(beamGeo, m), p2 = new THREE.Mesh(beamGeo, m);
    p2.rotation.x = Math.PI / 2; b.add(p1, p2);   // (two crossed strips: round from any side)
    b.position.set(x0, BEAM_Y, z0); b.rotation.y = -Math.atan2(dr, dc); b.scale.x = 0.001;
    group.add(b);
    const beam = { b, m, t0: t, full: 0.001, fade: -1 }; beams.push(beam); return beam;
  }

  // ---------- the discs ----------
  const discAt = {};
  let envMap = null, now = 0;
  const events = [];
  function removeDisc(k) {
    const d = discAt[k]; if (!d) return;
    group.remove(d.group); d.group.traverse(o => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); });
    delete discAt[k];
  }
  function clear() { for (const k of Object.keys(discAt)) removeDisc(k); events.length = 0; for (const b of beams) { group.remove(b.b); b.m.dispose(); } beams.length = 0; }
  function placeDisc(c, r, white, form) {
    removeDisc(c + ',' + r);
    const d = makeOthelloDisc({ cell, white });
    const [x, z] = pos(c, r);
    d.group.position.set(x, top, z);
    if (envMap) for (const m of d.materials) m.envMap = envMap;
    group.add(d.group); discAt[c + ',' + r] = d;
    if (form) {   // (a swarm of its energy's sparks streams in and gathers into it, and bursts a little as it settles)
      const col = white ? BEAM_GOLD : BEAM_PURPLE;
      d.materialize(now);
      burst(x, BEAM_Y, z, col, 70, 0.16, true);
      burst(x, BEAM_Y, z, col.clone().lerp(new THREE.Color(1, 1, 1), 0.35), 30, 0.09, true);
      glitchBlocks(x, top, z, col, 14);
      events.push({ at: now + 0.75, fn: () => burst(x, BEAM_Y, z, col, 26, 0.12, false) });
    }
    return d;
  }
  const worldDir = new THREE.Vector3();
  function take(c, r, white, dc, dr) {   // (the beam's energy pours in from the side it hit, and the disc becomes its color)
    const d = discAt[c + ',' + r]; if (!d) return;
    worldDir.set(dc, 0, dr).transformDirection(group.matrixWorld);
    d.take(now, worldDir.x, worldDir.z, white);
    const [x, z] = pos(c, r), s = 0.4 * cell / Math.hypot(dc, dr);
    burst(x - dc * s, BEAM_Y, z - dr * s, white ? BEAM_GOLD : BEAM_PURPLE, 18, 0.08, false);
  }
  function set(grid, form) {   // (match the grid: discs added where missing, turned or removed where they differ)
    events.length = 0;
    let i = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const v = grid[r][c], k = c + ',' + r, d = discAt[k];
      if (!v) { removeDisc(k); continue; }
      if (d && d.white === (v === 1)) continue;
      if (form) { const at = now + (i++) * 0.06; events.push({ at, fn: () => placeDisc(c, r, v === 1, true) }); }
      else placeDisc(c, r, v === 1, false);
    }
  }
  function move(c, r, white, lines) {
    const color = white ? BEAM_GOLD : BEAM_PURPLE;
    let arrive = 0;
    for (const l of lines) {
      const step = Math.hypot(l.dc, l.dr) * cell, full = (l.run.length + 1) * step, t0 = now + 0.2;
      arrive = Math.max(arrive, t0 + full / BEAM_SPEED);
      events.push({ at: t0, fn: () => {
        const [ex, ez] = pos(l.end[0], l.end[1]);
        const beam = fireBeam(ex, ez, -l.dc, -l.dr, color, now); beam.full = full;
        const e = discAt[l.end[0] + ',' + l.end[1]]; if (e) e.pulse(now);
        burst(ex, BEAM_Y, ez, color, 20, 0.1, false);
        l.run.forEach(([x, y], i) => {
          const dist = (l.run.length - i) * step;   // (the one next to the far end is reached first)
          events.push({ at: now + (dist - cell * 0.4) / BEAM_SPEED, fn: () => take(x, y, white, -l.dc, -l.dr) });
        });
        events.push({ at: now + full / BEAM_SPEED, fn: () => { beam.fade = now; } });
      } });
    }
    events.push({ at: arrive || now, fn: () => placeDisc(c, r, white, true) });
    return arrive - now + 1.0;   // (about how long it takes)
  }
  function takeAll(loserWhite) {   // (the game's won: every one of the loser's discs is taken, glitching, and turns the winner's color)
    const winColor = loserWhite ? BEAM_PURPLE : BEAM_GOLD;
    Object.keys(discAt).forEach(k => {
      const d = discAt[k];
      if (d.white !== loserWhite) { events.push({ at: now + 0.2 + Math.random() * 0.4, fn: () => d.pulse(now) }); return; }
      events.push({ at: now + 0.3 + Math.random() * 1.0, fn: () => {
        const [x, z] = pos(...k.split(',').map(Number));
        d.conquer(now, !loserWhite);
        burst(x, BEAM_Y, z, winColor, 20, 0.12, false);
        glitchBlocks(x, top, z, winColor, 8);
      } });
    });
  }
  function dissolveAll() {   // (every disc breaks into sparks and goes)
    Object.keys(discAt).forEach((k, i) => events.push({ at: now + i * 0.04, fn: () => {
      const d = discAt[k]; if (!d) return;
      const [x, z] = pos(...k.split(',').map(Number));
      burst(x, BEAM_Y, z, d.white ? BEAM_GOLD : BEAM_PURPLE, 25, 0.2, false);
      removeDisc(k);
    } }));
  }

  // ---------- kept running (only while it's drawn) ----------
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false; group.add(ticker);
  const clock = new THREE.Clock();
  let last = 0;
  ticker.onBeforeRender = renderer => {
    const t = clock.getElapsedTime(), dt = Math.min(t - last, 0.05); last = t; now = t;
    if (!envMap) envMap = softEnv(renderer);
    events.sort((a, b) => a.at - b.at);
    while (events.length && events[0].at <= t) events.shift().fn();
    for (const k in discAt) {
      const d = discAt[k];
      if (!d.materials[0].envMap) for (const m of d.materials) { m.envMap = envMap; m.needsUpdate = true; }
      d.update(t);
    }
    for (let i = beams.length - 1; i >= 0; i--) {
      const bm = beams[i];
      bm.len = Math.min((t - bm.t0) * BEAM_SPEED, bm.full);
      bm.b.scale.x = Math.max(bm.len, 0.001);
      bm.m.uniforms.uLen.value = bm.len; bm.m.uniforms.uTime.value = t;
      if (bm.fade > 0) {
        const f = 1 - (t - bm.fade) / 0.5;
        bm.m.uniforms.uFade.value = Math.max(f, 0);
        if (f <= 0) { group.remove(bm.b); bm.m.dispose(); beams.splice(i, 1); }
      }
    }
    stepSparks(dt);
  };
  return { group, set, move, clear, dissolveAll, takeAll, busy: () => events.length > 0 || beams.length > 0, get time() { return now; } };
}

// ---------- The Workshop's look: a game playing itself out slowly (R in the Workshop starts it over) ----------
export function build() {
  const board = makeOthelloBoard({ size: 1.15 });
  const group = board.group, CELL = board.CELL;
  const at = i => -CELL * 4 + CELL * (i + 0.5);
  const play = makeOthelloPlay({ cell: CELL, top: board.TOP, cellPos: (c, r) => [at(c), at(r)] });
  group.add(play.group);
  let grid, player, next = 1, ending = false;
  function newGame() {
    grid = Array.from({ length: 8 }, () => Array(8).fill(0));
    grid[3][3] = grid[4][4] = 1; grid[3][4] = grid[4][3] = 2;
    player = 2;   // (black moves first)
    play.set(grid, true);
  }
  function turn() {
    let list = legalMoves(grid, player);
    if (!list.length) {
      player = 3 - player; list = legalMoves(grid, player);
      if (!list.length) {   // (nobody can move: done; the loser's discs melt, then a new game)
        let w = 0, b = 0; for (const row of grid) for (const v of row) { if (v === 1) w++; else if (v === 2) b++; }
        if (w !== b) { play.takeAll(w < b); setTimeout(() => board.flood(w > b ? 'white' : 'black'), 1400); }
        next = play.time + 6; grid = null; ending = true; return;
      }
    }
    const m = cpuPick(list), p = player;
    grid[m.r][m.c] = p;
    for (const l of m.lines) for (const [x, y] of l.run) grid[y][x] = p;
    play.move(m.c, m.r, p === 1, m.lines);
    player = 3 - p;
    next = play.time + 3;
  }
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false; group.add(ticker);
  ticker.onBeforeRender = () => {
    if (play.time < next) return;
    if (ending) { ending = false; play.dissolveAll(); board.restore(); next = play.time + 2.5; return; }
    if (!grid) { newGame(); next = play.time + 3; } else turn();
  };
  return group;
}
// >>>>> END OF FILE: HangoutRoom/pieces/othellodisc.js <<<<<
