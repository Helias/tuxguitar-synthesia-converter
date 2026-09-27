import { DecimalPipe, PercentPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { PRESETS } from '../../core/scene/options';
import { ExportService } from '../../state/export.service';
import { SongStore } from '../../state/song-store';

@Component({
  selector: 'app-export-panel',
  imports: [DecimalPipe, PercentPipe],
  templateUrl: './export-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportPanel {
  protected readonly store = inject(SongStore);
  protected readonly exporter = inject(ExportService);
  protected readonly open = signal(true);

  protected readonly formats = [
    { id: 'mp4', label: 'MP4' },
    { id: 'webm', label: 'WebM' },
  ] as const;
  protected readonly codecs = this.exporter.codecs;
  protected readonly noEncoder = computed(() => {
    const codecs = this.codecs();
    return !!codecs && !codecs.mp4 && !codecs.webm;
  });

  protected readonly busy = computed(() => ['audio', 'video'].includes(this.exporter.phase()));
  protected readonly summary = computed(() => {
    const scene = this.store.scene();
    const preset = PRESETS[this.store.options().preset];
    if (!scene) return '';
    const minutes = Math.floor(scene.duration / 60);
    const seconds = Math.round(scene.duration % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')} · ${preset.height}p ${preset.fps} fps`;
  });

  constructor() {
    effect(() => {
      const preset = this.store.options().preset;
      void this.exporter.probe(preset);
    });
    // A finished video no longer matches once the settings change.
    effect(() => {
      this.store.scene();
      this.store.trackVolumes();
      this.store.soundFont();
      untracked(() => this.exporter.clearResult());
    });
  }

  protected start(): void {
    void this.exporter.exportVideo();
  }
}
