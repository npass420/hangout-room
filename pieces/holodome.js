// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/holodome.js <<<<<
// The holodeck dome: a scene that forms around you. First black water spreads out across the floor from the middle,
// a glowing line sweeping out at its edge; then a low round wall rises out of the water all the way round and keeps
// going, curving in overhead into a shallow dome that closes right over you, a glowing line climbing at its top edge
// as it builds. Taking it down runs the other way: the dome opens and sinks back into the water, and the water
// draws back to the middle.
// The pictures make the scene: the walls picture wraps round the wall and up the dome in copies side by side, every
// other one mirrored so they meet without a seam, each keeping the picture's true shape. A second walls picture (if
// given: like the lagoon without its moon, so there's only one) goes on every copy but the first. A scene made of
// wide panoramas can ask for just two copies round (the picture and its second); a picture taller than the dome
// blends its top into the dome picture, which closes the top,
// seen from beneath. With no dome picture, the top is a night sky with stars. The water is dark and glossy, with slow
// waves and rings spreading from everyone walking on it, and it reflects the whole scene.
// One piece for every room that needs it: the Maker and the Scene room now, the den's curtain and a play room later.
//   makeHoloDome({ radius, wall, rise })   radius: how far out the wall stands (m); wall: how tall the straight part
//                                          is before it curves in; rise: how much higher the middle of the dome is.
//                                          Never smaller than a gallery (GALLERY_RADIUS): a smaller one grows to it
//     .group          add it to the scene (its middle on the floor at x = 0, z = 0)
//     .show(on)       form it, or take it down
//     .pictures({ walls, walls2, dome, night, copies })   picture addresses (walls2 and dome can be left out);
//                     night: [r, g, b]; copies: how many round (2 for a panorama pair; left out, it's worked out)
//     .update(dt, t, eye, feet)   every frame. eye: the camera's position; feet: [{ x, z, s }] where people are
//                                 standing (s: how strongly they stir the water)
//     .amount         0 (gone) .. 1 (fully formed);  .roomFade: 0 .. 1, how far the room around should have faded
//     .waterAt        how far the water has spread (m);  .radius;  .formed: fully formed
//   build()   the Workshop's look at it: a small one forming and unforming by itself
// =====================================================================================================================
import * as THREE from 'three';

const SPREAD_TIME = 1.6;   // seconds for the water to spread out
const BUILD_TIME = 3.0;    // seconds for the wall and dome to rise and close
const OVERLAP = 0.4;       // (the wall starts rising a little before the water's all the way out)
const TOTAL = SPREAD_TIME + BUILD_TIME - OVERLAP;
const LINE = new THREE.Color(0.45, 0.8, 1.0);   // the glowing build line

