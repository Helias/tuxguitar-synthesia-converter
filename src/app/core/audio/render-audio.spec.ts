import { readFileSync } from 'node:fs';
import { fixture, hasFixture } from '../testing/fixtures';
import { importFile } from '../import';
import { renderAudio } from './render-audio';

const soundFont = new Uint8Array(
  readFileSync('node_modules/@coderline/alphatab/dist/soundfont/sonivox.sf3'),
);
const SONG = 'non-ti-riconosco-piu.tg';
const available = hasFixture(SONG);
const song = available ? importFile(fixture(SONG), 'x.tg') : (null as never);
const SR = 48000;

function firstLoudSample(samples: Float32Array, from = 0, threshold = 0.01): number {
  for (let i = from; i < samples.length; i++) if (Math.abs(samples[i]) > threshold) return i;
  return -1;
}

describe.skipIf(!available)('renderAudio', () => {
  it('starts the song exactly at the lead-in offset and pads to the duration', async () => {
    const audio = await renderAudio({
      midi: song.buildMidi(new Set([0, 1])),
      soundFont,
      channelVolumes: new Map(),
      sampleRate: SR,
      songOffset: 2,
      clickTimes: [],
      duration: 8,
    });
    expect(audio.channels[0].length).toBe(8 * SR);
    const onset = firstLoudSample(audio.channels[0]);
    expect(onset / SR).toBeGreaterThanOrEqual(2);
    expect(onset / SR).toBeLessThan(2.02);
  });

  it('mixes the count-in clicks and mutes channels with volume 0', async () => {
    const muted = new Map(song.tracks.flatMap((t) => t.channels.map((c) => [c, 0] as const)));
    const audio = await renderAudio({
      midi: song.buildMidi(new Set()),
      soundFont,
      channelVolumes: muted,
      sampleRate: SR,
      songOffset: 2,
      clickTimes: [0.5, 1, 1.5],
      duration: 4,
    });
    const left = audio.channels[0];
    expect(firstLoudSample(left) / SR).toBeCloseTo(0.5, 2);
    expect(firstLoudSample(left, Math.round(0.9 * SR)) / SR).toBeCloseTo(1, 2);
    // Every track muted: nothing after the song starts.
    expect(firstLoudSample(left, Math.round(1.7 * SR), 0.001)).toBe(-1);
  });
});
