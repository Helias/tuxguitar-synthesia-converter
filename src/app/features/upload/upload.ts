import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SongStore } from '../../state/song-store';

const EXAMPLE = { url: 'examples/Fur-Elise.mid', name: 'Fur-Elise.mid' };

const ACCEPT = '.tg,.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.mxl,.xml,.capx,.tex,.alphatex,.mid,.midi';

@Component({
  selector: 'app-upload',
  templateUrl: './upload.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-1 items-center justify-center p-4 sm:p-8' },
})
export class Upload {
  protected readonly store = inject(SongStore);
  protected readonly dragging = signal(false);
  protected readonly accept = ACCEPT;

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) void this.store.open(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected async openExample(): Promise<void> {
    let blob: Blob;
    try {
      const response = await fetch(new URL(EXAMPLE.url, document.baseURI));
      if (!response.ok) throw new Error(response.statusText);
      blob = await response.blob();
    } catch {
      this.store.error.set('The example could not be downloaded.');
      return;
    }
    await this.store.open(new File([blob], EXAMPLE.name));
  }

  protected onPick(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.store.open(file);
  }
}
