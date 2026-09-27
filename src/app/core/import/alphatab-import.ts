import * as alphaTab from '@coderline/alphatab';
import { FileFormatError, UnsupportedFormatError } from './errors';
import { isZip, zipEntryNames } from './tg';
import { SongFormat } from '../song';

/**
 * Loads Guitar Pro 3–8, MusicXML (plain or .mxl), Capella (CapXML) and alphaTex with alphaTab.
 * Older Guitar Pro files store Windows-1252 text; if UTF-8 decoding produced replacement
 * characters the file is read again with that encoding.
 */
export function loadAlphaTabScore(
  bytes: Uint8Array,
  settings: alphaTab.Settings,
): alphaTab.model.Score {
  let score = load(bytes, settings);
  if (hasReplacementChars(score)) {
    const latin = new alphaTab.Settings();
    latin.importer.encoding = 'windows-1252';
    try {
      score = load(bytes, latin);
    } catch {
      // Keep the UTF-8 result.
    }
  }
  return score;
}

function load(bytes: Uint8Array, settings: alphaTab.Settings): alphaTab.model.Score {
  try {
    return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
  } catch (e) {
    if (e instanceof alphaTab.AlphaTabError && e.type === alphaTab.AlphaTabErrorType.Format) {
      throw new FileFormatError(e.message || 'The file could not be read.');
    }
    if (e instanceof alphaTab.importer.UnsupportedFormatError) {
      throw new UnsupportedFormatError('This file format is not supported.');
    }
    throw new FileFormatError(e instanceof Error ? e.message : 'The file could not be read.');
  }
}

function hasReplacementChars(score: alphaTab.model.Score): boolean {
  const texts = [score.title, score.artist, score.album, ...score.tracks.map((t) => t.name)];
  return texts.some((t) => t?.includes('�'));
}

/** A human label for what alphaTab will read, from the file's magic bytes. */
export function sniffAlphaTabFormat(bytes: Uint8Array): SongFormat {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 512));
  if (head.includes('FICHIER GUITAR PRO')) {
    const version = /v(\d)\./.exec(head)?.[1] ?? '';
    return { id: 'gp', label: `Guitar Pro ${version}`.trim() };
  }
  if (head.startsWith('BCFZ') || head.startsWith('BCFS')) {
    return { id: 'gp', label: 'Guitar Pro 6' };
  }
  if (isZip(bytes)) {
    const entries = zipEntryNames(bytes);
    if (entries.some((e) => e.endsWith('score.gpif'))) return { id: 'gp', label: 'Guitar Pro 7–8' };
    return { id: 'musicxml', label: 'MusicXML (compressed)' };
  }
  if (/<score-(partwise|timewise)/.test(head) || head.includes('MusicXML')) {
    return { id: 'musicxml', label: 'MusicXML' };
  }
  if (/capella/i.test(head)) return { id: 'capxml', label: 'Capella (CapXML)' };
  return { id: 'alphatex', label: 'alphaTex' };
}
