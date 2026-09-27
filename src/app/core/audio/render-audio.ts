import * as alphaTab from '@coderline/alphatab';
import { addClick } from './click';

export interface RenderedAudio {
  sampleRate: number;
  /** Planar stereo samples, left then right. */
  channels: [Float32Array, Float32Array];
}

export interface RenderAudioOptions {
  midi: alphaTab.midi.MidiFile;
  soundFont: Uint8Array;
  /** Mix volume per MIDI channel (0 mutes). */
  channelVolumes: ReadonlyMap<number, number>;
  sampleRate: number;
  /** Where the song starts in the output, in seconds (lead-in silence before it). */
  songOffset: number;
  /** Count-in click times in seconds; the first one is accented. */
  clickTimes: readonly number[];
  /** Output length in seconds; the synthesized song is cut or padded to it. */
  duration: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Milliseconds synthesized per step; the loop yields to the UI between steps. */
const CHUNK_MS = 500;

/**
 * Synthesizes the whole song with alphaSynth (no audio device, no worker: a standalone
 * AlphaSynth only used for its exporter) and mixes in the count-in clicks.
 */
export async function renderAudio(options: RenderAudioOptions): Promise<RenderedAudio> {
  const { sampleRate } = options;
  const length = Math.ceil(options.duration * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  const exportOptions = new alphaTab.synth.AudioExportOptions();
  exportOptions.sampleRate = sampleRate;
  exportOptions.soundFonts = [options.soundFont];
  exportOptions.useSyncPoints = false;
  for (const [channel, volume] of options.channelVolumes) {
    exportOptions.trackVolume.set(channel, volume);
  }
  const exporter = createSynth(sampleRate).exportAudio(exportOptions, options.midi, [], new Map());

  let write = Math.round(options.songOffset * sampleRate);
  for (;;) {
    if (options.signal?.aborted) throw abortError();
    const chunk = exporter.render(CHUNK_MS);
    if (!chunk) break;
    const samples = chunk.samples;
    for (let i = 0; i + 1 < samples.length && write < length; i += 2, write++) {
      if (write >= 0) {
        left[write] = samples[i];
        right[write] = samples[i + 1];
      }
    }
    options.onProgress?.(chunk.endTime > 0 ? Math.min(1, chunk.currentTime / chunk.endTime) : 1);
    if (write >= length) break;
    await yieldToUi();
  }

  options.clickTimes.forEach((time, i) => addClick(left, right, sampleRate, time, i === 0));
  for (let i = 0; i < length; i++) {
    left[i] = softClip(left[i]);
    right[i] = softClip(right[i]);
  }
  options.onProgress?.(1);
  return { sampleRate, channels: [left, right] };
}

function createSynth(sampleRate: number): alphaTab.synth.AlphaSynth {
  const idle = { on: () => undefined, off: () => undefined };
  const output = {
    sampleRate,
    ready: idle,
    sampleRequest: idle,
    samplesPlayed: idle,
    open: () => undefined,
  } as unknown as alphaTab.synth.ISynthOutput;
  return new alphaTab.synth.AlphaSynth(output, 500);
}

/** Keeps occasional synth peaks from wrapping when encoded. */
function softClip(x: number): number {
  return x > 0.9 || x < -0.9 ? Math.tanh(x) : x;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function abortError(): DOMException {
  return new DOMException('The export was cancelled.', 'AbortError');
}
