/**
 * Plain-data mirror of TuxGuitar's song model (app.tuxguitar.song.models). Every TG reader
 * (0.7–1.4 compat, 1.5 binary, 2.0 XML) produces a TgSong; tg-to-score.ts converts it to alphaTab.
 */

export const QUARTER_TIME = 960;

export const TRIPLET_FEEL_NONE = 1;
export const TRIPLET_FEEL_EIGHTH = 2;
export const TRIPLET_FEEL_SIXTEENTH = 3;

export const CLEF_TREBLE = 1;
export const CLEF_BASS = 2;
export const CLEF_TENOR = 3;
export const CLEF_ALTO = 4;

export const STROKE_UP = 1;
export const STROKE_DOWN = -1;

export const VELOCITY_DEFAULT = 95;
export const PERCUSSION_BANK = 128;

export interface TgDuration {
  /** 1 = whole … 64 = sixty-fourth. */
  value: number;
  dotted: boolean;
  doubleDotted: boolean;
  enters: number;
  times: number;
}

export interface TgChannel {
  id: number;
  bank: number;
  program: number;
  volume: number;
  balance: number;
  chorus: number;
  reverb: number;
  phaser: number;
  tremolo: number;
  name: string;
}

export interface TgMarker {
  title: string;
  color: [number, number, number];
}

export interface TgMeasureHeader {
  number: number;
  /** Start in TG ticks; the first measure starts at QUARTER_TIME. */
  start: number;
  numerator: number;
  denominator: TgDuration;
  /** Quarter-note BPM. */
  tempo: number;
  repeatOpen: boolean;
  /** Number of times the section is repeated (0 = no repeat close). */
  repeatClose: number;
  /** Bitmask: bit 0 = first alternative ending. */
  repeatAlternative: number;
  marker: TgMarker | null;
  tripletFeel: number;
}

export interface TgBendPoint {
  /** 0..12 across the note duration. */
  position: number;
  /** Semitones × 2 (quarter tones) for bends; semitones for tremolo bar. */
  value: number;
}

export interface TgGrace {
  fret: number;
  /** 1 = 64th, 2 = 32nd, 3 = 16th. */
  duration: number;
  dynamic: number;
  transition: number;
  onBeat: boolean;
  dead: boolean;
}

export interface TgNoteEffect {
  bend: TgBendPoint[] | null;
  tremoloBar: TgBendPoint[] | null;
  harmonic: { type: number; data: number } | null;
  grace: TgGrace | null;
  trill: { fret: number; duration: number } | null;
  tremoloPicking: { duration: number } | null;
  vibrato: boolean;
  deadNote: boolean;
  slide: boolean;
  hammer: boolean;
  ghostNote: boolean;
  accentuatedNote: boolean;
  heavyAccentuatedNote: boolean;
  palmMute: boolean;
  staccato: boolean;
  tapping: boolean;
  slapping: boolean;
  popping: boolean;
  fadeIn: boolean;
  letRing: boolean;
}

export interface TgNote {
  value: number;
  /** 1 = highest string. */
  string: number;
  tied: boolean;
  velocity: number;
  effect: TgNoteEffect;
}

export interface TgVoice {
  empty: boolean;
  duration: TgDuration;
  notes: TgNote[];
}

export interface TgChord {
  name: string;
  firstFret: number;
  /** Fret per string, index 0 = highest string; -1 = not played. */
  frets: number[];
}

export interface TgBeat {
  start: number;
  voices: TgVoice[];
  stroke: { direction: number; value: number };
  chord: TgChord | null;
  text: string | null;
}

export interface TgMeasure {
  clef: number;
  /** 0 = C, 1..7 = sharps, 8..14 = flats (8 = one flat). */
  keySignature: number;
  beats: TgBeat[];
}

export interface TgTrack {
  number: number;
  name: string;
  solo: boolean;
  mute: boolean;
  channelId: number;
  /** Open-string MIDI values, index 0 = string 1 (highest). */
  strings: number[];
  offset: number;
  color: [number, number, number];
  measures: TgMeasure[];
}

export interface TgSong {
  name: string;
  artist: string;
  album: string;
  author: string;
  date: string;
  copyright: string;
  writer: string;
  transcriber: string;
  comments: string;
  channels: TgChannel[];
  headers: TgMeasureHeader[];
  tracks: TgTrack[];
}

export function newDuration(value = 4): TgDuration {
  return { value, dotted: false, doubleDotted: false, enters: 1, times: 1 };
}

export function copyDuration(d: TgDuration): TgDuration {
  return { ...d };
}

/** Port of TGDuration.getTime() including its integer truncation. */
export function durationTime(d: TgDuration): number {
  let time = Math.trunc(QUARTER_TIME * (4 / d.value));
  if (d.dotted) {
    time += Math.trunc(time / 2);
  } else if (d.doubleDotted) {
    time += Math.trunc(time / 4) * 3;
  }
  return Math.trunc((time * d.times) / d.enters);
}

export function measureLength(h: TgMeasureHeader): number {
  return h.numerator * durationTime(h.denominator);
}

export function newNoteEffect(): TgNoteEffect {
  return {
    bend: null,
    tremoloBar: null,
    harmonic: null,
    grace: null,
    trill: null,
    tremoloPicking: null,
    vibrato: false,
    deadNote: false,
    slide: false,
    hammer: false,
    ghostNote: false,
    accentuatedNote: false,
    heavyAccentuatedNote: false,
    palmMute: false,
    staccato: false,
    tapping: false,
    slapping: false,
    popping: false,
    fadeIn: false,
    letRing: false,
  };
}

export function newVoice(): TgVoice {
  return { empty: true, duration: newDuration(), notes: [] };
}

export function newHeader(number: number, start: number): TgMeasureHeader {
  return {
    number,
    start,
    numerator: 4,
    denominator: newDuration(4),
    tempo: 120,
    repeatOpen: false,
    repeatClose: 0,
    repeatAlternative: 0,
    marker: null,
    tripletFeel: TRIPLET_FEEL_NONE,
  };
}

export function newSong(): TgSong {
  return {
    name: '',
    artist: '',
    album: '',
    author: '',
    date: '',
    copyright: '',
    writer: '',
    transcriber: '',
    comments: '',
    channels: [],
    headers: [],
    tracks: [],
  };
}
