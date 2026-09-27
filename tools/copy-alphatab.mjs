// Copies alphaTab's worker, worklet, core, music font and soundfont into .alphatab/, which
// angular.json serves from the site root. alphaTab resolves `./alphaTab.worker.mjs` relative to
// the bundled chunk (import.meta.url), so these files must sit next to the Angular chunks.
// The minified worker/worklet import `./alphaTab.core.mjs`, so the minified core is written
// under that name.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('@coderline/alphatab'));
const out = join(import.meta.dirname, '..', '.alphatab');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'font'), { recursive: true });
mkdirSync(join(out, 'soundfont'), { recursive: true });
cpSync(join(dist, 'alphaTab.core.min.mjs'), join(out, 'alphaTab.core.mjs'));
cpSync(join(dist, 'alphaTab.worker.min.mjs'), join(out, 'alphaTab.worker.mjs'));
cpSync(join(dist, 'alphaTab.worklet.min.mjs'), join(out, 'alphaTab.worklet.mjs'));
for (const f of ['Bravura.woff2', 'Bravura.woff', 'Bravura.otf', 'Bravura-OFL.txt']) {
  cpSync(join(dist, 'font', f), join(out, 'font', f));
}
for (const f of ['sonivox.sf3', 'LICENSE']) {
  cpSync(join(dist, 'soundfont', f), join(out, 'soundfont', f));
}
