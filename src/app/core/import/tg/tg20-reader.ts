import { unzipSync } from 'fflate';
import { FileFormatError } from '../errors';
import {
  CLEF_ALTO,
  CLEF_BASS,
  CLEF_TENOR,
  CLEF_TREBLE,
  QUARTER_TIME,
  STROKE_DOWN,
  STROKE_UP,
  TRIPLET_FEEL_EIGHTH,
  TRIPLET_FEEL_NONE,
  TRIPLET_FEEL_SIXTEENTH,
  TgBeat,
  TgBendPoint,
  TgChannel,
  TgMeasure,
  TgMeasureHeader,
  TgNote,
  TgSong,
  TgTrack,
  TgVoice,
  VELOCITY_DEFAULT,
  measureLength,
  newDuration,
  newHeader,
  newNoteEffect,
  newSong,
  newVoice,
} from './tg-model';

/**
 * Port of TuxGuitar's io/tg/TGSongReaderImpl.java (TuxGuitar File Format 2.x): a ZIP holding
 * `version.txt` ("TuxGuitar_file_format 2.0") and `content.xml`.
 */

export const TG20_VERSION_FILE = 'version.txt';
export const TG20_CONTENT_FILE = 'content.xml';
const VERSION_PREFIX = 'TuxGuitar_file_format';
const SUPPORTED_MAJOR = 2;

/**
 * TGDuration.WHOLE_PRECISE_DURATION: 4 × lcm(64, every tuplet "enters" value). Beat starts are
 * stored in this unit and converted back with TGDuration.toTime().
 */
const WHOLE_PRECISE_DURATION = 4 * 2882880;

const TRIPLET_FEELS: Record<string, number> = {
  none: TRIPLET_FEEL_NONE,
  eighth: TRIPLET_FEEL_EIGHTH,
  sixteenth: TRIPLET_FEEL_SIXTEENTH,
};
const CLEFS: Record<string, number> = {
  treble: CLEF_TREBLE,
  bass: CLEF_BASS,
  tenor: CLEF_TENOR,
  alto: CLEF_ALTO,
};
const STROKES: Record<string, number> = { none: 0, up: STROKE_UP, down: STROKE_DOWN };
const HARMONICS: Record<string, number> = {
  'N.H': 1,
  'A.H': 2,
  'T.H': 3,
  'P.H': 4,
  'S.H': 5,
};
/** Grace duration is stored as a note value; the model uses 1 = 64th, 2 = 32nd, 3 = 16th. */
const GRACE_DURATIONS: Record<number, number> = { 64: 1, 32: 2, 16: 3 };

export function isTg20Zip(entries: string[]): boolean {
  return entries.includes(TG20_VERSION_FILE) && entries.includes(TG20_CONTENT_FILE);
}

export function readTg20(bytes: Uint8Array): TgSong {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => f.name === TG20_VERSION_FILE || f.name === TG20_CONTENT_FILE,
    });
  } catch {
    throw new FileFormatError('The TuxGuitar file is not a valid ZIP archive.');
  }
  const versionFile = files[TG20_VERSION_FILE];
  const content = files[TG20_CONTENT_FILE];
  if (!versionFile || !content) {
    throw new FileFormatError('The TuxGuitar file is missing version.txt or content.xml.');
  }
  const [prefix, version] = new TextDecoder().decode(versionFile).trim().split(' ');
  const major = Number.parseInt(version ?? '', 10);
  if (prefix !== VERSION_PREFIX || Number.isNaN(major)) {
    throw new FileFormatError('Unknown TuxGuitar file version.');
  }
  if (major !== SUPPORTED_MAJOR) {
    throw new FileFormatError(`TuxGuitar file format ${version} is not supported.`);
  }

  const doc = new DOMParser().parseFromString(new TextDecoder().decode(content), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new FileFormatError('The TuxGuitar file contains invalid XML.');
  }
  const root = doc.documentElement.nodeName === 'TuxGuitarFile' ? doc.documentElement : null;
  const songNode = child(root, 'TGSong');
  if (!songNode) {
    throw new FileFormatError('The TuxGuitar file has no song.');
  }
  return readSong(songNode);
}

function readSong(node: Element): TgSong {
  const song = newSong();
  song.name = text(node, 'name');
  song.artist = text(node, 'artist');
  song.album = text(node, 'album');
  song.author = text(node, 'author');
  song.date = text(node, 'date');
  song.copyright = text(node, 'copyright');
  song.writer = text(node, 'writer');
  song.transcriber = text(node, 'transcriber');
  song.comments = text(node, 'comments');
  song.channels = children(node, 'TGChannel').map(readChannel);
  song.headers = readMeasureHeaders(node);
  children(node, 'TGTrack').forEach((t, i) => song.tracks.push(readTrack(t, i + 1, song)));
  return song;
}

