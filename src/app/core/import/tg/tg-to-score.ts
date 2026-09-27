import * as alphaTab from '@coderline/alphatab';
import {
  CLEF_ALTO,
  CLEF_BASS,
  CLEF_TENOR,
  PERCUSSION_BANK,
  STROKE_DOWN,
  STROKE_UP,
  TRIPLET_FEEL_EIGHTH,
  TRIPLET_FEEL_SIXTEENTH,
  TgBeat,
  TgChannel,
  TgDuration,
  TgMeasureHeader,
  TgNote,
  TgSong,
  TgTrack,
  durationTime,
  measureLength,
} from './tg-model';

type Score = alphaTab.model.Score;
type Voice = alphaTab.model.Voice;
type Beat = alphaTab.model.Beat;
type Note = alphaTab.model.Note;

const {
  Automation,
  Bar,
  Beat: BeatCtor,
  BendPoint,
  BrushType,
  Chord,
  Clef,
  Color,
  Duration,
  DynamicValue,
  AccentuationType,
  FadeType,
  GraceType,
  HarmonicType,
  KeySignatureType,
  MasterBar,
  Note: NoteCtor,
  Score: ScoreCtor,
  Section,
  SlideOutType,
  Track,
  TripletFeel,
  VibratoType,
  Voice: VoiceCtor,
} = alphaTab.model;

/** GP5 drum keys that have no articulation of their own in alphaTab (Gp3To5Importer). */
const PERCUSSION_ARTICULATION_REMAP = new Map([
  [27, 42],
  [28, 60],
  [29, 29],
  [30, 30],
  [32, 31],
]);

const HARMONIC_TYPES = [
  HarmonicType.None,
  HarmonicType.Natural,
  HarmonicType.Artificial,
  HarmonicType.Tap,
  HarmonicType.Pinch,
  HarmonicType.Semi,
];

/** Rest durations used to fill gaps inside a voice, longest first. */
const REST_DURATIONS: TgDuration[] = [1, 2, 4, 8, 16, 32, 64].flatMap((value) => [
  { value, dotted: true, doubleDotted: false, enters: 1, times: 1 },
  { value, dotted: false, doubleDotted: false, enters: 1, times: 1 },
]);

interface ChannelPair {
  primary: number;
  secondary: number;
}

/** TuxGuitar's largest bend: 12 semitones. */
const MAX_BEND_QUARTER_TONES = 24;

/**
 * Converts a TuxGuitar song into an alphaTab Score. The Score's MIDI (via MidiFileGenerator)
 * reproduces TuxGuitar's playback: same measures, repeats, tempo, keys and note starts.
 *
 * With `order` (header indices in play order) the repeats are written out instead: every played
 * measure becomes its own bar and no repeat marks remain.
 */
export function tgSongToScore(
  song: TgSong,
  settings: alphaTab.Settings,
  order: number[] | null = null,
): Score {
  const score = new ScoreCtor();
  score.title = song.name;
  score.artist = song.artist;
  score.album = song.album;
  score.music = song.author;
  score.words = song.writer;
  score.copyright = song.copyright;
  score.tab = song.transcriber;
  score.notices = song.comments;

  const bars = order ?? song.headers.map((_, i) => i);
  addMasterBars(
    score,
    bars.map((i) => song.headers[i]),
    order !== null,
  );

  const channels = assignChannels(song);
  for (const tgTrack of song.tracks) {
    const tgChannel = song.channels.find((c) => c.id === tgTrack.channelId) ?? null;
    addTrack(score, song, tgTrack, tgChannel, channels.get(tgTrack.channelId)!, bars);
  }

  score.finish(settings);
  return score;
}

