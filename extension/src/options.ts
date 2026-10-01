declare const __DEFAULT_SERVER__: string;

const server = document.getElementById('server') as HTMLInputElement;
const nameEl = document.getElementById('name') as HTMLInputElement;
const saved = document.getElementById('saved') as HTMLElement;
server.placeholder = __DEFAULT_SERVER__;

chrome.storage.sync.get(['server', 'name']).then((s) => {
  server.value = s.server ?? '';
  nameEl.value = s.name ?? '';
});

document.getElementById('form')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  await chrome.storage.sync.set({ server: server.value.trim(), name: nameEl.value.trim().slice(0, 16) });
  saved.textContent = 'Saved';
  setTimeout(() => (saved.textContent = ''), 1500);
});
export {};