const SKY_GLSL = `
  uniform sampler2D uWalls, uWalls2, uDome;
  uniform float uHasWalls, uHasWalls2, uHasDome, uCopies, uPicH, uWallTop, uR, uW, uRc, uCy, uThTop, uL, uRd, uTime, uBuild;
  uniform vec3 uNight;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sOf(vec3 p) {   // how far up the wall and dome this point is, measured along the surface from the floor
    if (p.y <= uW) return max(p.y, 0.0);
    float phi = acos(clamp((p.y - uCy) / uRc, -1.0, 1.0));
    return uW + uRc * max(uThTop - phi, 0.0);
  }
  vec3 skyAt(vec3 p) {   // the scene's color at a point on the wall or dome
    float s = sOf(p);
    // the night: deep color, brighter low down, with twinkling stars
    vec3 dir = normalize(p - vec3(0.0, 1.6, 0.0));
    vec3 col = uNight * (1.0 + 1.5 * (1.0 - smoothstep(0.0, 0.6, dir.y)));
    vec2 sg = vec2(atan(dir.z, dir.x) * 90.0, asin(clamp(dir.y, -1.0, 1.0)) * 90.0), sid = floor(sg);
    float sh = h21(sid);
    if (sh > 0.93) col += vec3(0.9, 0.93, 1.0) * smoothstep(0.32, 0.0, length(fract(sg) - 0.5)) * (0.55 + 0.45 * sin(uTime * (0.7 + sh * 3.0) + sh * 50.0)) * 1.3;
    // the walls picture, round the wall and up the dome
    if (uHasWalls > 0.5) {
      float a = atan(-p.z, p.x) / 6.2831853;
      float u = a * uCopies, u2 = fract(a + 0.5) * uCopies;   // (two ways of measuring round, so the join never smears)
      vec2 g1 = vec2(dFdx(u), dFdy(u)), g2 = vec2(dFdx(u2), dFdy(u2));
      vec2 gu = abs(g1.x) + abs(g1.y) < abs(g2.x) + abs(g2.y) ? g1 : g2;
      float v = s / uPicH;
      vec3 pic = textureGrad(uWalls, vec2(u, v), vec2(gu.x, dFdx(v)), vec2(gu.y, dFdy(v))).rgb;
      if (uHasWalls2 > 0.5 && abs(floor(u)) > 0.5)   // (every copy but the first: the second picture, if there is one)
        pic = textureGrad(uWalls2, vec2(u, v), vec2(gu.x, dFdx(v)), vec2(gu.y, dFdy(v))).rgb;
      col = mix(col, pic, (1.0 - smoothstep(uWallTop * 0.8, uWallTop, s)) * step(v, 1.0));
    }
    // the dome picture, closing the top
    if (uHasDome > 0.5) {
      float r = length(p.xz);
      vec2 duv = vec2(0.5 + p.x / (2.0 * uRd), 0.5 + p.z / (2.0 * uRd));
      col = mix(col, texture2D(uDome, duv).rgb, 1.0 - smoothstep(uRd * 0.6, uRd * 0.97, r));
    }
    return col;
  }
  vec3 hitDome(vec3 o, vec3 r) {   // where a ray from inside meets the dome or its wall
    vec3 oc = o - vec3(0.0, uCy, 0.0);
    float b = dot(oc, r), c = dot(oc, oc) - uRc * uRc;
    vec3 p = o + r * (-b + sqrt(max(b * b - c, 0.0)));
    if (p.y < uW) {
      float a = dot(r.xz, r.xz), bb = dot(o.xz, r.xz), cc = dot(o.xz, o.xz) - uR * uR;
      p = o + r * ((-bb + sqrt(max(bb * bb - a * cc, 0.0))) / max(a, 1e-6));
    }
    return p;
  }`;