function addMasterBars(score: Score, headers: TgMeasureHeader[], unrolled: boolean): void {
  let previousTempo = -1;
  for (const header of headers) {
    const mb = new MasterBar();
    mb.timeSignatureNumerator = header.numerator;
    mb.timeSignatureDenominator = header.denominator.value;
    if (!unrolled) {
      mb.isRepeatStart = header.repeatOpen;
      // TuxGuitar counts extra passes; alphaTab counts total passes.
      mb.repeatCount = header.repeatClose > 0 ? header.repeatClose + 1 : 0;
      mb.alternateEndings = header.repeatAlternative & 0xff;
    }
    mb.tripletFeel =
      header.tripletFeel === TRIPLET_FEEL_EIGHTH
        ? TripletFeel.Triplet8th
        : header.tripletFeel === TRIPLET_FEEL_SIXTEENTH
          ? TripletFeel.Triplet16th
          : TripletFeel.NoTripletFeel;
    if (header.marker) {
      const section = new Section();
      section.text = header.marker.title;
      section.marker = '';
      mb.section = section;
    }
    if (header.tempo !== previousTempo) {
      mb.tempoAutomations.push(Automation.buildTempoAutomation(false, 0, header.tempo, 2));
      previousTempo = header.tempo;
    }
    score.addMasterBar(mb);
  }
}

/**
 * alphaTab gives each track a primary and a secondary (effects) MIDI channel. Tracks sharing a
 * TuxGuitar channel share the pair; percussion always uses channel 9.
 */
function assignChannels(song: TgSong): Map<number, ChannelPair> {
  const pairs = new Map<number, ChannelPair>();
  let next = 0;
  const take = (): number => {
    if (next === 9) next++;
    return next++;
  };
  for (const track of song.tracks) {
    if (pairs.has(track.channelId)) continue;
    const channel = song.channels.find((c) => c.id === track.channelId);
    if (channel && channel.bank === PERCUSSION_BANK) {
      pairs.set(track.channelId, { primary: 9, secondary: 9 });
    } else {
      const primary = take();
      pairs.set(track.channelId, { primary, secondary: take() });
    }
  }
  return pairs;
}

function addTrack(
  score: Score,
  song: TgSong,
  tgTrack: TgTrack,
  tgChannel: TgChannel | null,
  channels: ChannelPair,
  bars: number[],
): void {
  const track = new Track();
  track.ensureStaveCount(1);
  score.addTrack(track);
  track.name = tgTrack.name;
  track.shortName = tgTrack.name.slice(0, 10);
  track.color = new Color(tgTrack.color[0], tgTrack.color[1], tgTrack.color[2], 255);

  const percussion = tgChannel?.bank === PERCUSSION_BANK;
  const info = track.playbackInfo;
  info.primaryChannel = channels.primary;
  info.secondaryChannel = channels.secondary;
  info.program = percussion ? 0 : (tgChannel?.program ?? 25);
  info.volume = Math.round((tgChannel?.volume ?? 127) / 8);
  info.balance = Math.round((tgChannel?.balance ?? 64) / 8);
  info.isMute = tgTrack.mute;
  info.isSolo = tgTrack.solo;

  const staff = track.staves[0];
  staff.isPercussion = percussion;
  staff.stringTuning.tunings = percussion ? [] : [...tgTrack.strings];
  staff.transpositionPitch = percussion ? 0 : tgTrack.offset;
  if (!percussion && info.program >= 24 && info.program <= 31) {
    staff.displayTranspositionPitch = -12;
  }

  bars.forEach((index) => {
    const measure = tgTrack.measures[index];
    const header = song.headers[index];
    const bar = new Bar();
    staff.addBar(bar);
    bar.clef = percussion ? Clef.Neutral : toClef(measure.clef);
    bar.keySignature =
      measure.keySignature <= 7 ? measure.keySignature : -(measure.keySignature - 7);
    bar.keySignatureType = KeySignatureType.Major;

    for (let v = 0; v < 2; v++) {
      const voice = new VoiceCtor();
      const filled = fillVoice(voice, v, measure.beats, header, tgTrack, staff);
      if (filled || v === 0) {
        bar.addVoice(voice);
      }
      if (!filled && v === 0) {
        const empty = new BeatCtor();
        empty.isEmpty = true;
        empty.duration = Duration.Whole;
        voice.addBeat(empty);
      }
    }
  });
}