function readChannel(node: Element): TgChannel {
  return {
    id: int(node, 'id'),
    bank: int(node, 'bank'),
    program: int(node, 'program'),
    volume: int(node, 'volume'),
    balance: int(node, 'balance'),
    chorus: int(node, 'chorus'),
    reverb: int(node, 'reverb'),
    phaser: int(node, 'phaser'),
    tremolo: int(node, 'tremolo'),
    name: text(node, 'name'),
  };
}

function readMeasureHeaders(songNode: Element): TgMeasureHeader[] {
  const headers: TgMeasureHeader[] = [];
  let numerator = 4;
  let denominator = 4;
  let tempo = 120;
  let start = QUARTER_TIME;
  children(songNode, 'TGMeasureHeader').forEach((node, i) => {
    const header = newHeader(i + 1, start);

    const ts = child(node, 'timeSignature');
    if (ts) {
      numerator = attrInt(ts, 'numerator');
      denominator = attrInt(ts, 'denominator');
    }
    header.numerator = numerator;
    header.denominator = newDuration(denominator);

    const tempoNode = child(node, 'tempo');
    if (tempoNode) {
      // TGTempo.setValueBase: the value may be given per any note value, optionally dotted.
      const raw = Number.parseInt(tempoNode.textContent ?? '', 10);
      const base = tempoNode.hasAttribute('base') ? attrInt(tempoNode, 'base') : 4;
      const dotted = tempoNode.getAttribute('dotted') === 'true';
      tempo = Math.trunc((raw * 4) / base);
      if (dotted) tempo = Math.trunc((3 * tempo) / 2);
    }
    header.tempo = tempo;

    header.repeatOpen = child(node, 'repeatOpen') !== null;
    const close = child(node, 'repeatClose');
    if (close) header.repeatClose = Number.parseInt(close.textContent ?? '0', 10);
    const alternative = child(node, 'repeatAlternative');
    if (alternative) {
      for (const alt of children(alternative, 'alternative')) {
        header.repeatAlternative |= 1 << (Number.parseInt(alt.textContent ?? '1', 10) - 1);
      }
    }
    const marker = child(node, 'marker');
    if (marker) {
      header.marker = {
        title: marker.textContent ?? '',
        color: [attrInt(marker, 'R'), attrInt(marker, 'G'), attrInt(marker, 'B')],
      };
    }
    const feel = child(node, 'tripletFeel');
    if (feel) header.tripletFeel = TRIPLET_FEELS[feel.textContent ?? ''] ?? TRIPLET_FEEL_NONE;

    headers.push(header);
    start += measureLength(header);
  });
  return headers;
}

function readTrack(node: Element, number: number, song: TgSong): TgTrack {
  const soloMute = child(node, 'soloMute')?.textContent ?? '';
  const offset = child(node, 'offset');
  const color = child(node, 'color');
  const track: TgTrack = {
    number,
    name: text(node, 'name'),
    solo: soloMute === 'solo',
    mute: soloMute === 'mute',
    channelId: int(node, 'channelId'),
    strings: children(node, 'TGString').map((s) => Number.parseInt(s.textContent ?? '0', 10)),
    offset: offset ? Number.parseInt(offset.textContent ?? '0', 10) : 0,
    color: color ? [attrInt(color, 'R'), attrInt(color, 'G'), attrInt(color, 'B')] : [255, 0, 0],
    measures: [],
  };

  let clef = CLEF_TREBLE;
  let keySignature = 0;
  const measureNodes = children(node, 'TGMeasure');
  if (measureNodes.length !== song.headers.length) {
    throw new FileFormatError('Unexpected number of measures in a TuxGuitar track.');
  }
  measureNodes.forEach((m) => {
    const clefNode = child(m, 'clef');
    if (clefNode) clef = CLEFS[clefNode.textContent ?? ''] ?? CLEF_TREBLE;
    const keyNode = child(m, 'keySignature');
    if (keyNode) keySignature = Number.parseInt(keyNode.textContent ?? '0', 10);
    const measure: TgMeasure = { clef, keySignature, beats: children(m, 'TGBeat').map(readBeat) };
    track.measures.push(measure);
  });
  return track;
}

