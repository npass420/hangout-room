// hud.js — the rooms' on-screen bits stay out of the way until you want them:
//   three small buttons in the corners, each opening its panel and leaving it open until it's clicked again:
//     💬 bottom left: the chat (a red dot on it when a message comes in while it's closed)
//     ☰  bottom right: the menu (connection, sound, and the room's buttons)
//     👥 top right: who's here, in every room (world.js keeps the count on the button)
//   the room's title and its instructions at the top show when they change (entering, sitting down, standing up),
//   then fade away after a few seconds.
// setupHud() once per room.

const TITLE_TIME = 4000;  // how long the title and instructions show before fading (ms)
let started = false;

export function setupHud() {
  if (started) return;
  started = true;
  const css = document.createElement('style');
  css.textContent = `#ui { transition: opacity 0.8s; } #ui.faded { opacity: 0; }`;
  document.head.appendChild(css);

  // the corner buttons: each one opens and closes its own panel
  const toggle = (btnId, cls, opened) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const open = document.body.classList.toggle(cls);
      btn.blur();
      if (open && opened) opened();
    });
  };
  toggle('chatBtn', 'chatOpen', () => {
    const dot = document.getElementById('newDot'), msgs = document.getElementById('msgs'), input = document.getElementById('chatInput');
    if (dot) dot.style.display = 'none';
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    if (input && !window.matchMedia('(max-width: 700px)').matches) input.focus();   // (ready to type; not on phones, where it pops the keyboard)
  });
  toggle('menuBtn', 'menuOpen');
  toggle('whoBtn', 'whoOpen');

  // the title and instructions: shown when their words change, then faded
  const ui = document.getElementById('ui');
  if (ui) {
    let words = '', timer = 0;
    const show = () => {
      const now = ui.textContent;
      if (now === words) return;   // (set again with the same words: nothing new to show)
      words = now;
      ui.classList.remove('faded');
      clearTimeout(timer);
      timer = setTimeout(() => ui.classList.add('faded'), TITLE_TIME);
    };
    new MutationObserver(show).observe(ui, { childList: true, characterData: true, subtree: true });
    window.addEventListener('room-show', () => { words = ''; show(); });
    show();
  }
}
