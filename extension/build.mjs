// Bundles the extension into extension/dist.
//   LIERO_SERVER=liero.you.workers.dev node extension/build.mjs
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const server = process.env.LIERO_SERVER || 'localhost:8787';

const ctx = await esbuild.context({
  entryPoints: {
    background: path.join(dir, 'src/background.ts'),
    loader: path.join(dir, 'src/loader.ts'),
    game: path.join(dir, 'src/game/entry.ts'),
    options: path.join(dir, 'src/options.ts'),
  },
  outdir: path.join(dir, 'dist'),
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  define: { __DEFAULT_SERVER__: JSON.stringify(server) },
  logLevel: 'info',
});

// Guest web client (served at liero.page/r/<room>); always talks to the server it's served from.
const web = await esbuild.context({
  entryPoints: { play: path.join(dir, '../web/src/play.ts'), demo: path.join(dir, '../web/src/demo.ts') },
  outdir: path.join(dir, '../web/dist'),
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'firefox115', 'safari16'],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  define: { __DEFAULT_SERVER__: JSON.stringify(server) },
  logLevel: 'info',
});

if (watch) {
  await Promise.all([ctx.watch(), web.watch()]);
} else {
  await Promise.all([ctx.rebuild(), web.rebuild()]);
  await Promise.all([ctx.dispose(), web.dispose()]);
}
