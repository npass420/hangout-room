// =====================================================================
// world.js — the connection to the online database, and who's online everywhere. Every page shares it.
// It watches all the places at once (the Cave, the Doodle Gallery, the Table Room and the Game Room) and lists everyone
// online, each name with a little icon for where they are. In a room the list is in the room's panel (top right); in the
// Cave it gets a panel of its own (bottom right, clear of the doorways' names; a 👥 button at the top on phones).
// =====================================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getDatabase, ref, set, remove, onValue, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

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
  { key: 'lobby',   path: 'lobby/presence',  icon: '🧊', name: 'Cave' },
  { key: 'gallery', path: 'room/presence',   icon: '🎨', name: 'Doodle Gallery' },
  { key: 'tables',  path: 'tables/presence', icon: '♟️', name: 'Table Room' },
  { key: 'game',    path: 'game/presence',   icon: '🐸', name: 'Game Room' }
];
const COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#3949ab', '#8e24aa'];   // the rooms' rainbow name colors
const GAMES = { checkers: 'Checkers', chess: 'Chess', othello: 'Othello' };
function doing(key, p) {   // a few words on what they're up to, where the room says
  if (key === 'tables' && typeof p.s === 'string' && GAMES[p.s.split(':')[0]]) return ` · playing ${GAMES[p.s.split(':')[0]]}`;
  if (key === 'gallery' && p.b) return ' · 🖍 at the board';
  return '';
}

// ---------- The look of the list ----------
const style = document.createElement('style');
style.textContent = `
  .wl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.5; }
  .wl .ic { display: inline-block; width: 1.5em; }
  .wl.away { opacity: 0.72; }
  .wlKey { margin-top: 6px; font-size: 11px; opacity: 0.6; line-height: 1.5; }
  #worldBox { right: 16px; bottom: 16px; z-index: 26; min-width: 160px; max-width: 240px; font-size: 14px; transition: opacity 0.5s; }
  #worldBox h2 { margin: 0 0 6px; font-size: 15px; font-weight: normal; opacity: 0.8; cursor: default; }
  #worldBox.leaving { opacity: 0; }
  @media (max-width: 700px) {
    #worldBox { top: 8px; bottom: auto; right: 8px; min-width: 0; padding: 6px 12px; border-radius: 14px; }
    #worldBox h2 { margin: 0; font-size: 14px; cursor: pointer; }
    #worldBox:not(.open) .wlBody { display: none; }
    #worldBox.open { left: 8px; max-width: none; padding: 12px 14px; }
    #worldBox.open h2 { margin-bottom: 6px; }
  }`;
document.head.appendChild(style);

// ---------- Watching every place ----------
const everyone = {};   // place key -> { id: { name, c, ... } }
let here = 'lobby';    // where you are
let box = null;        // the Cave's own panel
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
      if (Number.isInteger(p.c) && p.c >= 0 && p.c < 7) {   // their rainbow color (the Cave doesn't give one)
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
  if (box) {
    box.querySelector('h2').textContent = box.classList.contains('open') || !isPhone() ? title : `👥 ${people.length}`;
    fill(box.querySelector('.wlBody'));
  }
  if (here !== 'lobby') {   // a room: its own panel at the top right, and the 👥 button on phones
    const h2 = document.querySelector('#who h2'), list = document.getElementById('whoList'), btn = document.getElementById('whoBtn');
    if (h2) h2.textContent = title;
    if (list) fill(list);
    if (btn) btn.textContent = `👥 ${people.length}`;
  }
}
const isPhone = () => window.matchMedia('(max-width: 700px)').matches;

// ---------- In the Cave: its own panel, and you count as being here once you've picked a name ----------
export function inCave() {
  here = 'lobby';
  box = document.createElement('div');
  box.id = 'worldBox'; box.className = 'panel';
  box.innerHTML = '<h2></h2><div class="wlBody"></div>';
  box.querySelector('h2').addEventListener('click', () => { if (isPhone()) { box.classList.toggle('open'); draw(); } });
  document.body.appendChild(box);
  draw();
}
const meInCave = ref(db, 'lobby/presence/' + myId);
let caveName = '';
function sayInCave() {
  if (!caveName) return;
  set(meInCave, { name: caveName, t: Date.now() }).catch(() => {});
  onDisconnect(meInCave).remove();   // gone from the list if you close the tab or lose the connection
}
onValue(ref(db, '.info/connected'), s => { if (s.val() === true) sayInCave(); });   // and back on it when you reconnect
export function joinCave(name) {   // you picked a name in the Cave (or came back with one)
  if (here !== 'lobby' || !box || !name) return;
  caveName = name;
  sayInCave();
}
export function leaveCave() {      // you're going through to a room
  caveName = '';
  remove(meInCave).catch(() => {});
  if (box) {
    box.classList.add('leaving');
    const b = box; box = null;
    setTimeout(() => b.remove(), 600);
  }
}
// ---------- In a room: the list fills the room's panel ----------
export function inRoom(key) {
  here = key;
  draw();
}