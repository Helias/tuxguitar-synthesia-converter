import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ResizeHandle } from '../../shared/resize-handle';
import { LayoutService } from '../../state/layout.service';
import { PlayerService } from '../../state/player.service';

/**
 * Collapsible pentagram (staff notation) view. The alphaTab element stays mounted (only clipped when collapsed):
 * the AlphaTabApi bound to it also drives preview playback.
 */
@Component({
  selector: 'app-notation-panel',
  templateUrl: './notation-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ResizeHandle],
  host: { class: 'flex min-h-0 flex-col' },
})
export class NotationPanel {
  protected readonly player = inject(PlayerService);
  protected readonly layout = inject(LayoutService);
  protected readonly open = signal(false);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('alphaTab');
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  protected readonly bodyHeight = () =>
    this.scroller().nativeElement.getBoundingClientRect().height;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const element = this.host().nativeElement;
      void this.player.attach(element, this.scroller().nativeElement);
      // alphaTab skips rendering while the element has no width (the app is hidden until a song
      // loads) and doesn't retry by itself.
      let visible = false;
      const observer = new ResizeObserver(([entry]) => {
        const nowVisible = entry.contentRect.width > 0;
        if (nowVisible && !visible) this.player.redrawNotation();
        visible = nowVisible;
      });
      observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
