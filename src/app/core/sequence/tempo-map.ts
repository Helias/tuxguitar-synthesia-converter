import { PPQ, TempoEvent } from './note-event';

/** Converts ticks (960 PPQ) to seconds and back over a list of tempo changes. */
export class TempoMap {
  private readonly ticks: number[] = [];
  private readonly bpms: number[] = [];
  private readonly secs: number[] = [];

  constructor(tempos: TempoEvent[]) {
    const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
    if (sorted.length === 0 || sorted[0].tick > 0) {
      sorted.unshift({ tick: 0, bpm: sorted[0]?.bpm ?? 120 });
    }
    let sec = 0;
    sorted.forEach((t, i) => {
      if (i > 0 && t.tick === this.ticks[this.ticks.length - 1]) {
        this.bpms[this.bpms.length - 1] = t.bpm;
        return;
      }
      if (i > 0) {
        const prev = this.ticks.length - 1;
        sec += ((t.tick - this.ticks[prev]) / PPQ) * (60 / this.bpms[prev]);
      }
      this.ticks.push(t.tick);
      this.bpms.push(t.bpm);
      this.secs.push(sec);
    });
  }

  toSeconds(tick: number): number {
    const i = Math.max(0, upperBound(this.ticks, tick) - 1);
    return this.secs[i] + ((tick - this.ticks[i]) / PPQ) * (60 / this.bpms[i]);
  }

  toTick(seconds: number): number {
    const i = Math.max(0, upperBound(this.secs, seconds) - 1);
    return this.ticks[i] + ((seconds - this.secs[i]) * this.bpms[i] * PPQ) / 60;
  }

  bpmAt(tick: number): number {
    return this.bpms[Math.max(0, upperBound(this.ticks, tick) - 1)];
  }
}

/** Index of the first element greater than `value` in a sorted array. */
export function upperBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first element greater than or equal to `value` in a sorted array. */
export function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
