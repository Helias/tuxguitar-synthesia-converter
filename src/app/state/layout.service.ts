import { Injectable, computed, signal } from '@angular/core';

/** Panel heights the user set by dragging; null keeps the automatic size. */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  /** Height of the whole preview player (video + transport), in px. */
  readonly videoHeight = signal<number | null>(null);
  /** Height of the open pentagram's scroll area, in px. */
  readonly notationHeight = signal<number | null>(null);
  /** Once the user sizes a panel, the page may grow past the viewport. */
  readonly userSized = computed(
    () => this.videoHeight() !== null || this.notationHeight() !== null,
  );
}
