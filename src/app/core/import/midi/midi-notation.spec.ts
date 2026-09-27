import { fixture, hasFixture } from '../../testing/fixtures';
import { importFile } from '../index';

describe('midiNotation', () => {
  it.skipIf(!hasFixture('features.mid'))('writes every MIDI note into full bars', () => {
    const song = importFile(fixture('features.mid'), 'features.mid');
    const score = song.score;
    expect(song.playsScore).toBe(false);
    expect(score.masterBars.map((mb) => mb.start)).toEqual(song.bars.map((b) => b.startTick));

    const written: string[] = [];
    for (const track of score.tracks) {
      for (const bar of track.staves[0].bars) {
        const masterBar = bar.masterBar;
        const beats = bar.voices[0].beats;
        const filled = beats.reduce((sum, beat) => sum + beat.playbackDuration, 0);
        expect(filled).toBe(masterBar.calculateDuration());
        for (const beat of beats) {
          for (const note of beat.notes) {
            if (note.isTieDestination) continue;
            written.push(
              `${track.index}:${masterBar.start + beat.playbackStart}:${note.realValue}`,
            );
          }
        }
      }
    }
    const snapped = song.notes.map(
      (n) => `${n.trackIndex}:${Math.round(n.startTick / 240) * 240}:${n.key}`,
    );
    expect([...new Set(written)].sort()).toEqual([...new Set(snapped)].sort());
  });
});
