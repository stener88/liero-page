// Captures action frames for store/marketing images: host (with extension) + 3 guests fighting.
//   node scripts/marketing-capture.mjs   (needs npm run server + scripts/testsite on :8000)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const EXT = path.resolve('extension');
const SERVER = process.env.SERVER ?? 'localhost:8787';
const OUT = 'store/frames';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vp = { width: 1280, height: 800 };
const host = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'mk-')), {
  executablePath: exe, headless: true, viewport: vp, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'],
});
const A = host.pages()[0] ?? await host.newPage();
await A.goto('http://localhost:8000/index.html');
await A.goto(`http://localhost:8000/index.html#liero=new@${SERVER}`);
await A.waitForFunction(() => !!document.querySelector('liero-root'), null, { timeout: 15000 });
await sleep(2500);
const link = await A.evaluate(() => [...document.querySelector('liero-root').shadowRoot.querySelectorAll('input')].find((i) => i.readOnly)?.value);
const names = ['Stein', 'kaja', 'oleB', 'Mikko'];
const rename = (p, n) => p.evaluate((n) => {
  const i = [...document.querySelector('liero-root').shadowRoot.querySelectorAll('input')].find((x) => !x.readOnly);
  i.value = n; i.dispatchEvent(new Event('change'));
}, n);
await rename(A, names[0]);
const b = await chromium.launch({ executablePath: exe });
const guests = [];
for (let g = 0; g < 3; g++) {
  const p = await (await b.newContext({ viewport: vp })).newPage();
  await p.goto(link);
  await sleep(1800);
  await rename(p, names[g + 1]);
  console.log('guest', g, 'joined');
  guests.push(p);
}
await sleep(1000);
// Everyone fights: walk, rope, fire at random spots.
const act = async (p, i, t) => {
  const r = (n) => Math.floor(Math.random() * n);
  await p.mouse.move(200 + r(880), 150 + r(500));
  if (t % 5 === i % 5) { await p.mouse.down({ button: 'right' }); await sleep(40); await p.mouse.up({ button: 'right' }); }
  await p.keyboard.press(['Digit1', 'Digit3', 'Digit2', 'Digit5'][r(4)]);
  const k = ['KeyA', 'KeyD', 'KeyW'][r(3)];
  await p.keyboard.down(k);
  await p.mouse.down(); await sleep(120 + r(200)); await p.mouse.up();
  await p.keyboard.up(k);
};
let n = 0;
for (let t = 0; t < 26; t++) {
  await Promise.all([A, ...guests].map((p, i) => act(p, i, t)));
  console.log('t', t);
  if (t > 3) await A.screenshot({ path: `${OUT}/host-${String(n++).padStart(2, '0')}.png` });
}
await guests[0].screenshot({ path: `${OUT}/guest.png` });
// Clean "before" shot for comparison.
const C = await (await b.newContext({ viewport: vp, deviceScaleFactor: 2 })).newPage();
await C.goto('http://localhost:8000/index.html');
await C.screenshot({ path: `${OUT}/before.png` });
console.log('frames', n, link);
await host.close(); await b.close();
