import * as alphaTab from '@coderline/alphatab';
import { LoadedSong } from '../song';
import { loadAlphaTabScore, sniffAlphaTabFormat } from './alphatab-import';
import { UnsupportedFormatError } from './errors';
import { loadMidiSong } from './midi/midi-song';
import { isSmf } from './midi/smf';
import { scoreToSong } from './score-song';
import { detectTuxGuitar, readTuxGuitar, tgToScore } from './tg';

export { FileFormatError, UnsupportedFormatError } from './errors';

/** File extensions offered in the file picker. */
export const SUPPORTED_EXTENSIONS = [
  '.tg',
  '.gp',
  '.gp3',
  '.gp4',
  '.gp5',
  '.gpx',
  '.musicxml',
  '.mxl',
  '.xml',
  '.capx',
  '.tex',
  '.alphatex',
  '.mid',
  '.midi',
];

/**
 * Reads any supported file. Detection is by content: MIDI, then TuxGuitar (a TG 2.x file is a
 * ZIP like GP7 and .mxl, so its entry names are checked before handing ZIPs to alphaTab),
 * then everything alphaTab understands.
 */
export function importFile(bytes: Uint8Array, fileName: string): LoadedSong {
  if (bytes.length === 0) {
    throw new UnsupportedFormatError('The file is empty.');
  }
  if (isSmf(bytes)) {
    return loadMidiSong(bytes, fileName);
  }
  const settings = createSettings();
  const tgFormat = detectTuxGuitar(bytes);
  if (tgFormat) {
    const song = readTuxGuitar(bytes, tgFormat);
    const version = tgFormat === 'tg-2' ? '2.x' : tgFormat.slice(3);
    return scoreToSong(tgToScore(song, settings), settings, {
      id: 'tg',
      label: `TuxGuitar ${version}`,
    });
  }
  const score = loadAlphaTabScore(bytes, settings);
  return scoreToSong(score, settings, sniffAlphaTabFormat(bytes));
}

export function createSettings(): alphaTab.Settings {
  return new alphaTab.Settings();
}
