import { existsSync, readFileSync } from 'node:fs';

/** Test-only helpers for reading files from test/fixtures (tests run with cwd = project root). */
/**
 * Fixtures made from copyrighted songs are kept out of the public repository; tests that need
 * them are skipped where the files are missing.
 */
export function hasFixture(name: string): boolean {
  return existsSync(`test/fixtures/${name}`);
}

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`test/fixtures/${name}`));
}

export interface Golden {
  name: string;
  artist: string;
  tracks: {
    number: number;
    name: string;
    channelId: number;
    program: number;
    percussion: boolean;
    mute: boolean;
    measures: number;
  }[];
  headers: {
    n: number;
    start: number;
    len: number;
    tempo: number;
    ts: string;
    repeatOpen: boolean;
    repeatClose: number;
    alt: number;
    marker: string | null;
  }[];
  /** [kind, tick, track number, channel, key | usPerQuarter, velocity]; ticks start at 960. */
  events: [string, number, number, number, number, number][];
}

export function golden(name: string): Golden {
  return JSON.parse(readFileSync(`test/fixtures/${name}`, 'utf8')) as Golden;
}

/** TuxGuitar starts the first measure at one quarter (960 ticks); alphaTab starts at 0. */
export const TG_TICK_OFFSET = 960;

export interface GoldenNote {
  track: number;
  start: number;
  end: number;
  key: number;
}

/** Pairs golden note-on/off events (FIFO per track and key) into notes with alphaTab ticks. */
export function goldenNotes(g: Golden): GoldenNote[] {
  const open = new Map<string, number[]>();
  const notes: GoldenNote[] = [];
  const events = [...g.events].sort((a, b) => a[1] - b[1] || (a[0] === 'off' ? -1 : 1));
  for (const [kind, tick, track, , key] of events) {
    const id = `${track}:${key}`;
    if (kind === 'on') {
      open.set(id, [...(open.get(id) ?? []), tick]);
    } else if (kind === 'off' && open.get(id)?.length) {
      const start = open.get(id)!.shift()!;
      notes.push({
        track: track - 1,
        start: start - TG_TICK_OFFSET,
        end: tick - TG_TICK_OFFSET,
        key,
      });
    }
  }
  return notes;
}
