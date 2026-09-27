import { FileFormatError } from '../errors';
import { DataInput } from './data-input';
import { sharedChannelId } from './tg-binary-reader';
import {
  CLEF_TREBLE,
  QUARTER_TIME,
  TRIPLET_FEEL_NONE,
  TgBeat,
  TgBendPoint,
  TgDuration,
  TgMeasure,
  TgMeasureHeader,
  TgNote,
  TgNoteEffect,
  TgSong,
  TgTrack,
  VELOCITY_DEFAULT,
  copyDuration,
  durationTime,
  measureLength,
  newDuration,
  newHeader,
  newNoteEffect,
  newSong,
  newVoice,
} from './tg-model';

/**
 * Ports of TuxGuitar's oldest compat readers (io/tg/v07, v08, v09 TGSongReaderImpl.java).
 * 0.8 and 0.9 store each measure as a list of "components" (one note or rest each); 0.7
 * ("TG_DEVEL-0.01") stores explicit start times and fixed-size ints.
 */

export const TG07_HEADER = 'TG_DEVEL-0.01';
export const TG08_HEADER = 'TG_DEVEL-0.8';

const TRACK_LYRICS = 0x01;
const CHANNEL_SOLO = 0x01;
const CHANNEL_MUTE = 0x02;

const MEASURE_HEADER_TIMESIGNATURE = 0x01;
const MEASURE_HEADER_TEMPO = 0x02;
const MEASURE_HEADER_OPEN_REPEAT = 0x04;
const MEASURE_HEADER_CLOSE_REPEAT = 0x08;
const MEASURE_HEADER_MARKER = 0x10;
const MEASURE_HEADER_TRIPLET_FEEL = 0x20;

const MEASURE_CLEF = 0x01;
const MEASURE_KEYSIGNATURE = 0x02;

const COMPONENT_NOTE = 0x01;
const COMPONENT_TIEDNOTE = 0x04;
const COMPONENT_EFFECT = 0x08;
const COMPONENT_NEXT_BEAT = 0x10;
const COMPONENT_NEXT_DURATION = 0x20;
/** 0.9 only; 0.8 stores a velocity byte with every note. */
const COMPONENT_VELOCITY = 0x40;

const DURATION_DOTTED = 0x01;
const DURATION_DOUBLE_DOTTED = 0x02;
const DURATION_TUPLET = 0x04;

// 0.9 effects (3-byte header, same bits as 1.0).
const EFFECT_BEND = 0x01;
const EFFECT_TREMOLO_BAR = 0x02;
const EFFECT_HARMONIC = 0x04;
const EFFECT_GRACE = 0x08;
const EFFECT_TRILL = 0x010;
const EFFECT_TREMOLO_PICKING = 0x020;
const EFFECT_VIBRATO = 0x040;
const EFFECT_DEAD = 0x080;
const EFFECT_SLIDE = 0x0100;
const EFFECT_HAMMER = 0x0200;
const EFFECT_GHOST = 0x0400;
const EFFECT_ACCENTUATED = 0x0800;
const EFFECT_HEAVY_ACCENTUATED = 0x01000;
const EFFECT_PALM_MUTE = 0x02000;
const EFFECT_STACCATO = 0x04000;
const EFFECT_TAPPING = 0x08000;
const EFFECT_SLAPPING = 0x010000;
const EFFECT_POPPING = 0x020000;
const EFFECT_FADE_IN = 0x040000;

// 0.8 effects (1-byte header).
const EFFECT08_VIBRATO = 0x01;
const EFFECT08_BEND = 0x02;
const EFFECT08_DEAD_NOTE = 0x04;
const EFFECT08_SLIDE = 0x08;
const EFFECT08_HAMMER = 0x10;

const GRACE_FLAG_DEAD = 0x01;
const GRACE_FLAG_ON_BEAT = 0x02;

