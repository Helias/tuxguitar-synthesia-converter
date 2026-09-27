import { SongTrack } from '../core/song';
import { defaultTrackSettings } from './default-roles';

const track = (index: number, name: string, program: number, minKey: number, maxKey: number) =>
  ({
    index,
    name,
    program,
    isPercussion: false,
    channels: [index],
    mutedInFile: false,
    noteCount: 100,
    minKey,
    maxKey,
  }) satisfies SongTrack;

const roles = (tracks: SongTrack[]) => defaultTrackSettings(tracks).map((s) => s.role);

describe('defaultTrackSettings', () => {
  it('splits two melodic tracks into hands by pitch', () => {
    expect(roles([track(0, 'down:', 0, 33, 76), track(1, 'up:', 0, 57, 100)])).toEqual([
      'left',
      'right',
    ]);
  });

  it('lets a lone piano track play both hands', () => {
    expect(roles([track(0, 'Vocals', 52, 55, 80), track(1, 'Piano', 0, 36, 90)])).toEqual([
      'backing',
      'both',
    ]);
  });
});
