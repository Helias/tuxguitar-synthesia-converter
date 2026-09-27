import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { PlayerService } from '../../state/player.service';

/**
 * Collapsible score view. The alphaTab element stays mounted (only clipped when collapsed):
 * the AlphaTabApi bound to it also drives preview playback.
 */
@Component({
  selector: 'app-notation-panel',
  templateUrl: './notation-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class NotationPanel {
  protected readonly player = inject(PlayerService);
  protected readonly open = signal(false);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('alphaTab');
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  constructor() {
    afterNextRender(() => {
      void this.player.attach(this.host().nativeElement, this.scroller().nativeElement);
    });
  }
}
