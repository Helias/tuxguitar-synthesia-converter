import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HEIGHT, KEYS_TOP, WIDTH, drawFrame, keyX, whiteKeyAt } from '../../core/render/draw-frame';
import { keyName } from '../../core/scene/options';
import { PlayerService } from '../../state/player.service';
import { SongStore } from '../../state/song-store';

@Component({
  selector: 'app-preview-player',
  templateUrl: './preview-player.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col', '(document:keydown.space)': 'onSpace($event)' },
})
export class PreviewPlayer {
  protected readonly store = inject(SongStore);
  protected readonly player = inject(PlayerService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');
  private readonly size = signal({ width: 0, height: 0 });
  private raf = 0;
  private dragging: number | null = null;

  protected readonly keysTopPercent = (KEYS_TOP / HEIGHT) * 100;

  protected readonly duration = computed(() => this.store.scene()?.duration ?? 0);

  /** A draggable marker per "Both hands" track, at its split key. */
  protected readonly markers = computed(() => {
    const scene = this.store.scene();
    if (!scene) return [];
    const naming = this.store.options().noteNames;
    return this.store
      .tracks()
      .map((t, index) => ({ t, index }))
      .filter(({ t }) => t.role === 'both')
      .map(({ t, index }) => {
        const x = keyX(scene, t.splitKey);
        return {
          index,
          left: x === null ? null : (x / WIDTH) * 100,
          label: `${index + 1} · ${keyName(t.splitKey, naming)}`,
        };
      })
      .filter((m) => m.left !== null);
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const observer = new ResizeObserver(([entry]) => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.min(WIDTH, Math.round(entry.contentRect.width * dpr));
        this.size.set({ width, height: Math.round((width * HEIGHT) / WIDTH) });
      });
      observer.observe(this.frame().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    destroyRef.onDestroy(() => cancelAnimationFrame(this.raf));

    // Paused: redraw when anything visible changes. Playing: redraw every animation frame.
    effect(() => {
      const scene = this.store.scene();
      const { width, height } = this.size();
      const time = this.player.time();
      if (!scene || !width) return;
      const canvas = this.canvas().nativeElement;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (this.player.playing()) {
        this.animate();
      } else {
        cancelAnimationFrame(this.raf);
        drawFrame(canvas.getContext('2d')!, time, scene, width, height);
      }
    });
  }

  private animate(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      const scene = this.store.scene();
      if (!scene || !this.player.playing()) return;
      const canvas = this.canvas().nativeElement;
      drawFrame(canvas.getContext('2d')!, this.player.now(), scene, canvas.width, canvas.height);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  protected readonly fmt = formatTime;

  protected seek(value: string): void {
    this.player.seek(Number(value));
  }

  protected onSpace(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;
    event.preventDefault();
    this.player.toggle();
  }

  protected startDrag(event: PointerEvent, trackIndex: number): void {
    this.dragging = trackIndex;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  protected drag(event: PointerEvent): void {
    const scene = this.store.scene();
    if (this.dragging === null || !scene) return;
    const rect = this.frame().nativeElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    this.store.setSplitKey(this.dragging, whiteKeyAt(scene, x));
  }

  protected endDrag(): void {
    this.dragging = null;
  }

  protected nudge(event: KeyboardEvent, trackIndex: number): void {
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    this.store.setSplitKey(trackIndex, (this.store.tracks()[trackIndex]?.splitKey ?? 60) + delta);
  }
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
