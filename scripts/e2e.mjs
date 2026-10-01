// End-to-end: two Chromium instances with the extension, one hosts, one joins via invite link.
//   node scripts/e2e.mjs [pageUrl]
// Requires the dev server (npm run server) and a page to play on.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXT = path.resolve('extension');
const PAGE = process.argv[2] ?? 'http://localhost:8000/index.html';
const SERVER = process.env.SERVER ?? 'localhost:8787';
const OUT = process.env.OUT ?? 'e2e-out';
const exe = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(OUT, { recursive: true });

async function launch(tag, withExtension = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pw-${tag}-`));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: exe,
    headless: true,
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(process.env.DPR ?? 1),
    args: withExtension ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] : ['--headless=new'],
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('console', (m) => { if (/liero|error/i.test(m.text())) console.log(`[${tag}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`[${tag}] pageerror: ${e.message}`));
  return { ctx, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const panelLink = (page) => page.evaluate(() => [...(document.querySelector('liero-root')?.shadowRoot?.querySelectorAll('input') ?? [])].find((i) => i.readOnly)?.value ?? null);
const shadowClick = (page, text) => page.evaluate((t) => {
  const b = [...document.querySelector('liero-root').shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === t);
  if (!b) throw new Error('no button ' + t);
  b.click();
}, text);

const A = await launch('A');
await A.page.goto(PAGE);
await A.page.focus('#email').catch(() => {});
await A.page.screenshot({ path: `${OUT}/0-page.png` });
// Host via the "new room" hash (same path the toolbar button uses, without needing a click).
await A.page.goto(PAGE + `#liero=new@${SERVER}`);
await A.page.waitForFunction(() => !!document.querySelector('liero-root'), null, { timeout: 15000 });
await sleep(400);
await A.page.screenshot({ path: `${OUT}/1-intro.png` });
await sleep(2200);
await A.page.screenshot({ path: `${OUT}/2-host-alone.png` });
const link = await panelLink(A.page);
console.log('invite link:', link);
if (!link) throw new Error('no invite link');

// The guest has NO extension: invite links open the web client.
const B = await launch('B', false);
await B.page.goto(link);
await B.page.waitForFunction(() => !!document.querySelector('liero-root'), null, { timeout: 15000 });
await sleep(2500);
await B.page.screenshot({ path: `${OUT}/3-joiner.png` });

const room = link.match(/\/r\/([\w-]+)/)[1];
const count = await (await fetch(`http://${SERVER}/count/${room}`)).json();
console.log('players in room:', count.players);

// Play a bit: A walks right and fires bazooka at the mouse, B ropes up and sprays the minigun.
await A.page.mouse.move(900, 500);
await A.page.keyboard.down('KeyD');
await sleep(700);
await A.page.keyboard.up('KeyD');
for (let i = 0; i < 4; i++) { await A.page.mouse.down(); await sleep(80); await A.page.mouse.up(); await sleep(700); }
await A.page.keyboard.press('Digit3');
await A.page.mouse.move(700, 300);
await A.page.mouse.down(); await sleep(60); await A.page.mouse.up();

await B.page.keyboard.press('Digit2');
await B.page.mouse.move(640, 100);
await B.page.mouse.down({ button: 'right' }); await sleep(60); await B.page.mouse.up({ button: 'right' });
await B.page.keyboard.down('KeyW'); await sleep(600); await B.page.keyboard.up('KeyW');
await B.page.mouse.move(400, 600);
await B.page.mouse.down(); await sleep(900); await B.page.mouse.up();
await sleep(1200);
await A.page.screenshot({ path: `${OUT}/4-host-after.png` });
await B.page.screenshot({ path: `${OUT}/5-joiner-after.png` });
const typed = await A.page.evaluate(() => document.getElementById('email')?.value ?? '');
console.log('keys leaked into the page input:', JSON.stringify(typed));
if (typed) throw new Error('game keys typed into the page');

// Menu, weapon picker, rename.
await B.page.keyboard.press('Escape');
await sleep(250);
// Marketing screenshots: show the real address instead of localhost.
if (process.env.SHOT_LINK) await B.page.evaluate((l) => document.querySelector('liero-root').shadowRoot.querySelectorAll('input').forEach((i) => { if (i.readOnly) i.value = l; }), process.env.SHOT_LINK);
await B.page.screenshot({ path: `${OUT}/6-menu.png` });
await B.page.keyboard.press('KeyL');
await sleep(250);
await B.page.screenshot({ path: `${OUT}/7-weapons.png` });
await B.page.keyboard.press('Escape');
await sleep(150);
await B.page.keyboard.press('Escape');
await sleep(150);
// Leave from the menu restores the page.
await shadowClick(B.page, 'Leave game');
await sleep(800);
console.log('guest left to:', B.page.url());
await sleep(300);
const count2 = await (await fetch(`http://${SERVER}/count/${room}`)).json();
console.log('players after leave:', count2.players);

await A.ctx.close();
await B.ctx.close();
