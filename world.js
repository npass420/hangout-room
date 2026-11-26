// =====================================================================
// world.js — the connection to the online database, and who's online everywhere. Every page shares it.
// It watches all the places at once (the Doodle Gallery, the Game Room, the Maker and the Scene Room) and lists everyone online,
// each name with a little icon for where they are. The list is in the room's panel (top right; a 👥 button on phones).
// =====================================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// ---------- Online connection (Firebase) ----------
const firebaseConfig = {
  apiKey: "AIzaSyATJ802q3tyJ5XAzek9M_XoDTl24uHxyu4",
  authDomain: "hangout-room-872ee.firebaseapp.com",
  databaseURL: "https://hangout-room-872ee-default-rtdb.firebaseio.com",
  projectId: "hangout-room-872ee",
  storageBucket: "hangout-room-872ee.firebasestorage.app",
  messagingSenderId: "779393375939",
  appId: "1:779393375939:web:ec8f83ec990e0d7458cc76"
};
export const db = getDatabase(initializeApp(firebaseConfig));
export const myId = 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);  // a new id for each tab

// ---------- The places, and the little icon for each ----------
const PLACES = [
  { key: 'gallery', path: 'room/presence',   icon: '🎨', name: 'Doodle Gallery' },
  { key: 'game',    path: 'game/presence',   icon: '🐸', name: 'Game Room' },
  { key: 'maker',   path: 'maker/presence',  icon: '🛠', name: 'Maker' },
  { key: 'scene',   path: 'scene/presence',  icon: '🌌', name: 'Scene Room' }
];
const COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#3949ab', '#8e24aa'];   // the rooms' rainbow name colors
function doing(key, p) {   // a few words on what they're up to, where the room says
  if (key === 'gallery' && p.b) return ' · 🖍 at the board';
  return '';
}

// ---------- The look of the list ----------
const style = document.createElement('style');
style.textContent = `
  .wl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.5; }
  .wl .ic { display: inline-block; width: 1.5em; }
  .wl.away { opacity: 0.72; }
  .wlKey { margin-top: 6px; font-size: 11px; opacity: 0.6; line-height: 1.5; }`;
document.head.appendChild(style);

// ---------- Watching every place ----------
const everyone = {};   // place key -> { id: { name, c, ... } }
let here = 'gallery';  // where you are
for (const pl of PLACES) {
  everyone[pl.key] = {};
  onValue(ref(db, pl.path), s => { everyone[pl.key] = s.val() || {}; draw(); });
}

function draw() {
  // Everyone, the people where you are first (you at the top), then each other place in turn
  const order = [PLACES.find(p => p.key === here), ...PLACES.filter(p => p.key !== here)];
  const rows = [];
  for (const pl of order) {
    const list = Object.entries(everyone[pl.key]).filter(([, p]) => p && p.name)
      .sort(([a], [b]) => (b === myId) - (a === myId));
    for (const [id, p] of list) rows.push({ pl, id, p });
  }
  const seen = new Set(), people = rows.filter(r => !seen.has(r.id) && seen.add(r.id));   // anyone caught between places shows once
  const fill = list => {
    list.textContent = '';
    if (!people.length) { const d = document.createElement('div'); d.className = 'wl away'; d.textContent = 'Nobody yet'; list.appendChild(d); }
    for (const { pl, id, p } of people) {
      const d = document.createElement('div');
      d.className = 'wl' + (pl.key === here ? '' : ' away');
      d.title = `${p.name} · ${pl.name}`;
      const ic = document.createElement('span');
      ic.className = 'ic'; ic.textContent = pl.icon;
      d.appendChild(ic);
      if (Number.isInteger(p.c) && p.c >= 0 && p.c < 7) {   // their rainbow color
        const dot = document.createElement('span');
        dot.textContent = '● '; dot.style.color = COLORS[p.c];
        d.appendChild(dot);
      }
      d.appendChild(document.createTextNode(`${p.name}${id === myId ? ' (you)' : ''}${doing(pl.key, p)}`));
      list.appendChild(d);
    }
    const key = document.createElement('div');   // what the icons mean
    key.className = 'wlKey';
    key.textContent = PLACES.map(pl => `${pl.icon} ${pl.name}`).join(' · ');
    list.appendChild(key);
  };
  const title = `Online (${people.length})`;
  const h2 = document.querySelector('#who h2'), list = document.getElementById('whoList'), btn = document.getElementById('whoBtn');
  if (h2) h2.textContent = title;
  if (list) fill(list);
  if (btn) btn.textContent = `👥 ${people.length}`;
}
// ---------- In a room: the list fills the room's panel ----------
export function inRoom(key) {
  here = key;
  draw();
}