const HARMONIC_TYPE_ARTIFICIAL = 2;
const HARMONIC_TYPE_TAPPED = 3;
const HARMONIC_MIN_ARTIFICIAL_OFFSET = -24;
const TREMOLO_BAR_MAX_VALUE_LENGTH = 12;
const MIN_OFFSET = -24;

/** Reads a TuxGuitar 0.7, 0.8 or 0.9 file. `version` is the header after the format prefix. */
export function readTgLegacy(bytes: Uint8Array, version: '0.7' | '0.8' | '0.9'): TgSong {
  const d = new DataInput(bytes);
  d.readUnsignedByteString();
  return version === '0.7' ? readTg07(d) : new ComponentReader(d, version === '0.9').readSong();
}

class ComponentReader {
  private velocity = VELOCITY_DEFAULT;

  constructor(
    private readonly d: DataInput,
    private readonly v09: boolean,
  ) {}

  readSong(): TgSong {
    const d = this.d;
    const song = newSong();
    song.name = d.readUnsignedByteString();
    song.artist = d.readUnsignedByteString();
    song.album = d.readUnsignedByteString();
    song.author = d.readUnsignedByteString();

    const headerCount = d.readShort();
    let last: TgMeasureHeader | null = null;
    let start = QUARTER_TIME;
    for (let i = 0; i < headerCount; i++) {
      const header = this.readMeasureHeader(i + 1, start, last);
      song.headers.push(header);
      start += measureLength(header);
      last = header;
    }
    const trackCount = d.read();
    for (let i = 0; i < trackCount; i++) {
      song.tracks.push(this.readTrack(i + 1, song));
    }
    return song;
  }

  private readMeasureHeader(
    number: number,
    start: number,
    last: TgMeasureHeader | null,
  ): TgMeasureHeader {
    const d = this.d;
    const flags = d.read();
    const header = newHeader(number, start);
    if (flags & MEASURE_HEADER_TIMESIGNATURE) {
      header.numerator = d.read();
      header.denominator = this.readDuration(newDuration());
    } else if (last) {
      header.numerator = last.numerator;
      header.denominator = copyDuration(last.denominator);
    }
    if (flags & MEASURE_HEADER_TEMPO) {
      header.tempo = d.readShort();
    } else if (last) {
      header.tempo = last.tempo;
    }
    header.repeatOpen = (flags & MEASURE_HEADER_OPEN_REPEAT) !== 0;
    if (flags & MEASURE_HEADER_CLOSE_REPEAT) {
      header.repeatClose = d.readShort();
    }
    if (flags & MEASURE_HEADER_MARKER) {
      header.marker = { title: d.readUnsignedByteString(), color: readShortColor(d) };
    }
    header.tripletFeel = last ? last.tripletFeel : TRIPLET_FEEL_NONE;
    if (flags & MEASURE_HEADER_TRIPLET_FEEL) {
      header.tripletFeel = d.read();
    }
    return header;
  }

  private readTrack(number: number, song: TgSong): TgTrack {
    const d = this.d;
    const flags = this.v09 ? d.read() : 0;
    const track: TgTrack = {
      number,
      name: d.readUnsignedByteString(),
      solo: false,
      mute: false,
      channelId: 0,
      strings: [],
      offset: 0,
      color: [255, 0, 0],
      measures: [],
    };
    const channelFlags = d.read();
    const gmChannel = d.read();
    d.read();
    track.channelId = sharedChannelId(song, gmChannel, {
      program: d.read(),
      volume: d.read(),
      balance: d.read(),
      chorus: d.read(),
      reverb: d.read(),
      phaser: d.read(),
      tremolo: d.read(),
    });
    track.solo = (channelFlags & CHANNEL_SOLO) !== 0;
    track.mute = (channelFlags & CHANNEL_MUTE) !== 0;

    let last: TgMeasure | null = null;
    for (const header of song.headers) {
      last = this.readMeasure(header, last);
      track.measures.push(last);
    }
    const stringCount = d.read();
    for (let i = 0; i < stringCount; i++) {
      track.strings.push(d.read());
    }
    track.offset = MIN_OFFSET + d.read();
    track.color = readShortColor(d);
    if (flags & TRACK_LYRICS) {
      d.readShort();
      d.readUnsignedByteString();
    }
    return track;
  }

