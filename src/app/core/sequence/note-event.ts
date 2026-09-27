/** Ticks are always at 960 PPQ. */
export const PPQ = 960;

export interface NoteEvent {
  trackIndex: number;
  startTick: number;
  endTick: number;
  key: number;
  velocity: number;
  channel: number;
}

export interface TempoEvent {
  tick: number;
  bpm: number;
}

export interface TimeSignatureEvent {
  tick: number;
  numerator: number;
  denominator: number;
}
