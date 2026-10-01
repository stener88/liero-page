// Extension entry: injected into the tab by the background worker. Clicking the icon again leaves.
import { Game, type GameOpts } from './main.ts';

{
  const w = window as unknown as { __lieroGame?: Game; __lieroOpts?: GameOpts };
  const opts = w.__lieroOpts ?? { mode: 'host' };
  delete w.__lieroOpts;
  if (w.__lieroGame) {
    w.__lieroGame.destroy();
  } else {
    const g = new Game(opts);
    w.__lieroGame = g;
    g.start().catch((e) => { console.error('[liero]', e); g.destroy(); });
  }
}
