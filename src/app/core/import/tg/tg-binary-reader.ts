import { FileFormatError } from '../errors';
import { DataInput, readTgVersion } from './data-input';
import {
  CLEF_TREBLE,
  PERCUSSION_BANK,
  QUARTER_TIME,
  TRIPLET_FEEL_NONE,
  TgBeat,
  TgBendPoint,
  TgChannel,
  TgChord,
  TgDuration,
  TgMeasure,
  TgMeasureHeader,
  TgNote,
  TgNoteEffect,
  TgSong,
  TgTrack,
  TgVoice,
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
 * Port of TuxGuitar's binary readers for file formats 1.0–1.5 (io/tg/v10 … v13, v15
 * TGSongReaderImpl.java + TGStream.java). 1.3 and 1.5 are identical apart from the header;
 * older versions differ as noted inline. Flag values are copied verbatim from each TGStream.
 */

export const TG_BINARY_VERSIONS = ['1.0', '1.1', '1.2', '1.3', '1.5'] as const;
export type TgBinaryVersion = (typeof TG_BINARY_VERSIONS)[number];

const TRACK_SOLO = 0x01;
const TRACK_MUTE = 0x02;
const TRACK_LYRICS = 0x04;
/** 1.0: the track header only carries lyrics; solo/mute live in the channel header. */
const TRACK_LYRICS_V10 = 0x01;
const CHANNEL_SOLO_V10 = 0x01;
const CHANNEL_MUTE_V10 = 0x02;

const MEASURE_HEADER_TIMESIGNATURE = 0x01;
const MEASURE_HEADER_TEMPO = 0x02;
const MEASURE_HEADER_REPEAT_OPEN = 0x04;
const MEASURE_HEADER_REPEAT_CLOSE = 0x08;
const MEASURE_HEADER_REPEAT_ALTERNATIVE = 0x10;
const MEASURE_HEADER_MARKER = 0x20;
const MEASURE_HEADER_TRIPLET_FEEL = 0x40;

const MEASURE_CLEF = 0x01;
const MEASURE_KEYSIGNATURE = 0x02;

const BEAT_HAS_NEXT = 0x01;
const BEAT_HAS_STROKE = 0x02;
const BEAT_HAS_CHORD = 0x04;
const BEAT_HAS_TEXT = 0x08;
const BEAT_HAS_VOICE = 0x10;
const BEAT_HAS_VOICE_CHANGES = 0x20;

/** 1.0: single-voice beat flags. */
const BEAT_NEXT_DURATION_V10 = 0x02;
const BEAT_HAS_NOTES_V10 = 0x04;
const BEAT_HAS_CHORD_V10 = 0x08;
const BEAT_HAS_TEXT_V10 = 0x10;

const VOICE_HAS_NOTES = 0x01;
const VOICE_NEXT_DURATION = 0x02;

const NOTE_HAS_NEXT = 0x01;
const NOTE_TIED = 0x02;
const NOTE_EFFECT = 0x04;
const NOTE_VELOCITY = 0x08;

const DURATION_DOTTED = 0x01;
const DURATION_DOUBLE_DOTTED = 0x02;
const DURATION_NO_TUPLET = 0x04;

const EFFECT_BEND = 0x000001;
const EFFECT_TREMOLO_BAR = 0x000002;
const EFFECT_HARMONIC = 0x000004;
const EFFECT_GRACE = 0x000008;
const EFFECT_TRILL = 0x000010;
const EFFECT_TREMOLO_PICKING = 0x000020;
const EFFECT_VIBRATO = 0x000040;
const EFFECT_DEAD = 0x000080;
const EFFECT_SLIDE = 0x000100;
const EFFECT_HAMMER = 0x000200;
const EFFECT_GHOST = 0x000400;
const EFFECT_ACCENTUATED = 0x000800;
const EFFECT_HEAVY_ACCENTUATED = 0x001000;
const EFFECT_PALM_MUTE = 0x002000;
const EFFECT_STACCATO = 0x004000;
const EFFECT_TAPPING = 0x008000;
const EFFECT_SLAPPING = 0x010000;
const EFFECT_POPPING = 0x020000;
const EFFECT_FADE_IN = 0x040000;
const EFFECT_LET_RING = 0x080000;

const GRACE_FLAG_DEAD = 0x01;
const GRACE_FLAG_ON_BEAT = 0x02;

const HARMONIC_TYPE_NATURAL = 1;
const TREMOLO_BAR_MAX_VALUE_LENGTH = 12;
const MAX_VOICES = 2;
const MIN_OFFSET = -24;

/** Per-voice running state while reading a measure (TGStream.TGVoiceData). */
interface VoiceData {
  start: number;
  velocity: number;
  flags: number;
  duration: TgDuration;
}

