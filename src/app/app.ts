import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ExportPanel } from './features/export-panel/export-panel';
import { NotationPanel } from './features/notation-panel/notation-panel';
import { OptionsPanel } from './features/options-panel/options-panel';
import { PreviewPlayer } from './features/preview-player/preview-player';
import { TrackTable } from './features/track-table/track-table';
import { Upload } from './features/upload/upload';
import { SongStore } from './state/song-store';

@Component({
  selector: 'app-root',
  imports: [ExportPanel, NotationPanel, OptionsPanel, PreviewPlayer, TrackTable, Upload],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-full flex-col' },
})
export class App {
  protected readonly store = inject(SongStore);

  protected openAnother(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.store.open(file);
  }
}
