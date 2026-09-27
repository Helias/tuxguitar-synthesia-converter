import { TgSong, measureLength } from './tg-model';

/**
 * Header indices in the order TuxGuitar plays them: a port of
 * app.tuxguitar.player.base.MidiRepeatController for a whole-song playback.
 *
 * TuxGuitar keeps jumping back while an alternative ending is pending, so a group whose endings
 * are spread over several closing bars re-enters its opening bar once more after the last ending
 * (the bars in that pass are skipped). alphaTab's repeat groups don't reproduce that.
 */
export function tgPlaybackOrder(song: TgSong): number[] {
  const headers = song.headers;
  const order: number[] = [];
  let index = 0;
  let lastIndex = -1;
  let repeatOpen = true;
  let repeatAlternative = 0;
  let repeatStartIndex = 0;
  let repeatNumber = 0;
  // Guards against malformed files that would loop forever.
  const limit = headers.length * 64;

  while (index < headers.length && order.length < limit) {
    const header = headers[index];
    if (header.number === 1) {
      repeatStartIndex = index;
      repeatOpen = true;
    }
    let shouldPlay = true;
    if (header.repeatOpen) {
      repeatStartIndex = index;
      repeatOpen = true;
      if (index > lastIndex) {
        repeatNumber = 0;
        repeatAlternative = 0;
      }
    } else {
      if (repeatAlternative === 0) {
        repeatAlternative = header.repeatAlternative;
      }
      if (repeatOpen && repeatAlternative > 0 && (repeatAlternative & (1 << repeatNumber)) === 0) {
        if (header.repeatClose > 0) {
          repeatAlternative = 0;
        }
        shouldPlay = false;
      }
    }
    if (shouldPlay) {
      order.push(index);
      lastIndex = Math.max(lastIndex, index);
      if (repeatOpen && header.repeatClose > 0) {
        if (repeatNumber < header.repeatClose || repeatAlternative > 0) {
          index = repeatStartIndex - 1;
          repeatNumber++;
        } else {
          repeatNumber = 0;
          repeatOpen = false;
        }
        repeatAlternative = 0;
      }
    }
    index++;
  }
  return order;
}

/** Total playback length in TG ticks for a play order. */
export function playbackLength(song: TgSong, order: number[]): number {
  return order.reduce((sum, i) => sum + measureLength(song.headers[i]), 0);
}
