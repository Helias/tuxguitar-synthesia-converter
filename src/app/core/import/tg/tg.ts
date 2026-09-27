import * as alphaTab from '@coderline/alphatab';
import { unzipSync } from 'fflate';
import { FileFormatError } from '../errors';
import { readTgHeader, readTgVersion } from './data-input';
import { TG_BINARY_VERSIONS, TgBinaryVersion, readTgBinary } from './tg-binary-reader';
import { TG07_HEADER, TG08_HEADER, readTgLegacy } from './tg-legacy-reader';
import { TgSong } from './tg-model';
import { isTg20Zip, readTg20 } from './tg20-reader';
import { tgPlaybackOrder } from './tg-playback-order';
import { tgSongToScore } from './tg-to-score';

export type TgFormat = 'tg-0.7' | 'tg-0.8' | 'tg-0.9' | `tg-${TgBinaryVersion}` | 'tg-2';

/** Identifies a TuxGuitar file from its bytes, or returns null. */
export function detectTuxGuitar(bytes: Uint8Array): TgFormat | null {
  if (isZip(bytes)) {
    return isTg20Zip(zipEntryNames(bytes)) ? 'tg-2' : null;
  }
  const header = readTgHeader(bytes);
  if (header === TG07_HEADER) return 'tg-0.7';
  if (header === TG08_HEADER) return 'tg-0.8';
  const version = readTgVersion(bytes);
  if (version === '0.9') return 'tg-0.9';
  if (TG_BINARY_VERSIONS.includes(version as TgBinaryVersion)) {
    return `tg-${version as TgBinaryVersion}`;
  }
  if (version !== null) {
    throw new FileFormatError(`TuxGuitar file format ${version} is not supported.`);
  }
  return null;
}

export function readTuxGuitar(bytes: Uint8Array, format: TgFormat): TgSong {
  switch (format) {
    case 'tg-2':
      return readTg20(bytes);
    case 'tg-0.7':
    case 'tg-0.8':
    case 'tg-0.9':
      return readTgLegacy(bytes, format.slice(3) as '0.7' | '0.8' | '0.9');
    default:
      return readTgBinary(bytes);
  }
}

export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
  );
}

/** Entry names of a ZIP archive, without inflating anything. */
export function zipEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
  } catch {
    return names;
  }
  return names;
}

/**
 * Builds the alphaTab Score for a TuxGuitar song. If alphaTab would play the bars in a different
 * order than TuxGuitar (see tgPlaybackOrder), the repeats are written out in TuxGuitar's order.
 */
export function tgToScore(song: TgSong, settings: alphaTab.Settings): alphaTab.model.Score {
  const score = tgSongToScore(song, settings);
  const tgOrder = tgPlaybackOrder(song);
  const alphaTabOrder = alphaTabPlaybackOrder(score, settings);
  const same =
    tgOrder.length === alphaTabOrder.length && tgOrder.every((bar, i) => bar === alphaTabOrder[i]);
  return same ? score : tgSongToScore(song, settings, tgOrder);
}

/** Master bar indices in the order alphaTab's MidiFileGenerator plays them. */
export function alphaTabPlaybackOrder(
  score: alphaTab.model.Score,
  settings: alphaTab.Settings,
): number[] {
  const noop = (): void => undefined;
  const handler: alphaTab.midi.IMidiFileHandler = {
    addTimeSignature: noop,
    addRest: noop,
    addNote: noop,
    addControlChange: noop,
    addProgramChange: noop,
    addTempo: noop,
    addNoteBend: noop,
    addBend: noop,
    finishTrack: noop,
    addTickShift: noop,
  };
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
  generator.generate();
  return generator.tickLookup.masterBars.map((m) => m.masterBar.index);
}
