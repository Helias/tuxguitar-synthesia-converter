export type Role = 'right' | 'left' | 'both' | 'backing' | 'off';
export type Hand = 'right' | 'left';
export type NoteNaming = 'it' | 'en' | 'none';

export interface TrackSettings {
  role: Role;
  /** Role "both": keys below this MIDI key go to the left hand. */
  splitKey: number;
  /** Playback volume, 0–1.5 (1 = as in the file). */
  volume: number;
}

export type VideoPreset = '1080p30' | '720p30' | '1080p60';

export interface VideoOptions {
  /** Falling speed in pixels per second at 1080p. */
  fallSpeed: number;
  noteNames: NoteNaming;
  rightColor: string;
  leftColor: string;
  /** Seconds of title card before the song starts. */
  leadIn: number;
  /** Four metronome clicks (and a visual 4-3-2-1) before the song starts. */
  countIn: boolean;
  /** Draw all 88 keys instead of the octaves the hands use. */
  fullKeyboard: boolean;
  /** Hand tracks keep their own instrument instead of switching to piano. */
  keepOriginalInstrument: boolean;
  preset: VideoPreset;
}

export const DEFAULT_OPTIONS: VideoOptions = {
  fallSpeed: 300,
  noteNames: 'none',
  rightColor: '#42a5f5',
  leftColor: '#78d65c',
  leadIn: 4,
  countIn: true,
  fullKeyboard: false,
  keepOriginalInstrument: false,
  preset: '1080p30',
};

export const PRESETS: Record<VideoPreset, { width: number; height: number; fps: number }> = {
  '1080p30': { width: 1920, height: 1080, fps: 30 },
  '720p30': { width: 1280, height: 720, fps: 30 },
  '1080p60': { width: 1920, height: 1080, fps: 60 },
};

export const DEFAULT_SPLIT_KEY = 60;
export const BACKING_VOLUME = 0.6;

export const NOTE_NAMES: Record<Exclude<NoteNaming, 'none'>, string[]> = {
  it: ['Do', 'Do#', 'Re', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'Sib', 'Si'],
  en: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
};

/** Name with octave, e.g. "Do4" / "C4" (MIDI 60 = C4). */
export function keyName(key: number, naming: NoteNaming): string {
  const names = NOTE_NAMES[naming === 'none' ? 'en' : naming];
  return `${names[key % 12]}${Math.floor(key / 12) - 1}`;
}
