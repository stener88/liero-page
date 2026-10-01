# Chrome Web Store listing: copy and answers

Paste these into the developer dashboard (https://chrome.google.com/webstore/devconsole).

## Store listing tab

**Name:** Liero.page

**Summary (max 132 characters):**
Turn any web page into a real-time worm deathmatch. Send a link, and friends join from their browser. No install needed for them.

**Category:** Entertainment (or Games, if offered)

**Language:** English

**Description:**

Every web page is a battlefield.

Click the Liero.page icon on any page, a news article, Wikipedia, your company's careers page, and it freezes into a map exactly as you see it. Headlines become ledges, images become cover, and rockets leave craters in the text.

Send the invite link and your friends drop straight into the match from any desktop browser. Only the host needs the extension.

• Real-time online multiplayer, up to 8 players
• 40 classic weapons: bazooka, grenades, miniguns, mines, nukes and more. Pick your 5.
• Ninja rope for swinging across the page
• Every page is a new map, and every map is destructible
• Original-style sound effects (toggle with M)
• The real page is never changed. Leave the game and everything is back.

Controls: A/D move · W jump · click to fire · right-click for the ninja rope · 1–5 switch weapons · L choose weapons · Esc menu

Built on the classic game logic of Liero (1998, WTFPL) via OpenLiero.

**Graphics (in store/assets):**
- Store icon: icon-128.png
- Screenshots (1280×800): screenshot-1-gameplay.png, screenshot-2-weapons.png, screenshot-3-invite.png
- Small promo tile (440×280): promo-small-440x280.png
- Marquee promo tile (1400×560): promo-marquee-1400x560.png

**Official URL / homepage:** https://liero.page
**Support URL:** mailto:hello@liero.page (or https://liero.page)

## Privacy practices tab

**Single purpose:**
Liero.page turns the web page the user is viewing into a multiplayer game map when the user clicks the extension icon, so they can play a real-time game on it with friends.

**Permission justifications:**
- **activeTab:** Gives the extension access to the current tab only after the user clicks the Liero.page icon or presses its shortcut. Needed to take a screenshot of the visible page (the game map) and to start the game on that page.
- **scripting:** Injects the game into the current tab when the user clicks the icon. Nothing is injected otherwise.
- **storage:** Saves the player's name, sound setting and chosen weapons.

**Remote code:** No, I am not using remote code. (All code is bundled in the package. The game server only sends game data.)

**Data usage (tick these):**
- **Website content:** YES. When the user starts a game, a screenshot of the visible tab and the layout of the page are sent to the Liero.page game server and shown to the players in that match.
- Everything else (personally identifiable info, health, financial, authentication, personal communications, location, web history, user activity): NO.

**Certify all three:**
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://liero.page/privacy

## Distribution tab
- Visibility: Public (or Unlisted for a soft launch: only people with the link can install)
- Regions: All regions
- Price: Free
