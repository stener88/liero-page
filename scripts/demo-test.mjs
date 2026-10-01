// Landing page demo: play on liero.page itself (no extension), and a friend joins via the invite link.
//   node scripts/demo-test.mjs   (needs npm run server)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const SERVER = process.env.SERVER ?? 'localhost:8787';
const OUT = process.env.OUT ?? 'e2e-out/demo';
fs.mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: exe });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = async (tag) => {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 1) })).newPage();
  p.on('console', (m) => { if (/liero|error/i.test(m.text())) console.log(`[${tag}] ${m.text()}`); });
  p.on('pageerror', (e) => console.log(`[${tag}] pageerror: ${e.message}`));
  return p;
};
const A = await mk('A');
await A.goto(`http://${SERVER}/`);
await sleep(800);
await A.screenshot({ path: `${OUT}/0-landing.png` });
await A.screenshot({ path: `${OUT}/0-landing-full.png`, fullPage: true });
await A.click('header .play');
await A.waitForFunction(() => !!document.querySelector('liero-root'), null, { timeout: 15000 });
await sleep(3000);
await A.screenshot({ path: `${OUT}/1-demo.png` });
const link = await A.evaluate(() => [...document.querySelector('liero-root').shadowRoot.querySelectorAll('input')].find((i) => i.readOnly)?.value);
console.log('invite:', link);
const B = await mk('B');
await B.goto(link);
await sleep(3000);
await A.mouse.move(900, 300);
for (let i = 0; i < 3; i++) { await A.mouse.down(); await sleep(80); await A.mouse.up(); await sleep(600); }
await B.keyboard.down('KeyD'); await sleep(500); await B.keyboard.up('KeyD');
await sleep(1500);
await A.screenshot({ path: `${OUT}/2-host.png` });
await B.screenshot({ path: `${OUT}/3-guest.png` });
const room = link.match(/\/r\/([\w-]+)/)[1];
console.log('players:', (await (await fetch(`http://${SERVER}/count/${room}`)).json()).players);
await A.keyboard.press('Escape'); await sleep(200);
await A.evaluate(() => [...document.querySelector('liero-root').shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Leave game').click());
await sleep(500);
console.log('page restored:', await A.evaluate(() => !document.querySelector('liero-root') && !document.body.classList.contains('playing')));
await b.close();
