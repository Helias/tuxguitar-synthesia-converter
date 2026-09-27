import { fixture, hasFixture } from '../testing/fixtures';
import { importFile } from '../import';
import { DEFAULT_OPTIONS, TrackSettings } from './options';
import { buildScene, handFor } from './scene';

const SONG = 'non-ti-riconosco-piu.tg';
const available = hasFixture(SONG);
const song = available ? importFile(fixture(SONG), 'x.tg') : (null as never);
const roles = (right: number, left: number, both = -1): TrackSettings[] =>
  song.tracks.map((t) => ({
    role:
      t.index === right
        ? 'right'
        : t.index === left
          ? 'left'
          : t.index === both
            ? 'both'
            : 'backing',
    splitKey: 60,
    volume: 1,
  }));

describe.skipIf(!available)('buildScene', () => {
  it('draws only hand tracks and offsets them by the lead-in', () => {
    const scene = buildScene(song, roles(0, 1), { ...DEFAULT_OPTIONS, countIn: false, leadIn: 4 });
    const handNotes = song.notes.filter((n) => n.trackIndex === 0 || n.trackIndex === 1);
    expect(scene.notes).toHaveLength(handNotes.length);
    expect(scene.songOffset).toBe(4);
    expect(scene.notes[0].start).toBeCloseTo(4, 6);
    expect(scene.hands).toEqual(['right', 'left']);
    // 57 bars of 4/4 at 135 BPM.
    expect(scene.bars).toHaveLength(57);
    expect(scene.bars[1].time - scene.bars[0].time).toBeCloseTo((4 * 60) / 135, 6);
  });

  it('spans whole octaves around the hand notes', () => {
    const scene = buildScene(song, roles(0, 1), DEFAULT_OPTIONS);
    expect(scene.lowKey % 12).toBe(0);
    expect(scene.highKey % 12).toBe(0);
    const keys = scene.notes.map((n) => n.key);
    expect(scene.lowKey).toBeLessThanOrEqual(Math.min(...keys));
    expect(scene.highKey).toBeGreaterThanOrEqual(Math.max(...keys));
    expect(buildScene(song, roles(0, 1), { ...DEFAULT_OPTIONS, fullKeyboard: true }).lowKey).toBe(
      21,
    );
  });

  it('places four count-in clicks one beat apart before the song', () => {
    const scene = buildScene(song, roles(0, 1), { ...DEFAULT_OPTIONS, leadIn: 1, countIn: true });
    const beat = 60 / 135;
    expect(scene.songOffset).toBeCloseTo(4 * beat, 6);
    expect(scene.countIn.map((t) => +t.toFixed(6))).toEqual(
      [0, 1, 2, 3].map((i) => +(i * beat).toFixed(6)),
    );
  });

  it('splits a "both" track at the split key', () => {
    expect(handFor({ role: 'both', splitKey: 60, volume: 1 }, 59)).toBe('left');
    expect(handFor({ role: 'both', splitKey: 60, volume: 1 }, 60)).toBe('right');
    expect(handFor({ role: 'backing', splitKey: 60, volume: 1 }, 60)).toBeNull();
    const scene = buildScene(song, roles(-1, -1, 0), DEFAULT_OPTIONS);
    expect(scene.notes.every((n) => (n.key < 60 ? n.hand === 'left' : n.hand === 'right'))).toBe(
      true,
    );
  });
});
