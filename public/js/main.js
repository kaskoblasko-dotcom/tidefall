import { Game } from './game.js';

const fill = document.getElementById('load-fill'), text = document.getElementById('load-text');
const progress = (p, msg) => { fill.style.width = `${Math.round(p * 100)}%`; text.textContent = msg; };

function fail(msg) {
  text.textContent = msg; text.style.color = '#c2452f'; fill.style.background = '#c2452f';
}

(async () => {
  const canvas = document.createElement('canvas');
  if (!(canvas.getContext('webgl2') || canvas.getContext('webgl'))) return fail('WebGL is not available in this browser. Try a current desktop Chrome, Edge or Firefox.');
  try {
    const game = new Game();
    window.__tidefall = game;
    await game.boot(progress);
    document.getElementById('scr-loading').hidden = true;
  } catch (e) {
    console.error(e);
    fail(`Failed to start: ${e.message}`);
  }
})();
