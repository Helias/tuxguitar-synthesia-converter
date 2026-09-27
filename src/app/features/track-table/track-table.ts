import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Role, keyName } from '../../core/scene/options';
import { instrumentName } from '../../shared/general-midi';
import { SongStore } from '../../state/song-store';

const ROLES: { value: Role; label: string }[] = [
  { value: 'right', label: 'Right hand' },
  { value: 'left', label: 'Left hand' },
  { value: 'both', label: 'Both hands' },
  { value: 'backing', label: 'Backing' },
  { value: 'off', label: 'Off' },
];

@Component({
  selector: 'app-track-table',
  imports: [DecimalPipe],
  templateUrl: './track-table.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackTable {
  protected readonly store = inject(SongStore);
  protected readonly roles = ROLES;

  protected readonly rows = computed(() => {
    const song = this.store.song();
    const settings = this.store.tracks();
    const naming = this.store.options().noteNames;
    if (!song) return [];
    return song.tracks.map((t) => ({
      track: t,
      settings: settings[t.index],
      instrument: instrumentName(t.program, t.isPercussion),
      range:
        t.noteCount && !t.isPercussion
          ? `${keyName(t.minKey, naming)}–${keyName(t.maxKey, naming)}`
          : '',
      split: keyName(settings[t.index]?.splitKey ?? 60, naming),
    }));
  });

  protected setRole(index: number, value: string): void {
    this.store.setRole(index, value as Role);
  }

  protected setVolume(index: number, value: string): void {
    this.store.setVolume(index, Number(value) / 100);
  }

  protected moveSplit(index: number, delta: number): void {
    this.store.setSplitKey(index, (this.store.tracks()[index]?.splitKey ?? 60) + delta);
  }
}
