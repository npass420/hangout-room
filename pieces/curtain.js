// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/curtain.js <<<<<
// The game curtain: a round curtain of glossy black glass that slides down from the ring light to the floor when a
// game starts, closing the table and its players in. From outside it's a tall column of black glass, catching the
// room's light. Inside, once it's down, the glass fades into a sky: deep space full of stars, soft drifting nebula,
// all the way round and closing overhead, so the gallery is gone and the players are somewhere else. When the game
// ends, the sky fades back to black glass and the curtain rises back into the ring.
// A fine glowing line runs round its bottom edge as it moves.
// Holodeck: once the sky is in, the curtain spreads outward from the table, its glowing line sweeping out across the
// floor, until the sky fills the whole room and beyond (the floor too), and then it's a sky all round you, far off like
// a real one. Going back, it pulls in to the table first, then fades back to glass and rises.
// The floating lamp (hanginglamp.js), no cord: it waits up in the ring and lowers over the
// table once the sky is in; clicking it changes the sky.
//   makeCurtain({ radius, top, hide })   radius: the curtain's (meters), top: where it hangs from (the ring's height);
//                                  hide: the room's things inside it to hide while the sky is in (the ring light)
//     .group                       add it to the scene (it stands centered on x = 0, z = 0)
//     .close() / .open()           drop it, fade in the sky, spread it out / pull it in, fade it out, lift it
//     .toGlass(hold)               (seen from outside as the den clears) straight to the plain black glass column, down,
//                                  waiting hold seconds (while everything gets ready behind it), then it lifts
//     .closed                      it's closing (or closed); .down: all the way down; .skyIn: the sky is in
//     .lampDown(on)                the lamp floats down over the table (someone's sitting), or back up
//     onRoom(on)                   (option) called when the room should switch off (sky in) or back on
//     .setSky(i) / .skyIndex / .SKY_COUNT   which background (deep space, your lantern lagoon)
//     .update(dt)                  every frame
// =====================================================================================================================
import * as THREE from 'three';
import { makeLamp } from './hanginglamp.js';

const DROP = 2.6;                     // seconds for the curtain to come down (and to go up)
const FADE = 1.8;                     // seconds for the sky to fade in (and out)
const SPREAD = 2.4;                   // seconds for the sky to spread out to the whole room and beyond (and back in)
const FAR = 19;                       // how far it spreads: 19 times the curtain's size (about 37 m out, past the walls)
const SKIES = [                       // the backgrounds
  { a: [0.32, 0.12, 0.55], b: [0.08, 0.16, 0.45], c: [0.05, 0.42, 0.3], belt: 'textures/sky_belt.jpg',      // deep space: stars,
    stars: [0.85, 0.95, 1.0], aurora: 1 },                                                                   //   clouds, the star ring, aurora
  { pic: 'textures/sky_island.jpg', picB: 'textures/sky_island_nomoon.jpg', stars: [1.0, 0.95, 0.85],       // your lantern tree lagoon, alive
    low: 0.94, span: 2.29, horizon: 0.41, top: [0.0052, 0.022, 0.067], water: 1, stay: 1 },   // (stay: it keeps to the curtain's own size, no spreading out)
  { pic: 'textures/castle_window.jpg', picB: 'textures/castle_fire.jpg', vault: 'textures/castle_vault.jpg',   // the castle: a real room
    stars: [1.0, 0.85, 0.8], top: [0.006, 0.004, 0.006], hall: 1 }
];
// The skies:
//   deep space (aurora): everything in it moves on its own: three layers of twinkling stars each turning its own way,
//     light clouds of violet, blue and green drifting, the star ring (your stardust picture) round you at eye level,
//     shimmering and fading softly into the sky, and curtains of aurora high up pouring across the table (sitting
//     across from each other, one way is upstream, the other downstream), waving, each brightest along one edge,
//     their colors shifting through green, teal, violet and rose; mirrored beneath you, flowing back the other way,
//     so you float between two skies with the star ring where they meet.
//   hall (the castle): a real eight-sided room round the table, traced from wherever you're looking from, so it stands
//     true from every seat: flat walls (the window bay picture on six, the fireplace on two facing each other), a dark
//     carved pillar at each corner covering the joins, the vault overhead (your Kindroid castle ceiling picture, seen
//     from beneath: black carved ribs running up from the pillars to the gold boss right over the table, crimson and
//     gold panels between), and a polished black marble floor that reflects it all. Its candles and fires flicker.
//   water (the lagoon): the picture wraps round you twice (the second copy mirrored, so there's no seam, and with its
//     moon taken out, so there's one moon), horizon at eye level. low and span: how it runs up the curtain. Its water
//     ripples, the reflections wobble, the blue glow twinkles and the lanterns flicker; overhead it eases into its own
//     night color (top) with stars; and the floor under the table is live water: dark glossy ripples reflecting the
//     sky, with blue glow sparkling in it, blending into the picture's water out at the curtain.
// The curtain's own stars turn slowly the other way, so the sky lives against them.
const loader = new THREE.TextureLoader();
const pictures = {};
function ceilingPicture(file) {   // (the castle's vault: seen at a slant from far below, so it keeps its mipmaps and stays crisp)
  if (!pictures[file]) {
    const t = loader.load(new URL(file, import.meta.url).href);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    t.anisotropy = 16;
    pictures[file] = t;
  }
  return pictures[file];
}
function picture(file) {
  if (!pictures[file]) {
    const t = loader.load(new URL(file, import.meta.url).href);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;   // (no mipmaps: where a picture meets itself round the back, they drew a dotted seam line)
    t.anisotropy = 8;
    pictures[file] = t;
  }
  return pictures[file];
}

