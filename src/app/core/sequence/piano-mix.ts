import type * as AlphaTab from '@coderline/alphatab';

/**
 * Makes `channels` play as a piano: every program change becomes Acoustic Grand Piano and all
 * pitch bends are dropped. Guitar slides, bends, vibrato and whammy reach the MIDI as pitch bends,
 * which on a piano sample sound like a detuned glide instead of the next note.
 *
 * Takes the alphaTab module as a parameter so lazily loaded callers can use it.
 */
export function applyPianoMix(
  at: typeof AlphaTab,
  midi: AlphaTab.midi.MidiFile,
  channels: ReadonlySet<number>,
): void {
  if (channels.size === 0) return;
  const isBend = (e: AlphaTab.midi.MidiEvent) =>
    (e instanceof at.midi.PitchBendEvent || e instanceof at.midi.NoteBendEvent) &&
    channels.has(e.channel);
  for (const track of midi.tracks) {
    for (const e of track.events) {
      if (e instanceof at.midi.ProgramChangeEvent && channels.has(e.channel)) e.program = 0;
    }
    const kept = track.events.filter((e) => !isBend(e));
    if (kept.length !== track.events.length) track.events.splice(0, track.events.length, ...kept);
  }
}
