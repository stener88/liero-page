// Builds the Chrome Web Store upload: store/liero-<version>.zip
//   npm run package
// The store version asks for the minimum permissions: it only touches a page when you click the
// Liero.page icon (or press Alt+Shift+P). No "read all your sites" permission, no script on every page.
// (The unpacked dev extension keeps the #liero= link loader, which the e2e test uses.)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ext = path.join(root, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
delete manifest.host_permissions;
delete manifest.content_scripts;
manifest.permissions = ['activeTab', 'scripting', 'storage'];

const game = fs.readFileSync(path.join(ext, 'dist/game.js'), 'utf8');
if (game.includes('localhost:8787') && !game.includes('liero.page')) {
  console.error('dist/ was built for localhost. Run `npm run package` (it builds for liero.page first).');
  process.exit(1);
}

const out = path.join(root, 'store', 'build');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'dist'), { recursive: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const f of ['background.js', 'game.js', 'options.js']) fs.copyFileSync(path.join(ext, 'dist', f), path.join(out, 'dist', f));
for (const f of fs.readdirSync(path.join(ext, 'icons'))) fs.copyFileSync(path.join(ext, 'icons', f), path.join(out, 'icons', f));
fs.copyFileSync(path.join(ext, 'options.html'), path.join(out, 'options.html'));

const zip = path.join(root, 'store', `liero-${manifest.version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
console.log(`Store package: ${path.relative(root, zip)} (${(fs.statSync(zip).size / 1024).toFixed(0)} KB)`);
console.log('Permissions:', manifest.permissions.join(', '));
