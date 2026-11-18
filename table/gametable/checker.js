// ===================================================================================================================
// >>>>> START OF FILE 1 of 1: Workshop/pieces/checker.js <<<<<
// Workshop/pieces/checker.js: the checker's look, after the Kindroid reference: a game piece made of
//   the disc: a thick round disc of black onyx with a softly rounded edge, its top polished near to a mirror (it
//     faintly reflects the jewel's glowing insides, a true mirror image that moves as you look round) and its sides
//     duller and finely grained
//   the seat: a thin black ring the jewel is set into
//   the jewel: a dome of smoky dark glass (real see-through glass, deeper colored the thicker it is), a little taller
//     than half a ball, with inside it: a glowing core (a hot white heart), a dense cloud of fine glitter round the
//     core, crystal chips floating at different depths, and dark smoky patches below
//   the glow: the core's light spilling softly onto the onyx round the jewel
// Two kinds of disc (stone): 'onyx', solid jet black whose polished top shows the jewel's reflection, or 'obsidian',
// smoked black glass you can see down into. Two jewels (gem): 'crimson' or 'violet'. The inside moves, slowly: the
// glitter cloud drifts round the core, the chips circle the other way, slower, bobbing gently.
// Crowned (setMorph, 0 to 1): the whole piece melts into a glowing glass orb: the jewel swells into a full ball, its
// insides growing with it and glowing brighter, while the onyx disc draws in round it into a polished black band
// round the orb's middle. The orb sits on y = 0 (whatever lifts it, floats it).
// Struck (setHeat, 0 to 1): the onyx and the glass glow up to white hot.
// makeChecker(THREE, show, { size, stone, gem, light, cache }) gives back { group, materials, update, setMorph, setHeat,
// color, ORB, HEIGHT, dispose }; the group stands on y = 0, centered; size is the disc's width in meters (a checkers
// square on the game table is about 10 cm). light: a real light spilling onto the onyx (true), or a drawn glow there
// instead (false: what the game uses, as a light per piece would slow the room). cache: an object shared by a set of
// pieces, so they make their pictures once between them. ORB: the crowned orb's radius; HEIGHT: the piece's height.
// VERSION 6
// ===================================================================================================================
const GEMS = {   // each jewel's colors: the glass's depth color, the floor inside, the glitter, the chips, the core, its glow and light
  crimson: { deep: 0xb0101c, floor: ['#6a0710', '#2c0306', '#0c0102'], speck: [255, 50, 40], speckLift: 120,
             chip: [0.75, 0.05, 0.04], chipBlue: 0, heart: 0xfff2b0, halo: 0xff1a10, spill: 0xff1a12, glint: [1, 0.12, 0.08], hot: [0, 1, 0] },
  violet:  { deep: 0x6a18c8, floor: ['#3e0a6a', '#1a052e', '#07020d'], speck: [190, 70, 255], speckLift: 120,
             chip: [0.5, 0.1, 0.75], chipBlue: 0.25, heart: 0xf4e6ff, halo: 0x8a2cff, spill: 0x8a2cff, glint: [0.62, 0.16, 1], hot: [0.6, 0.6, 0.6] }
};
export function makeChecker(THREE, show, { size = 0.086, stone = 'onyx', gem = 'crimson', light = true, cache = null } = {}) {
  const C = GEMS[gem] || GEMS.crimson;
  const group = new THREE.Group(), materials = [], glowLayer = show.glowLayer ?? 1;
  const R = size / 2, DH = size * 0.2;                 // the disc: its radius and height
  const JR = R * 0.44, JH = JR * 1.08;                 // the jewel: its radius and height
  const ORB = size * 0.3, OC = ORB, BAND = ORB * 0.14; // crowned: the orb's radius, its middle's height, its band's thickness
  const lerp = (a, b, e) => a + (b - a) * e;
  let seed = 17;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const own = [];   // (pictures made for this piece alone, freed with it)
  const keep = (key, make) => {   // a picture: made once per set of pieces when they share a cache
    if (cache) return cache[key] || (cache[key] = make());
    const t = make(); own.push(t); return t;
  };
  const canvasTex = (w, h, draw, srgb = true) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = show.anisotropy || 8; t.wrapS = THREE.RepeatWrapping;
    return t;
  };
  const soft = () => keep('soft', () => canvasTex(64, 64, (g) => {   // a soft round glow
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  }));

  // a lathe that can bend into another shape with the same number of points: it gives back the geometry and bend(e)
  function bender(from, to) {
    const geo = new THREE.LatheGeometry(from, 128), goal = new THREE.LatheGeometry(to, 128);
    const p0 = geo.attributes.position.array.slice(), n0 = geo.attributes.normal.array.slice();
    const p1 = goal.attributes.position.array.slice(), n1 = goal.attributes.normal.array.slice();
    goal.dispose();
    const pos = geo.attributes.position, nor = geo.attributes.normal, n = new THREE.Vector3();
    let was = 0;
    function bend(e) {
      if (e === was) return;
      was = e;
      for (let i = 0; i < pos.count; i++) {
        const k = i * 3;
        pos.setXYZ(i, lerp(p0[k], p1[k], e), lerp(p0[k + 1], p1[k + 1], e), lerp(p0[k + 2], p1[k + 2], e));
        n.set(lerp(n0[k], n1[k], e), lerp(n0[k + 1], n1[k + 1], e), lerp(n0[k + 2], n1[k + 2], e));
        if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
        n.normalize(); nor.setXYZ(i, n.x, n.y, n.z);
      }
      pos.needsUpdate = true; nor.needsUpdate = true;
      geo.computeBoundingBox(); geo.computeBoundingSphere();
    }
    return { geo, bend };
  }

  // ---------- The disc: a lathe from the middle of its top, round the rounded edge, down the side to the bottom ----------
  const E = DH * 0.42;   // the rounded edge's radius
  // (the flat top is its own piece, the mirror below; this is the rounded edge, the side and the bottom)
  const prof = [new THREE.Vector2(R - E, DH)], TOP_END = 0.18, SIDE_START = 0.5;   // (where along the outline the edge and the side are, 0 to 1)
  for (let i = 1; i <= 12; i++) { const a = Math.PI / 2 * (1 - i / 12); prof.push(new THREE.Vector2(R - E + Math.cos(a) * E, DH - E + Math.sin(a) * E)); }
  prof.push(new THREE.Vector2(R, E * 0.6));
  for (let i = 1; i <= 6; i++) { const a = -Math.PI / 2 * i / 6; prof.push(new THREE.Vector2(R - E * 0.6 + Math.cos(a) * E * 0.6, E * 0.6 + Math.sin(a) * E * 0.6)); }
  prof.push(new THREE.Vector2(0.0001, 0));
  // crowned, the same outline becomes the band round the orb's middle: a ring whose cross section is a small circle,
  // starting at its top and going round outward, under, and back up the inside
  const band = prof.map((_, i) => {
    const a = Math.PI / 2 - Math.PI * 2 * i / (prof.length - 1);
    return new THREE.Vector2(ORB * 0.97 + Math.cos(a) * BAND, OC + Math.sin(a) * BAND);
  });
  const discShape = bender(prof, band), discGeo = discShape.geo;
  { // spread the outline's texture evenly by distance along it (so the top, the edge and the side each get their share)
    const lens = [0];
    for (let i = 1; i < prof.length; i++) lens.push(lens[i - 1] + prof[i].distanceTo(prof[i - 1]));
    const total = lens[lens.length - 1], uv = discGeo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - lens[k % prof.length] / total);
  }
  // the onyx's look, along its outline (v: the top's middle at 1, the bottom's middle at 0): jet black, faintly grained;
  // polished on top, duller down the side
  const W = 1024, Hh = 512;
  const grain = keep('grain', () => canvasTex(W, Hh, (g, w, h) => {
    g.fillStyle = '#060607'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 4 + rnd() * 14; g.fillStyle = `rgb(${v},${v},${v + 1})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
  }));
  const rough = keep('rough', () => canvasTex(W, Hh, (g, w, h) => {   // (green is roughness: low on the polished top, higher down the side)
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgb(0,18,0)'); grd.addColorStop(TOP_END * 0.9, 'rgb(0,18,0)');
    grd.addColorStop(SIDE_START, 'rgb(0,140,0)'); grd.addColorStop(1, 'rgb(0,160,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {   // fine grain in the duller side
      const y = h * (SIDE_START + rnd() * (1 - SIDE_START)), v = 110 + rnd() * 90;
      g.fillStyle = `rgb(0,${v},0)`; g.fillRect(rnd() * w, y, 2, 2);
    }
  }, false));
  const onyx = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: grain, roughness: 1, roughnessMap: rough, metalness: 0,
    clearcoat: 0.8, clearcoatRoughness: 0.03, envMapIntensity: 1, side: THREE.DoubleSide
  });
  materials.push(onyx);
  const disc = new THREE.Mesh(discGeo, onyx);
  group.add(disc);
  // the polished top: jet black glass-smooth onyx you can faintly see a mirror image through (the reflection below it)
  const MIRROR = 0.16;   // how strong the reflection is
  const top = new THREE.MeshPhysicalMaterial({
    color: 0x040405, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 1,
    transparent: true, opacity: 1 - MIRROR
  });
  materials.push(top);
  const cap = new THREE.Mesh(new THREE.CircleGeometry(R - E + 0.0005, 128).rotateX(-Math.PI / 2), top);
  cap.position.y = DH;
  cap.userData.noShadow = true;
  group.add(cap);

  // ---------- The seat: a thin black ring round the jewel's foot ----------
  const seatMat = new THREE.MeshPhysicalMaterial({ color: 0x020203, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  materials.push(seatMat);
  const seat = new THREE.Mesh(new THREE.TorusGeometry(JR * 1.01, JR * 0.045, 12, 96).rotateX(Math.PI / 2), seatMat);
  const SEAT_Y = DH + JR * 0.03;
  seat.position.y = SEAT_Y;
  group.add(seat);

  // ---------- The jewel: a smoky dark glass dome (crowned: a whole glass ball) ----------
  const jprof = [];
  for (let i = 0; i <= 40; i++) { const a = Math.PI / 2 * i / 40; jprof.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * JR), DH + Math.sin(a) * JH)); }
  jprof.unshift(new THREE.Vector2(0.0001, DH));
  const ball = jprof.map((_, i) => {   // (the bottom pole first, then up round the side to the top)
    const a = -Math.PI / 2 + Math.PI * i / (jprof.length - 1);
    return new THREE.Vector2(Math.max(1e-4, Math.cos(a) * ORB), OC + Math.sin(a) * ORB);
  });
  const domeShape = bender(jprof, ball);
  const DEPTH = 1.1;   // how deep its color gets (in jewel heights): smoky and dark
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transmission: 1, thickness: JH * 1.3, ior: 1.6,
    attenuationColor: new THREE.Color(C.deep), attenuationDistance: JH * DEPTH,
    roughness: 0.02, metalness: 0, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 1
  });
  materials.push(glass);
  const dome = new THREE.Mesh(domeShape.geo, glass);
  dome.userData.seeThrough = true;   // (the room's glow pass looks through it, so the core's glow shows)
  dome.userData.noShadow = true;
  group.add(dome);
  const inside = new THREE.Group();   // everything in the jewel, measured from its foot
  inside.position.y = DH;
  group.add(inside);
  const inDome = (x, y, z, m = 0.08) => y > JH * 0.04 && (x * x + z * z) / (JR * JR * (1 - m) ** 2) + (y * y) / (JH * JH * (1 - m) ** 2) < 1;

  // the floor inside: dark smoky color, with fine glitter and darker smoke (seen down through the glass)
  const floorTex = keep('floor-' + gem, () => canvasTex(512, 512, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, C.floor[0]); grd.addColorStop(0.6, C.floor[1]); grd.addColorStop(1, C.floor[2]);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {   // smoky dark patches
      const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 70, s = g.createRadialGradient(x, y, 0, x, y, r);
      s.addColorStop(0, 'rgba(5,0,1,0.6)'); s.addColorStop(1, 'rgba(5,0,1,0)');
      g.fillStyle = s; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 9000; i++) {
      const b = rnd() * rnd();
      g.fillStyle = `rgba(${C.speck[0]},${Math.round(C.speck[1] + b * C.speckLift)},${C.speck[2]},${0.2 + b * 0.8})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + (b > 0.7 ? 1 : 0), 1 + (b > 0.7 ? 1 : 0));
    }
  }));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(JR * 0.97, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: floorTex }));
  floor.position.y = JH * 0.01;
  inside.add(floor);

  // the core: a hot white heart in a small glow, a little above the middle of the jewel's foot
  const CORE = new THREE.Vector3(0, JH * 0.38, 0);
  const haloColor = new THREE.Color(C.halo), white = new THREE.Color(1, 1, 1);
  const heart = new THREE.Mesh(new THREE.SphereGeometry(JR * 0.06, 16, 12), new THREE.MeshBasicMaterial({ color: C.heart }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(JR * 0.13, 16, 12), new THREE.MeshBasicMaterial({ color: haloColor.clone() }));
  for (const m of [heart, halo]) { m.position.copy(CORE); m.layers.enable(glowLayer); inside.add(m); }
  heart.renderOrder = 1;

  // the glitter: a dense cloud of fine specks round the core, thinning out toward the glass
  const COUNT = 1800, pos = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3), bright = new Float32Array(COUNT), phase = new Float32Array(COUNT);
  for (let n = 0; n < COUNT;) {
    const g = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;   // (bunched toward the middle)
    const x = CORE.x + g() * JR * 0.9, y = CORE.y + g() * JH * 0.7, z = CORE.z + g() * JR * 0.9;
    if (!inDome(x, y, z)) continue;
    pos.set([x, y, z], n * 3);
    const d = Math.hypot(x - CORE.x, (y - CORE.y) * 1.3, z - CORE.z) / JR;
    bright[n] = (0.3 + Math.pow(rnd(), 3) * 1.3) * (1.4 - Math.min(1, d));
    phase[n] = rnd() * Math.PI * 2;
    n++;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const dot = keep('dot', () => canvasTex(32, 32, (g) => {
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, '#fff'); r.addColorStop(0.4, '#fff'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  }));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: JR * 0.03, map: dot, alphaTest: 0.4, vertexColors: true }));
  const swirl = new THREE.Group();   // (the cloud turns slowly round the jewel's middle, so it stays inside the dome)
  swirl.add(dust);
  inside.add(swirl);

  // the chips: crystal fragments floating at different depths, circling slowly
  const drift = new THREE.Group();
  inside.add(drift);
  const chipGeo = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 16; i++) {
    const s = JR * (0.04 + rnd() * 0.07);
    const chip = new THREE.Mesh(chipGeo, new THREE.MeshBasicMaterial({
      color: (() => { const a = rnd(), b = rnd(); return new THREE.Color().setRGB(C.chip[0] + a * 0.25, C.chip[1] + b * 0.08, C.chip[2] + a * C.chipBlue); })() }));
    chip.scale.set(s * (0.7 + rnd() * 0.8), s * (0.3 + rnd() * 0.4), s * (0.7 + rnd() * 0.8));
    chip.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
    for (let k = 0; k < 40; k++) {
      const x = (rnd() - 0.5) * 1.6 * JR, y = JH * (0.08 + rnd() * 0.6), z = (rnd() - 0.5) * 1.6 * JR;
      if (inDome(x, y, z, 0.2)) { chip.position.set(x, y, z); break; }
    }
    drift.add(chip);
  }

  // the reflection: the jewel's insides (core, glitter, chips) mirrored in the onyx's top, just below it; a mirror image
  // is exactly what a flat polished surface shows, so it moves right as you look round. (Not the floor inside the jewel,
  // which would only hide the rest.)
  const mirror = new THREE.Group();
  const MIRROR_Y = stone === 'onyx' ? -Math.min(1, DH * 0.85 / JH) : -1;   // (in solid onyx it's kept within the stone's height)
  mirror.scale.y = MIRROR_Y;
  mirror.position.y = DH - 0.0004;
  let mirrorSwirl = null, mirrorDrift = null;
  for (const o of inside.children) {
    if (o === floor) continue;
    const c = o.clone();
    c.traverse(k => k.layers.disable(glowLayer));   // (a reflection doesn't glow out into the room)
    if (o === swirl) mirrorSwirl = c;
    if (o === drift) mirrorDrift = c;
    mirror.add(c);
  }
  group.add(mirror);
  // a smooth dark floor under the reflection (light falling into the stone finds nothing there to show): in solid onyx
  // just under the reflection, so only the reflection shows in the top; in obsidian right at the bottom, so you still
  // see down into it
  const fill = new THREE.Mesh(new THREE.CircleGeometry(R - E + 0.0005, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x020203 }));
  fill.position.y = stone === 'onyx' ? DH * 0.04 : 0.0004;
  group.add(fill);

  // the glow: the core's light spilling softly onto the onyx round the jewel (a real light, or drawn)
  let spill = null, spillGlow = null;
  const SPILL = 0.5;   // (how strong the drawn glow is)
  if (light) {
    spill = new THREE.PointLight(C.spill, 0.05, size * 1.5, 2);
    spill.position.copy(CORE).add(new THREE.Vector3(0, DH, 0));
    group.add(spill);
  } else {
    spillGlow = new THREE.Mesh(new THREE.PlaneGeometry(JR * 4.2, JR * 4.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: soft(), color: new THREE.Color(C.spill).multiplyScalar(0.6), transparent: true, opacity: SPILL,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    spillGlow.position.y = DH + 0.0002;
    spillGlow.userData.noShadow = true;
    group.add(spillGlow);
  }

  // ---------- Crowned: the piece melting into the orb (0 a checker, 1 the orb) ----------
  const GROW = ORB / JR * 0.95;   // (how much the insides grow, to fill the orb)
  let crown = 0, thick = JH;
  function setMorph(e) {
    e = Math.min(Math.max(e, 0), 1);
    if (e === crown) return;
    crown = e;
    discShape.bend(e); domeShape.bend(e);
    inside.scale.setScalar(lerp(1, GROW, e));
    inside.position.y = lerp(DH, OC - JH * 0.45 * GROW, e);   // (the insides' middle at the orb's middle)
    floor.visible = e < 0.999; floor.scale.setScalar(Math.max(1e-4, 1 - e));
    seat.visible = e < 0.6; seat.position.y = lerp(SEAT_Y, OC, e); seat.scale.setScalar(lerp(1, ORB / JR, e));
    cap.visible = e < 0.97; cap.position.y = lerp(DH, OC + BAND, e);
    cap.scale.setScalar(lerp(1, ORB * 0.85 / (R - E), e));
    top.opacity = (1 - MIRROR) * (1 - e) ** 2;
    mirror.visible = e < 0.25; mirror.scale.y = MIRROR_Y * Math.max(1e-4, 1 - e * 4);
    fill.visible = e < 0.3; fill.scale.setScalar(Math.max(1e-4, 1 - e / 0.3));
    if (spillGlow) { spillGlow.position.y = lerp(DH, OC + BAND, e) + 0.0002; spillGlow.material.opacity = SPILL * (1 - e); spillGlow.visible = e < 0.99; }
    if (spill) spill.position.y = lerp(DH + CORE.y, OC, e);
    halo.scale.setScalar(1 + 0.6 * e);
    thick = lerp(JH, ORB * 1.4, e);
    glass.thickness = lerp(JH * 1.3, ORB * 1.6, e);
  }

  // ---------- Struck: glowing up to white hot (0 cool, 1 white hot) ----------
  let heat = 0;
  const spillColor = new THREE.Color(C.spill);
  function setHeat(h) {
    h = Math.min(Math.max(h, 0), 1);
    if (h === heat) return;
    heat = h;
    onyx.emissive.copy(spillColor).lerp(white, h * 0.6); onyx.emissiveIntensity = h * 2.5;
    top.emissive.copy(spillColor).lerp(white, h * 0.6); top.emissiveIntensity = h * 2.5;
    glass.emissive.copy(haloColor).lerp(white, h * 0.7); glass.emissiveIntensity = h * 3;
    halo.material.color.copy(haloColor).lerp(white, h * 0.8);
    for (const m of [disc, cap]) { if (h > 0.02) m.layers.enable(glowLayer); else m.layers.disable(glowLayer); }   // (white hot, it glows out into the room)
  }

  const tone = new THREE.Color(), grown = new THREE.Vector3();
  function update(t) {
    group.getWorldScale(grown);   // (made bigger or smaller, its color stays just as deep)
    glass.attenuationDistance = thick * DEPTH * grown.x;
    const lift = (1 + 0.6 * crown) * (1 + 1.5 * heat);   // (brighter crowned, and brighter still struck)
    for (let i = 0; i < COUNT; i++) {   // the glitter twinkling, each speck on its own beat
      const b = bright[i] * lift * (0.55 + 0.45 * Math.sin(t * (1.1 + (i % 9) * 0.31) + phase[i]));
      const hot = 0.25 * Math.max(0, b - 0.9);   // (the brightest go a little toward white)
      tone.setRGB(C.glint[0] * b + C.hot[0] * hot, C.glint[1] * b + C.hot[1] * hot, C.glint[2] * b + C.hot[2] * hot);
      col[i * 3] = tone.r; col[i * 3 + 1] = tone.g; col[i * 3 + 2] = tone.b;
    }
    dustGeo.attributes.color.needsUpdate = true;
    const turn = t * 0.12, back = -t * 0.05, bob = Math.sin(t * 0.7) * JH * 0.03;   // (the inside moving, slowly)
    swirl.rotation.y = turn; drift.rotation.y = back; drift.position.y = bob;
    mirrorSwirl.rotation.y = turn; mirrorDrift.rotation.y = back; mirrorDrift.position.y = bob;
    const breath = 0.9 + 0.1 * Math.sin(t * 1.3);   // (the core breathing, gently)
    heart.scale.setScalar(breath * (1 + 0.5 * crown) * (1 + heat));
  }
  function dispose() {   // (taken away for good: frees what it used, but not pictures shared with other pieces)
    const done = new Set();
    group.traverse(o => {
      if (o.geometry && !done.has(o.geometry)) { done.add(o.geometry); o.geometry.dispose(); }
      if (o.material && !done.has(o.material)) { done.add(o.material); o.material.dispose(); }
    });
    for (const t of own) t.dispose();
  }
  update(0);
  return { group, materials, update, setMorph, setHeat, color: spillColor.clone(), ORB, HEIGHT: DH + JH, dispose };
}
// ===================================================================================================================
// >>>>> END OF FILE 1 of 1: Workshop/pieces/checker.js <<<<<
// ===================================================================================================================