function readBeat(node: Element): TgBeat {
  const preciseStart = Number.parseInt(text(node, 'preciseStart'), 10);
  const beat: TgBeat = {
    start: Math.trunc((QUARTER_TIME * 4 * preciseStart) / WHOLE_PRECISE_DURATION),
    voices: [],
    stroke: { direction: 0, value: 0 },
    chord: null,
    text: null,
  };
  const stroke = child(node, 'stroke');
  if (stroke) {
    beat.stroke = {
      direction: STROKES[stroke.getAttribute('direction') ?? ''] ?? 0,
      value: attrInt(stroke, 'value'),
    };
  }
  const chord = child(node, 'chord');
  if (chord) {
    beat.chord = {
      name: text(chord, 'name'),
      firstFret: int(chord, 'firstFret'),
      frets: children(chord, 'string').map((s) =>
        s.textContent ? Number.parseInt(s.textContent, 10) : -1,
      ),
    };
  }
  const textNode = child(node, 'text');
  if (textNode) beat.text = textNode.textContent ?? '';

  beat.voices = children(node, 'voice').map(readVoice);
  while (beat.voices.length < 2) beat.voices.push(newVoice());
  return beat;
}

function readVoice(node: Element): TgVoice {
  const voice = newVoice();
  const durationNode = child(node, 'duration');
  if (durationNode) {
    voice.duration = newDuration(attrInt(durationNode, 'value'));
    const dotted = durationNode.getAttribute('dotted');
    voice.duration.dotted = dotted === 'dotted';
    voice.duration.doubleDotted = dotted === 'doubleDotted';
    const division = child(durationNode, 'divisionType');
    if (division) {
      voice.duration.enters = attrInt(division, 'enters');
      voice.duration.times = attrInt(division, 'times');
    }
  }
  voice.notes = readNotes(node);
  voice.empty = voice.notes.length === 0;
  if (node.hasAttribute('empty')) {
    voice.empty = node.getAttribute('empty') === 'true';
  }
  return voice;
}

function readNotes(voiceNode: Element): TgNote[] {
  let velocity = VELOCITY_DEFAULT;
  return children(voiceNode, 'note').map((n) => {
    if (n.hasAttribute('velocity')) velocity = attrInt(n, 'velocity');
    const effect = newNoteEffect();
    const has = (name: string) => child(n, name) !== null;
    effect.vibrato = has('vibrato');
    effect.deadNote = has('deadNote');
    effect.slide = has('slide');
    effect.hammer = has('hammer');
    effect.ghostNote = has('ghostNote');
    effect.accentuatedNote = has('accentuatedNote');
    effect.heavyAccentuatedNote = has('heavyAccentuatedNote');
    effect.palmMute = has('palmMute');
    effect.staccato = has('staccato');
    effect.tapping = has('tapping');
    effect.slapping = has('slapping');
    effect.popping = has('popping');
    effect.fadeIn = has('fadeIn');
    effect.letRing = has('letRing');

    const bend = child(n, 'bend');
    if (bend) effect.bend = readPoints(bend);
    const tremoloBar = child(n, 'tremoloBar');
    if (tremoloBar) effect.tremoloBar = readPoints(tremoloBar);
    const harmonic = child(n, 'harmonic');
    if (harmonic) {
      effect.harmonic = {
        type: HARMONICS[harmonic.getAttribute('type') ?? ''] ?? 1,
        data: attrInt(harmonic, 'data'),
      };
    }
    const grace = child(n, 'grace');
    if (grace) {
      effect.grace = {
        fret: attrInt(grace, 'fret'),
        duration: GRACE_DURATIONS[attrInt(grace, 'duration')] ?? 1,
        dynamic: attrInt(grace, 'dynamic'),
        transition: 0,
        onBeat: grace.getAttribute('onBeat') === 'true',
        dead: grace.getAttribute('dead') === 'true',
      };
    }
    const trill = child(n, 'trill');
    if (trill)
      effect.trill = { fret: attrInt(trill, 'fret'), duration: attrInt(trill, 'duration') };
    const picking = child(n, 'tremoloPicking');
    if (picking) effect.tremoloPicking = { duration: attrInt(picking, 'duration') };

    return {
      value: attrInt(n, 'value'),
      string: attrInt(n, 'string'),
      tied: n.getAttribute('tiedNote') === 'true',
      velocity,
      effect,
    };
  });
}

function readPoints(node: Element): TgBendPoint[] {
  return children(node, 'point').map((p) => ({
    position: attrInt(p, 'position'),
    value: attrInt(p, 'value'),
  }));
}

function children(node: ParentNode | null, name: string): Element[] {
  if (!node) return [];
  return Array.from(node.children).filter((c) => c.nodeName === name);
}

function child(node: ParentNode | null, name: string): Element | null {
  return children(node, name)[0] ?? null;
}

function text(node: Element, name: string): string {
  return child(node, name)?.textContent ?? '';
}

function int(node: Element, name: string): number {
  return Number.parseInt(text(node, name), 10) || 0;
}

function attrInt(node: Element, name: string): number {
  return Number.parseInt(node.getAttribute(name) ?? '0', 10) || 0;
}
