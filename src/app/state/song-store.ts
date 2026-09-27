import { Injectable, computed, effect, signal } from '@angular/core';
import { BACKING_VOLUME, Role, TrackSettings, VideoOptions } from '../core/scene/options';
import { Scene, buildScene } from '../core/scene/scene';
import { LoadedSong } from '../core/song';
import { defaultTrackSettings } from './default-roles';
import {
  loadOptions,
  loadTrackSettings,
  saveOptions,
  saveTrackSettings,
  sha256,
} from './persistence';

export interface CustomSoundFont {
  name: string;
  bytes: Uint8Array;
}

/** Maximum accepted file size; tabs and MIDI files are far smaller. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class SongStore {
  readonly fileName = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly song = signal<LoadedSong | null>(null);
  readonly tracks = signal<TrackSettings[]>([]);
  readonly options = signal<VideoOptions>(loadOptions());
  readonly soundFont = signal<CustomSoundFont | null>(null);

  readonly scene = computed<Scene | null>(() => {
    const song = this.song();
    return song ? buildScene(song, this.tracks(), this.options()) : null;
  });

  /** Tracks switched to Acoustic Grand Piano for playback. */
  readonly pianoTracks = computed<ReadonlySet<number>>(() => {
    if (this.options().keepOriginalInstrument) return new Set();
    return new Set(
      this.tracks()
        .map((t, i) => (isHand(t.role) ? i : -1))
        .filter((i) => i >= 0),
    );
  });

  /** Effective playback volume per track (Off mutes). */
  readonly trackVolumes = computed(() =>
    this.tracks().map((t) => (t.role === 'off' ? 0 : t.volume)),
  );

  private fileHash: string | null = null;

  constructor() {
    effect(() => saveOptions(this.options()));
    effect(() => {
      const tracks = this.tracks();
      if (this.fileHash && tracks.length) saveTrackSettings(this.fileHash, tracks);
    });
  }

  async open(file: File): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error('The file is too large (over 50 MB).');
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const [{ importFile }, hash] = await Promise.all([import('../core/import'), sha256(bytes)]);
      const song = importFile(bytes, file.name);
      if (song.notes.length === 0) {
        throw new Error('The file contains no notes.');
      }
      this.fileHash = hash;
      this.song.set(song);
      this.fileName.set(file.name);
      this.tracks.set(
        loadTrackSettings(hash, song.tracks.length) ?? defaultTrackSettings(song.tracks),
      );
    } catch (e) {
      this.error.set(describeError(e));
    } finally {
      this.loading.set(false);
    }
  }

  close(): void {
    this.fileHash = null;
    this.song.set(null);
    this.fileName.set(null);
    this.tracks.set([]);
    this.error.set(null);
  }

  setRole(index: number, role: Role): void {
    this.updateTrack(index, (t) => ({
      ...t,
      role,
      // Moving between hand and backing picks that role's default loudness.
      volume:
        role === 'off'
          ? t.volume
          : isHand(role) !== isHand(t.role)
            ? isHand(role)
              ? 1
              : BACKING_VOLUME
            : t.volume,
    }));
  }

  setVolume(index: number, volume: number): void {
    this.updateTrack(index, (t) => ({ ...t, volume }));
  }

  setSplitKey(index: number, splitKey: number): void {
    this.updateTrack(index, (t) => ({
      ...t,
      splitKey: Math.max(21, Math.min(108, Math.round(splitKey))),
    }));
  }

  updateOptions(patch: Partial<VideoOptions>): void {
    this.options.update((o) => ({ ...o, ...patch }));
  }

  private updateTrack(index: number, change: (t: TrackSettings) => TrackSettings): void {
    this.tracks.update((tracks) => tracks.map((t, i) => (i === index ? change(t) : t)));
  }
}

export function isHand(role: Role): boolean {
  return role === 'right' || role === 'left' || role === 'both';
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    switch (e.name) {
      case 'UnsupportedFormatError':
        return `Unsupported file. ${e.message} Supported: TuxGuitar (.tg), Guitar Pro 3–8, MusicXML, Capella, alphaTex and MIDI.`;
      case 'FileFormatError':
        return `The file could not be read: ${e.message}`;
      default:
        return e.message || 'The file could not be read.';
    }
  }
  return 'The file could not be read.';
}
