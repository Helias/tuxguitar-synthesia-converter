import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import type * as AlphaTab from '@coderline/alphatab';
import { addClick } from '../core/audio/click';
import { applyPianoMix } from '../core/sequence/piano-mix';
import { Role } from '../core/scene/options';
import { LoadedSong } from '../core/song';
import { SongStore, isHand } from './song-store';

type AlphaTabModule = typeof AlphaTab;
export type PlayerState = 'idle' | 'loading' | 'ready' | 'error';

/** How far the interpolated clock may drift from alphaSynth before it snaps back (s). */
const MAX_DRIFT = 0.06;
/** Update rate of the coarse `time` signal used by the transport UI (ms). */
const UI_TIME_INTERVAL = 100;
/** Quiet time after the last settings change before playback resumes (ms), so drags settle. */
const RESUME_DELAY = 400;

/**
 * Preview playback. alphaSynth (through AlphaTabApi, bound to the notation element) plays the
 * song; this service keeps a smooth video-time clock for the canvas. Before the song starts
 * (title card / count-in) the clock runs on its own and the count-in clicks are played with
 * Web Audio, using the same click as the exported audio.
 */
@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly store = inject(SongStore);

  /** 'ready' = playback can start (synth, soundfont and song MIDI loaded). */
  readonly state = signal<PlayerState>('idle');
  /** The API exists, so songs can be loaded and rendered. */
  private readonly apiReady = signal(false);
  readonly playing = signal(false);
  readonly looping = signal(false);
  /** Video time in seconds, updated ~10×/s for the UI. Use now() for drawing. */
  readonly time = signal(0);

  private at: AlphaTabModule | null = null;
  private api: AlphaTab.AlphaTabApi | null = null;
  private loadedSong: LoadedSong | null = null;
  private anchorTime = 0;
  private anchorPerf = 0;
  private songRunning = false;
  private raf = 0;
  private lastUiUpdate = 0;
  private audio: AudioContext | null = null;
  private clicks: AudioBufferSourceNode[] = [];
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private resumePending = false;
  /** Playback was running when a settings change paused it, so it resumes afterwards. */
  private pausedForSettings = false;

  constructor() {
    effect(() => {
      const song = this.store.song();
      if (this.apiReady() && song !== this.loadedSong) untracked(() => this.loadSong(song));
    });
    effect(() => {
      this.store.pianoTracks();
      if (!this.apiReady()) return;
      untracked(() => this.applyPrograms());
    });
    effect(() => {
      const volumes = this.store.trackVolumes();
      if (!this.apiReady() || !this.store.song()) return;
      untracked(() => this.applyVolumes(volumes));
    });
    effect(() => {
      const roles = this.store.tracks().map((t) => t.role);
      if (!this.apiReady()) return;
      untracked(() => this.renderNotation(roles));
    });
    // A settings change during playback pauses it and resumes from the same time; a paused or
    // stopped player stays as it is. A new song only resets it.
    let settingsSong: LoadedSong | null = null;
    effect(() => {
      const song = this.store.song();
      this.store.tracks();
      this.store.options();
      this.store.soundFont();
      if (song !== settingsSong) {
        settingsSong = song;
        return;
      }
      untracked(() => this.scheduleResume());
    });
    effect(() => {
      if (this.state() === 'ready' && this.resumePending) untracked(() => this.resume());
    });
    let customSoundFont = false;
    effect(() => {
      const soundFont = this.store.soundFont();
      if (!this.apiReady()) return;
      untracked(() => {
        if (soundFont) this.api?.loadSoundFont(soundFont.bytes, false);
        else if (customSoundFont) this.api?.loadSoundFont(defaultSoundFontUrl(), false);
        customSoundFont = !!soundFont;
      });
    });
  }

  /** Creates the alphaTab API on the notation element (kept mounted for the app's lifetime). */
  async attach(element: HTMLElement, scrollElement: HTMLElement): Promise<void> {
    if (this.api) return;
    this.state.set('loading');
    try {
      const at = await import('@coderline/alphatab');
      this.at = at;
      const settings = new at.Settings();
      settings.core.fontDirectory = new URL('font/', document.baseURI).href;
      settings.player.playerMode = at.PlayerMode.EnabledSynthesizer;
      settings.player.soundFont = defaultSoundFontUrl();
      settings.player.scrollElement = scrollElement;
      settings.player.enableUserInteraction = false;
      settings.display.scale = 0.8;
      const api = new at.AlphaTabApi(element, settings);
      this.api = api;
      api.countInVolume = 0;
      api.metronomeVolume = 0;
      api.midiLoad.on((midi) => this.onMidiLoad(midi));
      api.playerPositionChanged.on((e) => this.onPosition(e));
      api.playerFinished.on(() => this.onFinished());
      api.error.on(() => this.state.set('error'));
      const updateReady = () => this.state.set(api.isReadyForPlayback ? 'ready' : 'loading');
      api.playerReady.on(updateReady);
      api.soundFontLoaded.on(updateReady);
      // api.midiLoaded overflows the stack when subscribed to (alphaTab 1.8.4); the synth's own
      // event reports the same moment.
      api.player?.readyForPlayback.on(updateReady);
      // alphaTab resets channel volumes to the file's on every MIDI load; this runs after it.
      api.player?.readyForPlayback.on(() => this.applyVolumes(this.store.trackVolumes()));
      this.apiReady.set(true);
    } catch {
      this.state.set('error');
    }
  }

  now(): number {
    return this.playing()
      ? this.anchorTime + (performance.now() - this.anchorPerf) / 1000
      : this.anchorTime;
  }

  async play(): Promise<void> {
    this.cancelResume();
    const scene = this.store.scene();
    if (!scene || !this.api || this.state() !== 'ready') return;
    if (this.anchorTime >= scene.duration - 0.05) this.anchorTime = 0;
    await this.ensureAudio();
    this.anchorPerf = performance.now();
    this.playing.set(true);
    if (this.anchorTime >= scene.songOffset) {
      this.startSong(this.anchorTime - scene.songOffset);
    } else {
      this.api.timePosition = 0;
      this.scheduleClicks(this.anchorTime);
    }
    this.loop();
  }

  pause(): void {
    this.cancelResume();
    this.halt();
  }

  private halt(): void {
    this.anchorTime = this.now();
    this.playing.set(false);
    this.stopSong();
    this.cancelClicks();
    cancelAnimationFrame(this.raf);
    this.time.set(this.anchorTime);
  }

  /** Renders the notation again, e.g. after its element became visible. */
  redrawNotation(): void {
    if (this.api?.score) this.api.render();
  }

  toggle(): void {
    if (this.playing()) this.pause();
    else void this.play();
  }

  seek(t: number): void {
    const scene = this.store.scene();
    if (!scene) return;
    const time = Math.max(0, Math.min(t, scene.duration));
    const wasPlaying = this.playing();
    this.anchorTime = time;
    this.anchorPerf = performance.now();
    this.time.set(time);
    if (!this.api || this.state() !== 'ready') return;
    this.cancelClicks();
    if (time >= scene.songOffset) {
      this.api.timePosition = (time - scene.songOffset) * 1000;
      if (wasPlaying && !this.songRunning) this.startSong(time - scene.songOffset);
    } else {
      this.stopSong();
      this.api.timePosition = 0;
      if (wasPlaying) this.scheduleClicks(time);
    }
  }

  private scheduleResume(): void {
    if (this.playing()) {
      this.halt();
      this.pausedForSettings = true;
    }
    if (!this.pausedForSettings) return;
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumePending = true;
      if (this.state() === 'ready') this.resume();
    }, RESUME_DELAY);
  }

  private resume(): void {
    if (!this.playing()) void this.play();
  }

  private cancelResume(): void {
    clearTimeout(this.resumeTimer);
    this.resumePending = false;
    this.pausedForSettings = false;
  }

  private loop(): void {
    cancelAnimationFrame(this.raf);
    const tick = (now: number) => {
      if (!this.playing()) return;
      const scene = this.store.scene();
      const t = this.now();
      if (scene && !this.songRunning && t >= scene.songOffset) {
        this.startSong(t - scene.songOffset);
      }
      if (now - this.lastUiUpdate > UI_TIME_INTERVAL) {
        this.lastUiUpdate = now;
        this.time.set(t);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private startSong(songSeconds: number): void {
    if (!this.api) return;
    this.api.timePosition = songSeconds * 1000;
    this.songRunning = true;
    this.api.play();
  }

  private stopSong(): void {
    if (this.songRunning) this.api?.pause();
    this.songRunning = false;
  }

  private onPosition(e: AlphaTab.synth.PositionChangedEventArgs): void {
    const scene = this.store.scene();
    if (!scene || !this.playing() || !this.songRunning || e.isSeek) return;
    const reported = scene.songOffset + e.currentTime / 1000;
    const drift = reported - this.now();
    if (Math.abs(drift) > MAX_DRIFT) {
      this.anchorTime = reported;
      this.anchorPerf = performance.now();
    } else {
      // Nudge towards the synth clock without visible jumps.
      this.anchorTime += drift * 0.1;
    }
  }

  private onFinished(): void {
    if (!this.playing()) return;
    if (this.looping()) {
      this.pause();
      this.anchorTime = 0;
      void this.play();
      return;
    }
    const scene = this.store.scene();
    this.pause();
    this.anchorTime = scene ? scene.duration : this.anchorTime;
    this.time.set(this.anchorTime);
  }

  private loadSong(song: LoadedSong | null): void {
    this.pause();
    this.loadedSong = song;
    this.renderedTracks = '';
    this.anchorTime = 0;
    this.time.set(0);
    if (!song || !this.api) return;
    this.renderNotation(this.store.tracks().map((t) => t.role));
  }

  private renderedTracks = '';

  private renderNotation(roles: Role[]): void {
    const song = this.loadedSong;
    if (!song || !this.api) return;
    const hands = roles.map((r, i) => (isHand(r) ? i : -1)).filter((i) => i >= 0);
    const indexes = hands.length ? hands : [0];
    const key = `${song.title}|${indexes.join(',')}`;
    if (key === this.renderedTracks && this.api.score === song.score) return;
    this.renderedTracks = key;
    this.api.renderScore(song.score, indexes);
  }

  private applyPrograms(): void {
    const song = this.loadedSong;
    if (!song || !this.api) return;
    const position = this.api.timePosition;
    this.api.loadMidiForScore();
    this.api.timePosition = position;
  }

  private applyVolumes(volumes: number[]): void {
    const song = this.loadedSong;
    if (!song || !this.api) return;
    song.tracks.forEach((track, i) => {
      for (const channel of track.channels)
        this.api!.player?.setChannelVolume(channel, volumes[i] ?? 1);
    });
  }

  /**
   * alphaTab regenerates the MIDI from the score on load. Hand tracks switch to piano here; for a
   * notation-only score the file's contents are replaced by the song's own MIDI.
   */
  private onMidiLoad(midi: AlphaTab.midi.MidiFile): void {
    const song = this.loadedSong;
    if (!song) return;
    const pianoTracks = this.store.pianoTracks();
    if (song.playsScore) {
      this.patchPrograms(midi, pianoTracks);
      return;
    }
    const own = song.buildMidi(pianoTracks);
    midi.format = own.format;
    midi.division = own.division;
    midi.tracks.splice(0, midi.tracks.length, ...own.tracks);
  }

  private patchPrograms(midi: AlphaTab.midi.MidiFile, pianoTracks: ReadonlySet<number>): void {
    const song = this.loadedSong;
    if (!song || !this.at) return;
    const channels = new Set(
      song.tracks
        .filter((t) => pianoTracks.has(t.index) && !t.isPercussion)
        .flatMap((t) => t.channels),
    );
    applyPianoMix(this.at, midi, channels);
  }

  private async ensureAudio(): Promise<void> {
    this.audio ??= new AudioContext();
    if (this.audio.state === 'suspended') await this.audio.resume();
  }

  private scheduleClicks(from: number): void {
    const scene = this.store.scene();
    const ctx = this.audio;
    if (!scene || !ctx) return;
    scene.countIn.forEach((time, i) => {
      if (time < from) return;
      const buffer = ctx.createBuffer(2, Math.round(0.08 * ctx.sampleRate), ctx.sampleRate);
      const left = new Float32Array(buffer.length);
      const right = new Float32Array(buffer.length);
      addClick(left, right, ctx.sampleRate, 0, i === 0);
      buffer.copyToChannel(left, 0);
      buffer.copyToChannel(right, 1);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.start(ctx.currentTime + (time - from));
      this.clicks.push(node);
    });
  }

  private cancelClicks(): void {
    for (const node of this.clicks) {
      try {
        node.stop();
      } catch {
        // Already finished.
      }
    }
    this.clicks = [];
  }
}

function defaultSoundFontUrl(): string {
  return new URL('soundfont/sonivox.sf3', document.baseURI).href;
}
