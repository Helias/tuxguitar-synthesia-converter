// Regenerates test/fixtures/*.golden.json from every .tg fixture with TuxGuitar's own parser and
// MIDI sequencer:
//   - binary formats (0.7–1.5): tools/TgExtract.java against an installed TuxGuitar 1.5.x
//     (set TUXGUITAR_HOME if it is not /usr/share/tuxguitar);
//   - format 2.x (ZIP): tools/TgExtract20.java against TuxGuitar-lib built by
//     tools/build-tuxguitar-lib.sh.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const fixtures = join(root, 'test', 'fixtures');
const home = process.env.TUXGUITAR_HOME ?? '/usr/share/tuxguitar';
const tg15Classpath = `${home}/lib/*:${home}/plugins/*`;
const libClasspathFile = join(root, '.tuxguitar-lib', 'classpath');
const tg20Classpath = existsSync(libClasspathFile)
  ? readFileSync(libClasspathFile, 'utf8').trim()
  : null;

for (const file of readdirSync(fixtures).filter((f) => f.endsWith('.tg'))) {
  const path = join(fixtures, file);
  const isZip = readFileSync(path).subarray(0, 2).toString('latin1') === 'PK';
  if (isZip && !tg20Classpath) {
    console.warn(`${file}: skipped, run tools/build-tuxguitar-lib.sh first`);
    continue;
  }
  const [classpath, tool] = isZip
    ? [tg20Classpath, 'TgExtract20.java']
    : [tg15Classpath, 'TgExtract.java'];
  const json = execFileSync('java', ['-cp', classpath, join(root, 'tools', tool), path], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(join(fixtures, file.replace(/\.tg$/, '.golden.json')), json);
  console.log(`${file} → ${file.replace(/\.tg$/, '.golden.json')}`);
}
