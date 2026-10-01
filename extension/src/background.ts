// Service worker: injects the game into the active tab on demand, and fetches
// cross-origin images for the map capture (content scripts can't read their pixels).

interface Opts { mode: 'host' | 'join'; room?: string; server?: string }

async function inject(tabId: number, opts: Opts) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (o: Opts) => { (window as unknown as { __lieroOpts: Opts }).__lieroOpts = o; },
    args: [opts],
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['dist/game.js'] });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) inject(tab.id, { mode: 'host' }).catch((e) => console.warn('[liero]', e));
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) inject(tab.id, { mode: 'host' }).catch((e) => console.warn('[liero]', e));
});

interface ImgReq { type: 'liero:img'; url: string; w: number; h: number; fit: string; pos: string }

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Fetch an image and render it exactly as the page lays it out (object-fit aware) at w×h device pixels. */
async function renderImage(req: ImgReq): Promise<string | null> {
  const w = Math.max(1, Math.min(4096, Math.round(req.w))), h = Math.max(1, Math.min(4096, Math.round(req.h)));
  const res = await fetch(req.url, { credentials: 'omit' });
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob());
  const iw = bmp.width, ih = bmp.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const [px, py] = (req.pos || '50% 50%').split(' ').map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : 0.5));
  if (req.fit === 'cover' || req.fit === 'contain' || req.fit === 'scale-down') {
    let s = req.fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    if (req.fit === 'scale-down') s = Math.min(1, s);
    const dw = iw * s, dh = ih * s;
    ctx.drawImage(bmp, (w - dw) * (px ?? 0.5), (h - dh) * (py ?? 0.5), dw, dh);
  } else if (req.fit === 'none') {
    ctx.drawImage(bmp, (w - iw) * (px ?? 0.5), (h - ih) * (py ?? 0.5));
  } else {
    ctx.drawImage(bmp, 0, 0, w, h);
  }
  bmp.close();
  const out = await canvas.convertToBlob({ type: 'image/png' });
  return `data:image/png;base64,${toBase64(await out.arrayBuffer())}`;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'liero:join' && sender.tab?.id !== undefined) {
    const opts: Opts = msg.room === 'new' ? { mode: 'host', server: msg.server } : { mode: 'join', room: msg.room, server: msg.server };
    inject(sender.tab.id, opts).catch((e) => console.warn('[liero]', e));
    return false;
  }
  if (msg?.type === 'liero:shot' && sender.tab) {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }).then(sendResponse, (e) => {
      console.warn('[liero] screenshot failed', e);
      sendResponse(null);
    });
    return true;
  }
  if (msg?.type === 'liero:img') {
    renderImage(msg as ImgReq).then(sendResponse, () => sendResponse(null));
    return true; // async response
  }
  return false;
});
