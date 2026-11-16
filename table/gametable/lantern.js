// ===================================================================================================================
// Workshop/pieces/lantern.js: a hanging red paper lantern (after their Kindroid picture): a round ball of deep red paper,
// a little squat, wound round with fine dark ribs, a short dark wood ring at its top and at its bottom. Deep inside it,
// a tiny white light: the paper glows red where it's lit through, brightest straight through the middle where the little
// light shows as a soft white spot, darker toward the edges, with a subtle red halo round it all. Out of its open bottom
// a soft white light falls straight down onto what's below (white, so the table and board keep their own colors).
// makeLantern(THREE, { glowLayer, radius, shadows }) gives back { group, light, update }: the group's middle is the
// ball's middle; light is the white light shining down (aimed at its target, which is placed by whoever hangs it).
// update(seconds) is to be called every frame (the little light flickers softly and drifts, like a flame).
// VERSION 9
// ===================================================================================================================
export function makeLantern(THREE, { glowLayer = 1, radius = 0.26, shadows = true } = {}) {
  const R = radius, SQUAT = 0.88;     // (a little wider than it is tall)
  const OPEN = 0.2;                    // how far round from the top and bottom the paper stops (the openings, in radians)
  const group = new THREE.Group();

  // ---------- The paper: lit from inside ----------
  // Where you look straight through the middle, the light inside shows through most (and the tiny light itself as a
  // soft white spot); toward the edges you look through the paper at a slant, and it's darker. A faint fiber shows in it.
  const paper = new THREE.ShaderMaterial({
    uniforms: { glow: { value: 1 }, flame: { value: new THREE.Vector3() } },
    vertexShader: `
      varying vec3 vP, vEye;
      void main() {
        vP = position;
        vEye = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;   // (where you are, in the lantern's own measure)
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float glow;
      uniform vec3 flame;   // (where the little light is inside: it drifts a little, like a flame)
      varying vec3 vP, vEye;
      float h(vec3 q) { return fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float fiber(vec3 q) {   // a soft blotchy grain, like thin paper held to the light
        vec3 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        // how straight the little light shines through this bit of paper toward you: brightest where the paper lies
        // between you and the light, so the bright patch moves as the flame drifts
        float facing = clamp(dot(normalize(vP - flame), normalize(vEye - vP)), 0.0, 1.0);
        float through = pow(facing, 1.6);                     // the light inside, showing through the paper
        float spot = pow(facing, 60.0);                       // the tiny light itself, deep in the middle
        float warm = pow(facing, 10.0);                       // its warm glow, lighting the paper round it
        float grain = 0.75 + 0.35 * fiber(vP * 55.0) + 0.15 * fiber(vP * 160.0);
        vec3 red = vec3(0.75, 0.05, 0.025);
        vec3 col = red * (0.077 + 0.55 * through) * grain                 // (deep red, not washed out)
                 + vec3(0.9, 0.2, 0.06) * warm * 0.3 * grain                    // (plainly lit from within)
                 + vec3(0.95, 0.28, 0.1) * spot * 0.6;                          // (the little light: a warm orange red, never white)
        gl_FragColor = vec4(col * glow * 0.65, 1.0);   // (the whole lantern kept dark: deep red, no white anywhere)
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64, 0, Math.PI * 2, OPEN, Math.PI - 2 * OPEN), paper);
  ball.scale.y = SQUAT;
  ball.layers.enable(glowLayer);   // (its subtle red halo)
  group.add(ball);

  // ---------- The ribs: fine dark lines wound round it, top to bottom ----------
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a0d08, roughness: 0.6 });
  const RIBS = 26;
  for (let i = 1; i < RIBS; i++) {
    const a = OPEN + (Math.PI - 2 * OPEN) * i / RIBS;   // (from the top opening down to the bottom one)
    const r = Math.sin(a) * R * 1.004, y = Math.cos(a) * R * SQUAT;
    const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0016, 6, 96), dark);
    rib.rotation.x = Math.PI / 2; rib.position.y = y;
    group.add(rib);
  }

  // ---------- The dark wood rings at the top and bottom openings ----------
  const wood = new THREE.MeshStandardMaterial({ color: 0x24140c, roughness: 0.45, metalness: 0.1 });
  const ringR = Math.sin(OPEN) * R + 0.004, ringY = Math.cos(OPEN) * R * SQUAT;
  for (const s of [1, -1]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(ringR + 0.01, ringR + 0.006, 0.04, 64, 1, true), wood);
    ring.position.y = s * (ringY + 0.008);
    group.add(ring);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(ringR + 0.01, 0.004, 8, 64), wood);   // (a rounded rim on it)
    lip.rotation.x = Math.PI / 2; lip.position.y = s * (ringY + 0.028);
    group.add(lip);
  }
  group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.userData.noShadow = true; } });

  // ---------- The light: soft and white, falling straight down out of the bottom ----------
  const light = new THREE.SpotLight(0xfff3e8, 18, 7, 0.5, 1, 1.2);   // (a beam just wide enough for the table and its rug, so the shiny floor beyond catches no glare)
  light.position.y = -ringY - 0.02;
  if (shadows) { light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -0.0005; light.shadow.radius = 4; }
  group.add(light);

  // the little light flickers softly and unevenly, like a flame (its glow in the paper and the light on the table dip and
  // swell together), and drifts a little inside the lantern, so the bright patch wanders on the paper and the shadows it
  // throws below sway a touch
  const flame = paper.uniforms.flame.value, lightX = 0, lightZ = 0;
  function update(t) {
    const flick = 0.5 * Math.sin(t * 7.3) + 0.3 * Math.sin(t * 11.9 + 1.1) + 0.2 * Math.sin(t * 17.3 + 2.4);
    const dip = Math.max(0, Math.sin(t * 0.37) * Math.sin(t * 1.9 + 0.7) - 0.6) * 0.5;   // (now and then a deeper dip, like a gust)
    const b = Math.max(0.6, 1 + 0.06 * Math.sin(t * 0.9) + 0.16 * flick * (0.55 + 0.45 * Math.sin(t * 0.63)) - dip);
    paper.uniforms.glow.value = b;
    light.intensity = 18 * b;
    flame.set(R * 0.14 * Math.sin(t * 0.53) + R * 0.03 * Math.sin(t * 2.7),
              R * 0.06 * Math.sin(t * 0.71 + 1),
              R * 0.14 * Math.cos(t * 0.47) + R * 0.03 * Math.cos(t * 3.1));
    light.position.x = lightX + flame.x; light.position.z = lightZ + flame.z;
  }
  return { group, light, update, materials: [dark, wood] };
}
// ===================================================================================================================
// END OF Workshop/pieces/lantern.js
// ===================================================================================================================
