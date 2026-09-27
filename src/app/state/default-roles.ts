import { BACKING_VOLUME, DEFAULT_SPLIT_KEY, TrackSettings } from '../core/scene/options';
import { SongTrack } from '../core/song';

const PIANO_NAME = /piano|keys|keyboard|tastier/i;
const BASS_NAME = /bass|basso/i;

/**
 * First guess at roles: a piano track plays with both hands; otherwise the busiest melodic
 * track is the right hand and a bass track (if any) the left hand. Drums and everything else are
 * backing; tracks muted in the file start Off.
 */
export function defaultTrackSettings(tracks: SongTrack[]): TrackSettings[] {
  const settings: TrackSettings[] = tracks.map((t) => ({
    role: t.mutedInFile ? 'off' : 'backing',
    splitKey: DEFAULT_SPLIT_KEY,
    volume: t.mutedInFile ? 0 : BACKING_VOLUME,
  }));
  const melodic = tracks.filter((t) => !t.isPercussion && !t.mutedInFile && t.noteCount > 0);
  const assign = (t: SongTrack | undefined, role: TrackSettings['role']) => {
    if (t) settings[t.index] = { role, splitKey: DEFAULT_SPLIT_KEY, volume: 1 };
  };

  const piano =
    melodic.find((t) => t.program <= 7 && PIANO_NAME.test(t.name)) ??
    melodic.find((t) => PIANO_NAME.test(t.name));
  if (piano) {
    assign(piano, 'both');
    return settings;
  }
  const isBass = (t: SongTrack) => (t.program >= 32 && t.program <= 39) || BASS_NAME.test(t.name);
  const bass = melodic.find(isBass);
  const lead = melodic.filter((t) => t !== bass).sort((a, b) => b.noteCount - a.noteCount)[0];
  assign(lead, 'right');
  assign(bass, 'left');
  if (!lead && !bass) assign(melodic[0], 'both');
  return settings;
}
