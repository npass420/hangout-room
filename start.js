// =====================================================================
// start.js — the front door. There's no lobby any more: the page opens straight into the Doodle Gallery.
// A black cover with a turning snowflake hides the room while it loads; then the cover fades and the gallery shows,
// with the name box over it. Type your name (or keep the saved one) and press Enter or ✓ to step in.
// Testing on this PC: localhost:8080/HangoutRoom/?room=game opens the Game Room instead, until the portals exist.
// =====================================================================
const ROOMS = {
  gallery: { name: 'Doodle Gallery', file: './studio/studio.js' },
  game:    { name: 'Game Room', file: './game/games.js' }
};
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const asked = LOCAL ? new URLSearchParams(location.search).get('room') : null;
const room = ROOMS[asked] ? asked : 'gallery';

const cover = document.getElementById('cover');
const loadFlake = document.getElementById('loadFlake');
const nameBox = document.getElementById('nameBox');
const nameInput = document.getElementById('nameInput');
const nameTitle = document.getElementById('nameTitle');

// ---------- The name box: a saved name is filled in, so it's one press to come in ----------
let saved = '';
try { saved = (localStorage.getItem('hangoutName') || '').trim().slice(0, 20); } catch (e) {}
if (saved) { nameInput.value = saved; nameTitle.textContent = `Welcome back, ${saved}!`; }
document.getElementById('nameOk').addEventListener('click', () => document.getElementById('enter').click());   // the room's own way in

// ---------- Load the room behind the cover, then fade the cover away ----------
loadFlake.classList.add('on');
window.addEventListener('room-ready', () => {
  window.dispatchEvent(new Event('room-show'));
  loadFlake.classList.remove('on');
  cover.classList.add('gone');
  setTimeout(() => { cover.style.display = 'none'; }, 1400);
  nameBox.classList.add('show');
  if (!('ontouchstart' in window)) { nameInput.focus(); nameInput.select(); }   // (no pop-up keyboard on phones until they tap it)
}, { once: true });
import(ROOMS[room].file).catch(e => {
  console.warn('Room load', e);
  loadFlake.textContent = `${ROOMS[room].name} couldn't load · tap to try again`;
  loadFlake.classList.add('oops');
  loadFlake.addEventListener('click', () => location.reload());
});
