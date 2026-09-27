import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { AudioCodec, VideoCodec } from 'mediabunny';
import { RenderedAudio, abortError } from '../audio/render-audio';
import { Ctx2D, drawFrame } from '../render/draw-frame';
import { Scene } from '../scene/scene';

export interface ExportedVideo {
  blob: Blob;
  extension: 'mp4' | 'webm';
  /** Set when the browser could not encode H.264/AAC and WebM was used instead. */
  notice: string | null;
}

export interface ExportVideoOptions {
  scene: Scene;
  audio: RenderedAudio;
  width: number;
  height: number;
  fps: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export class UnsupportedCodecError extends Error {
  override readonly name = 'UnsupportedCodecError';
}

interface Codecs {
  video: VideoCodec;
  audio: AudioCodec;
  container: 'mp4' | 'webm';
}

/** H.264 + AAC in MP4 when the browser can encode it, else VP9/VP8 + Opus in WebM. */
export async function probeCodecs(
  width: number,
  height: number,
  sampleRate: number,
): Promise<Codecs> {
  const videoOptions = { width, height, quality: QUALITY_HIGH };
  const audioOptions = { numberOfChannels: 2, sampleRate, quality: QUALITY_HIGH };
  const [avc, aac] = await Promise.all([
    getFirstEncodableVideoCodec(['avc'], videoOptions),
    getFirstEncodableAudioCodec(['aac'], audioOptions),
  ]);
  if (avc && aac) return { video: avc, audio: aac, container: 'mp4' };
  const [vp, opus] = await Promise.all([
    getFirstEncodableVideoCodec(['vp9', 'vp8'], videoOptions),
    getFirstEncodableAudioCodec(['opus'], audioOptions),
  ]);
  if (vp && opus) return { video: vp, audio: opus, container: 'webm' };
  throw new UnsupportedCodecError(
    'This browser cannot encode video (WebCodecs H.264/AAC or VP9/Opus). Use a recent Chrome or Edge.',
  );
}

/** Frames needed to cover `duration` seconds. */
export function frameCount(duration: number, fps: number): number {
  return Math.ceil(duration * fps);
}

/**
 * Draws every frame with drawFrame and encodes it together with the rendered audio. Video and
 * audio are added interleaved (one second of audio ahead at most) so the muxer never has to
 * hold one track back.
 */
export async function exportVideo(options: ExportVideoOptions): Promise<ExportedVideo> {
  const { scene, audio, width, height, fps } = options;
  const codecs = await probeCodecs(width, height, audio.sampleRate);
  await loadFonts();

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new UnsupportedCodecError('Canvas 2D is not available.');

  const output = new Output({
    format:
      codecs.container === 'mp4'
        ? new Mp4OutputFormat({ fastStart: 'in-memory' })
        : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, {
    codec: codecs.video,
    quality: QUALITY_HIGH,
    keyFrameInterval: 2,
  });
  const sound = new AudioSampleSource({ codec: codecs.audio, quality: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(sound);
  await output.start();

  const frames = frameCount(scene.duration, fps);
  const audioSeconds = audio.channels[0].length / audio.sampleRate;
  let audioSent = 0;
  try {
    for (let i = 0; i < frames; i++) {
      if (options.signal?.aborted) throw abortError();
      const t = i / fps;
      while (audioSent < audioSeconds && audioSent <= t + 1) {
        await addAudio(sound, audioChunk(audio, audioSent, 1));
        audioSent += 1;
      }
      drawFrame(ctx, t, scene, width, height);
      await video.add(t, 1 / fps);
      if (i % 10 === 0) {
        options.onProgress?.(i / frames);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    while (audioSent < audioSeconds) {
      await addAudio(sound, audioChunk(audio, audioSent, 1));
      audioSent += 1;
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  }
  options.onProgress?.(1);

  const buffer = output.target.buffer!;
  return {
    blob: new Blob([buffer], { type: codecs.container === 'mp4' ? 'video/mp4' : 'video/webm' }),
    extension: codecs.container,
    notice:
      codecs.container === 'webm'
        ? 'This browser cannot encode MP4 (H.264/AAC), so the video was saved as WebM (VP9/Opus).'
        : null,
  };
}

async function addAudio(source: AudioSampleSource, sample: AudioSample): Promise<void> {
  try {
    await source.add(sample);
  } finally {
    sample.close();
  }
}

/** `seconds` of planar stereo audio starting at `from`, as a mediabunny AudioSample. */
function audioChunk(audio: RenderedAudio, from: number, seconds: number): AudioSample {
  const start = Math.round(from * audio.sampleRate);
  const end = Math.min(audio.channels[0].length, Math.round((from + seconds) * audio.sampleRate));
  const frames = end - start;
  const data = new Float32Array(frames * 2);
  data.set(audio.channels[0].subarray(start, end), 0);
  data.set(audio.channels[1].subarray(start, end), frames);
  return new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: 2,
    sampleRate: audio.sampleRate,
    timestamp: start / audio.sampleRate,
  });
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Canvas text only uses web fonts that are already loaded. */
export async function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([
    document.fonts.load('400 24px "Noto Sans"'),
    document.fonts.load('700 34px "Noto Sans"'),
  ]);
}