/** Adds the beats of TG voice `v` to `voice`; returns false when the voice has no content. */
function fillVoice(
  voice: Voice,
  v: number,
  beats: TgBeat[],
  header: TgMeasureHeader,
  tgTrack: TgTrack,
  staff: alphaTab.model.Staff,
): boolean {
  const percussion = staff.isPercussion;
  let cursor = header.start;
  let filled = false;
  const end = header.start + measureLength(header);
  for (const tgBeat of beats) {
    const tgVoice = tgBeat.voices[v];
    if (!tgVoice || tgVoice.empty || tgBeat.start >= end) continue;
    if (tgBeat.start > cursor) {
      addRests(voice, tgBeat.start - cursor);
    }

    const graceNotes = tgVoice.notes.filter((n) => n.effect.grace);
    if (graceNotes.length > 0) {
      voice.addBeat(createGraceBeat(graceNotes, tgTrack, percussion));
    }

    const beat = new BeatCtor();
    applyDuration(beat, tgVoice.duration);
    voice.addBeat(beat);
    if (v === 0 || tgBeat.voices[0].empty) {
      applyBeatExtras(beat, tgBeat, staff);
    }
    for (const tgNote of tgVoice.notes) {
      beat.addNote(createNote(tgNote, beat, tgTrack, percussion));
    }
    if (tgVoice.notes.some((n) => n.effect.tapping)) beat.tap = true;
    if (tgVoice.notes.some((n) => n.effect.slapping)) beat.slap = true;
    if (tgVoice.notes.some((n) => n.effect.popping)) beat.pop = true;
    if (tgVoice.notes.some((n) => n.effect.fadeIn)) beat.fade = FadeType.FadeIn;

    cursor = tgBeat.start + durationTime(tgVoice.duration);
    filled = true;
  }
  return filled;
}

function addRests(voice: Voice, gap: number): void {
  while (gap > 0) {
    const d = REST_DURATIONS.find((r) => durationTime(r) <= gap);
    if (!d) return;
    const rest = new BeatCtor();
    applyDuration(rest, d);
    voice.addBeat(rest);
    gap -= durationTime(d);
  }
}

function applyDuration(beat: Beat, d: TgDuration): void {
  beat.duration = d.value as alphaTab.model.Duration;
  beat.dots = d.dotted ? 1 : d.doubleDotted ? 2 : 0;
  if (d.enters !== 1 || d.times !== 1) {
    beat.tupletNumerator = d.enters;
    beat.tupletDenominator = d.times;
  }
}

function applyBeatExtras(beat: Beat, tgBeat: TgBeat, staff: alphaTab.model.Staff): void {
  if (tgBeat.text) {
    beat.text = tgBeat.text;
  }
  if (tgBeat.chord && tgBeat.chord.name) {
    const chord = new Chord();
    chord.name = tgBeat.chord.name;
    chord.firstFret = tgBeat.chord.firstFret;
    chord.strings = [...tgBeat.chord.frets];
    const id = `${chord.name}|${chord.firstFret}|${chord.strings.join(',')}`;
    if (!staff.hasChord(id)) {
      staff.addChord(id, chord);
    }
    beat.chordId = id;
  }
  if (tgBeat.stroke.direction === STROKE_UP || tgBeat.stroke.direction === STROKE_DOWN) {
    beat.brushType =
      tgBeat.stroke.direction === STROKE_UP ? BrushType.BrushUp : BrushType.BrushDown;
    beat.brushDuration = strokeDuration(tgBeat.stroke.value);
  }
}

/** TG stroke value is a note value (4, 8, …, 64); alphaTab wants the brush length in ticks. */
function strokeDuration(value: number): number {
  return value > 0 ? Math.round((960 * 4) / value / 8) : 0;
}

function createGraceBeat(notes: TgNote[], tgTrack: TgTrack, percussion: boolean): Beat {
  const beat = new BeatCtor();
  const grace = notes[0].effect.grace!;
  beat.graceType = grace.onBeat ? GraceType.OnBeat : GraceType.BeforeBeat;
  beat.duration =
    grace.duration === 3
      ? Duration.Sixteenth
      : grace.duration === 2
        ? Duration.ThirtySecond
        : Duration.SixtyFourth;
  for (const tgNote of notes) {
    const g = tgNote.effect.grace!;
    const note = new NoteCtor();
    setPitch(note, g.fret, tgNote.string, tgTrack, percussion);
    note.isDead = g.dead;
    note.dynamics = toDynamic(g.dynamic);
    beat.addNote(note);
  }
  return beat;
}

