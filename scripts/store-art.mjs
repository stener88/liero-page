// Renders the Chrome Web Store / social images from real gameplay captures.
//   node scripts/marketing-capture.mjs && DPR=2 SHOT_LINK=https://liero.page/r/fv7pn3pp OUT=store/shots-hd node scripts/e2e.mjs
//   node scripts/store-art.mjs  -> store/assets/*.png
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const data = (f, t = 'image/png') => `data:${t};base64,${fs.readFileSync(f).toString('base64')}`;
const font = (f) => data(`store/fonts/${f}`, 'font/woff2');
const ACTION = process.env.ACTION ?? 'store/frames/host-17.png';
const ROPE = process.env.ROPE ?? 'store/frames/host-16.png';
const WRECK = process.env.WRECK ?? 'store/frames/host-21.png';
const img = {
  action: data(ACTION), rope: data(ROPE), wreck: data(WRECK), before: data('store/frames/before.png'),
  menu: data('store/shots-hd/6-menu.png'), weapons: data('store/shots-hd/7-weapons.png'), icon: data('extension/icons/128.png'),
};
const css = `
@font-face { font-family: Px; src: url(${font('press-start-2p-latin-400-normal.woff2')}); }
@font-face { font-family: Plex; src: url(${font('ibm-plex-mono-latin-400-normal.woff2')}); }
@font-face { font-family: Plex; font-weight: 600; src: url(${font('ibm-plex-mono-latin-600-normal.woff2')}); }
* { box-sizing: border-box; margin: 0; }
body { width: var(--w); height: var(--h); overflow: hidden; position: relative; color: #f2ecdf; font-family: Plex, monospace;
  background: radial-gradient(circle at 80% 20%, #2a2140 0, transparent 55%), #14111c; }
.px { font-family: Px, monospace; }
h1 { font: 400 var(--hs, 40px)/1.32 Px, monospace; text-shadow: 4px 4px 0 #000; }
h1 em { font-style: normal; color: #ff5a5f; } h1 b { font-weight: 400; color: #ffd23f; }
p { font-size: var(--ps, 21px); line-height: 1.5; color: #cfc6d8; }
.logo { display: flex; align-items: center; gap: 12px; font: 400 var(--ls, 16px)/1 Px, monospace; color: #ffd23f; }
.logo img { width: var(--li, 30px); height: var(--li, 30px); image-rendering: pixelated; }
.win { position: absolute; background: #0b0a10; border: 4px solid #000; box-shadow: 10px 10px 0 #000; overflow: hidden; }
.win .bar { height: 30px; display: flex; gap: 7px; align-items: center; padding: 0 12px; background: #2a2436; border-bottom: 4px solid #000; }
.win .bar i { width: 11px; height: 11px; background: #ff5a5f; } .win .bar i:nth-child(2) { background: #ffd23f; } .win .bar i:nth-child(3) { background: #7cff6b; }
.win .bar span { margin-left: 10px; flex: 1; background: #14111c; color: #a79fb5; font-size: 13px; padding: 2px 10px; }
.win .shot { width: 100%; height: calc(100% - 30px); background-size: cover; background-position: center; }
.dirt { position: absolute; left: 0; right: 0; bottom: 0; height: 22px;
  background: repeating-linear-gradient(90deg, #8a5a33 0 12px, #6b4425 12px 20px, #8a5a33 20px 36px, #7a4f2c 36px 44px); }
.tag { position: absolute; font: 400 13px/1 Px, monospace; color: #14111c; background: #ffd23f; padding: 10px 12px; box-shadow: 4px 4px 0 #000; }
.tag.red { background: #ff5a5f; } .tag.green { background: #7cff6b; } .tag.blue { background: #3ec1ff; }
`;
const win = (src, url, style, pos = 'center', size = 'cover') =>
  `<div class="win" style="${style}"><div class="bar"><i></i><i></i><i></i><span>${url}</span></div><div class="shot" style="background-image:url(${src});background-position:${pos};background-size:${size}"></div></div>`;
const logo = `<div class="logo"><img src="${img.icon}">LIERO.PAGE</div>`;