const SKY_SHADER = `
  uniform float time, reveal, usePic, aurora, water, hall, picLow, picSpan, horizon, floorR;
  uniform vec3 colA, colB, colC, starTint, topCol, roomC; uniform sampler2D pic, picB, belt;
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
  float starField(vec3 d) {
    return stars(d, 60.0, 0.965) * 1.8 + stars(d, 90.0, 0.93) * 1.4 + stars(d, 140.0, 0.93) * 1.0
         + stars(d, 220.0, 0.94) * 0.8 + stars(d, 330.0, 0.95) * 0.65 + stars(d, 500.0, 0.96) * 0.5
         + stars(d, 750.0, 0.965) * 0.4 + stars(d, 1100.0, 0.97) * 0.3 + stars(d, 1600.0, 0.975) * 0.22;   // (nine layers, near to far)
  }
  vec3 turned(vec3 d) { float r = -time * 0.008, c = cos(r), sn = sin(r); return vec3(c * d.x + sn * d.z, d.y, -sn * d.x + c * d.z); }   // (the stars turn slowly)

  // the lagoon picture round you, as seen in direction d (wet: how far into its water)
  vec3 lagoon(vec3 d, out float overhead) {
    float ang = atan(d.x, d.z) / 6.2831853, up = asin(clamp(d.y, -1.0, 1.0));
    float rawV = (up + picLow) / picSpan, v = min(rawV, 0.995);
    float u = ang * 2.0;
    float wet = clamp((horizon - abs(v)) / horizon, 0.0, 1.0);
    if (wet > 0.0) {   // (the water moves: slow swells, and finer ripples nearer you)
      u += (sin(v * 150.0 - time * 1.3 + sin(u * 23.0) * 2.0) * 0.0022 + sin(v * 60.0 - time * 0.7) * 0.0016) * wet;
      v += sin(u * 95.0 + time * 0.9) * 0.0012 * wet;
    }
    // the two copies (the second mirrored, the one without the moon), blended softly where they meet
    float wB = smoothstep(0.15, -0.15, sin(3.14159265 * fract(u * 0.5) * 2.0));
    vec3 p = mix(texture2D(pic, vec2(u, v)).rgb, texture2D(picB, vec2(u, v)).rgb, wB);
    float glowBlue = smoothstep(0.12, 0.35, p.b - p.r) * smoothstep(0.55, 0.95, p.g + p.b);   // (the blue glow in the water)
    p += p * glowBlue * (noise(vec3(u * 260.0, v * 260.0, time * 1.6)) - 0.45) * 1.6 * step(0.001, wet);
    float warm = smoothstep(0.2, 0.45, p.r - p.b) * smoothstep(0.55, 0.9, p.r);       // (lantern light, and the tree's glow)
    float fl = noise(vec3(u * 35.0, v * 35.0, time * 3.2)) * 0.7 + noise(vec3(u * 9.0, v * 9.0, time * 1.3)) * 0.3;
    p *= 1.0 + warm * (fl - 0.5) * 0.55;
    overhead = smoothstep(0.84, 0.99, rawV);   // (up high, where the picture would pinch to a point: its own sky color)
    return mix(p * 0.95, topCol, overhead);
  }

  // ---------- the castle: an eight-sided room, traced along each ray from where you're looking ----------
  // (sizes in meters, from the floor under the table: RA how far each wall is from the middle, RH the walls' height,
  // RW each wall's width, RS how steeply the vault rises from the walls' tops, PR the corner pillars' radius)
  const float RA = 6.6, RH = 4.96, RW = 5.467, RS = 0.95, PR = 0.3, P8 = 0.39269908, P4 = 0.78539816;
  vec3 marble(vec2 q) {   // polished black marble: big slabs, fine pale veins
    float v1 = abs(fbm(vec3(q * 0.8, 3.1)) - 0.5), v2 = abs(fbm(vec3(q * 2.3 + 9.0, 7.7)) - 0.5);
    float vein = smoothstep(0.012, 0.0, v1) * 0.11 + smoothstep(0.006, 0.0, v2) * 0.06;
    vec2 g = abs(fract(q / 1.6) - 0.5);
    float seam = smoothstep(0.494, 0.5, max(g.x, g.y));
    return (vec3(0.010, 0.010, 0.014) + vec3(0.5, 0.52, 0.6) * vein) * (1.0 - seam * 0.6);
  }
  // what a ray from o (in the room's own space) going d hits first: a wall, the vault, a pillar or the floor
  vec3 surface(vec3 o, vec3 d, out float onFloor, out vec3 hp) {
    float tB = 1e9, kind = 0.0; vec2 nB = vec2(0.0, 1.0);
    for (int k = 0; k < 8; k++) {
      float a = float(k) * P4;
      vec2 n = vec2(sin(a), cos(a));
      float dn = dot(d.xz, n);
      if (dn > 1e-5) { float t = (RA - dot(o.xz, n)) / dn; if (t < tB) { tB = t; kind = 1.0 + float(k) * 0.01; nB = n; } }
      float dr = RS * dn + d.y;
      if (dr > 1e-5) { float t = (RH + RA * RS - RS * dot(o.xz, n) - o.y) / dr; if (t < tB) { tB = t; kind = 2.0; } }
    }
    if (d.y < -1e-5) { float t = -o.y / d.y; if (t < tB) { tB = t; kind = 3.0; } }
    vec2 pc = vec2(0.0);
    for (int k = 0; k < 8; k++) {   // the pillars, one at each corner
      float a = float(k) * P4 + P8;
      vec2 c = vec2(sin(a), cos(a)) * (RA / cos(P8) - 0.06), oc = o.xz - c;
      float A = dot(d.xz, d.xz), B = dot(oc, d.xz), C = dot(oc, oc) - PR * PR, D = B * B - A * C;
      if (D > 0.0 && A > 1e-6) {
        float t = (-B - sqrt(D)) / A;
        if (t > 0.0 && t < tB && o.y + d.y * t < RH) { tB = t; kind = 4.0; pc = c; }
      }
    }
    hp = o + d * tB;
    onFloor = step(2.5, kind) * step(kind, 3.5);
    vec3 col;
    if (kind < 2.0) {   // a wall: its picture (the fireplace on the two facing walls), candles and fire flickering
      int k = int(floor((kind - 1.0) * 100.0 + 0.5));
      vec2 right = vec2(-nB.y, nB.x);
      vec2 uv = vec2(0.5 + dot(hp.xz, right) / RW, clamp(hp.y / RH, 0.002, 0.998));
      uv.x = clamp(uv.x, 0.002, 0.998);
      bool fire = k == 0 || k == 4;
      col = fire ? texture2D(picB, uv).rgb : texture2D(pic, uv).rgb;
      float warm = smoothstep(0.2, 0.45, col.r - col.b) * smoothstep(0.5, 0.9, col.r);
      float fl = noise(vec3(uv * 40.0, time * 3.4)) * 0.7 + noise(vec3(uv * 10.0, time * 1.4)) * 0.3;
      col *= 1.0 + warm * (fl - 0.5) * (fire ? 0.8 : 0.6);
      col *= 0.55 + 0.45 * smoothstep(0.0, 0.4, hp.y);                       // (darker down at the floor)
      col *= 0.7 + 0.3 * smoothstep(0.0, 0.12, min(uv.x, 1.0 - uv.x));        // (and into the corners)
    } else if (kind < 2.5) {   // the vault: your castle ceiling picture, seen from beneath, its gold boss right over the table
      vec2 q = hp.xz / (RA * 2.08) + 0.5;   // (the walls' tops land just inside the picture's edge, the ribs over the pillars)
      col = texture2D(belt, vec2(q.x, 1.0 - q.y)).rgb * 0.8;
      float warm = smoothstep(0.2, 0.45, col.r - col.b) * smoothstep(0.3, 0.75, col.r);
      float fl = noise(vec3(q * 30.0, time * 2.6)) * 0.7 + noise(vec3(q * 8.0, time * 1.2)) * 0.3;
      col *= 1.0 + warm * (fl - 0.5) * 0.3;   // (the gold catching the flickering candlelight)
      col *= 1.0 - 0.45 * smoothstep(RA * 0.8, RA * 1.05, length(hp.xz));   // (darker into the rim where it meets the walls)
    } else if (kind < 3.5) {   // the floor (its marble: the reflection is added by the caller)
      col = marble(hp.xz);
      col += vec3(0.09, 0.035, 0.012) * pow(smoothstep(RA * 0.45, RA, length(hp.xz)), 2.0) * 0.6;   // (candlelight pooling by the walls)
    } else {   // a pillar: carved ebony, fluted, gold bands, lit warm from the room
      vec2 nr = (hp.xz - pc) / PR;
      float psi = atan(nr.x, nr.y);
      vec2 L = normalize(-pc);
      float lam = max(dot(nr, L), 0.0), y = hp.y;
      float flute = 0.7 + 0.3 * cos(psi * 18.0);
      vec3 V = normalize(o - hp);
      float spec = pow(max(dot(reflect(-V, vec3(nr.x, 0.0, nr.y)), normalize(vec3(L.x, 0.3, L.y))), 0.0), 24.0);
      col = vec3(0.022, 0.016, 0.014) * flute * (0.35 + 0.9 * lam) + vec3(0.25, 0.13, 0.06) * spec * 0.4;
      float bands = smoothstep(0.05, 0.0, abs(y - 0.32)) + smoothstep(0.05, 0.0, abs(y - 0.48))
                  + smoothstep(0.07, 0.0, abs(y - (RH - 0.55))) + smoothstep(0.05, 0.0, abs(y - (RH - 0.3)));
      col = mix(col, vec3(0.6, 0.4, 0.14) * (0.3 + 0.9 * lam + spec), clamp(bands, 0.0, 1.0));
      col *= 0.7 + 0.3 * smoothstep(0.0, 0.5, y);
    }
    return col;
  }
  vec3 castle(vec3 world) {   // the room seen from the camera, through this point
    vec3 o = cameraPosition - roomC, d = normalize(world - cameraPosition);
    float onFloor; vec3 hp;
    vec3 col = surface(o, d, onFloor, hp);
    if (onFloor > 0.5) {   // polished: the room reflected in it, a little rippled by the marble's unevenness
      vec2 wob = vec2(noise(vec3(hp.xz * 3.0, 0.0)), noise(vec3(hp.xz * 3.0, 5.0))) - 0.5;
      vec3 rd = normalize(reflect(d, normalize(vec3(wob.x * 0.012, 1.0, wob.y * 0.012))));
      float f2; vec3 h2;
      vec3 refl = surface(hp + vec3(0.0, 0.001, 0.0), rd, f2, h2);
      float fres = 0.05 + 0.95 * pow(1.0 - max(-d.y, 0.0), 5.0);
      col = col * (1.0 - fres * 0.5) + refl * (0.22 + 0.7 * fres);
    }
    return col;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 drift = vec3(time * 0.004, 0.0, time * 0.002);
    float n = fbm(d * 2.2 + drift), m = fbm(d * 4.5 - drift * 1.7 + 5.0), g = fbm(d * 3.1 + drift * 0.6 + 11.0);
    vec3 col = vec3(0.004, 0.004, 0.01) + (colA * smoothstep(0.45, 0.85, n) * 0.55 + colB * smoothstep(0.4, 0.9, m) * 0.45
                                         + colC * smoothstep(0.5, 0.88, g) * 0.5) * 0.6;
    float starAmt = 1.0;
    vec3 ds = turned(d);

    if (hall > 0.5) {   // (the castle: the room, floor and all)
      col = castle(vDir + vec3(0.0, 1.4, 0.0));
      starAmt = 0.0;
    } else if (aurora > 0.5) {   // (deep space: everything moving on its own)
      float h = abs(d.y), below = d.y < 0.0 ? -1.0 : 1.0;
      col = vec3(0.003, 0.004, 0.012) + (col - vec3(0.004, 0.004, 0.01)) * 0.75;   // (the light clouds: the nebula, drifting its own way)
      // the stars: three layers, each turning its own way at its own speed, all twinkling
      for (int i = 0; i < 3; i++) {
        float fi = float(i), a = time * (0.005 + 0.004 * fi) * (i == 1 ? -1.0 : 1.0);
        vec3 ax = normalize(vec3(0.3 + fi, 1.0 - 0.4 * fi, 0.5 * fi - 0.2));
        vec3 dl = d * cos(a) + cross(ax, d) * sin(a) + ax * dot(ax, d) * (1.0 - cos(a));   // (turned about its own axis)
        col += starTint * (stars(dl, 80.0 + 170.0 * fi, 0.945 + 0.01 * fi) * (1.1 - 0.3 * fi) + stars(dl + 3.7, 320.0 + 520.0 * fi, 0.95) * 0.45 + stars(dl - 1.9, 1100.0 + 600.0 * fi, 0.97) * 0.3);
      }
      // the aurora: curtains of light high up, pouring across the table along x (upstream one way, downstream the other),
      // waving as they go, their colors shifting; mirrored down beneath you, flowing back the other way
      vec2 g2 = d.xz / (h + 0.1);
      float flowT = time * 0.16 * below;
      float along = g2.x * 0.55, across = g2.y * 0.55;
      vec3 aur = vec3(0.0);
      for (int j = 0; j < 3; j++) {
        float fj = float(j);
        float c0 = sin(along * 0.8 + time * 0.05 + fj * 2.1) * 0.55 + sin(along * 2.1 - time * 0.035 + fj) * 0.22 + (fj - 1.0) * 0.75;
        float w = 0.16 + 0.07 * sin(along * 1.3 + time * 0.07 + fj * 4.0);
        float band = exp(-pow((across - c0) / w, 2.0));
        float edge = exp(-pow((across - c0 + w * 0.6) / (w * 0.35), 2.0));   // (each curtain brightest along one edge)
        float rays = 0.45 + 0.55 * noise(vec3(along * 9.0 - flowT * 6.0, across * 1.2, fj * 7.0 + time * 0.05));
        rays *= 0.6 + 0.4 * noise(vec3(along * 26.0 - flowT * 14.0, across * 3.0, fj * 3.0));
        float k = time * 0.02 + along * 0.08 + fj * 0.31 + noise(vec3(along * 0.6, across * 0.6, time * 0.04)) * 0.6;
        float kk = fract(k);
        vec3 hue = kk < 0.25 ? mix(vec3(0.1, 1.0, 0.55), vec3(0.1, 0.8, 1.0), kk * 4.0)
                 : kk < 0.5  ? mix(vec3(0.1, 0.8, 1.0), vec3(0.55, 0.35, 1.0), (kk - 0.25) * 4.0)
                 : kk < 0.75 ? mix(vec3(0.55, 0.35, 1.0), vec3(1.0, 0.4, 0.7), (kk - 0.5) * 4.0)
                 :             mix(vec3(1.0, 0.4, 0.7), vec3(0.1, 1.0, 0.55), (kk - 0.75) * 4.0);
        aur += hue * (band * 0.55 + edge * 0.6) * rays * (0.75 + 0.25 * sin(time * 0.3 + fj * 2.0));
      }
      col += aur * 0.42 * smoothstep(0.08, 0.38, h) * (below < 0.0 ? 0.8 : 1.0);
      // the star ring: your stardust picture round you at eye level (six times round, mirrored: no seams), turning slowly,
      // shimmering, fading softly into the sky above and below
      col += exp(-pow(h / 0.09, 2.0)) * vec3(0.02, 0.06, 0.09);
      float bang = atan(ds.x, ds.z) / 6.2831853;
      vec2 bu = vec2(bang * 6.0, 0.5 + d.y / 0.32);
      if (abs(d.y) < 0.16) {
        vec3 bt = texture2D(belt, bu).rgb;
        float bright = smoothstep(0.25, 0.7, max(bt.r, max(bt.g, bt.b)));
        float tw = noise(vec3(bu.x * 420.0, bu.y * 160.0, time * 1.7));
        float breathe = 0.9 + 0.1 * noise(vec3(bu.x * 6.0, bu.y * 3.0, time * 0.25));
        float soft = 1.0 - smoothstep(0.03, 0.16, abs(d.y));
        col += bt * 0.62 * soft * breathe * (1.0 + bright * (tw - 0.5) * 1.1);
      }
      // shooting stars now and then: a bright head with a fading tail streaking down across the sky
      vec2 spos = vec2(atan(d.x, d.z), asin(clamp(d.y, -1.0, 1.0)));
      for (int i = 0; i < 3; i++) {
        float fi = float(i), P = 7.0 + fi * 3.3, tt = (time + fi * 2.7) / P, cyc = floor(tt), ph = fract(tt) / 0.16;
        if (ph < 1.0) {
          float h1 = fract(sin(cyc * 12.9898 + fi * 78.233) * 43758.5), h2 = fract(sin(cyc * 39.346 + fi * 11.135) * 24634.6);
          vec2 a0 = vec2(h1 * 6.2832 - 3.1416, 0.3 + h2 * 0.75);
          vec2 vel = normalize(vec2(h1 > 0.5 ? 1.0 : -1.0, -0.5 - h2 * 0.5)) * 0.6;
          vec2 head = a0 + vel * ph, tail = head - vel * 0.4;
          vec2 pa = spos - tail, ba = head - tail;
          pa.x = mod(pa.x + 3.1416, 6.2832) - 3.1416;
          float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          vec2 df = pa - ba * hh;
          df.x *= cos(spos.y);
          float dd = dot(df, df);
          col += vec3(0.85, 0.92, 1.0) * (exp(-dd / 0.0000045) * hh * hh * 1.8 + exp(-dd / 0.00004) * hh * hh * hh * 0.25) * sin(ph * 3.1416);
        }
      }
      // a few big stars that slowly swell and fade, here and there
      float big = stars(turned(d) * 1.3 + 7.0, 26.0, 0.975);
      col += vec3(0.9, 0.95, 1.0) * big * (0.5 + 0.5 * sin(time * 0.6 + d.x * 40.0 + d.z * 31.0)) * 1.4;
      starAmt = 0.0;   // (its own stars, above)
    } else if (water > 0.5) {
      float overhead;
      col = lagoon(d, overhead);
      starAmt = overhead;   // (its own stars low down: none drawn over its tree and islands)
      #ifdef FLOOR
      {   // the floor: live water under the table, reflecting the lagoon's sky, its blue glow sparkling
        vec3 wp = vDir + vec3(0.0, 1.4, 0.0);
        float r = length(wp.xz);
        vec2 x = wp.xz * 9.0;
        float t = time;
        // broken up waves: wave trains from many uneven directions, each rising and fading in patches as the water
        // moves, over a slow swell and a fine chop, so nothing lines up in rows
        vec2 grad = vec2(0.0);
        for (int i = 0; i < 7; i++) {
          float fi = float(i), ang = fi * 2.399 + 0.37, k = 0.8 + fract(fi * 0.618) * 1.9;
          vec2 dir = vec2(cos(ang), sin(ang));
          float strong = noise(vec3(x * 0.16 + fi * 3.7, t * 0.07 + fi));   // (where this train is strong, drifting)
          float amp = smoothstep(0.25, 0.85, strong) * (1.2 - fi * 0.1);
          grad += dir * cos(dot(x, dir) * k + t * (0.7 + k * 0.45) + fi * 1.7) * k * amp * 0.55;
        }
        float e = 0.08;
        float h0 = noise(vec3(x * 0.9, t * 0.35)), hx = noise(vec3((x + vec2(e, 0.0)) * 0.9, t * 0.35)), hz = noise(vec3((x + vec2(0.0, e)) * 0.9, t * 0.35));
        grad += vec2(hx - h0, hz - h0) / e * 0.9;   // (the slow swell)
        float c0 = noise(vec3(x * 3.1, t * 0.9)), cx = noise(vec3((x + vec2(e, 0.0)) * 3.1, t * 0.9)), cz = noise(vec3((x + vec2(0.0, e)) * 3.1, t * 0.9));
        grad += vec2(cx - c0, cz - c0) / e * 0.35;   // (the fine chop)
        vec3 nrm = normalize(vec3(-grad.x * 0.06, 1.0, -grad.y * 0.06));
        vec3 view = normalize(wp - cameraPosition);
        vec3 rd = reflect(view, nrm);
        rd.y = max(rd.y, 0.02);
        float o2;
        vec3 refl = lagoon(normalize(rd), o2);
        float fres = 0.08 + 0.92 * pow(1.0 - max(dot(-view, nrm), 0.0), 4.0);
        vec3 deep = vec3(0.004, 0.022, 0.045);
        vec3 live = mix(deep, refl, clamp(fres * 1.3, 0.0, 1.0));
        float spark = stars(vec3(wp.x * 2.0, time * 0.02, wp.z * 2.0), 40.0, 0.93) + stars(vec3(wp.x * 2.0 + 5.0, time * 0.015, wp.z * 2.0), 70.0, 0.92) * 0.7;
        live += vec3(0.25, 0.9, 1.0) * spark * 1.4;   // (the blue glow, sparkling in the water)
        // round the table it's live water; going out it takes on the picture's own water colors and ripples, and past
        // that it's the picture's water itself, its lanterns, shores and islands (one long soft blend, no edge)
        float out1 = smoothstep(0.6, 2.6, r);
        live = mix(live, live * 0.55 + col * 0.6, smoothstep(0.3, 1.6, r));
        col = mix(live, col, out1 * out1 * (3.0 - 2.0 * out1));
        starAmt = 0.0;
      }
      #endif
    }
    col += starTint * starAmt * (1.0 - usePic * 0.6) * starField(ds);
    vec3 glass = vec3(0.006, 0.006, 0.009);   // (the black glass, seen from inside)
    gl_FragColor = vec4(mix(glass, col, reveal), 1.0);
    #ifdef FLOOR
    gl_FragColor = vec4(col, reveal);   // (the sky floor: it fades in over the room's floor)
    #endif
    #include <colorspace_fragment>
  }`;

