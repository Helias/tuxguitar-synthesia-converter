import type * as alphaTab from '@coderline/alphatab';
import type { NoteEvent, TempoEvent, TimeSignatureEvent } from './sequence/note-event';

export interface SongTrack {
  index: number;
  name: string;
  /** General MIDI program of the first instrument, 0-based. */
  program: number;
  isPercussion: boolean;
  /** MIDI channels the track plays on (volume and program changes apply to these). */
  channels: number[];
  /** Muted in the source file; such tracks start with the Off role. */
  mutedInFile: boolean;
  noteCount: number;
  minKey: number;
  maxKey: number;
}

/** One played bar (repeats are expanded). */
export interface PlayedBar {
  /** Bar number in the score, 1-based. */
  number: number;
  startTick: number;
  endTick: number;
  section: string | null;
}

export interface ChordEvent {
  tick: number;
  name: string;
}

export interface SongFormat {
  id: string;
  label: string;
}

/**
 * Everything the app needs from an imported file. Ticks are at 960 PPQ and include repeats.
 */
export interface LoadedSong {
  format: SongFormat;
  title: string;
  artist: string;
  /** alphaTab model for notation and preview playback; null for MIDI input. */
  score: alphaTab.model.Score | null;
  tracks: SongTrack[];
  notes: NoteEvent[];
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  bars: PlayedBar[];
  chords: ChordEvent[];
  endTick: number;
  /**
   * A fresh playable MIDI file. Tracks in `pianoTracks` have every program change replaced by
   * Acoustic Grand Piano.
   */
  buildMidi(pianoTracks: ReadonlySet<number>): alphaTab.midi.MidiFile;
}

export function summarizeTracks(
  base: Omit<SongTrack, 'noteCount' | 'minKey' | 'maxKey'>[],
  notes: NoteEvent[],
): SongTrack[] {
  return base.map((t) => {
    let noteCount = 0;
    let minKey = 127;
    let maxKey = 0;
    for (const n of notes) {
      if (n.trackIndex !== t.index) continue;
      noteCount++;
      minKey = Math.min(minKey, n.key);
      maxKey = Math.max(maxKey, n.key);
    }
    return { ...t, noteCount, minKey: noteCount ? minKey : 0, maxKey: noteCount ? maxKey : 0 };
  });
}
