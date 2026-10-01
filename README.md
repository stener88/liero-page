# Liero.page

**Every web page is a battlefield.** A real-time worm deathmatch, built on the original Liero, where the page you're on is the map. Click the toolbar icon on any site: the page freezes into destructible terrain, you get an invite link, and friends who open it drop into the same match from any desktop browser.

Play it at **[liero.page](https://liero.page)**: hit *Play on this page* and the landing page itself becomes the map.

Open source under the MIT license. Built on Liero (WTFPL) and OpenLiero (BSD-2-Clause); see [NOTICE.md](NOTICE.md).

## Quick start (local)

```bash
npm install
npm run build        # bundles the extension into extension/dist
npm run server       # room server on ws://localhost:8787
```

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → pick the `extension/` folder.
2. Open any page and click the Liero.page icon (or press `Alt+Shift+P`).
3. Click **Invite friends** (copies the link) and open the link in any other browser window. Guests don't need the extension.

Controls: `A/D` move · `W/Space` jump · click to fire (aim with the mouse) · right-click or `E` for the ninja rope · `W/S` reel in/out · `A+D` together to dig · `1-5`, `Q` or the wheel to switch weapons · `L` choose your 5 weapons · `Tab` show solid ground · `Z` zoom · `M` sound · `Esc` menu (invite link, your name, leave).

## Deploy to liero.page (Cloudflare)

One Worker serves everything on `liero.page`:

- `/`: landing page (`web/index.html`)
- `/privacy`: privacy policy (needed for the Chrome Web Store)
- `/r/<room>`: guest client for invite links. It runs in any desktop browser, no extension needed.
- `/room/<room>`: game WebSocket (one Durable Object per room)

```bash
npx wrangler login     # once, opens the browser
npm run deploy         # builds everything for liero.page and deploys the Worker + assets
```

Then reload the extension in `chrome://extensions`. `npm run deploy` also rebuilds it with `liero.page` as the default server. The domain needs to be in the same Cloudflare account; Wrangler creates the DNS record for the custom domain itself.

Who needs the extension: only the **host**, because only an extension can screenshot the page and read its layout. Invite links (`liero.page/r/<room>`) open the guest client, so friends can join from any desktop browser.

## Publish to the Chrome Web Store

```bash
npm run package      # builds for liero.page -> store/liero-<version>.zip
```

The store build asks only for `activeTab`, `scripting` and `storage`: it touches a page only when you click the icon. Listing copy, permission justifications and privacy answers are in `store/LISTING.md`; screenshots and promo tiles are in `store/assets/` (`node scripts/store-tiles.mjs` re-renders the tiles). Bump `version` in `extension/manifest.json` for every update.

## Landing page demo

`liero.page` has a **Play on this page** button: the landing page itself becomes the map (redrawn from the DOM, no extension), and the menu's invite link lets friends join. `node scripts/demo-test.mjs` tests it with a second browser joining.

## How it works

```
shared/liero/   the game: a port of Liero's logic (via OpenLiero), its data, and the binary netcode
shared/         map codec, protocol, terrain
server/         RoomCore (authoritative, 70 Hz) + Node dev server + Durable Object wrapper
extension/      MV3: loader (invite links) → background (injects, screenshots) → game (capture, net, render)
web/            landing page, privacy page and the guest client (liero.page/r/<room>)
scripts/        extract-liero.ts, tests (npm test), two-browser e2e test
```

- **Original Liero.** Weapons (all 40), particles, explosions, worm physics, the ninja rope, sprites, palette and sounds come from the original Liero 1.33 files. `scripts/extract-liero.ts` reads them using the offsets documented in OpenLiero's exe reader and generates `shared/liero/data.gen.ts` and `extension/src/game/liero-sounds.gen.ts`. The game logic is a TypeScript port of OpenLiero's `worm.cpp`, `weapon.cpp`, `nobject.cpp`, `sobject.cpp` and `ninjarope.cpp`: 16.16 fixed point at 70 ticks per second.
- **The page is the dirt.** The visible screen is screenshotted (`chrome.tabs.captureVisibleTab`) and shown untouched. The DOM decides what's solid: text lines, images, controls, boxes and borders become a 1 px mask. Everything solid is diggable, and Liero's dirt effects carve real Liero-shaped craters into it.
- **Netcode.** Clients send inputs (keys, mouse aim as a Liero angle, weapon slot). The server simulates and sends binary snapshots at 35 Hz: worms, weapon objects and damaging particles, plus tick-stamped events (explosions, dirt changes, blood stains, sounds). Purely cosmetic particles (debris, blood) are sent once as spawn events and simulated by each client. Your own worm is predicted with the same Liero physics, and others, projectiles and effects play 3–8 ticks (about 45–115 ms, adapting to connection jitter) in the past so explosions line up with the craters. Late joiners get the map, the current mask and a history of page damage.
- **Rooms.** One Durable Object per room ID. If the host leaves, the room carries on. If everyone leaves, it resets.

### Credits

Liero © 1998 Joosa Riekkinen. The original Liero data and binary files are available under the WTFPL (see `liero-original/LICENSE.TXT`). `LIERO.SND` contains sounds from MoleZ, which is freeware and freely distributable. Game logic follows [OpenLiero](https://github.com/openliero/openliero) (BSD-2-Clause) by Erik Lindroos and contributors. Full notices: [NOTICE.md](NOTICE.md).

## Tested

- `npm test`: Liero physics, rope, bazooka craters, kills and respawn, all 40 weapons firing, prediction determinism, map and snapshot codecs.
- `node scripts/e2e.mjs`: two headless Chromiums. The host has the extension; the guest has no extension and joins through the `/r/<room>` invite link. Both play, the guest opens the menu and weapon picker, then leaves through the menu. It also checks that game keys never type into a focused input on the page. This passes against both the Node server and the Durable Object (`wrangler dev`), including on a page with a strict `connect-src 'none'` CSP.

## Known gaps / next steps

- The arena is one screen. Bigger maps would need scroll-and-stitch screenshots (Chrome allows about 2 per second).
- Images that need cookies (logged-in content) or are `blob:` URLs fall back to grey blocks.
- Projectiles aren't predicted (your shot appears after about one round trip, though its sound plays instantly). Move to rollback if it feels laggy.
- Bonus crates and game modes (Game of Tag, Holdazone) from Liero aren't ported yet; it's free-for-all deathmatch.
- Guests need a keyboard and mouse (no touch controls yet).
- No public "room per URL" matchmaking yet, only invite links. The `/count/<room>` endpoint is already there for a "3 people here" badge.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm test` and `npx tsc --noEmit`; for gameplay or netcode changes also run `node scripts/e2e.mjs` and `node scripts/demo-test.mjs` (they need `npm run server` and `python3 -m http.server 8000` in `scripts/testsite`).

## License

MIT for Liero.page's own code (see [LICENSE](LICENSE)). Third-party code and data keep their licenses (see [NOTICE.md](NOTICE.md)).