/** Running beat state (TGStream.TGBeatData). */
class BeatData {
  private currentStart: number;
  readonly voices: VoiceData[] = [];

  constructor(measureStart: number) {
    this.currentStart = measureStart;
    for (let i = 0; i < MAX_VOICES; i++) {
      this.voices.push({
        start: measureStart,
        velocity: VELOCITY_DEFAULT,
        flags: 0,
        duration: newDuration(),
      });
    }
  }

  getCurrentStart(): number {
    let minimumStart = -1;
    for (const v of this.voices) {
      if (v.start > this.currentStart && (minimumStart < 0 || v.start < minimumStart)) {
        minimumStart = v.start;
      }
    }
    if (minimumStart > this.currentStart) {
      this.currentStart = minimumStart;
    }
    return this.currentStart;
  }
}

export function readTgBinary(bytes: Uint8Array): TgSong {
  const version = readTgVersion(bytes);
  if (!TG_BINARY_VERSIONS.includes(version as TgBinaryVersion)) {
    throw new FileFormatError(`TuxGuitar file format ${version ?? '?'} is not supported.`);
  }
  const d = new DataInput(bytes);
  d.readUnsignedByteString();
  return new TgBinaryReader(d, Number(version) * 10).readSong();
}

class TgBinaryReader {
  /**
   * @param version 10, 11, 12, 13 or 15.
   */
  constructor(
    private readonly d: DataInput,
    private readonly version: number,
  ) {}

  readSong(): TgSong {
    const d = this.d;
    const song = newSong();
    song.name = d.readUnsignedByteString();
    song.artist = d.readUnsignedByteString();
    song.album = d.readUnsignedByteString();
    song.author = d.readUnsignedByteString();
    if (this.version >= 12) {
      song.date = d.readUnsignedByteString();
      song.copyright = d.readUnsignedByteString();
      song.writer = d.readUnsignedByteString();
      song.transcriber = d.readUnsignedByteString();
      song.comments = d.readIntegerString();
    }

    // Before 1.3 each track embeds its channel (readTrackChannel).
    if (this.version >= 13) {
      const channelCount = d.readByte();
      for (let i = 0; i < channelCount; i++) {
        song.channels.push(this.readChannel());
      }
    }

    const headerCount = d.readShort();
    let last: TgMeasureHeader | null = null;
    let start = QUARTER_TIME;
    for (let i = 0; i < headerCount; i++) {
      const header = this.readMeasureHeader(i + 1, start, last);
      song.headers.push(header);
      start += measureLength(header);
      last = header;
    }

    const trackCount = d.readByte();
    for (let i = 0; i < trackCount; i++) {
      song.tracks.push(this.readTrack(i + 1, song));
    }
    return song;
  }

  private readChannel(): TgChannel {
    const d = this.d;
    const channel: TgChannel = {
      id: d.readShort(),
      bank: d.read(),
      program: d.read(),
      volume: d.read(),
      balance: d.read(),
      chorus: d.read(),
      reverb: d.read(),
      phaser: d.read(),
      tremolo: d.read(),
      name: d.readUnsignedByteString(),
    };
    const parameterCount = d.readShort();
    for (let i = 0; i < parameterCount; i++) {
      d.readUnsignedByteString();
      d.readIntegerString();
    }
    return channel;
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
      header.numerator = d.readByte();
      header.denominator = this.readDuration();
    } else if (last) {
      header.numerator = last.numerator;
      header.denominator = copyDuration(last.denominator);
    }

    if (flags & MEASURE_HEADER_TEMPO) {
      header.tempo = d.readShort();
    } else if (last) {
      header.tempo = last.tempo;
    }

