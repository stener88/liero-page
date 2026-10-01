import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:8787/');
await p.waitForTimeout(800);
await p.screenshot({ path: 'e2e-out/landing-full.png', fullPage: true });
await b.close();
