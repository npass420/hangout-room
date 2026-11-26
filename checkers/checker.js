// ===================================================================================================================
// >>>>> START OF FILE 1 of 1: Workshop/pieces/checker.js <<<<<
// Workshop/pieces/checker.js: the checker's look, after the Kindroid reference: a game piece made of
//   the disc: a thick round disc of black onyx with a softly rounded edge, its top polished near to a mirror (it
//     faintly reflects the jewel's glowing insides, a true mirror image that moves as you look round) and its sides
//     duller and finely grained
//   the seat: a thin dark ring the jewel is set into, glowing gently in the jewel's own color, with a faint pool of
//     that glow on the board round the piece's foot
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
// lite: a lighter piece for phones in a busy room: the jewel is a dark glossy see-through shell (blended, not real glass,
// which makes the screen draw the whole room a second time), a smaller cloud of glitter, and no mirror image in the top.
// makeChecker(THREE, show, { size, stone, gem, light, cache, lite }) gives back { group, materials, update, setMorph, setHeat,
// color, ORB, HEIGHT, dispose }; the group stands on y = 0, centered; size is the disc's width in meters (a checkers
// square on the game table is about 10 cm). light: a real light spilling onto the onyx (true), or a drawn glow there
// instead (false: what the game uses, as a light per piece would slow the room). cache: an object shared by a set of
// pieces, so they make their pictures once between them. ORB: the crowned orb's radius; HEIGHT: the piece's height.
// ===================================================================================================================
const GEMS = {   // each jewel's colors: the glass's depth color, the floor inside, the glitter, the chips, the core, its glow and light
  crimson: { deep: 0xb0101c, floor: ['#6a0710', '#2c0306', '#0c0102'], speck: [255, 50, 40], speckLift: 120,
             chip: [0.75, 0.05, 0.04], chipBlue: 0, heart: 0xfff2b0, halo: 0xff1a10, spill: 0xff1a12, glint: [1, 0.12, 0.08], hot: [0, 1, 0] },
  violet:  { deep: 0x6a18c8, floor: ['#3e0a6a', '#1a052e', '#07020d'], speck: [190, 70, 255], speckLift: 120,
             chip: [0.5, 0.1, 0.75], chipBlue: 0.25, heart: 0xf4e6ff, halo: 0x8a2cff, spill: 0x8a2cff, glint: [0.62, 0.16, 1], hot: [0.6, 0.6, 0.6] }
};
export function makeChecker(THREE, show, { size = 0.086, stone = 'onyx', gem = 'crimson', light = true, cache = null, lite = false } = {}) {
  const C = GEMS[gem] || GEMS.crimson;
  const group = new THREE.Group(), materials = [], glowLayer = show.glowLayer ?? 1;
  const DH = size * 0.2;                               // the disc's height
  const JR = size / 2 * 0.44, JH = JR * 1.08;          // the jewel: its radius and height
  const R = JR + DH * 0.42;                            // the disc's radius: just the rounded edge round the orb, no flat top showing
  const FOOT = size * 0.004;   // (the half orb's flat bottom, just off the board)
  const RIM = JR * 0.03;       // (the tiny black rim round its foot)
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
  // real onyx: black with faint smoky banding and thin pale veins wandering through it
  const veins = (g, w, h, n, wrap) => {
    for (let i = 0; i < n; i++) {
      let x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI * 2;
      const len = 40 + rnd() * 90, v = 120 + rnd() * 100, wide = 0.7 + rnd() * 1.6;
      g.strokeStyle = `rgba(${v},${v},${v + 6},${0.4 + rnd() * 0.45})`; g.lineWidth = wide;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < len; k++) {
        a += (rnd() - 0.5) * 0.5; x += Math.cos(a) * 4; y += Math.sin(a) * 4;
        if (wrap && (x < 0 || x > w)) { x = (x + w) % w; g.stroke(); g.beginPath(); g.moveTo(x, y); } else g.lineTo(x, y);
        if (rnd() < 0.02) { g.stroke(); g.lineWidth = Math.max(0.4, g.lineWidth * (0.5 + rnd())); g.beginPath(); g.moveTo(x, y); }
      }
      g.stroke();
    }
  };
  const stoneBase = (g, w, h) => {
    g.fillStyle = '#050506'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {   // smoky bands, a little lighter and a little darker
      const x = rnd() * w, y = rnd() * h, r = 60 + rnd() * 220, v = rnd() < 0.5 ? 28 + rnd() * 22 : 0;
      const s = g.createRadialGradient(x, y, 0, x, y, r);
      s.addColorStop(0, `rgba(${v},${v},${v + 3},0.35)`); s.addColorStop(1, `rgba(${v},${v},${v + 3},0)`);
      g.fillStyle = s; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 9000; i++) { const v = 6 + rnd() * 16; g.fillStyle = `rgba(${v},${v},${v + 2},0.6)`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.5, 1 + rnd() * 1.5); }
  };
  const grain = keep('grain', () => canvasTex(W, Hh, (g, w, h) => {
    stoneBase(g, w, h);
    g.filter = 'blur(1.5px)'; veins(g, w, h, 16, true); g.filter = 'none'; veins(g, w, h, 24, true);
  }));
  const topGrain = keep('topgrain', () => canvasTex(1024, 1024, (g, w, h) => {
    stoneBase(g, w, h);
    g.filter = 'blur(2px)'; veins(g, w, h, 24, false); g.filter = 'none'; veins(g, w, h, 34, false);
  }));
  const rough = keep('rough', () => canvasTex(W, Hh, (g, w, h) => {   // (green is roughness: low on the polished top, higher down the side)
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgb(0,70,0)'); grd.addColorStop(TOP_END * 0.9, 'rgb(0,70,0)');
    grd.addColorStop(SIDE_START, 'rgb(0,140,0)'); grd.addColorStop(1, 'rgb(0,160,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {   // fine grain in the duller side
      const y = h * (SIDE_START + rnd() * (1 - SIDE_START)), v = 110 + rnd() * 90;
      g.fillStyle = `rgb(0,${v},0)`; g.fillRect(rnd() * w, y, 2, 2);
    }
  }, false));
  const onyx = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: grain, roughness: 1, roughnessMap: rough, metalness: 0,
    clearcoat: 0.3, clearcoatRoughness: 0.2, envMapIntensity: 1, side: THREE.DoubleSide   // (a little soft: sharp glints came out square)
  });
  materials.push(onyx);
  const disc = new THREE.Mesh(discGeo, onyx);
  disc.visible = false;   // (the half orb lies straight on the board now: no onyx base)
  group.add(disc);
  // the polished top: jet black glass-smooth onyx you can faintly see a mirror image through (the reflection below it)
  const MIRROR = 0.16;   // how strong the reflection is
  const top = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: topGrain, roughness: 0.3, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.18, envMapIntensity: 1,
    transparent: true, opacity: 1 - MIRROR
  });
  materials.push(top);
  const cap = new THREE.Mesh(new THREE.CircleGeometry(R - E + 0.0005, 128).rotateX(-Math.PI / 2), top);
  cap.position.y = DH;
  cap.visible = false;
  cap.userData.noShadow = true;
  group.add(cap);

  // ---------- The seat: a thin black ring round the jewel's foot ----------
  const seatMat = new THREE.MeshPhysicalMaterial({ color: 0x020203, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05,
    emissive: new THREE.Color(C.deep), emissiveIntensity: 0.7 });   // (dark, glowing gently in its own color)
  materials.push(seatMat);
  const seat = new THREE.Mesh(new THREE.TorusGeometry(JR * 1.0, RIM * 1.6, 12, 96).rotateX(Math.PI / 2), seatMat);
  const SEAT_Y = RIM * 1.6;
  seat.position.y = SEAT_Y;
  group.add(seat);
  // the rim's glow on the board round the piece's foot: a faint ring of its color, fading out from the rim
  const rimGlowMat = new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(C.spill) }, uK: { value: 0.55 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uC; uniform float uK; varying vec2 vP;
      void main() { float d = (length(vP) - ${(JR * 1.0).toFixed(5)}) / ${(JR * 0.38).toFixed(5)};
        float a = exp(-d * d * 2.2) * (d < 0.0 ? 0.5 : 1.0) * uK;
        gl_FragColor = vec4(uC * a, a); }`
  });
  const rimGlow = new THREE.Mesh(new THREE.RingGeometry(JR * 0.7, JR * 1.55, 96, 1).rotateX(-Math.PI / 2), rimGlowMat);
  rimGlow.position.y = 0.0005;
  rimGlow.userData.noShadow = true;
  group.add(rimGlow);

  // ---------- The jewel: a smoky dark glass dome (crowned: a whole glass ball) ----------
  // a whole glass orb set down into the onyx, its middle a little above the stone's top: the top of the ball shows,
  // its lower half glints up through the polished top; the light at the orb's very middle
  // the orb cut in half: a dome of glass laid flat on the board, its flat bottom closed
  const JC = 0;   // (the ball's middle is at the dome's flat bottom)
  const jprof = [new THREE.Vector2(1e-4, FOOT)];
  for (let i = 0; i <= 40; i++) { const a = Math.PI / 2 * i / 40; jprof.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * JR), FOOT + Math.sin(a) * JR)); }
  const ball = jprof.map((_, i) => {   // (the bottom pole first, then up round the side to the top)
    const a = -Math.PI / 2 + Math.PI * i / (jprof.length - 1);
    return new THREE.Vector2(Math.max(1e-4, Math.cos(a) * ORB), OC + Math.sin(a) * ORB);
  });
  const domeShape = bender(jprof, ball);
  const DEPTH = 0.9;   // how deep its color gets (in jewel heights): clear glowing red, like the reference orb
  const glass = lite
    ? new THREE.MeshPhysicalMaterial({   // (lite: a tinted glossy shell, blended over the insides)
        color: new THREE.Color(C.deep).multiplyScalar(0.6), transparent: true, opacity: 0.5, depthWrite: false,
        roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 1 })
    : new THREE.MeshPhysicalMaterial({
        color: 0xffffff, transmission: 1, thickness: JR * 1.2, ior: 1.6,
        attenuationColor: new THREE.Color(C.deep), attenuationDistance: JH * DEPTH,
        roughness: 0.02, metalness: 0, specularIntensity: 0.7, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1,
        depthWrite: false   // (the insides are drawn after the glass, over it, so they stay as crisp as in the onyx's mirror)
      });
  materials.push(glass);
  const dome = new THREE.Mesh(domeShape.geo, glass);
  dome.userData.seeThrough = true;   // (the room's glow pass looks through it, so the core's glow shows)
  dome.userData.noShadow = true;
  if (lite) dome.renderOrder = 2;   // (drawn over the insides)
  group.add(dome);
  const inside = new THREE.Group();   // everything in the jewel, measured from its foot
  inside.position.y = FOOT;
  group.add(inside);
  const inDome = (x, y, z, m = 0.08) => y > JR * 0.03 && x * x + y * y + z * z < (JR * (1 - m)) ** 2;   // (inside the half orb)

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
  floor.visible = false;   // (a whole orb now: no flat floor in it)
  inside.add(floor);

  // the core: a hot white heart in a small glow, a little above the middle of the jewel's foot
  const CORE = new THREE.Vector3(0, JR * 0.36, 0);   // (the light: in the middle of the half orb's body)
  const haloColor = new THREE.Color(C.halo), white = new THREE.Color(1, 1, 1);
  // (the light: a tiny hot point fading smoothly out into its color, no hard edges, so no rings)
  const glowTex = keep('glow', () => { const t = canvasTex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (let i = 0; i <= 16; i++) { const d = i / 16; r.addColorStop(d, `rgba(255,255,255,${Math.exp(-d * d * 9) * (1 - d)})`); }
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  }); t.wrapS = THREE.ClampToEdgeWrapping; return t; });
  const HEART = JR * 1.1, HALO = JR * 0.9;   // (how wide the hot point and its colored glow are)
  // (the heart is a starburst: a white hot point with fine rays shooting out all round)
  const burstTex = keep('burst', () => { const t = canvasTex(256, 256, (g) => {
    const c = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (let i = 0; i <= 16; i++) { const d = i / 16; c.addColorStop(d, `rgba(255,255,255,${Math.exp(-d * d * 30)})`); }
    g.fillStyle = c; g.fillRect(0, 0, 256, 256);
    g.translate(128, 128);
    for (let k = 0; k < 90; k++) {
      const a = rnd() * Math.PI * 2, l = 30 + Math.pow(rnd(), 2) * 95, w = 0.4 + rnd() * 1.1;
      const ray = g.createLinearGradient(0, 0, Math.cos(a) * l, Math.sin(a) * l);
      ray.addColorStop(0, `rgba(255,255,255,${0.35 + rnd() * 0.5})`); ray.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = ray; g.lineWidth = w; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * l, Math.sin(a) * l); g.stroke();
    }
  }); t.wrapS = THREE.ClampToEdgeWrapping; return t; });
  const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: burstTex, color: C.heart, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: haloColor.clone(), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.35 }));
  heart.scale.setScalar(HEART); halo.scale.setScalar(HALO);
  for (const m of [heart, halo]) { m.position.copy(CORE); inside.add(m); }   // (not in the room's glow pass: its blur washed red over the base and the orb's bottom; the game has no glow pass anyway)
  heart.renderOrder = 1;
  // (seen through real glass, the insides went soft and cloudy; drawn after the glass instead, over it, they stay
  // crisp, the same sharp sparkles you see in the onyx's mirror. Phones' lighter glass is blended over them already.)
  const crisp = o => { if (lite) return; o.material.transparent = true; o.material.depthWrite = false; o.renderOrder = Math.max(o.renderOrder, 2); };
  crisp(heart); crisp(halo); heart.renderOrder = 3;

  // the glitter, after the reference orb: fine sharp specks filling the whole ball (thicker toward the middle), a
  // scatter of bigger bright sparks, some going gold or white; each twinkles on its own beat. Drawn by the screen's
  // graphics chip (its own little program), so two dozen pieces cost the computer next to nothing.
  const FINE = lite ? 260 : 1100, SPARK = lite ? 40 : 110, COUNT = FINE + SPARK;
  const pos = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3), siz = new Float32Array(COUNT), phase = new Float32Array(COUNT);
  const glintC = new THREE.Color().setRGB(C.glint[0], C.glint[1], C.glint[2]), gold = new THREE.Color(1, 0.72, 0.35), tmpC = new THREE.Color();
  for (let n = 0; n < COUNT;) {
    // (a point in the ball: mostly spread evenly, some pulled in toward the core)
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, rr = JR * 0.93 * Math.pow(rnd(), n % 3 === 0 ? 1.6 : 0.45);
    const x = Math.sqrt(1 - u * u) * Math.cos(a) * rr, y = CORE.y + u * rr, z = Math.sqrt(1 - u * u) * Math.sin(a) * rr;
    if (!inDome(x, y, z, 0.05)) continue;
    pos.set([x, y, z], n * 3);
    const spark = n >= FINE, d = rr / JR;
    const b = (spark ? 0.55 + rnd() * 0.45 : 0.22 + Math.pow(rnd(), 2) * 0.55) * (1.25 - 0.5 * d);
    tmpC.copy(glintC).lerp(spark && rnd() < 0.45 ? gold : white, spark ? 0.25 + rnd() * 0.35 : rnd() * rnd() * 0.25).multiplyScalar(b);
    col.set([tmpC.r, tmpC.g, tmpC.b], n * 3);
    siz[n] = JR * (spark ? 0.04 + rnd() * 0.03 : 0.016 + rnd() * 0.02);
    phase[n] = rnd() * Math.PI * 2;
    n++;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  dustGeo.setAttribute('size', new THREE.BufferAttribute(siz, 1));
  dustGeo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const dustU = { uTime: { value: 0 }, uLift: { value: 1 }, uPx: { value: 500 } };
  const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
    uniforms: dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float size; attribute float phase; attribute vec3 color;
      uniform float uTime, uLift, uPx; varying vec3 vC;
      void main() {
        float tw = 0.45 + 0.55 * sin(uTime * (1.2 + fract(phase * 3.7) * 2.2) + phase);
        vC = min(color * uLift * max(tw, 0.08), vec3(1.0));   // (never blown out past full color)
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float sc = length(modelMatrix[0].xyz);
        gl_PointSize = max(1.5, size * sc * uPx / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vC;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.45, d);
        gl_FragColor = vec4(vC * a, a);
        #include <colorspace_fragment>
      }`
  }));
  dust.frustumCulled = false;
  dust.onBeforeRender = (r, sc, cam) => { r.getDrawingBufferSize(dustPx); dustU.uPx.value = dustPx.y * 0.5 * cam.projectionMatrix.elements[5]; };
  const dustPx = new THREE.Vector2();
  crisp(dust);
  const swirl = new THREE.Group();   // (the cloud turns slowly round the orb's middle)
  swirl.add(dust);
  // a few star sparkles: little four-pointed flares that flash now and then
  const flareTex = keep('flare', () => { const t = canvasTex(128, 128, (g) => {
    const c = g.createRadialGradient(64, 64, 0, 64, 64, 22);
    c.addColorStop(0, 'rgba(255,255,255,1)'); c.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = c; g.fillRect(0, 0, 128, 128);
    for (const [w, l] of [[3, 62], [1.5, 40]]) for (let k = 0; k < 4; k++) {
      g.save(); g.translate(64, 64); g.rotate(k * Math.PI / 2 + (w < 2 ? Math.PI / 4 : 0));
      const ray = g.createLinearGradient(0, 0, l, 0);
      ray.addColorStop(0, 'rgba(255,255,255,0.95)'); ray.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = ray; g.beginPath(); g.moveTo(0, -w); g.lineTo(l, 0); g.lineTo(0, w); g.fill(); g.restore();
    }
  }); t.wrapS = THREE.ClampToEdgeWrapping; return t; });
  const flares = [];
  for (let i = 0; i < (lite ? 2 : 6); i++) {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, color: new THREE.Color().copy(glintC).lerp(white, 0.45),
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    for (let k = 0; k < 40; k++) {
      const x = (rnd() - 0.5) * 1.7 * JR, y = CORE.y + (rnd() - 0.5) * 1.7 * JR, z = (rnd() - 0.5) * 1.7 * JR;
      if (inDome(x, y, z, 0.15) && Math.hypot(x, y - CORE.y, z) > JR * 0.3) { f.position.set(x, y, z); break; }
    }
    f.userData.size = JR * (0.3 + rnd() * 0.25); f.userData.beat = 0.4 + rnd() * 0.5; f.userData.off = rnd() * 10;
    f.scale.setScalar(1e-4);
    crisp(f); f.renderOrder = 3;
    flares.push(f); swirl.add(f);
  }
  // the orb filled with its color's light: brightest through the middle, where you look through the most of it
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(C.halo) }, uK: { value: 0.3 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN, vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uC; uniform float uK; varying vec3 vN, vV;
      void main() { float f = pow(max(dot(normalize(vN), normalize(vV)), 0.0), 3.5);   // (black at the edge, deepening to red in the middle) gl_FragColor = vec4(uC * f * uK, 1.0);
        #include <colorspace_fragment>
      }`
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(JR * 0.95, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);   // (a half ball, filling the dome)
  if (!lite) { body.renderOrder = 2; inside.add(body); }
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
    crisp(chip);   // (the chips read as big red blotches at game size, so they're left out: the drift stays, empty)
  }

  // the reflection: the jewel's insides (core, glitter, chips) mirrored in the onyx's top, just below it; a mirror image
  // is exactly what a flat polished surface shows, so it moves right as you look round. (Not the floor inside the jewel,
  // which would only hide the rest.)
  const mirror = new THREE.Group();   // (lite: left empty)
  const MIRROR_Y = stone === 'onyx' ? -Math.min(1, DH * 0.85 / JH) : -1;   // (in solid onyx it's kept within the stone's height)
  mirror.scale.y = MIRROR_Y;
  mirror.position.y = DH - 0.0004;
  let mirrorSwirl = null, mirrorDrift = null;
  for (const o of []) {   // (no mirror copy now: the orb's own lower half shows through the polished top)
    if (o === floor) continue;
    const c = o.clone();
    c.traverse(k => {
      k.layers.disable(glowLayer);   // (a reflection doesn't glow out into the room)
      if (k.material && !lite) { k.material = k.material.clone(); k.material.transparent = false; k.material.depthWrite = true; k.renderOrder = 0; }   // (the mirror image drawn as before: solid, under the polished top)
    });
    if (o === swirl) mirrorSwirl = c;
    if (o === drift) mirrorDrift = c;
    mirror.add(c);
  }
  mirror.visible = false;
  group.add(mirror);
  // a smooth dark floor under the reflection (light falling into the stone finds nothing there to show): in solid onyx
  // just under the reflection, so only the reflection shows in the top; in obsidian right at the bottom, so you still
  // see down into it
  const fill = new THREE.Mesh(new THREE.CircleGeometry(R - E + 0.0005, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x020203 }));
  fill.position.y = stone === 'onyx' ? DH * 0.04 : 0.0004;
  fill.visible = false;
  group.add(fill);

  // the glow: the core's light spilling softly onto the onyx round the jewel (a real light, or drawn)
  let spill = null, spillGlow = null;
  const SPILL = 0.22;   // (how strong the drawn glow is)
  if (light) {
    spill = new THREE.PointLight(C.spill, 0.05, size * 1.5, 2);
    spill.position.copy(CORE).add(new THREE.Vector3(0, FOOT, 0));
    group.add(spill);
  } else {
    spillGlow = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.7, R * 1.7).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: soft(), color: new THREE.Color(C.spill).multiplyScalar(0.6), transparent: true, opacity: SPILL,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    spillGlow.position.y = 0.0003;   // (a soft glow on the board round it)
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
    inside.position.y = lerp(FOOT, OC, e);   // (crowned, the ball's middle at the orb's middle)
    heart.position.y = halo.position.y = lerp(CORE.y, 0, e);   // (and the light drifting to its very middle)
    floor.scale.setScalar(Math.max(1e-4, 1 - e));
    seat.position.y = lerp(SEAT_Y, OC, e); seat.scale.setScalar(lerp(1, ORB / JR, e));
    rimGlow.visible = e < 0.99; rimGlow.scale.setScalar(Math.max(1e-4, 1 - e));
    cap.position.y = lerp(DH, OC + BAND, e);
    cap.scale.setScalar(lerp(1, ORB * 0.85 / (R - E), e));
    top.opacity = (1 - MIRROR) * (1 - e) ** 2;
    mirror.scale.y = MIRROR_Y * Math.max(1e-4, 1 - e * 4);
    fill.scale.setScalar(Math.max(1e-4, 1 - e / 0.3));
    if (spillGlow) { spillGlow.position.y = 0.0003; spillGlow.material.opacity = SPILL * (1 - e); spillGlow.visible = e < 0.99; }
    if (spill) spill.position.y = lerp(FOOT + CORE.y, OC, e);
    halo.scale.setScalar(HALO * (1 + 0.6 * e));
    thick = lerp(JH, ORB * 1.4, e);
    glass.thickness = lerp(JR * 2, ORB * 1.6, e);
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

  const grown = new THREE.Vector3();
  function update(t) {
    group.getWorldScale(grown);   // (made bigger or smaller, its color stays just as deep)
    glass.attenuationDistance = thick * DEPTH * grown.x;
    const lift = (1 + 0.6 * crown) * (1 + 1.5 * heat);   // (brighter crowned, and brighter still struck)
    dustU.uTime.value = t; dustU.uLift.value = lift;   // (the glitter twinkling, worked out by the graphics chip)
    for (const f of flares) {   // (a star sparkle flashing now and then)
      const k = Math.max(0, Math.sin(t * f.userData.beat + f.userData.off)) ** 6;
      f.scale.setScalar(Math.max(1e-4, f.userData.size * k)); f.material.rotation = t * 0.2 + f.userData.off;
    }
    heart.material.rotation = t * 0.05;
    bodyMat.uniforms.uK.value = 0.3 * lift;
    const turn = t * 0.12, back = -t * 0.05, bob = Math.sin(t * 0.7) * JH * 0.03;   // (the inside moving, slowly)
    swirl.rotation.y = turn; drift.rotation.y = back; drift.position.y = bob;
    if (mirrorSwirl) { mirrorSwirl.rotation.y = turn; mirrorDrift.rotation.y = back; mirrorDrift.position.y = bob; }
    const breath = 0.9 + 0.1 * Math.sin(t * 1.3);   // (the core breathing, gently)
    heart.scale.setScalar(HEART * breath * (1 + 0.5 * crown) * (1 + heat));
    seatMat.emissiveIntensity = 0.7 * breath * (1 + 0.6 * crown) + heat * 2.5;   // (the rim's gentle glow, breathing with the core)
    rimGlowMat.uniforms.uK.value = 0.55 * breath;
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
  return { group, materials, update, setMorph, setHeat, color: spillColor.clone(), ORB, HEIGHT: FOOT + JR, dispose };
}
// ===================================================================================================================
// >>>>> END OF FILE 1 of 1: Workshop/pieces/checker.js <<<<<
// ===================================================================================================================
