// Tiny content script on every page: if the URL carries an invite
// (#liero=<room>@<server>), ask the background worker to start the game.

let last = '';
function check() {
  const m = location.hash.match(/liero=([\w-]{1,64})(?:@([^&\s]+))?/);
  if (!m || m[0] === last) return;
  last = m[0];
  // Wait a moment so the page has laid out (the host may need to capture it).
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'liero:join', room: m[1], server: m[2] ? decodeURIComponent(m[2]) : undefined });
  }, 600);
}

if (document.readyState === 'complete') check();
else window.addEventListener('load', check, { once: true });
window.addEventListener('hashchange', check);
