import * as alphaTab from '@coderline/alphatab';
import { NoteEvent, TempoEvent, TimeSignatureEvent } from '../../sequence/note-event';
import { PlayedBar, SongTrack } from '../../song';
import { PERCUSSION_ARTICULATION_REMAP } from '../tg/tg-to-score';

const { Automation, Bar, Beat, Clef, MasterBar, Note, Score, Section, Track, Voice } =
  alphaTab.model;

/** Quantization grid: a sixteenth note at 960 PPQ. */
const GRID = 240;

/** Note values the grid can express, longest first: [ticks, duration, dots]. */
const DURATIONS: [number, alphaTab.model.Duration, number][] = [
  [3840, alphaTab.model.Duration.Whole, 0],
  [2880, alphaTab.model.Duration.Half, 1],
  [1920, alphaTab.model.Duration.Half, 0],
  [1440, alphaTab.model.Duration.Quarter, 1],
  [960, alphaTab.model.Duration.Quarter, 0],
  [720, alphaTab.model.Duration.Eighth, 1],
  [480, alphaTab.model.Duration.Eighth, 0],
  [240, alphaTab.model.Duration.Sixteenth, 0],
];

/**
 * Builds notation for a MIDI file the way TuxGuitar's MidiSongReader does: every note start or
 * end splits the beat, notes still sounding are tied into the next beat, and durations that
 * don't fit one note value are split into tied pieces. Times are snapped to a sixteenth grid.
 *
 * The Score is for display only: its bars start at the same ticks as the MIDI's, so alphaTab's
 * cursor follows playback of the original file.
 */
export function midiNotation(
  title: string,
  tracks: SongTrack[],
  notes: NoteEvent[],
  bars: PlayedBar[],
  tempos: TempoEvent[],
  timeSignatures: TimeSignatureEvent[],
  settings: alphaTab.Settings,
): alphaTab.model.Score {
  const score = new Score();
  score.title = title;
  addMasterBars(score, bars, tempos, timeSignatures);
  for (const t of tracks) {
    addTrack(
      score,
      t,
      notes.filter((n) => n.trackIndex === t.index),
      bars,
    );
  }
  score.finish(settings);
  return score;
}

function addMasterBars(
  score: alphaTab.model.Score,
  bars: PlayedBar[],
  tempos: TempoEvent[],
  timeSignatures: TimeSignatureEvent[],
): void {
  for (const bar of bars) {
    const mb = new MasterBar();
    const ts = timeSignatures.filter((t) => t.tick <= bar.startTick).at(-1);
    mb.timeSignatureNumerator = ts?.numerator ?? 4;
    mb.timeSignatureDenominator = ts?.denominator ?? 4;
    if (bar.section) {
      const section = new Section();
      section.text = bar.section;
      section.marker = '';
      mb.section = section;
    }
    const length = bar.endTick - bar.startTick;
    for (const tempo of tempos) {
      if (tempo.tick < bar.startTick || tempo.tick >= bar.endTick) continue;
      const ratio = (tempo.tick - bar.startTick) / length;
      // Display only (playback uses the MIDI's tempo map); MIDI stores µs per quarter, which
      // rarely gives a round BPM.
      const bpm = Math.round(tempo.bpm);
      mb.tempoAutomations.push(Automation.buildTempoAutomation(false, ratio, bpm, 2));
    }
    score.addMasterBar(mb);
  }
}

function addTrack(
  score: alphaTab.model.Score,
  songTrack: SongTrack,
  notes: NoteEvent[],
  bars: PlayedBar[],
): void {
  const track = new Track();
  track.ensureStaveCount(1);
  score.addTrack(track);
  track.name = songTrack.name;
  track.shortName = songTrack.name.slice(0, 10);
  const info = track.playbackInfo;
  info.program = songTrack.program;
  info.primaryChannel = songTrack.channels[0];
  info.secondaryChannel = songTrack.channels[0];
  // No string tuning: notes are placed by pitch (octave/tone) and no tablature is drawn.
  const staff = track.staves[0];
  staff.isPercussion = songTrack.isPercussion;
  // Guitars (GM 24–31) and basses (32–39) are written an octave above their sound.
  const octaveUp = !songTrack.isPercussion && songTrack.program >= 24 && songTrack.program <= 39;
  if (octaveUp) staff.displayTranspositionPitch = -12;

  const songEnd = bars[bars.length - 1].endTick;
  const quantized = notes
    .map((n) => {
      const start = Math.min(snap(n.startTick), songEnd - GRID);
      return { key: n.key, start, end: Math.min(Math.max(snap(n.endTick), start + GRID), songEnd) };
    })
    .sort((a, b) => a.start - b.start);
  const clef = songTrack.isPercussion
    ? Clef.Neutral
    : median(quantized.map((n) => n.key)) + (octaveUp ? 12 : 0) < 60
      ? Clef.F4
      : Clef.G2;

  const cuts = new Set<number>();
  for (const bar of bars) cuts.add(bar.startTick);
  for (const n of quantized) {
    cuts.add(n.start);
    cuts.add(n.end);
  }
  const boundaries = [...cuts].sort((a, b) => a - b);

  /** Sounding notes: key → end tick. */
  const sounding = new Map<number, number>();
  let next = 0;
  let b = 0;
  for (const played of bars) {
    const bar = new Bar();
    staff.addBar(bar);
    bar.clef = clef;
    const voice = new Voice();
    bar.addVoice(voice);
    while (b < boundaries.length && boundaries[b] < played.endTick) {
      const from = boundaries[b];
      const to = Math.min(boundaries[b + 1] ?? played.endTick, played.endTick);
      b++;
      for (const [key, end] of sounding) if (end <= from) sounding.delete(key);
      const started = new Set<number>();
      while (next < quantized.length && quantized[next].start === from) {
        const n = quantized[next++];
        sounding.set(n.key, Math.max(n.end, sounding.get(n.key) ?? 0));
        started.add(n.key);
      }
      let at = from;
      for (const [ticks, duration, dots] of split(to - from, from - played.startTick)) {
        const beat = new Beat();
        beat.duration = duration;
        beat.dots = dots;
        voice.addBeat(beat);
        for (const key of sounding.keys()) {
          const note = new Note();
          if (songTrack.isPercussion) {
            note.percussionArticulation = PERCUSSION_ARTICULATION_REMAP.get(key) ?? key;
          } else {
            note.octave = Math.floor(key / 12);
            note.tone = key % 12;
          }
          note.isTieDestination = at > from || !started.has(key);
          beat.addNote(note);
        }
        at += ticks;
      }
    }
  }
}

/**
 * Splits `length` ticks starting `offset` ticks into the bar into note values. Each piece is the
 * longest value that starts on a multiple of its undotted length, so beats stay readable.
 */
function split(length: number, offset: number): [number, alphaTab.model.Duration, number][] {
  const pieces: [number, alphaTab.model.Duration, number][] = [];
  while (length >= GRID) {
    const piece =
      DURATIONS.find(([ticks, , dots]) => {
        const undotted = dots ? (ticks * 2) / 3 : ticks;
        return ticks <= length && offset % undotted === 0;
      }) ?? DURATIONS[DURATIONS.length - 1];
    pieces.push(piece);
    length -= piece[0];
    offset += piece[0];
  }
  return pieces;
}

function snap(tick: number): number {
  return Math.round(tick / GRID) * GRID;
}

function median(values: number[]): number {
  if (values.length === 0) return 60;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