  private readMeasure(header: TgMeasureHeader, last: TgMeasure | null): TgMeasure {
    const d = this.d;
    if (this.v09) this.velocity = VELOCITY_DEFAULT;
    const flags = d.read();
    const measure: TgMeasure = { clef: CLEF_TREBLE, keySignature: 0, beats: [] };
    const componentCount = d.readShort();
    let previous: TgBeat | null = null;
    for (let i = 0; i < componentCount; i++) {
      previous = this.readComponent(header, measure, previous);
    }
    measure.clef = last ? last.clef : CLEF_TREBLE;
    if (flags & MEASURE_CLEF) measure.clef = d.read();
    measure.keySignature = last ? last.keySignature : 0;
    if (flags & MEASURE_KEYSIGNATURE) measure.keySignature = d.read();
    return measure;
  }

  private readComponent(
    header: TgMeasureHeader,
    measure: TgMeasure,
    previous: TgBeat | null,
  ): TgBeat {
    const d = this.d;
    const flags = d.read();
    let beat = previous;
    if (!beat) {
      beat = newBeat(header.start);
      measure.beats.push(beat);
    } else if (flags & COMPONENT_NEXT_BEAT) {
      beat = newBeat(previous!.start + durationTime(previous!.voices[0].duration));
      measure.beats.push(beat);
    }
    const voice = beat.voices[0];
    voice.empty = false;
    if (flags & COMPONENT_NEXT_DURATION) {
      voice.duration = this.readDuration(newDuration());
    } else if (previous && previous !== beat) {
      voice.duration = copyDuration(previous.voices[0].duration);
    }

    if (flags & COMPONENT_NOTE) {
      let note: TgNote;
      if (this.v09) {
        const value = d.read();
        const string = d.read();
        if (flags & COMPONENT_VELOCITY) this.velocity = d.read();
        note = { value, string, tied: false, velocity: this.velocity, effect: newNoteEffect() };
      } else {
        const value = d.read();
        const velocity = d.read();
        const string = d.read();
        note = { value, string, tied: false, velocity, effect: newNoteEffect() };
      }
      note.tied = (flags & COMPONENT_TIEDNOTE) !== 0;
      if (flags & COMPONENT_EFFECT) {
        note.effect = this.v09 ? this.readEffect09() : this.readEffect08();
      }
      voice.notes.push(note);
    }
    return beat;
  }

  private readDuration(duration: TgDuration): TgDuration {
    const d = this.d;
    const flags = d.read();
    duration.dotted = (flags & DURATION_DOTTED) !== 0;
    duration.doubleDotted = (flags & DURATION_DOUBLE_DOTTED) !== 0;
    duration.value = d.read();
    if (flags & DURATION_TUPLET) {
      duration.enters = d.read();
      duration.times = d.read();
    }
    return duration;
  }

  private readEffect08(): TgNoteEffect {
    const d = this.d;
    const flags = d.read();
    const effect = newNoteEffect();
    effect.vibrato = (flags & EFFECT08_VIBRATO) !== 0;
    effect.deadNote = (flags & EFFECT08_DEAD_NOTE) !== 0;
    effect.slide = (flags & EFFECT08_SLIDE) !== 0;
    effect.hammer = (flags & EFFECT08_HAMMER) !== 0;
    if (flags & EFFECT08_BEND) {
      effect.bend = readHalvedBend(() => d.read());
    }
    return effect;
  }

