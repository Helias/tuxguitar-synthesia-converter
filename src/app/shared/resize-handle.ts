import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

const MIN_HEIGHT = 120;
const KEY_STEP = 20;

/**
 * Horizontal bar that resizes a panel vertically: drag or use the arrow keys; double-click resets
 * to the automatic size. `height` reads the panel's current height when a resize starts.
 */
@Component({
  selector: 'app-resize-handle',
  template: `<span
    class="h-1 w-12 rounded-full bg-slate-600 group-hover:bg-sky-400 group-focus-visible:bg-sky-400"
  ></span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'group flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none',
    role: 'separator',
    'aria-orientation': 'horizontal',
    tabindex: '0',
    '[attr.aria-label]': 'label()',
    title: 'Drag to resize · double-click to reset',
    '(pointerdown)': 'start($event)',
    '(dblclick)': 'resized.emit(null)',
    '(keydown)': 'nudge($event)',
  },
})
export class ResizeHandle {
  readonly label = input.required<string>();
  readonly height = input.required<() => number>();
  readonly resized = output<number | null>();

  protected start(event: PointerEvent): void {
    if (event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const startY = event.clientY;
    const startHeight = this.height()();
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    const move = (e: PointerEvent) =>
      this.resized.emit(Math.max(MIN_HEIGHT, Math.round(startHeight + e.clientY - startY)));
    // Fires after pointerup/pointercancel too, so every way a drag can end is covered.
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('lostpointercapture', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('lostpointercapture', end);
  }

  protected nudge(event: KeyboardEvent): void {
    const delta = event.key === 'ArrowUp' ? -KEY_STEP : event.key === 'ArrowDown' ? KEY_STEP : 0;
    if (!delta) return;
    event.preventDefault();
    this.resized.emit(Math.max(MIN_HEIGHT, Math.round(this.height()() + delta)));
  }
}