    header.repeatOpen = (flags & MEASURE_HEADER_REPEAT_OPEN) !== 0;
    if (flags & MEASURE_HEADER_REPEAT_CLOSE) {
      header.repeatClose = d.readShort();
    }
    if (flags & MEASURE_HEADER_REPEAT_ALTERNATIVE) {
      header.repeatAlternative = d.readByte();
    }
    if (flags & MEASURE_HEADER_MARKER) {
      header.marker = { title: d.readUnsignedByteString(), color: this.readColor() };
    }
    header.tripletFeel = last ? last.tripletFeel : TRIPLET_FEEL_NONE;
    if (flags & MEASURE_HEADER_TRIPLET_FEEL) {
      header.tripletFeel = d.readByte();
    }
    return header;
  }

  private readTrack(number: number, song: TgSong): TgTrack {
    const d = this.d;
    const flags = d.read();
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
    if (this.version >= 11) {
      track.solo = (flags & TRACK_SOLO) !== 0;
      track.mute = (flags & TRACK_MUTE) !== 0;
    }
    if (this.version >= 13) {
      track.channelId = d.readShort();
    } else {
      readTrackChannel(d, song, track, this.version === 10);
    }

    let last: TgMeasure | null = null;
    for (const header of song.headers) {
      const measure = this.readMeasure(header, last);
      track.measures.push(measure);
      last = measure;
    }

    const stringCount = d.readByte();
    for (let i = 0; i < stringCount; i++) {
      track.strings.push(d.readByte());
    }
    track.offset = MIN_OFFSET + d.readByte();
    track.color = this.readColor();
    if (flags & (this.version === 10 ? TRACK_LYRICS_V10 : TRACK_LYRICS)) {
      d.readShort();
      d.readIntegerString();
    }
    return track;
  }

  private readMeasure(header: TgMeasureHeader, last: TgMeasure | null): TgMeasure {
    const d = this.d;
    const flags = d.read();
    const measure: TgMeasure = { clef: CLEF_TREBLE, keySignature: 0, beats: [] };
    const data = new BeatData(header.start);

    let beatFlags = BEAT_HAS_NEXT;
    while (beatFlags & BEAT_HAS_NEXT) {
      beatFlags = d.read();
      measure.beats.push(
        this.version === 10 ? this.readBeatV10(beatFlags, data) : this.readBeat(beatFlags, data),
      );
    }

    measure.clef = last ? last.clef : CLEF_TREBLE;
    if (flags & MEASURE_CLEF) {
      measure.clef = d.readByte();
    }
    measure.keySignature = last ? last.keySignature : 0;
    if (flags & MEASURE_KEYSIGNATURE) {
      measure.keySignature = d.readByte();
    }
    return measure;
  }

  private readBeat(flags: number, data: BeatData): TgBeat {
    const d = this.d;
    const beat: TgBeat = {
      start: data.getCurrentStart(),
      voices: [],
      stroke: { direction: 0, value: 0 },
      chord: null,
      text: null,
    };
    this.readVoices(flags, beat, data);
    if (flags & BEAT_HAS_STROKE) {
      beat.stroke = { direction: d.readByte(), value: d.readByte() };
    }
    if (flags & BEAT_HAS_CHORD) {
      beat.chord = this.readChord();
    }
    if (flags & BEAT_HAS_TEXT) {
      beat.text = d.readUnsignedByteString();
    }
    return beat;
  }

  /** 1.0 has a single voice per beat and no strokes. */
  private readBeatV10(flags: number, data: BeatData): TgBeat {
    const d = this.d;
    const vd = data.voices[0];
    const voice = newVoice();
    voice.empty = false;
    const beat: TgBeat = {
      start: vd.start,
      voices: [voice, newVoice()],
      stroke: { direction: 0, value: 0 },
      chord: null,
      text: null,
    };
    if (flags & BEAT_NEXT_DURATION_V10) {
      vd.duration = this.readDuration();
    }
    if (flags & BEAT_HAS_NOTES_V10) {
      this.readNotes(voice, vd);
    }
    if (flags & BEAT_HAS_CHORD_V10) {
      beat.chord = this.readChord();
    }
    if (flags & BEAT_HAS_TEXT_V10) {
      beat.text = d.readUnsignedByteString();
    }
    voice.duration = copyDuration(vd.duration);
    vd.start += durationTime(voice.duration);
    return beat;
  }

  private readVoices(flags: number, beat: TgBeat, data: BeatData): void {
    for (let i = 0; i < MAX_VOICES; i++) {
      const shift = i * 2;
      const voice: TgVoice = newVoice();
      beat.voices.push(voice);
      if (!(flags & (BEAT_HAS_VOICE << shift))) continue;

      const vd = data.voices[i];
      if (flags & (BEAT_HAS_VOICE_CHANGES << shift)) {
        vd.flags = this.d.read();
      }
      if (vd.flags & VOICE_NEXT_DURATION) {
        vd.duration = this.readDuration();
      }
      if (vd.flags & VOICE_HAS_NOTES) {
        this.readNotes(voice, vd);
      }
      voice.duration = copyDuration(vd.duration);
      vd.start += durationTime(voice.duration);
      voice.empty = false;
    }
  }

  private readNotes(voice: TgVoice, vd: VoiceData): void {
    let flags = NOTE_HAS_NEXT;
    while (flags & NOTE_HAS_NEXT) {
      flags = this.d.read();
      voice.notes.push(this.readNote(flags, vd));
    }
  }

  private readNote(flags: number, vd: VoiceData): TgNote {
    const d = this.d;
    const value = d.readByte();
    const string = d.readByte();
    const tied = (flags & NOTE_TIED) !== 0;
    if (flags & NOTE_VELOCITY) {
      vd.velocity = d.readByte();
    }
    const effect = flags & NOTE_EFFECT ? this.readNoteEffect() : newNoteEffect();
    return { value, string, tied, velocity: vd.velocity, effect };
  }

  private readChord(): TgChord {
    const d = this.d;
    const stringCount = d.readByte();
    const name = d.readUnsignedByteString();
    const firstFret = d.readByte();
    const frets: number[] = [];
    for (let i = 0; i < stringCount; i++) {
      frets.push(d.readByte());
    }
    return { name, firstFret, frets };
  }

  private readDuration(): TgDuration {
    const d = this.d;
    const flags = d.read();
    const duration = newDuration();
    duration.dotted = (flags & DURATION_DOTTED) !== 0;
    duration.doubleDotted = (flags & DURATION_DOUBLE_DOTTED) !== 0;
    duration.value = d.readByte();
    if (flags & DURATION_NO_TUPLET) {
      duration.enters = d.readByte();
      duration.times = d.readByte();
    }
    return duration;
  }

  private readNoteEffect(): TgNoteEffect {
    const d = this.d;
    const flags = d.readHeader(3);
    const effect = newNoteEffect();
    if (flags & EFFECT_BEND) {
      effect.bend = this.readPoints(0);
    }
    if (flags & EFFECT_TREMOLO_BAR) {
      effect.tremoloBar = this.readPoints(TREMOLO_BAR_MAX_VALUE_LENGTH);
    }
    if (flags & EFFECT_HARMONIC) {
      const type = d.readByte();
      const data = type !== HARMONIC_TYPE_NATURAL ? d.readByte() : 0;
      effect.harmonic = { type, data };
    }
    if (flags & EFFECT_GRACE) {
      const graceFlags = d.read();
      effect.grace = {
        dead: (graceFlags & GRACE_FLAG_DEAD) !== 0,
        onBeat: (graceFlags & GRACE_FLAG_ON_BEAT) !== 0,
        fret: d.readByte(),
        duration: d.readByte(),
        dynamic: d.readByte(),
        transition: d.readByte(),
      };
    }
    if (flags & EFFECT_TRILL) {
      effect.trill = { fret: d.readByte(), duration: d.readByte() };
    }
    if (flags & EFFECT_TREMOLO_PICKING) {
      effect.tremoloPicking = { duration: d.readByte() };
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
    // Let ring was added in 1.2.
    effect.letRing = this.version >= 12 && (flags & EFFECT_LET_RING) !== 0;
    return effect;
  }

  /** Bend / tremolo-bar points; tremolo bar values are stored shifted by +12. */
  private readPoints(valueShift: number): TgBendPoint[] {
    const d = this.d;
    const count = d.readByte();
    const points: TgBendPoint[] = [];
    for (let i = 0; i < count; i++) {
      const position = d.readByte();
      const value = d.readByte() - valueShift;
      points.push({ position, value });
    }
    return points;
  }

  private readColor(): [number, number, number] {
    const d = this.d;
    return [d.read(), d.read(), d.read()];
  }
}

