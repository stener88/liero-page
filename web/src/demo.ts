// Landing-page demo: liero.page itself becomes the map. No extension needed, since this is our own
// page: it's redrawn from the DOM instead of screenshotted. Others can join with the invite link.
import { Game } from '../../extension/src/game/main.ts';

declare global { interface Window { __lieroDemo?: Game } }

export async function startDemo() {
  if (window.__lieroDemo) return;
  await document.fonts?.ready;
  // Lazy images that haven't scrolled into view yet would be blank in the map.
  await Promise.all([...document.images].map((img) => {
    img.loading = 'eager';
    return img.decode().catch(() => {});
  }));
  const game = new Game({
    mode: 'host',
    server: location.host,
    web: true,
    onExit: () => {
      delete window.__lieroDemo;
      document.body.classList.remove('playing');
    },
  });
  window.__lieroDemo = game;
  document.body.classList.add('playing');
  await game.start();
}

(window as unknown as { lieroDemo: typeof startDemo }).lieroDemo = startDemo;
void startDemo().catch((e) => {
  console.error('[liero]', e);
  delete window.__lieroDemo;
  document.body.classList.remove('playing');
});