function createNote(tgNote: TgNote, beat: Beat, tgTrack: TgTrack, percussion: boolean): Note {
  const note = new NoteCtor();
  const e = tgNote.effect;
  setPitch(note, tgNote.value, tgNote.string, tgTrack, percussion);
  note.isTieDestination = tgNote.tied;
  note.dynamics = toDynamic(tgNote.velocity);
  note.isDead = e.deadNote;
  note.isGhost = e.ghostNote;
  note.isPalmMute = e.palmMute;
  note.isStaccato = e.staccato;
  note.isLetRing = e.letRing;
  note.isHammerPullOrigin = e.hammer;
  if (e.heavyAccentuatedNote) note.accentuated = AccentuationType.Heavy;
  else if (e.accentuatedNote) note.accentuated = AccentuationType.Normal;
  if (e.vibrato) note.vibrato = VibratoType.Slight;
  if (e.slide) note.slideOutType = SlideOutType.Shift;
  if (e.harmonic) {
    note.harmonicType = HARMONIC_TYPES[e.harmonic.type] ?? HarmonicType.None;
    if (note.harmonicType === HarmonicType.Natural) {
      note.harmonicValue = alphaTabHarmonicValue(tgNote.value);
    } else {
      note.harmonicValue = e.harmonic.data;
    }
  }
  if (e.bend && e.bend.length > 0) {
    // Some files (e.g. converted from Guitar Pro) store raw GP bend units instead of TuxGuitar's:
    // positions 0–60 and 25 per quarter tone, which would otherwise draw bends of dozens of tones.
    const gpUnits = e.bend.some((p) => p.position > 12 || p.value > 12);
    for (const p of e.bend) {
      const position = gpUnits ? Math.min(p.position, 60) : p.position * 5;
      const value = gpUnits ? Math.round(p.value / 25) : p.value * 2;
      note.addBendPoint(new BendPoint(position, Math.min(value, MAX_BEND_QUARTER_TONES)));
    }
  }
  if (e.tremoloBar && e.tremoloBar.length > 0 && beat.whammyBarPoints === null) {
    for (const p of e.tremoloBar) {
      beat.addWhammyBarPoint(new BendPoint(p.position * 5, p.value * 2));
    }
  }
  if (e.trill && !percussion) {
    note.trillValue = e.trill.fret + stringValue(tgTrack, tgNote.string) + tgTrack.offset;
    note.trillSpeed = e.trill.duration as alphaTab.model.Duration;
  }
  if (e.tremoloPicking) {
    const tremolo = new alphaTab.model.TremoloPickingEffect();
    tremolo.marks = tremoloMarks(e.tremoloPicking.duration);
    beat.tremoloPicking = tremolo;
  }
  return note;
}

function tremoloMarks(duration: number): number {
  return duration >= 32 ? 3 : duration >= 16 ? 2 : 1;
}

/** Natural harmonic value as alphaTab expects it: the fret the harmonic is played on. */
function alphaTabHarmonicValue(fret: number): number {
  return fret;
}

function setPitch(
  note: Note,
  fret: number,
  string: number,
  tgTrack: TgTrack,
  percussion: boolean,
): void {
  if (percussion) {
    const key = fret + stringValue(tgTrack, string);
    note.percussionArticulation = PERCUSSION_ARTICULATION_REMAP.get(key) ?? key;
    note.string = -1;
    note.fret = -1;
  } else {
    // TuxGuitar string 1 is the highest; alphaTab string 1 is the lowest.
    note.string = tgTrack.strings.length - string + 1;
    note.fret = fret;
  }
}

function stringValue(tgTrack: TgTrack, string: number): number {
  return tgTrack.strings[string - 1] ?? 0;
}

function toClef(clef: number): alphaTab.model.Clef {
  switch (clef) {
    case CLEF_BASS:
      return Clef.F4;
    case CLEF_TENOR:
      return Clef.C4;
    case CLEF_ALTO:
      return Clef.C3;
    default:
      return Clef.G2;
  }
}

/** TG velocities step by 16 from 15 (ppp) to 127 (fff). */
function toDynamic(velocity: number): alphaTab.model.DynamicValue {
  const index = Math.max(0, Math.min(7, Math.round((velocity - 15) / 16)));
  return [
    DynamicValue.PPP,
    DynamicValue.PP,
    DynamicValue.P,
    DynamicValue.MP,
    DynamicValue.MF,
    DynamicValue.F,
    DynamicValue.FF,
    DynamicValue.FFF,
  ][index];
}
