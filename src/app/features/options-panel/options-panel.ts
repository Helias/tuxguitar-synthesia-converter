import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NoteNaming, VideoPreset } from '../../core/scene/options';
import { SongStore } from '../../state/song-store';

@Component({
  selector: 'app-options-panel',
  templateUrl: './options-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionsPanel {
  protected readonly store = inject(SongStore);

  protected setNumber(key: 'fallSpeed' | 'leadIn', value: string): void {
    this.store.updateOptions({ [key]: Number(value) });
  }

  protected setFlag(
    key: 'countIn' | 'fullKeyboard' | 'keepOriginalInstrument',
    value: boolean,
  ): void {
    this.store.updateOptions({ [key]: value });
  }

  protected setColor(key: 'rightColor' | 'leftColor', value: string): void {
    this.store.updateOptions({ [key]: value });
  }

  protected setNoteNames(value: string): void {
    this.store.updateOptions({ noteNames: value as NoteNaming });
  }

  protected setPreset(value: string): void {
    this.store.updateOptions({ preset: value as VideoPreset });
  }

  protected async pickSoundFont(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.store.soundFont.set({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
}
