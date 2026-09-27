import { DEFAULT_OPTIONS, TrackSettings, VideoOptions } from '../core/scene/options';

const OPTIONS_KEY = 'tsc.options.v1';
const FILE_PREFIX = 'tsc.file.v1.';

/** Global video options; storage may be unavailable (private mode, blocked site data). */
export function loadOptions(): VideoOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    return raw
      ? { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<VideoOptions>) }
      : DEFAULT_OPTIONS;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

export function saveOptions(options: VideoOptions): void {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Not persisted; the app works without storage.
  }
}

/** Per-file roles, split keys and volumes, keyed by the SHA-256 of the file bytes. */
export function loadTrackSettings(fileHash: string, trackCount: number): TrackSettings[] | null {
  try {
    const raw = localStorage.getItem(FILE_PREFIX + fileHash);
    const saved = raw ? (JSON.parse(raw) as TrackSettings[]) : null;
    return saved?.length === trackCount ? saved : null;
  } catch {
    return null;
  }
}

export function saveTrackSettings(fileHash: string, tracks: TrackSettings[]): void {
  try {
    localStorage.setItem(FILE_PREFIX + fileHash, JSON.stringify(tracks));
  } catch {
    // Not persisted.
  }
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
