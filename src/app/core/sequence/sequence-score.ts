import * as alphaTab from '@coderline/alphatab';
import type { ChordEvent, PlayedBar } from '../song';
import { NoteEvent, PPQ, TempoEvent, TimeSignatureEvent } from './note-event';

export interface Sequence {
  notes: NoteEvent[];
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  /** Playable MIDI generated in the same pass (AlphaSynthMidiFileHandler). */
  midiFile: alphaTab.midi.MidiFile;
  endTick: number;
  bars: PlayedBar[];
  chords: ChordEvent[];
}

/**
 * Runs alphaTab's MidiFileGenerator once, recording note/tempo events for the canvas while
 * the wrapped AlphaSynthMidiFileHandler builds the MidiFile used for audio.
 */
export function sequenceScore(score: alphaTab.model.Score, settings: alphaTab.Settings): Sequence {
  const midiFile = new alphaTab.midi.MidiFile();
  const inner = new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile);
  const notes: NoteEvent[] = [];
  const tempos: TempoEvent[] = [];
  const timeSignatures: TimeSignatureEvent[] = [];
  let endTick = 0;

  const handler: alphaTab.midi.IMidiFileHandler = {
    addTimeSignature: (tick, numerator, denominator) => {
      timeSignatures.push({ tick, numerator, denominator });
      inner.addTimeSignature(tick, numerator, denominator);
    },
    addRest: (track, tick, channel) => inner.addRest(track, tick, channel),
    addNote: (track, start, length, key, velocity, channel) => {
      notes.push({
        trackIndex: track,
        startTick: start,
        endTick: start + length,
        key,
        velocity,
        channel,
      });
      inner.addNote(track, start, length, key, velocity, channel);
    },
    addControlChange: (track, tick, channel, controller, value) =>
      inner.addControlChange(track, tick, channel, controller, value),
    addProgramChange: (track, tick, channel, program) =>
      inner.addProgramChange(track, tick, channel, program),
    addTempo: (tick, bpm) => {
      tempos.push({ tick, bpm });
      inner.addTempo(tick, bpm);
    },
    addNoteBend: (track, tick, channel, key, value) =>
      inner.addNoteBend(track, tick, channel, key, value),
    addBend: (track, tick, channel, value) => inner.addBend(track, tick, channel, value),
    finishTrack: (track, tick) => {
      endTick = Math.max(endTick, tick);
      inner.finishTrack(track, tick);
    },
    addTickShift: (tickShift) => inner.addTickShift(tickShift),
  };

  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
  generator.generate();
  if (midiFile.division !== PPQ) {
    throw new Error(`Unexpected MIDI division ${midiFile.division}`);
  }
  notes.sort((a, b) => a.startTick - b.startTick || a.key - b.key);
  const { bars, chords } = readTimeline(score, generator.tickLookup);
  return { notes, tempos, timeSignatures, midiFile, endTick, bars, chords };
}

/** Played bars (with sections) and chord names, in playback order, from the tick lookup. */
function readTimeline(
  score: alphaTab.model.Score,
  lookup: alphaTab.midi.MidiTickLookup,
): { bars: PlayedBar[]; chords: ChordEvent[] } {
  const bars: PlayedBar[] = [];
  const chords: ChordEvent[] = [];
  for (const played of lookup.masterBars) {
    const masterBar = played.masterBar;
    bars.push({
      number: masterBar.index + 1,
      startTick: played.start,
      endTick: played.end,
      section: masterBar.section?.text || null,
    });
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        const bar = staff.bars[masterBar.index];
        for (const voice of bar?.voices ?? []) {
          for (const beat of voice.beats) {
            const chord = beat.chordId ? staff.getChord(beat.chordId) : null;
            if (chord?.name) {
              chords.push({ tick: played.start + beat.playbackStart, name: chord.name });
            }
          }
        }
      }
    }
  }
  chords.sort((a, b) => a.tick - b.tick);
  return { bars, chords: chords.filter((c, i) => i === 0 || c.tick !== chords[i - 1].tick) };
}