const pages = {
  'screenshot-1-gameplay': [1280, 800, `
    <div style="position:absolute;left:56px;top:48px;width:1170px">${logo}
      <h1 style="margin-top:22px">Every web page is a <em>battlefield</em>.</h1></div>
    ${win(img.action, 'dailybyte.news/rope-physics-considered-harmful', 'left:56px;top:210px;width:1168px;height:560px', '55% 60%', '118%')}
    <div class="tag" style="left:930px;top:178px;transform:rotate(3deg)">4 PLAYERS LIVE</div>`],
  'screenshot-2-invite': [1280, 800, `
    <div style="position:absolute;left:56px;top:60px;width:430px">${logo}
      <h1 style="margin-top:30px;--hs:30px">Friends join with a <b>link</b>.</h1>
      <p style="margin-top:26px">Send the invite and they drop straight into your match from Chrome, Safari or Firefox.</p>
      <p style="margin-top:18px;color:#7cff6b">No install for them.<br>Up to 8 players.</p></div>
    ${win(img.menu, 'liero.page/r/fv7pn3pp', 'left:520px;top:80px;width:720px;height:640px', '50% 45%')}
    <div class="dirt"></div>`],
  'screenshot-3-weapons': [1280, 800, `
    <div style="position:absolute;left:56px;top:48px;width:1170px">${logo}
      <h1 style="margin-top:22px">40 classic weapons. <b>Pick 5.</b></h1></div>
    ${win(img.weapons, 'Choose your weapons', 'left:56px;top:210px;width:1168px;height:560px', '50% 45%')}
    <div class="tag red" style="left:930px;top:178px;transform:rotate(-3deg)">ORIGINAL LIERO ARSENAL</div>`],
  'screenshot-4-rope': [1280, 800, `
    <div style="position:absolute;left:56px;top:60px;width:440px">${logo}
      <h1 style="margin-top:30px;--hs:30px">Swing. Dig. <em>Blow it up.</em></h1>
      <p style="margin-top:26px">Ninja-rope off headlines, tunnel through paragraphs and leave craters in the news. Original Liero physics.</p></div>
    ${win(img.rope, 'dailybyte.news', 'left:530px;top:80px;width:710px;height:640px', '60% 58%', '165%')}
    <div class="dirt"></div>`],
  'screenshot-5-before-after': [1280, 800, `
    <div style="position:absolute;left:56px;top:48px;width:1170px">${logo}
      <h1 style="margin-top:22px;--hs:34px">Any page becomes the map.</h1>
      <p style="margin-top:12px">The real site is never changed. Leave the game and it's all back.</p></div>
    ${win(img.before, 'before', 'left:56px;top:260px;width:560px;height:470px', '40% 40%')}
    ${win(img.wreck, 'after', 'left:664px;top:260px;width:560px;height:470px', '40% 40%')}
    <div class="tag" style="left:560px;top:470px;font-size:20px;z-index:2">→</div>`],
  'promo-small-440x280': [440, 280, `
    <div class="win" style="left:0;top:0;width:440px;height:280px;border:0;box-shadow:none"><div class="shot" style="height:100%;background-image:url(${img.action});background-size:700px;background-position:55% 62%"></div></div>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,17,28,.96) 0,rgba(20,17,28,.88) 42%,rgba(20,17,28,.15) 72%,rgba(20,17,28,0) 100%)"></div>
    <div style="position:absolute;left:22px;top:22px;right:22px"><div class="logo" style="--ls:20px;--li:30px"><img src="${img.icon}">LIERO.PAGE</div>
      <h1 style="--hs:16px;margin-top:14px;line-height:1.5">Every web page is a <em>battlefield</em>.</h1></div>`],
  'promo-marquee-1400x560': [1400, 560, `
    <div style="position:absolute;left:64px;top:96px;width:560px">${logo.replace('--ls', '')}
      <h1 style="--hs:38px;margin-top:28px">Every web page is a <em>battlefield</em>.</h1>
      <p style="margin-top:22px;--ps:20px">Real-time worm deathmatch on the page you're on. Send a link, friends join from their browser.</p></div>
    ${win(img.action, 'dailybyte.news', 'left:690px;top:60px;width:660px;height:470px;transform:rotate(1.5deg)', '55% 55%', '145%')}
    <div class="dirt"></div>`],
  'og-1200x630': [1200, 630, `
    <div style="position:absolute;left:60px;top:84px;width:520px">${logo}
      <h1 style="--hs:36px;margin-top:28px">Every web page is a <em>battlefield</em>.</h1>
      <p style="margin-top:22px">Real-time worm deathmatch on any site. Send a link, friends join.</p></div>
    ${win(img.action, 'liero.page', 'left:620px;top:70px;width:540px;height:470px;transform:rotate(1.5deg)', '55% 55%', '150%')}
    <div class="dirt"></div>`],
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [name, [w, h, body]] of Object.entries(pages)) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(`<html><head><style>:root{--w:${w}px;--h:${h}px}${css}</style></head><body>${body}</body></html>`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  await p.screenshot({ path: `store/assets/${name}.png` });
  await p.close();
}
await b.close();
console.log('ok');
