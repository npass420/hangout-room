// ===================================================================================================================
// Workshop/pieces/jewels.js: cut jewels set into a surface, each held in a polished gold bezel (a thin gold wall that
// wraps the stone's edge), as in the reference pictures.
//   Dark ruby: star cut like a real gem, drawn by a gem shader that follows light into the stone and round its facets
//   inside: deep dark crimson, darker at the edges, layered, with a low ember glowing from within that slowly breathes.
//   Onyx: a smooth full dome of jet black, polished to a mirror gloss.
// makeJewels(THREE, { size, materials, glowLayer, envCube }) gives back { crest, oval, orb, dome, RUBY, ONYX, group,
// update }
// (envCube: the room's reflection snapshot as a cube, which the rubies look out at through their facets):
//   orb(x, y, z, radius): a smooth round ruby, drawn by the same gem shader.
//   inlay(x, y, z, radius, { wide, low, rim, color }): a clear bright oval dome set on a surface, facing +z, a tiny light
//     glowing deep inside: color 'ruby' (red) or 'violet' (purple); in a thin gold rim (rim: false for none).
//   dome(x, z, y, radius, stone): a game piece: a perfectly smooth round dome with a flat bottom and no setting, a tiny
//     light deep inside lighting fine specks through it: J.RUBY (deep crimson) or J.ONYX (black, glowing dark black
//     light purple). Gives back { group, setKing(on) }: a king rises into a floating ball, glowing brighter.
//   crest(x, z, turn, y, grow): a large dark ruby kite crest in a smooth gold setting; turn points its long point
//     (0 = toward -z), grow sizes it.
//   oval(x, z, turn, y, stone, grow): an oval jewel lying along x (turned by turn), J.RUBY (cut) or J.ONYX (dome).
//   y is the surface they sit on; size scales them all; materials: a list to add their materials to (so they reflect
//   the room); glowLayer: the room's glow layer; update(seconds): call every frame.
// VERSION 35
// ===================================================================================================================
import { makeSounds } from './sounds.js';
export function makeJewels(THREE, { size = 1, materials = [], glowLayer = 1, envCube = null, listener = null } = {}) {
  const k = size, group = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8a64a, metalness: 1, roughness: 0.2, envMapIntensity: 0.78 });
  const RUBY = 'ruby';   // (which stone: the cut ruby is drawn by the gem shader below, one for each cut)
  const ONYX = new THREE.MeshPhysicalMaterial({
    color: 0x020203, roughness: 0.065, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 0.99
  });
  materials.push(gold, ONYX);

  // ---------- Outlines (in the flat, x across and y along; the shapes lie flat with y pointing toward -z) ----------
  const ovalOutline = (a, b, n = 20) => Array.from({ length: n }, (_, i) => { const t = i / n * Math.PI * 2; return [a * Math.cos(t), b * Math.sin(t)]; });

  // ---------- A cut gem over an outline: a short upright edge (the girdle), then a ring of facets rising to a flat table ----------
  function cutGem(outline, girdle, height, table) {
    const pos = [], n = outline.length;
    const P = (i, s, y) => { const [x, z] = outline[i % n]; return [x * s, y, -z * s]; };
    const tri = (a, b, c) => pos.push(...a, ...b, ...c);
    // a star cut: the girdle; a ring of points halfway up, set between the girdle's points; the table's ring, in line
    // with the girdle's; so the facets run as triangles and kites in turn, each tipped its own way
    const Pm = i => { const [x0, z0] = outline[i % n], [x1, z1] = outline[(i + 1) % n], s = 0.78;
      return [(x0 + x1) / 2 * s, girdle + (height - girdle) * 0.5, -(z0 + z1) / 2 * s]; };
    for (let i = 0; i < n; i++) {
      const g0 = P(i, 1, 0), g1 = P(i + 1, 1, 0), u0 = P(i, 1, girdle), u1 = P(i + 1, 1, girdle);
      const mPrev = Pm(i + n - 1), m = Pm(i), t0 = P(i, table, height), t1 = P(i + 1, table, height), top = [0, height, 0];
      tri(g0, u1, u0); tri(g0, g1, u1);         // the girdle
      tri(u0, u1, m);                           // lower facets, pointing up
      tri(mPrev, m, u0);                        // ... and the ones between, pointing down
      tri(mPrev, m, t0);                        // upper facets, pointing up to the table
      tri(t0, m, t1);                           // ... and the ones between
      tri(t0, t1, top);                         // the table
    }
    // make every face point outward and up (the girdle out, the facets out and up, the table up), whichever way round
    // the outline runs
    for (let j = 0; j < pos.length; j += 9) {
      const A = pos.slice(j, j + 3), B = pos.slice(j + 3, j + 6), C = pos.slice(j + 6, j + 9);
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
      const cx = (A[0] + B[0] + C[0]) / 3, cz = (A[2] + B[2] + C[2]) / 3;
      if (nx * cx + ny * 0.01 + nz * cz < 0) for (let q = 0; q < 3; q++) { const t = pos[j + 3 + q]; pos[j + 3 + q] = pos[j + 6 + q]; pos[j + 6 + q] = t; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }


  // ---------- The ruby's gem shader ----------
  // A ruby is drawn as light really passes through a cut stone. Where you look at a facet, a little light reflects off
  // its polish; the rest goes in, bending as it enters. Inside, it travels to the far side of the stone, where it meets
  // a facet from within: some leaves (bending again, showing what's out there, in the room), the rest bounces back
  // inside, and so on (four times over). The red comes from the stone soaking up the other colors the further the
  // light travels through it, so thick parts and long paths come out deep dark crimson and the thin edges darker
  // still; and an ember glows within the stone itself, building up along the way, so the glow comes from inside.
  // The stone's shape is known exactly: the faces of its cut, plus the hidden lower half under the setting (facets
  // meeting in a point below), every one a flat plane, so the light can be followed inside without guessing.
  const MAX_PLANES = 128;
  const gemShared = {   // (shared by every ruby)
    absorb: { value: new THREE.Vector3(5, 90, 80) },   // how strongly the stone soaks up red, green, blue, per meter
    glowColor: { value: new THREE.Color() },
    glow: { value: 0.3 },
    envIntensity: { value: 1.32 },
    envMap: { value: envCube },
    ior: { value: 1.77 },                               // (a ruby's: how much it bends light)
    cap: { value: 100 }                                 // (the brightest it may be anywhere: no limit, unless a stone sets its own)
  };
  const gemVertex = `
    varying vec3 vPos; varying vec3 vCam;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vPos = position;
      vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`;
  const gemFragment = `
    uniform vec4 planes[${MAX_PLANES}]; uniform int planeCount;
    uniform samplerCube envMap; uniform float envIntensity; uniform vec3 absorb;
    uniform vec3 glowColor; uniform float glow; uniform float ior; uniform float cap;
    #ifdef DOME
      uniform float cut;     // (where a dome's flat bottom is: 0 a dome, down to -DOME a whole ball, as a king)
      uniform float boost;   // (how much brighter its light is: 1, and more as a king)
      uniform float heat;    // (0, up to 1 as it's struck: the whole stone glowing white hot)
      uniform float specks;  // (1: the glittering specks inside; 0: none, a clear stone)
      uniform float backing; // (0: its flat bottom lets light through; more: it's set on something that throws light back up)
      uniform vec3 backTint; // (the color that light comes back up as)
    #endif
    uniform mat4 modelMatrix;
    varying vec3 vPos; varying vec3 vCam;
    #include <common>
    #include <logdepthbuf_pars_fragment>
    vec3 room(vec3 dObj) { return textureCube(envMap, normalize(mat3(modelMatrix) * dObj)).rgb * envIntensity; }
    float fresnel(float c, float f0) { return f0 + (1.0 - f0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }
    vec3 hash3(vec3 q) { q = fract(q * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
    void main() {
      #include <logdepthbuf_fragment>
      vec3 rd = normalize(vPos - vCam);
      #if defined(ORB)
        vec3 n = normalize(vPos);                                  // (a smooth round stone)
      #elif defined(DOME)
        if (vPos.y < cut - DOME * 0.001) discard;                                   // (the ball below the flat bottom)
        vec3 n = vPos.y < cut + DOME * 0.002 ? vec3(0.0, -1.0, 0.0) : normalize(vPos);   // (a dome: round top, flat bottom)
      #else
        vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));         // (a cut stone: each facet flat)
      #endif
      if (dot(n, rd) > 0.0) n = -n;
      float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
      float F = fresnel(dot(-rd, n), f0);
      vec3 colour = room(reflect(rd, n)) * F;          // the polish
      vec3 d = refract(rd, n, 1.0 / ior), p = vPos;
      vec3 through = vec3(1.0), inside = vec3(0.0);
      for (int bounce = 0; bounce < 5; bounce++) {
        float tMin = 1e9; vec3 nOut = vec3(0.0, 1.0, 0.0); bool back = false;
        #if defined(ORB)
          float b = dot(p, d), c = dot(p, p) - ORB * ORB, h = b * b - c;   // (where the ray inside meets the round surface)
          if (h > 0.0) { tMin = -b + sqrt(h); nOut = normalize(p + d * tMin); }
        #elif defined(DOME)
          float b = dot(p, d), c = dot(p, p) - DOME * DOME, h = b * b - c;   // (the round top...)
          if (h > 0.0) { tMin = -b + sqrt(h); nOut = normalize(p + d * tMin); }
          if (d.y < -1e-5) {                                                  // (...or the flat bottom, if it's nearer)
            float tb = (cut - p.y) / d.y;
            if (tb > 1e-6 && tb < tMin) { tMin = tb; nOut = vec3(0.0, -1.0, 0.0); back = true; }
          }
        #else
        for (int i = 0; i < ${MAX_PLANES}; i++) {
          if (i >= planeCount) break;
          float dn = dot(d, planes[i].xyz);
          if (dn > 1e-5) {
            float t = (planes[i].w - dot(p, planes[i].xyz)) / dn;
            if (t > 1e-6 && t < tMin) { tMin = t; nOut = planes[i].xyz; }
          }
        }
        #endif
        if (tMin > 1e8) break;
        #ifdef DOME
          vec3 soak = exp(-absorb * DENSE * 0.6 * tMin);   // (a dome's color set by its own size: clear deep crimson)
        #else
          vec3 soak = exp(-absorb * tMin);
        #endif
        #ifdef DOME
          // a dome's light: one tiny point of light deep inside, low in the middle. Along each stretch of the path inside,
          // add the light that point sheds onto it (bright where the path passes close, falling off with distance), dimmed
          // by the red it passes through on its way out: a hot pinpoint with a faint haze round it.
          vec3 C = vec3(0.0, 0.3 * (DOME + cut), 0.0);   // (low in a dome; drifting to the very middle as it becomes a ball)
          float s0 = dot(C - p, d);
          float r0 = max(length((C - p) - d * s0), 0.004 * DOME);
          float seen = (atan((tMin - s0) / r0) - atan(-s0 / r0)) / r0;
          inside += through * glowColor * glow * boost * exp(-absorb * DENSE * r0) * seen * DOME * 0.012;
          // the specks: fine glittering specks set through the stone (about one in every other small cell of it), each
          // lit by the light (brighter near it, dimmer and redder farther out), seen where this stretch of the path passes
          float cell = DOME / 9.0; vec3 last = vec3(1e5);
          for (int j = 0; j < 36; j++) {
            float t = (float(j) + 0.5) / 36.0 * tMin;
            vec3 cc = floor((p + d * t) / cell);
            if (cc == last) continue;
            last = cc;
            vec3 hs = hash3(cc);
            if (hs.x > 0.5) continue;
            vec3 sp = (cc + 0.15 + 0.7 * hash3(cc + 17.0)) * cell;   // (where in its cell the speck sits)
            if (sp.y < cut || dot(sp, sp) > DOME * DOME * 0.9) continue;
            float dd = length(cross(sp - p, d)) / (0.01 * DOME * (0.6 + hs.y));
            float toLight = length(sp - C);
            float lit = DOME * DOME / max(toLight * toLight, 0.01 * DOME * DOME);
            inside += through * exp(-absorb * DENSE * 0.6 * (t + toLight)) * glowColor * glow * boost * lit * exp(-dd * dd) * 0.5 * specks;
          }
        #else
          inside += through * glowColor * glow * (1.0 - exp(-tMin * 60.0));   // the ember, building along the way
        #endif
        through *= soak;
        p += d * tMin;
        vec3 leave = refract(d, -nOut, ior);
        float Fi = dot(leave, leave) < 1e-6 ? 1.0 : fresnel(dot(d, nOut), f0);
        #ifdef DOME
          if (back && backing > 0.0) { Fi = 1.0; through *= backing * backTint; }   // (light bounced back up, in the stone's color)
        #endif
        if (Fi < 1.0) inside += through * (1.0 - Fi) * room(leave);
        through *= Fi;
        d = reflect(d, -nOut);
        if (max(through.r, max(through.g, through.b)) < 0.01) break;
      }
      colour += (1.0 - F) * inside;
      #ifdef DOME
        colour = mix(colour, vec3(3.0), heat * heat);   // (struck: white hot, into the bloom)
      #endif
      colour = min(colour, vec3(cap));   // (a small stone kept from flaring: tiny overbright glints flicker in the glow as you move)
      gl_FragColor = vec4(colour, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  // the flat planes of a cut stone: its own faces, plus a hidden lower half drawn to a point below
  function gemPlanes(geo, outline, below) {
    const pos = geo.attributes.position.array, seen = new Set(), planes = [];
    const add = (nx, ny, nz, w) => {
      const key = [nx, ny, nz].map(v => Math.round(v * 500)).join() + ':' + Math.round(w * 1e5);
      if (seen.has(key)) return;
      seen.add(key); planes.push(new THREE.Vector4(nx, ny, nz, w));
    };
    for (let j = 0; j < pos.length; j += 9) {
      const A = new THREE.Vector3(pos[j], pos[j + 1], pos[j + 2]), B = new THREE.Vector3(pos[j + 3], pos[j + 4], pos[j + 5]), C = new THREE.Vector3(pos[j + 6], pos[j + 7], pos[j + 8]);
      const nrm = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
      if (nrm.lengthSq() < 1e-20) continue;
      nrm.normalize();
      add(nrm.x, nrm.y, nrm.z, nrm.dot(A));
    }
    const culet = new THREE.Vector3(0, -below, 0), mid = new THREE.Vector3(0, -below / 3, 0);
    outline.forEach((pt, i) => {   // the hidden lower facets, one under each edge of the outline
      const [x0, z0] = pt, [x1, z1] = outline[(i + 1) % outline.length];
      const A = new THREE.Vector3(x0, 0, -z0), B = new THREE.Vector3(x1, 0, -z1);
      const nrm = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(culet, A)).normalize();
      if (nrm.dot(new THREE.Vector3().subVectors(A, mid)) < 0) nrm.negate();
      add(nrm.x, nrm.y, nrm.z, nrm.dot(A));
    });
    while (planes.length < MAX_PLANES) planes.push(new THREE.Vector4(0, 0, 0, 0));
    return planes.slice(0, MAX_PLANES);
  }
  function gemMaterial(geo, outline, below, orbRadius = 0, domeRadius = 0, own = {}) {   // (own: uniforms of its own,
                                                                                          // e.g. a color unlike the rubies')   // (orbRadius / domeRadius: a smooth round
    const smooth = orbRadius || domeRadius;                                    // stone or dome of that size instead)
    const planes = smooth ? Array.from({ length: MAX_PLANES }, () => new THREE.Vector4()) : gemPlanes(geo, outline, below);
    const used = planes.findIndex(p => p.lengthSq() === 0);
    const m = new THREE.ShaderMaterial({
      uniforms: { ...gemShared, ...own, planes: { value: planes }, planeCount: { value: used < 0 ? MAX_PLANES : used } },
      vertexShader: gemVertex, fragmentShader: gemFragment,
      defines: orbRadius ? { ORB: orbRadius.toFixed(6) }
             : domeRadius ? { DOME: domeRadius.toFixed(6), DENSE: (0.05 * k * depth / domeRadius).toFixed(6) } : {}
    });
    m.isGem = true;
    // (the room's reflection snapshot turns reflections off while it's taken, and back on after: for the gem shader
    // that means looking at the room's own snapshot, or at nothing while the snapshot is being taken)
    Object.defineProperty(m, 'envMap', { get: () => gemShared.envMap.value, set: v => { gemShared.envMap.value = v ? envCube : null; } });
    materials.push(m);
    return m;
  }

  // ---------- A gold bezel round an outline: a thin wall standing round the stone's edge ----------
  function bezel(outline, wall, height) {
    const shape = new THREE.Shape(), hole = new THREE.Path();
    const grow = (x, y) => { const l = Math.hypot(x, y) || 1; return [x + x / l * wall, y + y / l * wall]; };
    outline.forEach(([x, y], i) => { const [X, Y] = grow(x, y); i ? shape.lineTo(X, Y) : shape.moveTo(X, Y); });
    shape.closePath();
    [...outline].reverse().forEach(([x, y], i) => (i ? hole.lineTo(x, y) : hole.moveTo(x, y)));
    hole.closePath();
    shape.holes.push(hole);
    const b = wall * 0.35;
    const g = new THREE.ExtrudeGeometry(shape, { depth: height - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.6, bevelSegments: 3 });
    g.translate(0, 0, -height + b);
    g.rotateX(-Math.PI / 2);   // (top at y = 0, the outline's y running toward -z, like the gems)
    return g;
  }

  // ---------- The pieces, made once and shared ----------
  // the crest, as in its reference picture: a kite of ruby, wide shoulders drawn down to a long point, a low peak at the
  // back; held in a smooth gold setting
  const CL = 0.058 * k;                                 // the crest's half length
  const KITE = [[0, 1], [0.24, 0.62], [0.46, 0.2], [0.62, -0.28], [0.52, -0.58], [0.26, -0.78], [0, -0.92],
                [-0.26, -0.78], [-0.52, -0.58], [-0.62, -0.28], [-0.46, 0.2], [-0.24, 0.62]];
  const crestOutline = KITE.map(([x, y]) => [x * CL, y * CL]);
  const crestGeo = cutGem(crestOutline, 0.004 * k, 0.019 * k, 0.42);
  const crestGem = gemMaterial(crestGeo, crestOutline, 0.04 * k);
  const crestBezel = bezel(crestOutline, 0.003 * k, 0.0085 * k);
  const OA = 0.021 * k, OB = 0.013 * k;                 // the ovals: half length, half width
  const ovalOutline1 = ovalOutline(OA, OB);
  const rubyOvalGeo = cutGem(ovalOutline1, 0.0025 * k, 0.0095 * k, 0.55);
  const ovalGem = gemMaterial(rubyOvalGeo, ovalOutline1, 0.018 * k);
  const onyxDomeGeo = new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const ovalBezel = bezel(ovalOutline1, 0.0022 * k, 0.0042 * k);

  const shine = m => { if (m.material.isGem) m.layers.enable(glowLayer); return m; };   // (rubies shine into the bloom)
  const place = (mesh, x, z, turn, y) => { mesh.position.set(x, y, z); mesh.rotation.y = turn; group.add(shine(mesh)); return mesh; };
  // a ruby set on a surface: a smooth oval dome of clear, bright crimson (after their Kindroid picture). Light goes deep
  // into it and bounces back up off what it sits on, so it glows vivid red from within rather than looking dark; a tiny
  // warm light sits low in its middle with a fine dusting of glitter round it catching the light; its polished top
  // shines like glass. It's kept from flaring (tiny overbright glints flicker in the glow as you move). It lies facing +z
  // (lay it on anything by turning the group it's put in); x, y, z is the middle of its flat bottom. wide: how much wider
  // than tall it is; low: how far it rises, as a share of its height; rim: a thin gold rim round it, or none.
  // color: 'ruby' (clear crimson) or 'violet' (clear purple, glowing a deep black light purple, to go with the onyx)
  function inlay(x, y, z, radius, { wide = 1.6, low = 0.6, rim = true, color = 'ruby', parent = group } = {}) {
    const RISE = radius * low * 2;                                   // (about the farthest light goes through it)
    const violet = color === 'violet';
    const c = violet ? [0.5, 0.05, 0.9] : [0.9, 0.06, 0.05];         // (the color light comes out after crossing it once)
    const DENSE = 0.05 * k * depth / radius;                         // (the shader's own measure for a dome this size)
    const own = { cut: { value: 0 }, boost: { value: 1.1 }, heat: { value: 0 }, specks: { value: 0.35 }, cap: { value: 2.4 },
      backing: { value: 0.85 }, envIntensity: { value: 0.95 },   // (a gentle shine: the room's bright glints kept from streaking through it)
      backTint: { value: violet ? new THREE.Vector3(0.75, 0.35, 1) : new THREE.Vector3(1, 0.45, 0.4) },
      glowColor: { value: violet ? new THREE.Color(0.45, 0.08, 1.0) : gemShared.glowColor.value },
      absorb: { value: new THREE.Vector3(...c.map(v => -Math.log(v) / (RISE * DENSE * 0.6))) } };
    const mat = gemMaterial(null, null, 0, 0, radius, own);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const stone = new THREE.Group();
    stone.rotation.x = Math.PI / 2;            // (the dome's top facing out, along +z)
    stone.scale.set(wide, low, 1);             // (wide across, low out from the surface)
    stone.add(shine(new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2), mat)));
    stone.add(shine(new THREE.Mesh(new THREE.CircleGeometry(radius, 96).rotateX(Math.PI / 2), mat)));
    g.add(stone);
    if (rim) {   // (its thin gold rim, unless it sits straight on the surface)
      const r = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.04, radius * 0.09, 12, 96), gold);
      r.scale.set(wide, 1, 1);
      g.add(r);
    }
    parent.add(g);
    return g;
  }
  function orb(x, y, z, radius) {   // a smooth round ruby, its middle at x, y, z
    const geo = new THREE.SphereGeometry(radius, 64, 40);
    const m = new THREE.Mesh(geo, gemMaterial(null, null, 0, radius));
    m.position.set(x, y, z);
    group.add(shine(m));
    return m;
  }
  // a game piece: a perfectly smooth round dome, flat bottomed, no setting, sitting on y. It gives back:
  //   setKing(on): crowns it: it rises out of its square, its flat bottom growing round as it lifts, into a whole glowing
  //     ball floating an inch up, bobbing and slowly rocking, its light brighter and shining on the board (or sets back).
  //   moveTo(x, z, over): glides it to x, z (a promise, done when it lands). over: a piece it captures on the way. A
  //     plain piece lifts, arcs up to hover over it, blasts it with a laser, then glides down onto its new square; a king
  //     flies straight across, beaming the whole time it's over it. Without over, just the glide.
  //   The laser leaves glowing burn marks on the surface that cool to a dark scorch and fade.
//   blast(): it heats up to glowing white, then explodes in a burst of sparks of its own color.  restore(): it grows back.
  const FLOAT = 0.0254;     // (a king floats an inch off the surface)
  const RISE = 1.6;         // (seconds to rise as a king)
  const domes = [];
  const sfx = makeSounds(THREE, listener);
  let glowTex = null;
  function glowDot() {      // a soft round glow picture, for where the laser hits and for the sparks
    if (glowTex) return glowTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return (glowTex = new THREE.CanvasTexture(c));
  }
  function dome(x, z, y, radius, stone) {
    const own = stone === RUBY ? {} : onyxGlow();
    own.cut = { value: 0 }; own.boost = { value: 1 }; own.heat = { value: 0 }; own.specks = { value: 1 }; own.backing = { value: 0 }; own.backTint = { value: new THREE.Vector3(1, 1, 1) };
    const mat = gemMaterial(null, null, 0, 0, radius, own);
    const color = (own.glowColor || gemShared.glowColor).value;
    const ball = new THREE.SphereGeometry(radius, 128, 64);
    const SEG = 128, bottom = new THREE.CircleGeometry(1, SEG).rotateX(Math.PI / 2);   // (re-shaped as the bottom moves)
    const unit = bottom.attributes.position.array.slice();
    const d = new THREE.Group();
    d.add(shine(new THREE.Mesh(ball, mat)), shine(new THREE.Mesh(bottom, mat)));
    const light = new THREE.PointLight(color, 0, 0.35, 2);
    d.add(light);   // (a king's light on the board below)
    d.position.set(x, y, z);
    group.add(d);

    // the laser: a bright core inside a softer glow, straight down from the stone to the surface, and a glowing dot
    // where it hits; all in the stone's own color, shining into the bloom, flickering
    const glowOf = (opacity, white) => new THREE.MeshBasicMaterial({
      color: color.clone().lerp(new THREE.Color(1, 1, 1), white).multiplyScalar(3), transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, -0.5, 0);   // (hangs down from its top)
    const beamOuter = new THREE.Mesh(beamGeo, glowOf(0.35, 0)), beamCore = new THREE.Mesh(beamGeo, glowOf(0.9, 0.55));
    const spot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowDot(), color: color.clone().multiplyScalar(4), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const laser = new THREE.Group();
    laser.add(beamOuter, beamCore, spot);
    laser.traverse(o => { o.layers.enable(glowLayer); o.userData.noShadow = true; });   // (light itself casts no shadow)
    laser.visible = false;
    group.add(laser);

    // the burn marks the laser leaves on the surface: each starts glowing hot in the stone's color, cools to a dark
    // scorch, and fades away (a handful at a time, reused in turn)
    const MARKS = 48, MARK_LIFE = 4, marks = [];
    const markGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < MARKS; i++) {
      const scorch = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ map: glowDot(), color: 0x000000, transparent: true,
        opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
      const hot = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ map: glowDot(), color: color.clone().multiplyScalar(3),
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2 }));
      hot.layers.enable(glowLayer);
      scorch.userData.noShadow = hot.userData.noShadow = true;
      scorch.visible = hot.visible = false;
      group.add(scorch, hot);
      marks.push({ scorch, hot, born: -1e9 });
    }
    let nextMark = 0, lastMark = null;
    function burn(t, mx, mz) {   // leave a mark here, if the dot has moved on a little (or held still a while) since the last
      if (lastMark && Math.hypot(mx - lastMark.x, mz - lastMark.z) < radius * 0.07 && t - lastMark.t < 0.25) return;
      const m = marks[nextMark]; nextMark = (nextMark + 1) % MARKS;
      const sz = radius * (0.35 + 0.15 * Math.random());
      for (const o of [m.scorch, m.hot]) { o.position.set(mx, y + 0.0004, mz); o.scale.setScalar(sz); o.rotation.y = Math.random() * 6.3; o.visible = true; }
      m.hot.position.y = y + 0.0006;
      m.born = t; lastMark = { x: mx, z: mz, t };
    }
    function cool(t) {
      for (const m of marks) {
        if (!m.scorch.visible) continue;
        const u = (t - m.born) / MARK_LIFE;
        if (u >= 1) { m.scorch.visible = m.hot.visible = false; continue; }
        m.hot.material.opacity = Math.max(0, 1 - u * 3.2) ** 1.5;       // (glowing hot, cooling fast)
        m.scorch.material.opacity = 0.6 * Math.min(1, u * 6) * (1 - u);   // (the dark scorch, lasting longer)
      }
    }

    // the sparks it bursts into when blasted
    const SPARKS = 320, sparkPos = new Float32Array(SPARKS * 3), sparkVel = [];
    const sparkGeo = new THREE.BufferGeometry(); sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({ map: glowDot(), color: color.clone().multiplyScalar(4), size: radius * 0.12,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.layers.enable(glowLayer); sparks.visible = false; sparks.frustumCulled = false;
    group.add(sparks);

    let king = 0, goal = 0, was = null, bx = x, bz = z, move = null, hit = null, grow = null, burstAt = null;
    // its sounds (made in code: see sounds.js), from where it is; the onyx a little deeper than the ruby
    const PITCH = stone === RUBY ? 1 : 0.8;
    let zapping = null, humming = null, kingWas = 0, phase = '';
    const sound = (name, o = {}) => sfx.play(name, d, { pitch: PITCH, ...o });
    function shape(c) {   // the flat bottom: a round disc where the slice crosses the ball
      const r = Math.sqrt(Math.max(radius * radius - c * c, 0)), pos = bottom.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, unit[i * 3] * r, c, unit[i * 3 + 2] * r);
      pos.needsUpdate = true; bottom.computeBoundingSphere();
    }
    shape(0);
    const ease = u => { u = Math.min(Math.max(u, 0), 1); return u * u * (3 - 2 * u); };
    const piece = {
      group: d,
      get king() { return goal === 1; },
      setKing(on = goal === 0) { goal = on ? 1 : 0; },
      moveTo(tx, tz, over = null) {
        const target = over ? { piece: over, ...over.place() } : null;
        return new Promise(done => { move = { x0: bx, z0: bz, x1: tx, z1: tz, over: target, start: null, done, struck: false }; });
      },
      blast() { hit = { start: null }; },
      restore() { hit = null; grow = { start: null }; d.visible = true; },
      tick(t) {
        const dt = was === null ? 0 : Math.min(t - was, 0.1); was = t;
        if (goal !== kingWas) {   // crowned (a rising chime and a floating hum), or set down
          kingWas = goal;
          sound(goal ? 'rise' : 'settle');
          if (goal && !humming) humming = sound('hum', { loop: true });
          if (!goal && humming) { humming.stop(); humming = null; }
        }
        king += Math.sign(goal - king) * Math.min(Math.abs(goal - king), dt / RISE);
        const e = ease(king);
        const c = -radius * e;
        if (c !== own.cut.value) { own.cut.value = c; shape(c); }

        // where it is: resting on its square, or on its way somewhere
        let px = bx, pz = bz, lift = 0, beam = false;
        if (move) {
          const m = move;
          const first = m.start === null;
          if (first) m.start = t;
          const u = t - m.start, dist = Math.hypot(m.x1 - m.x0, m.z1 - m.z0);
          let finished = false;
          if (goal === 1) {   // a king: straight across at a steady glide, rising a little, beaming while over its target
            const T = Math.max(1.2, dist / (radius * 5)), f = ease(u / T);
            if (first) sound('glide', { length: T });
            px = m.x0 + (m.x1 - m.x0) * f; pz = m.z0 + (m.z1 - m.z0) * f;
            lift = radius * 0.5 * Math.sin(Math.PI * Math.min(u / T, 1));
            if (m.over) {
              const gap = Math.hypot(px - m.over.x, pz - m.over.z);
              beam = gap < radius * 1.3;
              if (!m.struck && gap < radius * 0.35) { m.struck = true; m.over.piece.blast(); }
            }
            finished = u >= T;
          } else if (m.over) {   // a plain piece capturing: up and over to hover above it, blast, then down beyond it
            const UP = 0.8, HOLD = 0.45, DOWN = 0.8, APEX = radius * 2.2;   // (it fires, then lands as its target burns)
            const ox = m.over.x, oz = m.over.z;
            if (first) sound('glide', { length: UP });
            if (u >= UP + HOLD && phase !== 'down') { phase = 'down'; sound('glide', { length: DOWN }); }
            if (u < UP) { const f = ease(u / UP); px = m.x0 + (ox - m.x0) * f; pz = m.z0 + (oz - m.z0) * f; lift = APEX * Math.sin(Math.PI / 2 * u / UP); }
            else if (u < UP + HOLD) { px = ox; pz = oz; lift = APEX + radius * 0.06 * Math.sin((u - UP) * 9); beam = (u - UP) > 0.1; }
            else { const f = ease((u - UP - HOLD) / DOWN); px = ox + (m.x1 - ox) * f; pz = oz + (m.z1 - oz) * f; lift = APEX * Math.cos(Math.PI / 2 * Math.min((u - UP - HOLD) / DOWN, 1)); }
            if (!m.struck && u > UP + 0.12) { m.struck = true; m.over.piece.blast(); }
            finished = u >= UP + HOLD + DOWN;
          } else {   // a plain move: a low glide up and over onto the next square
            const T = 1.0, f = ease(u / T);
            if (first) sound('glide', { length: T });
            px = m.x0 + (m.x1 - m.x0) * f; pz = m.z0 + (m.z1 - m.z0) * f;
            lift = radius * 1.2 * Math.sin(Math.PI * Math.min(u / T, 1));
            finished = u >= T;
          }
          if (finished) { bx = m.x1; bz = m.z1; px = bx; pz = bz; lift = 0; move = null; phase = ''; if (!goal) sound('land'); m.done(); }
        }

        // a king rocks and drifts gently as it floats
        const bob = e * 0.004 * Math.sin(t * 2.1);
        d.position.set(px + e * radius * 0.04 * Math.sin(t * 0.43), y + e * (radius + FLOAT) + bob + lift, pz + e * radius * 0.04 * Math.sin(t * 0.37 + 1));
        d.rotation.set(e * 0.07 * Math.sin(t * 0.71), 0, e * 0.06 * Math.sin(t * 0.53 + 1.3));

        // being blasted: it heats up to glowing white, then explodes in a burst of sparks of its own color
        let heat = 0, size = 1;
        const HEAT = 1.0;   // (seconds glowing white before it bursts)
        if (hit) {
          if (hit.start === null) { hit.start = t; sound('heat'); }
          const u = t - hit.start;
          heat = ease(u / HEAT);
          if (u >= HEAT && !hit.burst) {   // the burst: the stone gone at once, sparks flying out from all through it
            hit.burst = t; burstAt = t; d.visible = false; sound('boom'); sparks.visible = true; sparkVel.length = 0;
            for (let i = 0; i < SPARKS; i++) {
              const a = Math.random() * Math.PI * 2, up = Math.random() * 1.2 - 0.2, sp = radius * (4 + Math.random() * 9);
              const r2 = Math.sqrt(Math.max(1 - up * up, 0)), at = Math.random() * radius * 0.8;
              sparkVel.push([Math.cos(a) * r2 * sp, Math.abs(up) * sp, Math.sin(a) * r2 * sp]);
              sparkPos.set([d.position.x + Math.cos(a) * r2 * at, d.position.y + radius * 0.3, d.position.z + Math.sin(a) * r2 * at], i * 3);
            }
          }
        }
        if (burstAt !== null) {   // the sparks fly on, whatever the stone does next
          const b = t - burstAt;
          for (let i = 0; i < SPARKS; i++) {
            const v = sparkVel[i];
            v[0] *= 1 - 1.2 * dt; v[2] *= 1 - 1.2 * dt; v[1] -= radius * 22 * dt;
            sparkPos[i * 3] += v[0] * dt; sparkPos[i * 3 + 1] = Math.max(y, sparkPos[i * 3 + 1] + v[1] * dt); sparkPos[i * 3 + 2] += v[2] * dt;
          }
          sparkGeo.attributes.position.needsUpdate = true;
          sparkMat.opacity = 1 - ease(b / 1.6);
          sparkMat.size = radius * (0.16 - 0.08 * Math.min(b / 1.6, 1));
          if (b > 1.6) { sparks.visible = false; burstAt = null; }
        }
        if (!hit && grow) {   // growing back
          if (grow.start === null) grow.start = t;
          size = ease((t - grow.start) / 0.5);
          if (t - grow.start > 0.5) grow = null;
        }
        own.heat.value = d.visible ? heat : 0;
        d.scale.setScalar(Math.max(size, 0.0001));
        own.boost.value = (1 + 1.2 * e) * (1 + 3 * heat);
        light.intensity = 0.004 * e;
        light.position.y = c - 0.005;

        // the laser: from the stone's underside straight down to the surface, flickering
        laser.visible = beam;
        if (beam && !zapping) zapping = sound('zap', { loop: true });
        if (!beam && zapping) { zapping.stop(); zapping = null; }
        if (beam) {
          const top = d.position.y + c, L = Math.max(top - y, 0.001);
          const fl = 1 + 0.18 * Math.sin(t * 43) + 0.1 * Math.sin(t * 71);
          laser.position.set(d.position.x, 0, d.position.z);
          beamOuter.position.y = beamCore.position.y = top;
          beamOuter.scale.set(radius * 0.11 * fl, L, radius * 0.11 * fl);
          beamCore.scale.set(radius * 0.035, L, radius * 0.035);
          spot.position.y = y + 0.0008;
          spot.scale.setScalar(radius * 0.9 * fl);
          burn(t, d.position.x, d.position.z);
        }
        cool(t);
      }
    };
    piece.place = () => ({ x: bx, z: bz });
    domes.push(piece);
    return piece;
  }
  // the onyx dome: black stone with the same tiny light and specks inside, glowing a dark purple, like black light.
  // (the light passing through it soaks up almost everything but a dim violet)
  function onyxGlow() {
    const STONE = [0.05, 0.004, 0.12];   // (the color light comes out after crossing the stone: near black, a hint of violet)
    const LEN = 0.05 * k * depth;
    return { absorb: { value: new THREE.Vector3(...STONE.map(v => -Math.log(v) / LEN)) },
             glowColor: { value: new THREE.Color(0.38, 0.06, 1.0) } };   // (the glow: deep black light purple)
  }
  function crest(x, z, turn, y, grow = 1) {
    const c = new THREE.Group();   // (built facing -z, then turned and set in place as one)
    c.add(shine(new THREE.Mesh(crestGeo, crestGem)));
    c.children[0].position.y = -0.0015 * k;
    const b = new THREE.Mesh(crestBezel, gold); b.position.y = 0.0065 * k; c.add(b);
    c.position.set(x, y, z); c.rotation.y = turn; c.scale.setScalar(grow);
    group.add(c);
  }
  function oval(x, z, turn, y, stone, grow = 1) {
    if (stone === RUBY) place(new THREE.Mesh(rubyOvalGeo, ovalGem), x, z, turn, y - 0.001 * k).scale.set(grow, grow, grow);
    else place(new THREE.Mesh(onyxDomeGeo, ONYX), x, z, turn, y - 0.0012 * k).scale.set(OA * grow, OB * 0.75 * grow, OB * grow);
    place(new THREE.Mesh(ovalBezel, gold), x, z, turn, y + 0.003 * k).scale.set(grow, grow, grow);
  }
  let ember = 0.5;   // the rubies' glow, at its middle
  // the rubies' color: the dark crimson of the checkerboard's red marble (hue, how strong the red, how light), the
  // inner glow the same red a little lighter
  const shade = { hue: 0.986, strength: 1, light: 0.25 };
  let depth = 2;   // how far through the stone light goes before it's that color (more: a clearer, lighter stone)
  function paint() {
    // the color light comes out after passing through the stone (about across its middle), turned into how strongly it
    // soaks up each of red, green and blue: red passes almost freely (that's a ruby's rich red), the rest is soaked up;
    // the ember the same red, a little lighter
    const c = new THREE.Color().setHSL(shade.hue, shade.strength, shade.light, THREE.SRGBColorSpace);
    const LEN = 0.05 * k * depth;
    gemShared.absorb.value.set(...[c.r, c.g, c.b].map(v => -Math.log(Math.max(v, 1e-4)) / LEN));
    gemShared.glowColor.value.setHSL(shade.hue, Math.min(1, shade.strength + 0.15), Math.min(0.5, shade.light * 1.35), THREE.SRGBColorSpace);
  }
  paint();
  function update(t) {   // the rubies' ember breathes slowly (calm, barely there); the pieces rise and float
    gemShared.glow.value = ember * (1 + 0.23 * Math.sin(t * 1.3) + 0.07 * Math.sin(t * 3.1));
    for (const p of domes) p.tick(t);
  }
  return { crest, oval, orb, dome, inlay, RUBY, ONYX, group, update };
}
// ===================================================================================================================
// END OF Workshop/pieces/jewels.js
// ===================================================================================================================
