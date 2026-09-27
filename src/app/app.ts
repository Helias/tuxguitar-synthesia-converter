import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { ExportPanel } from './features/export-panel/export-panel';
import { NotationPanel } from './features/notation-panel/notation-panel';
import { OptionsPanel } from './features/options-panel/options-panel';
import { PreviewPlayer } from './features/preview-player/preview-player';
import { TrackTable } from './features/track-table/track-table';
import { Upload } from './features/upload/upload';
import { ResizeHandle } from './shared/resize-handle';
import { LayoutService } from './state/layout.service';
import { SongStore } from './state/song-store';

@Component({
  selector: 'app-root',
  imports: [
    ExportPanel,
    NotationPanel,
    OptionsPanel,
    PreviewPlayer,
    ResizeHandle,
    TrackTable,
    Upload,
  ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-full flex-col' },
})
export class App {
  protected readonly store = inject(SongStore);
  protected readonly layout = inject(LayoutService);
  private readonly player = viewChild.required('player', { read: ElementRef<HTMLElement> });
  protected readonly playerHeight = () =>
    this.player().nativeElement.getBoundingClientRect().height;

  protected openAnother(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.store.open(file);
  }
}