/**
 * Channel embedded in a track (formats 0.7–1.2). Tracks on the same GM channel share one TG
 * channel, like the compat readers' GMChannelRoute lookup.
 */
export function readTrackChannel(
  d: DataInput,
  song: TgSong,
  track: TgTrack,
  hasSoloMuteHeader: boolean,
): void {
  const flags = hasSoloMuteHeader ? d.read() : 0;
  const gmChannel = d.read();
  d.read(); // effect channel
  const channel = {
    program: d.readByte(),
    volume: d.readByte(),
    balance: d.readByte(),
    chorus: d.readByte(),
    reverb: d.readByte(),
    phaser: d.readByte(),
    tremolo: d.readByte(),
  };
  if (hasSoloMuteHeader) {
    track.solo = (flags & CHANNEL_SOLO_V10) !== 0;
    track.mute = (flags & CHANNEL_MUTE_V10) !== 0;
  }
  track.channelId = sharedChannelId(song, gmChannel, channel);
}

export interface EmbeddedChannel {
  program: number;
  volume: number;
  balance: number;
  chorus: number;
  reverb: number;
  phaser: number;
  tremolo: number;
}

const gmChannels = new WeakMap<TgSong, Map<number, number>>();

/** Returns the id of the TG channel for `gmChannel`, creating it on first use. */
export function sharedChannelId(song: TgSong, gmChannel: number, c: EmbeddedChannel): number {
  let byGm = gmChannels.get(song);
  if (!byGm) {
    byGm = new Map();
    gmChannels.set(song, byGm);
  }
  const existing = byGm.get(gmChannel);
  if (existing !== undefined) return existing;
  const id = song.channels.length + 1;
  song.channels.push({
    id,
    bank: gmChannel === 9 ? PERCUSSION_BANK : 0,
    ...c,
    name: '',
  });
  byGm.set(gmChannel, id);
  return id;
}
