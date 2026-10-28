// =====================================================================
// sounds.js — little sound effects, made in code (no sound files needed)
// =====================================================================
let ctx = null, master = null, noiseBuf = null;
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
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);   // one second of hiss for rattles and whooshes
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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
// A burst of filtered hiss
function hiss({ dur = 0.08, vol = 0.15, delay = 0, freq = 2500, freqTo = 0, q = 1.2 } = {}) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
}

export const sfx = {
  // Chat and the room
  ping()  { tone(880, { dur: 0.12, vol: 0.07 }); tone(1320, { dur: 0.16, vol: 0.06, delay: 0.08 }); },
  join()  { tone(660, { dur: 0.12, vol: 0.06 }); tone(990, { dur: 0.18, vol: 0.06, delay: 0.1 }); },
  leave() { tone(990, { dur: 0.12, vol: 0.05 }); tone(660, { dur: 0.18, vol: 0.05, delay: 0.1 }); },
  // Othello
  disc()  { tone(170, { type: 'triangle', dur: 0.08, vol: 0.2 }); hiss({ dur: 0.04, vol: 0.08, freq: 1800 }); },
  flip(delay = 0) { tone(620, { dur: 0.07, vol: 0.05, delay, slideTo: 900 }); },
  // LittleTrail
  dice() {
    for (let i = 0; i < 7; i++) hiss({ dur: 0.03, vol: 0.18, delay: i * 0.09 + Math.random() * 0.04, freq: 2600 + Math.random() * 1500, q: 3 });
    tone(140, { type: 'triangle', dur: 0.08, vol: 0.15, delay: 0.8 });
    tone(120, { type: 'triangle', dur: 0.08, vol: 0.12, delay: 0.88 });
  },
  hop()    { tone(520, { dur: 0.07, vol: 0.05, slideTo: 760 }); },
  whoosh() { hiss({ dur: 0.6, vol: 0.12, freq: 400, freqTo: 2400, q: 0.8 }); },
  coin()   { tone(1320, { type: 'triangle', dur: 0.09, vol: 0.09 }); tone(1760, { type: 'triangle', dur: 0.2, vol: 0.09, delay: 0.07 }); },
  buy()    { [523, 659, 784].forEach((f, i) => tone(f, { type: 'triangle', dur: 0.18, vol: 0.1, delay: i * 0.08 })); },
  card()   { hiss({ dur: 0.35, vol: 0.1, freq: 900, freqTo: 3000, q: 0.7 }); tone(880, { dur: 0.3, vol: 0.05, delay: 0.15 }); },
  out()    { tone(392, { type: 'sawtooth', dur: 0.25, vol: 0.05 }); tone(294, { type: 'sawtooth', dur: 0.45, vol: 0.05, delay: 0.22, slideTo: 220 }); },
  // LittleStack
  clack(v = 1) { tone(320 + Math.random() * 60, { type: 'triangle', dur: 0.06, vol: 0.18 * v }); hiss({ dur: 0.03, vol: 0.1 * v, freq: 3200, q: 2 }); },
  crash() {
    for (let i = 0; i < 14; i++) {
      const d = i * 0.07 + Math.random() * 0.12;
      tone(220 + Math.random() * 200, { type: 'triangle', dur: 0.07, vol: 0.12, delay: d });
      hiss({ dur: 0.04, vol: 0.08, delay: d, freq: 2500 + Math.random() * 1500, q: 2 });
    }
    tone(90, { type: 'sine', dur: 0.5, vol: 0.2, delay: 0.25, slideTo: 50 });
  },
  // Slot machines: a reel thunking to a stop
  reel()   { tone(150 + Math.random() * 30, { type: 'triangle', dur: 0.09, vol: 0.2 }); hiss({ dur: 0.05, vol: 0.12, freq: 1400, q: 1.5 }); },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { type: 'triangle', dur: 0.2, vol: 0.12, delay: i * 0.12 }));
    [523, 659, 784].forEach(f => tone(f, { type: 'triangle', dur: 0.9, vol: 0.08, delay: 0.5 }));
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