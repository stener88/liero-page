// Guest client: liero.page/r/<room>. Same game as the extension, minus the page capture —
// guests play on the host's snapshot, so no install is needed.
import { Game } from '../../extension/src/game/main.ts';

const room = location.pathname.match(/^\/r\/([\w-]{1,64})\/?$/)?.[1];
const note = document.getElementById('note');

if (!room) {
  location.replace('/');
} else {
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (touchOnly && note) {
    note.hidden = false;
    note.textContent = 'Liero.page needs a keyboard and mouse. Open this link on a computer to play.';
  }
  const game = new Game({
    mode: 'join',
    room,
    server: location.host,
    web: true,
    onExit: () => { location.href = '/'; },
  });
  game.start().catch((e) => {
    console.error('[liero]', e);
    if (note) { note.hidden = false; note.textContent = `Couldn't start the game: ${e?.message ?? e}`; }
  });
}
