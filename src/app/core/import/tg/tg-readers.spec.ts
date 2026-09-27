import * as alphaTab from '@coderline/alphatab';
import {
  Golden,
  GoldenNote,
  TG_TICK_OFFSET,
  fixture,
  golden,
  goldenNotes,
  hasFixture,
} from '../../testing/fixtures';
import { sequenceScore } from '../../sequence/sequence-score';
import { detectTuxGuitar, readTuxGuitar, tgToScore } from './tg';
import { TgSong, measureLength } from './tg-model';
import { tgPlaybackOrder } from './tg-playback-order';

interface Case {
  name: string;
  format: string;
  /**
   * Bars (TuxGuitar numbering) whose notes are not compared. alphaTab sequences these effects
   * differently from TuxGuitar's MidiSequenceParser:
   * - harmonics: TuxGuitar adds a quieter note an octave below the harmonic and uses its own
   *   harmonic pitch table;
   * - grace notes: TuxGuitar steals 60/120/180 ticks from the previous beat, alphaTab uses its
   *   own grace timing;
   * - trill / tremolo picking: different subdivision of the note.
   */
  effectBars?: number[];
  /**
   * Bars whose note ends are not compared (onsets still are):
   * - let-ring chains ring longer in TuxGuitar (until the next note on the same string);
   * - a tie between different frets (reference files, bar 30) is lengthened by TuxGuitar's
   *   tie arithmetic, alphaTab adds the tied duration.
   */
  endBars?: number[] | 'all';
}

const REFERENCE_EFFECT_BARS = [26, 27, 28];

const CASES: Case[] = [
  { name: 'non-ti-riconosco-piu', format: 'tg-1.5' },
  { name: 'giancane-piano', format: 'tg-1.5' },
  { name: 'features', format: 'tg-1.5', endBars: [13, 14] },
  {
    name: 'tg15-reference',
    format: 'tg-1.5',
    effectBars: REFERENCE_EFFECT_BARS,
    endBars: [30],
  },
  { name: 'features-v1.3', format: 'tg-1.3', endBars: [13, 14] },
  { name: 'giancane', format: 'tg-1.3' },
  { name: 'features-v1.2', format: 'tg-1.2', endBars: [13, 14] },
  { name: 'features-v1.1', format: 'tg-1.1' },
  { name: 'features-v1.0', format: 'tg-1.0' },
  { name: 'legacy-v0.9', format: 'tg-0.9' },
  { name: 'legacy-v0.8', format: 'tg-0.8' },
  { name: 'legacy-v0.7', format: 'tg-0.7' },
  {
    name: 'tg20-reference',
    format: 'tg-2',
    effectBars: REFERENCE_EFFECT_BARS,
    endBars: [30],
  },
  { name: 'tg20-alt-repeat-loop', format: 'tg-2' },
  { name: 'tg20-tempo', format: 'tg-2' },
  { name: 'tg20-let-ring', format: 'tg-2', endBars: 'all' },
];

/** Playback tick ranges (alphaTab ticks) of the given bars across all their repetitions. */
function playbackRanges(song: TgSong, bars: number[] | 'all' | undefined): [number, number][] {
  if (!bars) return [];
  const ranges: [number, number][] = [];
  let tick = 0;
  for (const index of tgPlaybackOrder(song)) {
    const length = measureLength(song.headers[index]);
    if (bars === 'all' || bars.includes(index + 1)) ranges.push([tick, tick + length]);
    tick += length;
  }
  return ranges;
}

const inRanges = (tick: number, ranges: [number, number][]) =>
  ranges.some(([from, to]) => tick >= from && tick < to);

/**
 * Palm-muted notes last `tempo * 60 / 60` ticks in TuxGuitar (MidiSequenceParser
 * DEFAULT_DURATION_PM) and `tempo * 80 / 60` in alphaTab (MidiFileGenerator
 * _defaultDurationPalmMute); both are hardcoded.
 */
function isPalmMuteDifference(n: GoldenNote, actualEnd: number, g: Golden): boolean {
  const header = [...g.headers].reverse().find((h) => h.start - TG_TICK_OFFSET <= n.start);
  const tempo = header?.tempo ?? 120;
  return n.end - n.start === tempo && actualEnd - n.start === Math.trunc((tempo * 80) / 60);
}

describe('TuxGuitar readers', () => {
  for (const { name, format, effectBars, endBars } of CASES.filter((c) =>
    hasFixture(`${c.name}.tg`),
  )) {
    describe(name, () => {
      const g = golden(`${name}.golden.json`);
      const bytes = fixture(`${name}.tg`);
      const song = readTuxGuitar(bytes, detectTuxGuitar(bytes)!);
      const settings = new alphaTab.Settings();
      const seq = sequenceScore(tgToScore(song, settings), settings);
      const skipped = playbackRanges(song, effectBars);
      const skipEnds = playbackRanges(song, endBars);

      it(`is detected as ${format}`, () => {
        expect(detectTuxGuitar(bytes)).toBe(format);
      });

      it('reads song and track metadata', () => {
        expect(song.name).toBe(g.name ?? '');
        expect(song.artist).toBe(g.artist ?? '');
        expect(
          song.tracks.map((t) => {
            const c = song.channels.find((ch) => ch.id === t.channelId)!;
            return {
              number: t.number,
              name: t.name,
              channelId: t.channelId,
              program: c.program,
              percussion: c.bank === 128,
              mute: t.mute,
              measures: t.measures.length,
            };
          }),
        ).toEqual(g.tracks);
      });

      it('reads measure headers', () => {
        expect(
          song.headers.map((h) => ({
            n: h.number,
            start: h.start,
            len: measureLength(h),
            tempo: h.tempo,
            ts: `${h.numerator}/${h.denominator.value}`,
            repeatOpen: h.repeatOpen,
            repeatClose: h.repeatClose,
            alt: h.repeatAlternative,
            marker: h.marker?.title ?? null,
          })),
        ).toEqual(g.headers);
      });

      it('sequences the same note-ons as TuxGuitar', () => {
        const actual = seq.notes
          .filter((n) => !inRanges(n.startTick, skipped))
          .map((n) => `${n.trackIndex}:${n.startTick}:${n.key}`)
          .sort();
        const expected = g.events
          .filter((e) => e[0] === 'on' && !inRanges(e[1] - TG_TICK_OFFSET, skipped))
          .map((e) => `${e[2] - 1}:${e[1] - TG_TICK_OFFSET}:${e[4]}`)
          .sort();
        expect(actual).toEqual(expected);
      });

      it('ends notes within one tick of TuxGuitar', () => {
        const ends = new Map<string, number[]>();
        for (const n of seq.notes) {
          const id = `${n.trackIndex}:${n.startTick}:${n.key}`;
          ends.set(id, [...(ends.get(id) ?? []), n.endTick]);
        }
        const mismatches = goldenNotes(g).filter((n) => {
          if (inRanges(n.start, skipped) || inRanges(n.start, skipEnds)) return false;
          const candidates = ends.get(`${n.track}:${n.start}:${n.key}`) ?? [];
          return !candidates.some(
            (end) => Math.abs(end - n.end) <= 1 || isPalmMuteDifference(n, end, g),
          );
        });
        expect(mismatches).toEqual([]);
      });
    });
  }
});
