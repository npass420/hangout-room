// =====================================================================
// sounds.js — little sound effects, made in code (no sound files needed). Every page and room shares this one file.
// =====================================================================
let ctx = null, master = null;
let muted = false;
try { muted = localStorage.getItem('hangoutMuted') === '1'; } catch (e) {}

// Browsers only allow sound after you click or tap something, so wake the sound up on every tap
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
window.addEventListener('pointerdown', () => { audio(); }, { passive: true });

// A single note
function tone(freq, { type = 'sine', dur = 0.15, vol = 0.15, delay = 0, slideTo = 0 } = {}) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

// A portal whoosh: rushing air (noise) swept up through a filter and back down, with a little swirl in it
let noiseBuf = null;
function noise(c) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function whoosh({ dur = 1.2, vol = 0.5, lo = 250, hi = 2600, delay = 0 } = {}) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay, peak = t0 + dur * 0.45, end = t0 + dur;
  const src = c.createBufferSource(); src.buffer = noise(c); src.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(lo, t0);
  bp.frequency.exponentialRampToValueAtTime(hi, peak);           // rushing up...
  bp.frequency.exponentialRampToValueAtTime(lo * 0.6, end);      // ...and falling away
  const swirl = c.createOscillator(), depth = c.createGain();    // a fast wobble on the filter makes it swirl
  swirl.frequency.value = 7; depth.gain.value = hi * 0.12;
  swirl.connect(depth); depth.connect(bp.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, peak);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(t0); src.stop(end + 0.05);
  swirl.start(t0); swirl.stop(end + 0.05);
}

// A burst of filtered noise: rushing air, a soft pomf, a hush
function hiss({ dur = 0.2, vol = 0.1, type = 'lowpass', f = 800, f2 = 0, q = 0.7, delay = 0, attack = 0.006 } = {}) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource(); src.buffer = noise(c); src.loop = true;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const flt = c.createBiquadFilter(); flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t0);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt); flt.connect(g); g.connect(master);
  src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
}
// A creak: a slow buzz of tiny ticks (wood rubbing on the hinge pin), its speed wandering, rung through a hollow filter
function creak({ dur = 1.0, vol = 0.05, delay = 0 } = {}) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay, end = t0 + dur;
  const o = c.createOscillator(); o.type = 'sawtooth';
  const curve = new Float32Array(16);
  for (let i = 0; i < 16; i++) curve[i] = 28 + 30 * Math.sin(i * 0.9 + Math.random()) ** 2 + Math.random() * 10;
  o.frequency.setValueCurveAtTime(curve, t0, dur);
  const b1 = c.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = 850 + Math.random() * 200; b1.Q.value = 7;
  const b2 = c.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = 1900; b2.Q.value = 9;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.12);
  g.gain.setValueAtTime(vol, end - 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  o.connect(b1); o.connect(b2); b1.connect(g); b2.connect(g); g.connect(master);
  o.start(t0); o.stop(end + 0.05);
}
// A note that wobbles as it slides: rubbery vinyl, or a bounce
function boing(from, to, { dur = 0.25, vol = 0.05, wob = 14, depth = 0.04, delay = 0, type = 'sine' } = {}) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), ld = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t0);
  o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  lfo.frequency.value = wob; ld.gain.value = from * depth;
  lfo.connect(ld); ld.connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
}
const vary = () => 0.94 + Math.random() * 0.12;   // never quite the same twice
let lastPat = 0;

