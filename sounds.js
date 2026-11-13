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
  whooshSoft() { whoosh({ dur: 1.4, vol: 0.22, lo: 200, hi: 1400 }); }
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