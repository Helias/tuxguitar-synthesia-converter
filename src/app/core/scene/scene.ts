import { TempoMap, upperBound } from '../sequence/tempo-map';
import { LoadedSong } from '../song';
import { Hand, NoteNaming, TrackSettings, VideoOptions } from './options';

export interface SceneNote {
  /** Video time in seconds. */
  start: number;
  end: number;
  key: number;
  hand: Hand;
}

export interface SceneBar {
  time: number;
  number: number;
  section: string | null;
}

export interface SceneLabel {
  time: number;
  text: string;
}

/**
 * Everything drawFrame needs, in video time (seconds from the first frame). The song starts at
 * `songOffset`; before that is the title card / count-in.
 */
export interface Scene {
  title: string;
  artist: string;
  notes: SceneNote[];
  /** notes[i].start, for binary search. */
  starts: number[];
  maxNoteDuration: number;
  lowKey: number;
  highKey: number;
  bars: SceneBar[];
  barTimes: number[];
  sections: SceneLabel[];
  sectionTimes: number[];
  chords: SceneLabel[];
  chordTimes: number[];
  /** Video time where the song (tick 0) starts. */
  songOffset: number;
  /** Video times of the four count-in clicks (empty without count-in). */
  countIn: number[];
  /** Video length in seconds (song + release tail). */
  duration: number;
  hands: Hand[];
  colors: Record<Hand, string>;
  noteNames: NoteNaming;
  fallSpeed: number;
}

/** Seconds of video after the last note so the final notes ring out. */
export const TAIL_SECONDS = 2.5;
export const COUNT_IN_BEATS = 4;

export function buildScene(
  song: LoadedSong,
  tracks: TrackSettings[],
  options: VideoOptions,
): Scene {
  const tempo = new TempoMap(song.tempos);
  const beatSeconds = 60 / tempo.bpmAt(0);
  const countInLength = options.countIn ? COUNT_IN_BEATS * beatSeconds : 0;
  const songOffset = Math.max(options.leadIn, countInLength);
  const time = (tick: number) => tempo.toSeconds(tick) + songOffset;

  const notes: SceneNote[] = [];
  for (const n of song.notes) {
    const hand = handFor(tracks[n.trackIndex], n.key);
    if (!hand) continue;
    notes.push({ start: time(n.startTick), end: time(n.endTick), key: n.key, hand });
  }
  notes.sort((a, b) => a.start - b.start || a.key - b.key);

  const keys = notes.map((n) => n.key);
  const [lowKey, highKey] = options.fullKeyboard
    ? [21, 108]
    : keys.length
      ? [Math.floor(Math.min(...keys) / 12) * 12, (Math.floor(Math.max(...keys) / 12) + 1) * 12]
      : [48, 84];

  const bars = song.bars.map((b) => ({
    time: time(b.startTick),
    number: b.number,
    section: b.section,
  }));
  const sections: SceneLabel[] = [];
  for (const b of bars) {
    if (b.section && sections[sections.length - 1]?.text !== b.section) {
      sections.push({ time: b.time, text: b.section });
    }
  }

  const chords = song.chords.map((c) => ({ time: time(c.tick), text: c.name }));
  const songEnd = Math.max(
    time(song.endTick),
    notes.reduce((max, n) => Math.max(max, n.end), 0),
  );
  const hands = (['right', 'left'] as Hand[]).filter((h) => notes.some((n) => n.hand === h));

  return {
    title: song.title,
    artist: song.artist,
    notes,
    starts: notes.map((n) => n.start),
    maxNoteDuration: notes.reduce((max, n) => Math.max(max, n.end - n.start), 0),
    lowKey,
    highKey,
    bars,
    barTimes: bars.map((b) => b.time),
    sections,
    sectionTimes: sections.map((s) => s.time),
    chords,
    chordTimes: chords.map((c) => c.time),
    songOffset,
    countIn: options.countIn
      ? Array.from(
          { length: COUNT_IN_BEATS },
          (_, i) => songOffset - (COUNT_IN_BEATS - i) * beatSeconds,
        )
      : [],
    duration: songEnd + TAIL_SECONDS,
    hands,
    colors: { right: options.rightColor, left: options.leftColor },
    noteNames: options.noteNames,
    fallSpeed: options.fallSpeed,
  };
}

export function handFor(track: TrackSettings | undefined, key: number): Hand | null {
  switch (track?.role) {
    case 'right':
      return 'right';
    case 'left':
      return 'left';
    case 'both':
      return key < track.splitKey ? 'left' : 'right';
    default:
      return null;
  }
}

/** Index of the last element of `times` that is <= t, or -1. */
export function lastAtOrBefore(times: readonly number[], t: number): number {
  return upperBound(times, t) - 1;
}
