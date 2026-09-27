import { Injectable, inject, signal } from '@angular/core';
import type { VideoFormat } from '../core/export/export-video';
import { PRESETS, VideoPreset } from '../core/scene/options';
import { SongStore } from './song-store';

export type ExportPhase = 'idle' | 'audio' | 'video' | 'done' | 'error';

export interface ExportResult {
  url: string;
  fileName: string;
  size: number;
}

/** Share of the progress bar taken by audio synthesis; video encoding takes the rest. */
const AUDIO_SHARE = 0.2;
const SAMPLE_RATE = 48000;

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly store = inject(SongStore);

  readonly phase = signal<ExportPhase>('idle');
  readonly progress = signal(0);
  readonly error = signal<string | null>(null);
  readonly result = signal<ExportResult | null>(null);
  readonly format = signal<VideoFormat>('mp4');
  /**
   * Codecs per format, e.g. "H.264 + AAC"; null when the browser can't encode that format,
   * undefined until probed.
   */
  readonly codecs = signal<Record<VideoFormat, string | null> | undefined>(undefined);

  private abort: AbortController | null = null;
  private defaultSoundFont: Promise<Uint8Array> | null = null;

  async probe(preset: VideoPreset): Promise<void> {
    const { describeCodecs, probeCodecs } = await import('../core/export/export-video');
    const { width, height } = PRESETS[preset];
    const probe = async (format: VideoFormat) => {
      try {
        const codecs = await probeCodecs(format, width, height, SAMPLE_RATE);
        return codecs && describeCodecs(codecs);
      } catch {
        return null;
      }
    };
    const [mp4, webm] = await Promise.all([probe('mp4'), probe('webm')]);
    this.codecs.set({ mp4, webm });
    if (!(this.format() === 'mp4' ? mp4 : webm)) {
      if (mp4) this.format.set('mp4');
      else if (webm) this.format.set('webm');
    }
  }

  async exportVideo(): Promise<void> {
    const song = this.store.song();
    const scene = this.store.scene();
    if (!song || !scene || this.phase() === 'audio' || this.phase() === 'video') return;
    this.clearResult();
    this.error.set(null);
    this.progress.set(0);
    this.phase.set('audio');
    const abort = new AbortController();
    this.abort = abort;

    try {
      const [{ renderAudio }, { exportVideo }] = await Promise.all([
        import('../core/audio/render-audio'),
        import('../core/export/export-video'),
      ]);
      const soundFont = this.store.soundFont()?.bytes ?? (await this.loadDefaultSoundFont());
      const volumes = this.store.trackVolumes();
      const channelVolumes = new Map<number, number>();
      for (const track of song.tracks) {
        for (const channel of track.channels)
          channelVolumes.set(channel, volumes[track.index] ?? 1);
      }
      const audio = await renderAudio({
        midi: song.buildMidi(this.store.pianoTracks()),
        soundFont,
        channelVolumes,
        sampleRate: SAMPLE_RATE,
        songOffset: scene.songOffset,
        clickTimes: scene.countIn,
        duration: scene.duration,
        onProgress: (f) => this.progress.set(f * AUDIO_SHARE),
        signal: abort.signal,
      });

      this.phase.set('video');
      const preset = PRESETS[this.store.options().preset];
      const video = await exportVideo({
        format: this.format(),
        scene,
        audio,
        ...preset,
        onProgress: (f) => this.progress.set(AUDIO_SHARE + f * (1 - AUDIO_SHARE)),
        signal: abort.signal,
      });
      this.result.set({
        url: URL.createObjectURL(video.blob),
        fileName: `${fileBase(song.title, this.store.fileName())}-piano-tutorial.${video.extension}`,
        size: video.blob.size,
      });
      this.phase.set('done');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        this.phase.set('idle');
      } else {
        this.error.set(e instanceof Error ? e.message : 'The export failed.');
        this.phase.set('error');
      }
    } finally {
      this.abort = null;
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  downloadMidi(): void {
    const song = this.store.song();
    if (!song) return;
    const bytes = song.buildMidi(this.store.pianoTracks()).toBinary();
    const url = URL.createObjectURL(
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/midi' }),
    );
    download(url, `${fileBase(song.title, this.store.fileName())}-piano.mid`);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  clearResult(): void {
    const result = this.result();
    if (result) URL.revokeObjectURL(result.url);
    this.result.set(null);
    if (this.phase() === 'done' || this.phase() === 'error') this.phase.set('idle');
  }

  private loadDefaultSoundFont(): Promise<Uint8Array> {
    this.defaultSoundFont ??= fetch(new URL('soundfont/sonivox.sf3', document.baseURI)).then(
      async (response) => {
        if (!response.ok) throw new Error('The soundfont could not be loaded.');
        return new Uint8Array(await response.arrayBuffer());
      },
    );
    return this.defaultSoundFont;
  }
}

export function download(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
}

/** A file-name-safe version of the song title (or the input file name). */
export function fileBase(title: string, fileName: string | null): string {
  const base = (title || fileName?.replace(/\.[^.]+$/, '') || 'song')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return base || 'song';
}