  private readEffect09(): TgNoteEffect {
    const d = this.d;
    const flags = d.readHeader(3);
    const effect = newNoteEffect();
    if (flags & EFFECT_BEND) {
      const count = d.read();
      effect.bend = [];
      for (let i = 0; i < count; i++) {
        effect.bend.push({ position: d.read(), value: d.read() });
      }
    }
    if (flags & EFFECT_TREMOLO_BAR) {
      const count = d.read();
      effect.tremoloBar = [];
      for (let i = 0; i < count; i++) {
        effect.tremoloBar.push({
          position: d.read(),
          value: d.read() - TREMOLO_BAR_MAX_VALUE_LENGTH,
        });
      }
    }
    if (flags & EFFECT_HARMONIC) {
      const type = d.read();
      let data = 0;
      if (type === HARMONIC_TYPE_ARTIFICIAL) data = HARMONIC_MIN_ARTIFICIAL_OFFSET + d.read();
      else if (type === HARMONIC_TYPE_TAPPED) data = d.read();
      effect.harmonic = { type, data };
    }
    if (flags & EFFECT_GRACE) {
      const graceFlags = d.read();
      effect.grace = {
        dead: (graceFlags & GRACE_FLAG_DEAD) !== 0,
        onBeat: (graceFlags & GRACE_FLAG_ON_BEAT) !== 0,
        fret: d.read(),
        duration: d.read(),
        dynamic: d.read(),
        transition: d.read(),
      };
    }
    if (flags & EFFECT_TRILL) {
      effect.trill = { fret: d.read(), duration: d.read() };
    }
    if (flags & EFFECT_TREMOLO_PICKING) {
      effect.tremoloPicking = { duration: d.read() };
    }
    effect.vibrato = (flags & EFFECT_VIBRATO) !== 0;
    effect.deadNote = (flags & EFFECT_DEAD) !== 0;
    effect.slide = (flags & EFFECT_SLIDE) !== 0;
    effect.hammer = (flags & EFFECT_HAMMER) !== 0;
    effect.ghostNote = (flags & EFFECT_GHOST) !== 0;
    effect.accentuatedNote = (flags & EFFECT_ACCENTUATED) !== 0;
    effect.heavyAccentuatedNote = (flags & EFFECT_HEAVY_ACCENTUATED) !== 0;
    effect.palmMute = (flags & EFFECT_PALM_MUTE) !== 0;
    effect.staccato = (flags & EFFECT_STACCATO) !== 0;
    effect.tapping = (flags & EFFECT_TAPPING) !== 0;
    effect.slapping = (flags & EFFECT_SLAPPING) !== 0;
    effect.popping = (flags & EFFECT_POPPING) !== 0;
    effect.fadeIn = (flags & EFFECT_FADE_IN) !== 0;
    return effect;
  }
}

/** TuxGuitar 0.7 ("TG_DEVEL-0.01"): big-endian ints/longs, starts in thousandths of a quarter. */
function readTg07(d: DataInput): TgSong {
  const song = newSong();
  song.name = d.readUnsignedByteString();
  song.artist = d.readUnsignedByteString();
  song.album = d.readUnsignedByteString();
  song.author = d.readUnsignedByteString();

  const trackCount = d.readInt();
  for (let t = 0; t < trackCount; t++) {
    const track: TgTrack = {
      number: readLong(d),
      name: d.readUnsignedByteString(),
      solo: false,
      mute: false,
      channelId: 0,
      strings: [],
      offset: 0,
      color: [255, 0, 0],
      measures: [],
    };
    const gmChannel = d.readShort();
    d.readShort();
    track.channelId = sharedChannelId(song, gmChannel, {
      program: d.readShort(),
      volume: d.readShort(),
      balance: d.readShort(),
      chorus: d.readShort(),
      reverb: d.readShort(),
      phaser: d.readShort(),
      tremolo: d.readShort(),
    });
    track.solo = d.readBoolean();
    track.mute = d.readBoolean();

    const measureCount = d.readInt();
    if (measureCount > 10000) throw new FileFormatError('The file is corrupt.');
    while (song.headers.length < measureCount) {
      song.headers.push(newHeader(song.headers.length + 1, QUARTER_TIME));
    }
    for (let i = 0; i < measureCount; i++) {
      track.measures.push(readMeasure07(d, song.headers[i]));
    }
    const stringCount = d.readInt();
    for (let i = 0; i < stringCount; i++) {
      d.readInt();
      track.strings.push(d.readInt());
    }
    track.color = [d.readInt(), d.readInt(), d.readInt()];
    song.tracks.push(track);
  }
  return song;
}

