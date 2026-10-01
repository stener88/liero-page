import { chromium } from 'playwright-core';
import fs from 'node:fs';
const shot = 'data:image/png;base64,' + fs.readFileSync('store/shots-raw/4-host-after.png').toString('base64');
const icon = 'data:image/png;base64,' + fs.readFileSync('extension/icons/128.png').toString('base64');
const html = (w, h, big) => `<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#0b0d12;font-family:system-ui,-apple-system,sans-serif">
<div style="position:absolute;inset:0;background:url(${shot}) ${big ? '100% 55%' : '80% 62%'}/${big ? '1400px' : '760px'} no-repeat;opacity:.9"></div>
<div style="position:absolute;inset:0;background:linear-gradient(90deg,#0b0d12 ${big ? 38 : 30}%,rgba(11,13,18,.55) ${big ? 60 : 62}%,rgba(11,13,18,.05))"></div>
<div style="position:absolute;left:${big ? 72 : 28}px;top:50%;transform:translateY(-50%);color:#e9ecf2;max-width:${big ? 560 : 230}px">
 <div style="display:flex;align-items:center;gap:${big ? 16 : 10}px"><img src="${icon}" style="width:${big ? 64 : 36}px;image-rendering:pixelated">
 <span style="font:800 ${big ? 44 : 24}px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;color:#ffd23f">LIERO.PAGE</span></div>
 <div style="font-weight:800;font-size:${big ? 46 : 22}px;line-height:1.08;margin-top:${big ? 22 : 12}px">Every web page is a battlefield.</div>
 ${big ? '<div style="font-size:22px;color:#aab2c0;margin-top:16px">Real-time worm deathmatch on the page you\'re on. Send a link, friends join in their browser.</div>' : ''}
</div></body></html>`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [w, h, name, big] of [[440, 280, 'promo-small-440x280', false], [1400, 560, 'promo-marquee-1400x560', true], [1200, 630, 'og-1200x630', true]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html(w, h, big));
  await p.screenshot({ path: `store/assets/${name}.png` });
}
await b.close();