const DOME_VS = `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DOME_FS = SKY_GLSL + `
  varying vec3 vP;
  void main() {
    float s = sOf(vP);
    if (s > uBuild) discard;   // (not built up this far yet)
    vec3 col = skyAt(vP);
    col += vec3(${LINE.r}, ${LINE.g}, ${LINE.b}) * (exp(-(uBuild - s) * 9.0) * 3.0 + exp(-(uBuild - s) * 1.5) * 0.25) * step(uBuild, uL - 0.01);
    gl_FragColor = vec4(col, 1.0);
  }`;

const WATER_VS = `varying vec3 vP; varying vec3 vW; void main() { vP = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const WATER_FS = SKY_GLSL + `
  uniform float uSpread; uniform vec3 uEye; uniform vec4 uFeet[8];
  varying vec3 vP; varying vec3 vW;
  void main() {
    float d = length(vP.xz);
    if (d > uSpread) discard;
    // the water's surface: slow swells, and rings spreading out from everyone standing on it
    vec2 q = vP.xz, g = vec2(0.0);
    g += vec2(0.8, 0.3) * cos(dot(q, vec2(0.8, 0.3)) * 1.3 + uTime * 0.6) * 0.012;
    g += vec2(-0.4, 0.9) * cos(dot(q, vec2(-0.4, 0.9)) * 1.9 - uTime * 0.8) * 0.009;
    g += vec2(0.7, -0.7) * cos(dot(q, vec2(0.7, -0.7)) * 3.7 + uTime * 1.1) * 0.004;
    for (int i = 0; i < 8; i++) {
      vec2 dv = q - uFeet[i].xy; float r = length(dv) + 1e-4;
      g += dv / r * uFeet[i].z * cos(r * 6.0 - uTime * 2.6) * exp(-r * 0.55) * 0.05;
    }
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = normalize(vP - uEye);
    vec3 R = reflect(V, n);
    R.y = max(R.y, 0.03); R = normalize(R);
    vec3 hp = hitDome(vP, R);
    vec3 refl = sOf(hp) > uBuild ? vec3(0.0) : skyAt(hp);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, n), 0.0), 5.0);
    vec3 col = vec3(0.002, 0.005, 0.01) + refl * (0.22 + 0.7 * fres);
    // the glowing line at the edge while it spreads
    col += vec3(${LINE.r}, ${LINE.g}, ${LINE.b}) * exp(-(uSpread - d) * 7.0) * 2.2 * step(uSpread, uR - 0.05);
    gl_FragColor = vec4(col, 1.0);
  }`;

export const GALLERY_RADIUS = 9;   // (the smallest a dome ever is: 18 m across, so a gallery-sized room, 12 m square, fits inside)
export function makeHoloDome({ radius = 11, wall = 2.4, rise = 5, small = false } = {}) {
  const k = small ? 1 : Math.max(1, GALLERY_RADIUS / radius);   // (smaller asked for: the whole shape grows to gallery size)
  const R = radius * k, W = wall * k, RISE = rise * k;
  const Rc = (R * R + RISE * RISE) / (2 * RISE), cy = W + RISE - Rc, thTop = Math.asin(Math.min(1, R / Rc)), L = W + Rc * thTop;
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
  const U = {
    uWalls: { value: blank }, uWalls2: { value: blank }, uDome: { value: blank }, uHasWalls: { value: 0 }, uHasWalls2: { value: 0 }, uHasDome: { value: 0 },
    uCopies: { value: 2 }, uPicH: { value: L * 0.75 }, uWallTop: { value: L * 0.7 }, uR: { value: R }, uW: { value: W }, uRc: { value: Rc }, uCy: { value: cy },
    uThTop: { value: thTop }, uL: { value: L }, uRd: { value: R * 0.6 }, uTime: { value: 0 }, uBuild: { value: 0 },
    uNight: { value: new THREE.Color(0.004, 0.008, 0.022) }
  };
  const group = new THREE.Group();
  group.visible = false;

  // the wall and dome: one surface spun round the middle, from the floor up the wall and over the top
  const prof = [];
  for (let i = 0; i <= 6; i++) prof.push(new THREE.Vector2(R, W * i / 6));
  for (let i = 1; i <= 40; i++) { const phi = thTop * (1 - i / 40); prof.push(new THREE.Vector2(Math.max(0, Rc * Math.sin(phi)), cy + Rc * Math.cos(phi))); }
  const dome = new THREE.Mesh(new THREE.LatheGeometry(prof, 128), new THREE.ShaderMaterial({ uniforms: U, vertexShader: DOME_VS, fragmentShader: DOME_FS, side: THREE.DoubleSide }));
  dome.frustumCulled = false;
  group.add(dome);

  // the water floor
  const WU = { ...U, uSpread: { value: 0 }, uEye: { value: new THREE.Vector3(0, 1.6, 0) }, uFeet: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) } };
  const water = new THREE.Mesh(new THREE.CircleGeometry(R, 128), new THREE.ShaderMaterial({ uniforms: WU, vertexShader: WATER_VS, fragmentShader: WATER_FS }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.003;
  water.userData.floor = true;   // (you can click it to walk there)
  water.frustumCulled = false;
  group.add(water);
  // (the water's own corners are in its flat space, turned to lie down: its shader needs them as they stand)
  water.geometry.rotateX(-Math.PI / 2); water.rotation.x = 0;

  // ---------- The pictures ----------
  const loader = new THREE.TextureLoader();
  let want = '';
  let wantCopies = 0;   // (how many copies round the scene asked for: 0 works it out)
  function fit() {   // (the walls picture keeps its true shape, its copies side by side making the full circle)
    const img = U.uWalls.value.image;
    if (!img || !img.width) return;
    const aspect = img.width / img.height, round = 2 * Math.PI * R;
    let copies = wantCopies;
    if (!copies) {   // (worked out: enough copies that each one fits up the wall and most of the way over)
      copies = Math.max(2, 2 * Math.round(round / (0.75 * L * aspect) / 2));
      while (round / copies / aspect > 0.85 * L) copies += 2;
    }
    const picH = round / copies / aspect;   // (how tall it stands, measured up the wall and over the dome)
    const top = Math.min(picH, L * 0.88);   // (taller than the dome: its top blends into the dome picture)
    U.uCopies.value = copies; U.uPicH.value = picH; U.uWallTop.value = top;
    const s = top * 0.85;   // (the dome picture fills in from where the walls picture starts to fade)
    let r = R;
    if (s > W) r = Rc * Math.sin(Math.max(0, thTop - (s - W) / Rc));
    U.uRd.value = Math.max(r * 1.15, R * 0.3);
  }
  function load(url, done) {
    loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; done(t); }, undefined, () => console.warn('Holodeck picture did not load: ' + url));
  }
  function pictures({ walls = '', walls2 = '', dome: top = '', night = null, copies = 0 } = {}) {
    const key = walls + '|' + walls2 + '|' + top;
    if (night) U.uNight.value.setRGB(night[0], night[1], night[2]);
    if ((copies | 0) !== wantCopies) { wantCopies = copies | 0; fit(); }
    if (key === want) return;
    want = key;
    const swap = (slot, flag, t) => { if (U[slot].value !== blank) U[slot].value.dispose(); U[slot].value = t || blank; U[flag].value = t ? 1 : 0; };
    if (walls) load(walls, t => { if (want !== key) { t.dispose(); return; } t.wrapS = THREE.MirroredRepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; swap('uWalls', 'uHasWalls', t); fit(); });
    else swap('uWalls', 'uHasWalls', null);
    if (walls && walls2) load(walls2, t => { if (want !== key) { t.dispose(); return; } t.wrapS = THREE.MirroredRepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; swap('uWalls2', 'uHasWalls2', t); });
    else swap('uWalls2', 'uHasWalls2', null);
    if (top) load(top, t => { if (want !== key) { t.dispose(); return; } t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; swap('uDome', 'uHasDome', t); });
    else swap('uDome', 'uHasDome', null);
  }

  // ---------- Forming and taking down ----------
  let at = 0, on = false;
  const ease = k => k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
  const local = new THREE.Vector3(), inv = new THREE.Matrix4();
  const api = {
    group, radius: R, height: W + RISE, amount: 0, roomFade: 0, waterAt: 0, formed: false,
    get on() { return on; },
    show(v) { on = !!v; },
    pictures,
    update(dt, t, eye, feet = []) {
      at = Math.max(0, Math.min(TOTAL, at + (on ? dt : -dt)));
      const spread = ease(at / SPREAD_TIME), build = ease((at - SPREAD_TIME + OVERLAP) / BUILD_TIME);
      api.waterAt = R * spread; api.amount = at / TOTAL; api.formed = at >= TOTAL;
      api.roomFade = ease((at - 0.5) / 1.4);
      group.visible = at > 0;
      if (!group.visible) return;
      WU.uSpread.value = R * spread + (spread >= 1 ? 1 : 0);
      U.uBuild.value = build >= 1 ? L + 1 : L * build;
      U.uTime.value = t;
      group.updateMatrixWorld();
      inv.copy(group.matrixWorld).invert();
      if (eye) WU.uEye.value.copy(local.copy(eye).applyMatrix4(inv));
      const fv = WU.uFeet.value;
      for (let i = 0; i < 8; i++) {
        const f = feet[i];
        if (f) { local.set(f.x, 0, f.z).applyMatrix4(inv); fv[i].set(local.x, local.z, f.s, 0); } else fv[i].set(0, 0, 0, 0);
      }
    }
  };
  return api;
}

// ---------- The Workshop's look at it: a small one forming, holding, and taking itself down, over and over ----------
export function build() {
  const d = makeHoloDome({ radius: 1.3, wall: 0.3, rise: 0.6, small: true });   // (a model of one, to look at)
  d.pictures({ walls: new URL('textures/sky_island.jpg', import.meta.url).href, walls2: new URL('textures/sky_island_nomoon.jpg', import.meta.url).href, night: [0.005, 0.02, 0.067] });
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false;
  let last = performance.now(), clock = 0;
  ticker.onBeforeRender = (r, s, cam) => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
    d.show(clock % 16 < 10);   // (formed for a while, then taken down, then again)
    d.update(dt, clock, cam.position, []);
  };
  const g = new THREE.Group();   // (the ticker stays outside the dome, so it keeps ticking while the dome's gone)
  g.add(d.group, ticker);
  return g;
}
// >>>>> END OF FILE: HangoutRoom/pieces/holodome.js <<<<<
