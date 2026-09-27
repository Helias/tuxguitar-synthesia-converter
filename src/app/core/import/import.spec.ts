import { readFileSync } from 'node:fs';
import * as alphaTab from '@coderline/alphatab';
import { TG_TICK_OFFSET, fixture, golden, hasFixture } from '../testing/fixtures';
import { FileFormatError, UnsupportedFormatError, importFile } from './index';

const noteOns = (song: ReturnType<typeof importFile>) =>
  song.notes.map((n) => `${n.trackIndex}:${n.startTick}:${n.key}`).sort();

const goldenNoteOns = (name: string) =>
  golden(`${name}.golden.json`)
    .events.filter((e) => e[0] === 'on')
    .map((e) => `${e[2] - 1}:${e[1] - TG_TICK_OFFSET}:${e[4]}`)
    .sort();

describe('importFile', () => {
  it.skipIf(!hasFixture('non-ti-riconosco-piu.tg'))('reads TuxGuitar files', () => {
    const song = importFile(fixture('non-ti-riconosco-piu.tg'), 'x.tg');
    expect(song.format).toEqual({ id: 'tg', label: 'TuxGuitar 1.5' });
    expect(song.title).toBe('Non ti riconosco più');
    expect(song.tracks.map((t) => [t.name, t.program, t.isPercussion])).toEqual([
      ['Chitarra classica', 24, false],
      ['Basso', 33, false],
      ['Batteria', 0, true],
    ]);
    expect(song.bars).toHaveLength(57);
    expect(song.bars[4].section).toBe('Strofa');
    expect(song.chords[0]).toEqual({ tick: 0, name: 'Dm' });
  });

  it.skipIf(!hasFixture('features.tg'))('expands repeats into played bars', () => {
    const song = importFile(fixture('features.tg'), 'features.tg');
    // [5 6 |1. 7 :| 2. 8] and |: 21 22 :| ×3 add 2 + 4 bars.
    expect(song.bars.map((b) => b.number).slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 5, 6, 8]);
    expect(song.bars).toHaveLength(57 + 2 + 4);
  });

  it.skipIf(!hasFixture('non-ti-riconosco-piu.gp5'))(
    'reads the Guitar Pro 5 export of the same song like TuxGuitar plays it',
    () => {
      const song = importFile(fixture('non-ti-riconosco-piu.gp5'), 'x.gp5');
      expect(song.format).toEqual({ id: 'gp', label: 'Guitar Pro 5' });
      expect(song.title).toBe('Non ti riconosco più');
      expect(noteOns(song)).toEqual(goldenNoteOns('non-ti-riconosco-piu'));
    },
  );

  it.skipIf(!hasFixture('features.gp4'))('reads Guitar Pro 4', () => {
    // Not compared with the golden: TuxGuitar's GP4 writer and alphaTab's GP4 reader disagree
    // on alternate endings, which is outside this app.
    const song = importFile(fixture('features.gp4'), 'features.gp4');
    expect(song.format.label).toBe('Guitar Pro 4');
    expect(song.tracks.map((t) => t.name)).toEqual(['Chitarra classica', 'Basso', 'Batteria']);
    expect(song.notes.length).toBeGreaterThan(1000);
  });

  it.skipIf(!hasFixture('features.mid'))('reads Standard MIDI files', () => {
    const song = importFile(fixture('features.mid'), 'features.mid');
    expect(song.format.id).toBe('midi');
    expect(song.tracks.map((t) => t.isPercussion)).toEqual([false, false, true]);
    expect(noteOns(song)).toEqual(goldenNoteOns('features'));
    expect(song.tempos.some((t) => Math.round(t.bpm) === 120)).toBe(true);
    const midi = song.buildMidi(new Set([0]));
    expect(midi.toBinary().length).toBeGreaterThan(100);
  });

  it('titles MIDI files after the file name when the tempo track has a default name', () => {
    const bytes = new Uint8Array(readFileSync('public/examples/Fur-Elise.mid'));
    expect(importFile(bytes, 'Fur-Elise.mid').title).toBe('Fur-Elise');
  });

  it('rejects empty and unknown files', () => {
    expect(() => importFile(new Uint8Array(), 'x')).toThrow(UnsupportedFormatError);
    const zip = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0]);
    expect(() => importFile(zip, 'x.zip')).toThrow();
  });

  it('reports truncated TuxGuitar files', () => {
    const bytes = fixture('tg15-reference.tg').subarray(0, 900);
    expect(() => importFile(bytes, 'x.tg')).toThrow(FileFormatError);
  });

  it('drops guitar pitch bends (slides, bends, vibrato) from tracks played as piano', () => {
    const song = importFile(fixture('tg15-reference.tg'), 'x.tg');
    const guitar = song.tracks[0];
    const bendsOnGuitar = (midi: alphaTab.midi.MidiFile) =>
      midi.events.filter(
        (e) =>
          (e instanceof alphaTab.midi.PitchBendEvent || e instanceof alphaTab.midi.NoteBendEvent) &&
          guitar.channels.includes(e.channel),
      ).length;
    const programs = (midi: alphaTab.midi.MidiFile) =>
      midi.events
        .filter((e) => e instanceof alphaTab.midi.ProgramChangeEvent)
        .filter((e) => guitar.channels.includes((e as alphaTab.midi.ProgramChangeEvent).channel))
        .map((e) => (e as alphaTab.midi.ProgramChangeEvent).program);

    const original = song.buildMidi(new Set());
    expect(bendsOnGuitar(original)).toBeGreaterThan(0);
    expect(programs(original)).not.toContain(0);

    const piano = song.buildMidi(new Set([guitar.index]));
    expect(bendsOnGuitar(piano)).toBe(0);
    expect(new Set(programs(piano))).toEqual(new Set([0]));
    // Notes are untouched.
    const notes = (m: alphaTab.midi.MidiFile) =>
      m.events.filter((e) => e instanceof alphaTab.midi.NoteOnEvent).length;
    expect(notes(piano)).toBe(notes(original));
  });
});