function readMeasure07(d: DataInput, header: TgMeasureHeader): TgMeasure {
  header.number = d.readInt();
  header.start = Math.trunc((QUARTER_TIME * readLong(d)) / 1000);
  const measure: TgMeasure = { clef: CLEF_TREBLE, keySignature: 0, beats: [] };
  const beatAt = (start: number, previous: TgBeat | null): TgBeat => {
    if (previous && previous.start === start) return previous;
    const beat = newBeat(start);
    measure.beats.push(beat);
    return beat;
  };

  let previous: TgBeat | null = null;
  const noteCount = d.readInt();
  for (let i = 0; i < noteCount; i++) {
    const value = d.readInt();
    const beat = beatAt(Math.trunc((QUARTER_TIME * readLong(d)) / 1000), previous);
    const voice = beat.voices[0];
    voice.empty = false;
    voice.duration = readDuration07(d);
    const note: TgNote = {
      value,
      velocity: d.readInt(),
      string: d.readInt(),
      tied: d.readBoolean(),
      effect: newNoteEffect(),
    };
    note.effect.vibrato = d.readBoolean();
    if (d.readBoolean()) {
      const count = d.readInt();
      note.effect.bend = readHalvedBend(() => d.readInt(), count);
    }
    note.effect.deadNote = d.readBoolean();
    note.effect.slide = d.readBoolean();
    note.effect.hammer = d.readBoolean();
    voice.notes.push(note);
    previous = beat;
  }
  previous = null;
  const silenceCount = d.readInt();
  for (let i = 0; i < silenceCount; i++) {
    const beat = beatAt(Math.trunc((QUARTER_TIME * readLong(d)) / 1000), previous);
    beat.voices[0].empty = false;
    beat.voices[0].duration = readDuration07(d);
    previous = beat;
  }
  // Notes and rests are stored in separate lists.
  measure.beats.sort((a, b) => a.start - b.start);

  header.numerator = d.readInt();
  header.denominator = readDuration07(d);
  header.tempo = d.readInt();
  measure.clef = d.readInt();
  measure.keySignature = d.readInt();
  header.repeatOpen = d.readBoolean();
  header.repeatClose = d.readInt();
  return measure;
}

function readDuration07(d: DataInput): TgDuration {
  const duration = newDuration(d.readInt());
  duration.dotted = d.readBoolean();
  duration.doubleDotted = d.readBoolean();
  duration.enters = d.readInt();
  duration.times = d.readInt();
  return duration;
}

/** 0.7/0.8 bends store positive values doubled. */
function readHalvedBend(read: () => number, count = read()): TgBendPoint[] {
  const points: TgBendPoint[] = [];
  for (let i = 0; i < count; i++) {
    const position = read();
    const value = read();
    points.push({ position, value: value > 0 ? Math.trunc(value / 2) : value });
  }
  return points;
}

function readLong(d: DataInput): number {
  const high = d.readInt();
  const low = d.readInt() >>> 0;
  return high * 2 ** 32 + low;
}

function readShortColor(d: DataInput): [number, number, number] {
  return [d.readShort(), d.readShort(), d.readShort()];
}

function newBeat(start: number): TgBeat {
  return {
    start,
    voices: [newVoice(), newVoice()],
    stroke: { direction: 0, value: 0 },
    chord: null,
    text: null,
  };
}
