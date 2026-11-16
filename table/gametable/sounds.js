// ===================================================================================================================
// Workshop/pieces/sounds.js: the game pieces' sounds, all made in code (no sound files): each sound is worked out
// sample by sample once, kept, and played from the piece itself, so it comes from where the piece is in the room.
//   glide (a soft rushing whoosh while it moves), zap (the laser: a buzz as if played backwards, swelling and cutting off, held while it fires; the same for both stones), heat (a rising
//   whine as a struck piece glows white), boom (the burst: a deep thump and a crackle of sparks), land (a glassy click),
//   rise and settle (a shimmering chime as a king lifts, falling as it sets down), hum (a king's low floating hum).
// makeSounds(THREE, listener) gives back { play(name, onto, { pitch, volume, loop }) } (play gives back the sound, so a
// held one can be stopped with .stop()); listener: a THREE.AudioListener riding on the camera, or null for silence.
// VERSION 2
// ===================================================================================================================
export function makeSounds(THREE, listener) {
  if (!listener) return { play: () => null };
  const ctx = listener.context, RATE = ctx.sampleRate;
  const kept = {};
  function make(name, seconds, fill) {   // a sound worked out sample by sample, once
    if (kept[name]) return kept[name];
    const n = Math.floor(seconds * RATE), buf = ctx.createBuffer(1, n, RATE), a = buf.getChannelData(0);
    fill(a, n);
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(a[i]));
    if (peak > 0) for (let i = 0; i < n; i++) a[i] *= 0.9 / peak;   // (each sound as loud as the next; volume sets the mix)
    return (kept[name] = buf);
  }
  const TAU = Math.PI * 2;
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };

  const SOUNDS = {
    // a soft rushing whoosh, swelling and fading (played over the length of the move)
    glide: () => make('glide', 1.2, (a, n) => {
      let lo = 0, band = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n, x = noise();
        lo += (x - lo) * (0.02 + 0.06 * Math.sin(Math.PI * u)); band = x - lo;   // (the rush brightens at its middle)
        a[i] = (lo * 0.7 + band * 0.12) * Math.sin(Math.PI * u) ** 1.5;
      }
    }),
    // the laser: a buzz played as if recorded backwards: each short pulse swells up out of nothing and cuts off sharp,
    // with a ringing feedback tone over it, swelling the same way (made to loop: the pulses run on while it fires)
    zap: () => make('zap', 0.48, (a, n) => {
      const PULSE = n / 4;   // (four swells in the loop)
      for (let i = 0; i < n; i++) {
        const t = i / RATE, u = (i % PULSE) / PULSE;
        const swell = Math.pow(u, 2.6) * Math.min(1, (1 - u) * 60);   // (rising, then a quick cut; no click at the cut)
        const buzz = ((150 * t) % 1) * 2 - 1;
        const ring = Math.sin(TAU * 1250 * t) * 0.5 + Math.sin(TAU * 1875 * t) * 0.25;   // (the feedback whine)
        a[i] = (buzz * 0.55 + ring * (0.3 + 0.7 * u) + noise() * 0.06) * swell;
      }
    }),
    // the struck piece heating up: a whine climbing as it goes white, trembling faster
    heat: () => make('heat', 1.0, (a, n) => {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n, f = 500 * Math.pow(5, u);
        ph += TAU * f / RATE;
        a[i] = (Math.sin(ph) + 0.3 * Math.sin(ph * 2.01)) * u * u * (0.8 + 0.2 * Math.sin(TAU * (6 + 30 * u) * i / RATE));
      }
    }),
    // the burst: a deep thump, a roar of noise falling away, and a crackle of sparks after
    boom: () => make('boom', 1.8, (a, n) => {
      let lo = 0, ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / RATE, x = noise();
        lo += (x - lo) * (0.25 * Math.exp(-t * 3) + 0.01);
        ph += TAU * (90 * Math.exp(-t * 4) + 40) / RATE;
        let s = Math.sin(ph) * Math.exp(-t * 5) * 1.2 + lo * Math.exp(-t * 2.5) * 1.5;
        if (t > 0.08 && noise() > 1 - 0.004 * Math.exp(-t * 1.5)) s += 0.8 * Math.sign(noise());   // (the crackle)
        a[i] = s;
      }
    }),
    // landing: a small glassy click
    land: () => make('land', 0.35, (a, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / RATE;
        a[i] = (Math.sin(TAU * 1800 * t) * 0.6 + Math.sin(TAU * 2710 * t) * 0.4 + Math.sin(TAU * 900 * t) * 0.5) * Math.exp(-t * 22);
      }
    }),
    // a king rising: a shimmering chime, notes climbing one after another and ringing on
    rise: () => make('rise', 2.2, (a, n) => chime(a, n, [523.25, 659.25, 783.99, 1046.5, 1318.5])),
    settle: () => make('settle', 2.2, (a, n) => chime(a, n, [1046.5, 783.99, 659.25, 523.25])),
    // a king floating: a low soft hum, gently swelling (made to loop)
    hum: () => make('hum', 2.0, (a, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / RATE;
        a[i] = (Math.sin(TAU * 110 * t) + 0.5 * Math.sin(TAU * 220 * t) + 0.2 * Math.sin(TAU * 165 * t)) * (0.75 + 0.25 * Math.sin(TAU * 0.5 * t));
      }
    })
  };
  function chime(a, n, notes) {
    notes.forEach((f, k) => {
      const at = Math.floor(k * 0.16 * RATE);
      for (let i = at; i < n; i++) {
        const t = (i - at) / RATE, env = Math.exp(-t * 2.2) * Math.min(1, t * 400);
        a[i] += (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t * 4)) * env * 0.5;
      }
    });
  }
  const LEVEL = { glide: 0.26, zap: 0.22, heat: 0.32, boom: 0.7, land: 0.35, rise: 0.45, settle: 0.38, hum: 0.09 };   // (all kept soft)

  function play(name, onto, { pitch = 1, volume = 1, loop = false, length = 0 } = {}) {
    if (ctx.state !== 'running') return null;   // (the browser holds sound back until you've clicked or pressed a key)
    const s = new THREE.PositionalAudio(listener);
    s.setBuffer(SOUNDS[name]());
    s.setRefDistance(0.6); s.setRolloffFactor(1.4);
    s.setVolume(LEVEL[name] * volume);
    s.setLoop(loop);
    s.setPlaybackRate(length ? pitch * s.buffer.duration / length : pitch);   // (stretched to last a set time, if asked)
    onto.add(s);
    s.onEnded = () => { s.isPlaying = false; onto.remove(s); s.disconnect(); };
    s.play();
    const stop = s.stop.bind(s);
    s.stop = () => { if (s.isPlaying) stop(); onto.remove(s); try { s.disconnect(); } catch (e) {} };
    return s;
  }
  return { play };
}
// ===================================================================================================================
// END OF Workshop/pieces/sounds.js
// ===================================================================================================================