export function makeCurtain({ radius = 2.0, top = 3.3, ceiling = top + 0.7, lampLow = 1.75, hide = [], onRoom = null } = {}) {
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
  // on the glass: gold glitter and a glow as it forms out of particles or vanishes into them (cGlow)
  const CIRC = { cTime: { value: 0 }, cFall: { value: 0 }, cGlow: { value: 0 } };
  outside.material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, CIRC);
    sh.vertexShader = 'varying vec2 vCirc;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vCirc = uv;');
    sh.fragmentShader = `uniform float cTime, cFall, cGlow; varying vec2 vCirc;
      float ch(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float run(float x, float speed, float seed) {   // (a point of light at the head, its trail fading behind it)
        float ph = fract(x / 14.0 - cTime * speed + seed);
        return pow(ph, 10.0) * 1.4 + pow(ph, 2.5) * 0.25;
      }
` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 c = vec3(0.0);
        totalEmissiveRadiance += c * (1.0 + cFall * 0.8);
        // glowing gold and glittering, as it comes or goes in particles (cGlow 1 .. 0 as it cools to black)
        if (cGlow > 0.0) {
          float gl = step(0.965, ch(floor(vCirc * vec2(520.0, 140.0)) + floor(cTime * 12.0) * 0.37));
          float sheen = 0.6 + 0.4 * sin(vCirc.y * 30.0 - cTime * 3.0 + vCirc.x * 40.0);
          totalEmissiveRadiance += vec3(1.0, 0.7, 0.3) * cGlow * (0.55 * sheen + gl * 3.0);
        }
      }`);
  };
  outside.material.customProgramCacheKey = () => 'curtainCircuits';
  // inside: black glass that fades into the sky (and a lid of sky overhead, inside the ring)
  const sky = SKIES[0];
  const uniforms = {
    time: { value: 0 }, reveal: { value: 0 }, usePic: { value: 0 }, aurora: { value: 0 }, water: { value: 0 }, hall: { value: 0 },
    picLow: { value: 0 }, picSpan: { value: 1 }, horizon: { value: 0.4 }, pic: { value: null }, picB: { value: null }, floorR: { value: 1 },
    topCol: { value: new THREE.Vector3() }, roomC: { value: new THREE.Vector3() },
    colA: { value: new THREE.Vector3(...sky.a) }, colB: { value: new THREE.Vector3(...sky.b) }, colC: { value: new THREE.Vector3(...sky.c) },
    starTint: { value: new THREE.Vector3(...sky.stars) }, belt: { value: null }
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, fragmentShader: SKY_SHADER,
    vertexShader: `varying vec3 vDir;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - vec3(0.0, 1.4, 0.0); gl_Position = projectionMatrix * viewMatrix * w; }`
  });
  const inside = new THREE.Mesh(wall, skyMat);
  inside.scale.set(0.998, 1, 0.998);   // (a hair inside the glass, but all the way down to the floor: no gap at the bottom)
  hang.add(inside);
  const lid = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), skyMat.clone());
  lid.material.uniforms = uniforms;
  lid.material.side = THREE.DoubleSide;
  lid.rotation.x = Math.PI / 2;     // (facing down)
  lid.position.y = -0.002;          // (right at the wall's top: no gap between them, which showed as a black line)
  lid.visible = false;
  group.add(lid);
  // the sky floor: a disc of sky over the room's floor inside the curtain, fading in with the sky
  const floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), new THREE.ShaderMaterial({
    uniforms, defines: { FLOOR: 1 }, transparent: true, side: THREE.DoubleSide, fragmentShader: SKY_SHADER, vertexShader: skyMat.vertexShader }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -top + 0.003;  // (a hair above the room's floor)
  floor.visible = false;
  group.add(floor);
  // the holodeck's sky, all the way round (once the curtain has spread out): far off, like a real sky
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius * FAR * 1.15, 96, 48), skyMat);
  dome.position.y = 1.4 - top;      // (centered where the sky is seen from)
  dome.visible = false;
  group.add(dome);
  // the fine glowing line round the bottom edge
  const edge = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.008, 8, 200),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.5).multiplyScalar(2.2) }));
  edge.rotation.x = Math.PI / 2;
  group.add(edge);

  // ---------- the floating lamp (hanginglamp.js), no cord: it waits up at the ring and
  // lowers over the table once the sky is in. Click it to change the sky.
  const GOLD = new THREE.MeshPhysicalMaterial({ color: 0xe8b552, metalness: 1, roughness: 0.16 });
  const { group: lamp, parts: lampParts, light: glow, shine } = makeLamp();
  group.add(lamp);
  const lampTop = 0.0, lampBottom = lampLow - top;   // (where the orb hangs: up in the ring, or low over the table)
  const ceil = ceiling - top;

  // ---------- as it lifts: golden sparkles and glitching gold specks left hanging in the air where it was ----------
  const SPK = 700;
  const sGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(SPK * 3), sSeed = new Float32Array(SPK);
  for (let i = 0; i < SPK; i++) {
    const a = Math.random() * Math.PI * 2, r = radius * (0.92 + Math.random() * 0.16);
    sPos.set([Math.cos(a) * r, -Math.random() * H, Math.sin(a) * r], i * 3); sSeed[i] = Math.random();
  }
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('seed', new THREE.BufferAttribute(sSeed, 1));
  const SU = { sAge: { value: 99 }, sTime: { value: 0 }, sPx: { value: 400 } };
  const sparkles = new THREE.Points(sGeo, new THREE.ShaderMaterial({
    uniforms: SU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float sAge, sTime, sPx; attribute float seed; varying float vA, vS;
      void main() {
        vS = seed;
        float life = 3.0 + seed * 4.0, k = sAge / life;
        vec3 p = position + vec3(sin(seed * 40.0 + sTime * 0.7) * 0.03, sAge * (0.04 + seed * 0.08), cos(seed * 30.0 + sTime * 0.6) * 0.03);
        float on = step(sAge, life) * smoothstep(0.0, 0.15, sAge - seed * 1.2);   // (left behind as the glass rises past)
        float tw = 0.5 + 0.5 * sin(sTime * (5.0 + seed * 9.0) + seed * 60.0);
        vA = on * (1.0 - smoothstep(0.55, 1.0, k)) * (0.35 + 0.65 * tw * tw);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = sPx * (0.01 + 0.02 * seed * seed) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA, vS;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = (exp(-dot(q, q) * 60.0) + (exp(-abs(q.x) * 30.0) * exp(-abs(q.y) * 5.0) + exp(-abs(q.y) * 30.0) * exp(-abs(q.x) * 5.0)) * step(0.85, vS)) * vA;
        gl_FragColor = vec4(mix(vec3(1.0, 0.68, 0.25), vec3(1.0, 0.93, 0.75), step(0.8, vS)) * a * 2.0, a);
      }`
  }));
  sparkles.frustumCulled = false; sparkles.visible = false;
  group.add(sparkles);
  const GL = 90;   // (the glitches: little gold squares flickering in and out, jumping about)
  const glitchMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.72, 0.32).multiplyScalar(1.6), transparent: true, opacity: 0.8,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const glitches = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glitchMat, GL);
  glitches.frustumCulled = false; glitches.visible = false;
  group.add(glitches);
  const gm = new THREE.Matrix4(), gq = new THREE.Quaternion(), gs = new THREE.Vector3(), gp = new THREE.Vector3(), gUp = new THREE.Vector3(0, 1, 0);
  const gSeed = Array.from({ length: GL }, () => ({ a: Math.random() * Math.PI * 2, y: -Math.random() * H, w: 0.02 + Math.random() * 0.06, h: 0.01 + Math.random() * 0.03, t: Math.random() }));
  let sparkAge = 99;
  function stepSparkles(dt) {
    sparkAge += dt;
    const on = sparkAge < 7.5;
    sparkles.visible = glitches.visible = on;
    if (!on) return;
    SU.sAge.value = sparkAge; SU.sTime.value += dt;
    SU.sPx.value = (window.innerHeight || 800) * Math.min(window.devicePixelRatio || 1, 2) * 0.5;
    const fadeG = 1 - Math.min(Math.max((sparkAge - 2.5) / 2.5, 0), 1);
    gSeed.forEach((g, i) => {
      if (Math.random() < 0.08) { g.a += (Math.random() - 0.5) * 0.15; g.y += (Math.random() - 0.5) * 0.12; }   // (jumping about)
      const show = Math.random() < 0.45 && sparkAge > g.t * 1.5 ? fadeG : 0;
      gp.set(Math.cos(g.a) * radius, Math.max(-H, Math.min(0, g.y)), Math.sin(g.a) * radius);
      gq.setFromAxisAngle(gUp, -g.a + Math.PI / 2);
      gs.set(g.w * show + 1e-5, g.h * show + 1e-5, 1);
      gm.compose(gp, gq, gs); glitches.setMatrixAt(i, gm);
    });
    glitches.instanceMatrix.needsUpdate = true;
  }

  let glowAge = 99, hold = 0;
  let drop = 0, fade = 0, spread = 0, closing = false, skyIndex = 0, lampWant = 0, lampK = 0, lastRoom = true;   // (drop: 0 up .. 1 down; fade: 0 glass .. 1 sky; spread: 0 at the table .. 1 the whole room)
  const ease = k => k * k * (3 - 2 * k);
  function show() {
    const d = ease(drop);
    const S = 1 + (FAR - 1) * ease(spread);   // (how far out the curtain has spread)
    hang.scale.set(S, Math.max(0.0001, d), S);
    hang.visible = drop > 0.001 && spread < 0.999;
    lid.scale.set(S, S, 1); floor.scale.set(S, S, 1);
    uniforms.floorR.value = S;
    dome.visible = spread >= 0.999;
    edge.scale.set(S, S, 1);
    edge.position.y = -H * d;
    edge.visible = (drop > 0.001 && drop < 0.999) || (spread > 0.001 && spread < 0.999);   // (as it drops, and sweeping out across the floor)
    uniforms.reveal.value = ease(fade);
    lid.visible = fade > 0.001 && spread < 0.999;
    floor.visible = fade > 0.001;
    const roomOn = fade < 0.5;   // (with the sky in, the room's own things are switched off: not drawn at all)
    if (roomOn !== lastRoom) { lastRoom = roomOn; for (const o of hide) o.visible = roomOn; if (onRoom) onRoom(roomOn); }   // (studio.js does this itself now: only for those inside)
    const low = ease(Math.max(lampK, fade));   // (the lamp comes down when someone sits, and stays down while the sky is in)
    const ly = lampTop + (lampBottom - lampTop) * low;
    lamp.position.y = ly + 0.5;   // (the lamp's top; it hangs half a meter down from there)
    glow.userData.level = 0.8 + 2.4 * low;
    shine(ease(fade));   // (the porcelain glows softly under the sky, where the room's lights don't reach)   // (the lamp flickers around this itself)
  }
  function applySky() {
    const s = SKIES[skyIndex], u = uniforms;
      if (s.a) { u.colA.value.set(...s.a); u.colB.value.set(...s.b); u.colC.value.set(...s.c); }
      u.starTint.value.set(...s.stars);
      u.usePic.value = s.pic ? 1 : 0; u.aurora.value = s.aurora ? 1 : 0; u.water.value = s.water ? 1 : 0; u.hall.value = s.hall ? 1 : 0;
      if (s.belt) u.belt.value = picture(s.belt);
      if (s.vault) u.belt.value = ceilingPicture(s.vault);   // (the castle has no star ring: its ceiling picture goes there)
      if (s.pic) { u.pic.value = picture(s.pic); u.picB.value = picture(s.picB || s.pic); u.topCol.value.set(...s.top); }
      if (s.water) { u.picLow.value = s.low; u.picSpan.value = s.span; u.horizon.value = s.horizon; }
  }
  applySky();   // (the first sky, ready from the start)
  show();
  return {
    group,
    get closed() { return closing; },
    get down() { return drop >= 0.999; },
    get skyIn() { return fade >= 0.5; },
    get spreadOut() { return spread > 0.001; },   // (spread out past the table: from outside, it has to stay hidden)
    get skyIndex() { return skyIndex; },
    SKY_COUNT: SKIES.length,
    close() { closing = true; hold = 0; },
    glowIn() { glowAge = 0; },   // (glowing gold and glittering, then cooling to black over a moment)
    // snap(): straight to where it's going, no animation (on load: the den as it was left, without playing it all out)
    snap() { drop = fade = spread = closing ? 1 : 0; sparkAge = 99; stepSparkles(0); show(); },
    // warm(renderer, scene, camera): get every one of its looks ready now, so nothing stalls the first time it's seen
    warm(renderer, scene, camera) {
      const was = [];
      group.traverse(o => { was.push([o, o.visible]); o.visible = true; });
      try { renderer.compile(scene, camera); } catch (e) {}
      for (const [o, v] of was) o.visible = v;
    },
    toGlass(wait = 1.2) { spread = fade = 0; hold = wait; sparkAge = -wait; show(); },
    open() { if (closing) sparkAge = -(SPREAD + FADE) * (spread > 0 ? 1 : fade > 0 ? 0.5 : 0); closing = false; },   // (the sparkles start as the glass begins to rise)
    toggle() { closing = !closing; },
    setSky(i) {
      i = Number.isInteger(i) ? ((i % SKIES.length) + SKIES.length) % SKIES.length : 0;
      if (i === skyIndex) return;
      skyIndex = i; applySky();
    },
    lampDown(on) { lampWant = on ? 1 : 0; },
    lampShown(on) { lamp.visible = on; },   // (hidden in the game view, so nothing hangs over the board)   // (someone sitting at the table: the lamp floats down over it)
    nextSky() {
      skyIndex = (skyIndex + 1) % SKIES.length;
      applySky();
    },
    lamp: lampParts,   // (what to click to change the sky)
    update(dt) {
      uniforms.time.value += dt;
      group.getWorldPosition(uniforms.roomC.value); uniforms.roomC.value.y -= top;   // (the castle stands on the floor under the curtain)
      CIRC.cTime.value += dt;
      glowAge += dt; CIRC.cGlow.value = Math.max(0, 1 - glowAge / 1.6);
      CIRC.cFall.value += ((closing && drop < 1 ? 1 : 0) - CIRC.cFall.value) * Math.min(dt * 2.5, 1);   // (brighter and faster as it comes down)
      stepSparkles(dt);
      lampK += Math.sign(lampWant - lampK) * Math.min(Math.abs(lampWant - lampK), dt / 2.2);
      if (closing) {   // (down first, then the sky fades in, then it spreads out)
        if (drop < 1) drop = Math.min(1, drop + dt / DROP);
        else if (fade < 1) fade = Math.min(1, fade + dt / FADE);
        else if (SKIES[skyIndex].stay) spread = Math.max(0, spread - dt / SPREAD);   // (a sky that stays at the curtain: pulled back in if it was out)
        else spread = Math.min(1, spread + dt / SPREAD);
      } else {         // (it pulls back in first, then the sky fades out, then up)
        if (hold > 0) hold = Math.max(0, hold - dt);   // (holding, down, before it lifts)
        else if (spread > 0) spread = Math.max(0, spread - dt / SPREAD);
        else if (fade > 0) fade = Math.max(0, fade - dt / FADE);
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