export const sfx = {
  // Chat and the room
  ping()  { tone(880, { dur: 0.12, vol: 0.07 }); tone(1320, { dur: 0.16, vol: 0.06, delay: 0.08 }); },
  join()  { tone(660, { dur: 0.12, vol: 0.06 }); tone(990, { dur: 0.18, vol: 0.06, delay: 0.1 }); },
  leave() { tone(990, { dur: 0.12, vol: 0.05 }); tone(660, { dur: 0.18, vol: 0.05, delay: 0.1 }); },
  // The doodle board: a soft click for fills and Undo clear
  flip(delay = 0) { tone(620, { dur: 0.07, vol: 0.05, delay, slideTo: 900 }); },
  // A little fanfare when a doodle is saved to the gallery
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { type: 'triangle', dur: 0.2, vol: 0.12, delay: i * 0.12 }));
    [523, 659, 784].forEach(f => tone(f, { type: 'triangle', dur: 0.9, vol: 0.08, delay: 0.5 }));
  },
  // Portals: a big whoosh going through one (the Cave's orb and doors, and the portal home), a softer one as a room's door opens
  whoosh()     { whoosh({ dur: 1.2, vol: 0.5 }); tone(140, { dur: 1.0, vol: 0.05, delay: 0.1, slideTo: 420 }); },
  whooshSoft() { whoosh({ dur: 1.4, vol: 0.22, lo: 200, hi: 1400 }); },

  // Doors, each style its own: the latch letting go and the swing open, the swing shut, and the bump against the frame
  doorOpen(style) {
    if (style === 'tavern') {        // an iron clank, then a long old creak
      tone(720, { type: 'square', dur: 0.04, vol: 0.02 }); tone(480, { type: 'square', dur: 0.05, vol: 0.018, delay: 0.035 });
      creak({ dur: 1.15, vol: 0.05, delay: 0.14 });
      hiss({ dur: 0.9, vol: 0.025, type: 'bandpass', f: 300, f2: 700, delay: 0.2, attack: 0.3 });
    } else if (style === 'gallery') { // a crisp brass click, then a smooth hush of air
      tone(2600, { type: 'triangle', dur: 0.025, vol: 0.035 }); tone(1700, { type: 'triangle', dur: 0.03, vol: 0.03, delay: 0.03 });
      hiss({ dur: 1.0, vol: 0.05, type: 'bandpass', f: 500, f2: 1300, q: 1.2, delay: 0.15, attack: 0.35 });
    } else {                          // a squeaky vinyl stretch and a soft boing
      boing(560 * vary(), 900, { dur: 0.32, vol: 0.022, wob: 22, depth: 0.05, delay: 0.05 });
      boing(190 * vary(), 330, { dur: 0.32, vol: 0.05, wob: 9, delay: 0.14 });
      hiss({ dur: 0.5, vol: 0.03, f: 900, f2: 300, delay: 0.14, attack: 0.1 });
    }
  },
  doorSwing(style) {
    if (style === 'tavern') creak({ dur: 0.7, vol: 0.03 });
    else if (style === 'gallery') hiss({ dur: 0.6, vol: 0.035, type: 'bandpass', f: 1100, f2: 450, q: 1.2, attack: 0.25 });
    else boing(330 * vary(), 210, { dur: 0.35, vol: 0.03, wob: 10 });
  },
  doorThud(style, k = 1) {
    if (style === 'tavern') {        // heavy wood on wood, and the latch dropping
      tone(92, { dur: 0.3, vol: 0.2 * k, slideTo: 46 });
      hiss({ dur: 0.14, vol: 0.14 * k, f: 420 });
      tone(1500, { type: 'square', dur: 0.03, vol: 0.015 * k, delay: 0.07 });
    } else if (style === 'gallery') { // a soft, solid close and a click
      tone(130, { dur: 0.18, vol: 0.1 * k, slideTo: 75 });
      hiss({ dur: 0.08, vol: 0.05 * k, f: 900 });
      tone(2400, { type: 'triangle', dur: 0.02, vol: 0.03 * k, delay: 0.05 });
    } else {                          // a squishy pomf with a little bounce after it
      hiss({ dur: 0.2, vol: 0.12 * k, f: 280 });
      tone(140, { dur: 0.22, vol: 0.08 * k, slideTo: 85 });
      boing(260, 200, { dur: 0.18, vol: 0.025 * k, wob: 12, delay: 0.12 });
    }
  },

  // The bouncy floor: cute and tiny, never loud
  bounce() {      // leaving the cushions: a little springy boing
    const v = vary();
    boing(240 * v, 470 * v, { dur: 0.24, vol: 0.03, wob: 11, depth: 0.03 });
    boing(480 * v, 940 * v, { dur: 0.16, vol: 0.008, type: 'triangle' });
  },
  land(k = 1) {   // landing: a soft pomf into the velvet
    hiss({ dur: 0.18, vol: 0.05 * k, f: 240 * vary() });
    tone(115 * vary(), { dur: 0.2, vol: 0.045 * k, slideTo: 72 });
  },
  pat() {         // a footstep on the cushions: barely there (never more than a few a second)
    const now = performance.now();
    if (now - lastPat < 180) return;
    lastPat = now;
    tone(165 * vary(), { dur: 0.07, vol: 0.011, slideTo: 125 });
    hiss({ dur: 0.05, vol: 0.008, f: 520 });
  }
};

// The 🔊 button
export function setupMute(btn) {
  const show = () => { btn.textContent = muted ? '🔇' : '🔊'; btn.title = muted ? 'Sound is off' : 'Sound is on'; };
  show();
  btn.addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem('hangoutMuted', muted ? '1' : '0'); } catch (e) {}
    show();
    if (!muted) sfx.ping();
  });
}