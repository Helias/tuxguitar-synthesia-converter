import * as alphaTab from '@coderline/alphatab';
import { NoteEvent, TempoEvent, TimeSignatureEvent } from '../../sequence/note-event';
import { LoadedSong, PlayedBar, SongTrack, summarizeTracks } from '../../song';
import { FileFormatError } from '../errors';
import { Smf, SmfEvent, parseSmf } from './smf';

const PERCUSSION_CHANNEL = 9;

/** A MIDI track split by channel: each (track, channel) pair with notes becomes one song track. */
interface LogicalTrack {
  name: string;
  sourceChannel: number;
  /** Channel used in the generated MidiFile, unique per logical track when possible. */
  outChannel: number;
  program: number;
  events: SmfEvent[];
}

export function loadMidiSong(bytes: Uint8Array, fileName: string): LoadedSong {
  const smf = parseSmf(bytes);
  const logical = splitTracks(smf);
  if (logical.length === 0) {
    throw new FileFormatError('The MIDI file contains no notes.');
  }
  const globals = smf.tracks.flatMap((t) => t.events);
  const tempos: TempoEvent[] = globals
    .filter((e) => e.type === 'tempo')
    .map((e) => ({ tick: e.tick, bpm: 60_000_000 / e.usPerQuarter }))
    .sort((a, b) => a.tick - b.tick);
  if (tempos.length === 0 || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: 120 });
  const timeSignatures: TimeSignatureEvent[] = globals
    .filter((e) => e.type === 'timeSignature')
    .map((e) => ({ tick: e.tick, numerator: e.numerator, denominator: e.denominator }))
    .sort((a, b) => a.tick - b.tick);
  const markers = globals
    .filter((e) => e.type === 'marker')
    .map((e) => ({ tick: e.tick, text: e.text }))
    .sort((a, b) => a.tick - b.tick);

  const notes = pairNotes(logical);
  const endTick = notes.reduce((max, n) => Math.max(max, n.endTick), 0);
  const tracks: SongTrack[] = summarizeTracks(
    logical.map((t, index) => ({
      index,
      name: t.name,
      program: t.program,
      isPercussion: t.sourceChannel === PERCUSSION_CHANNEL,
      channels: [t.outChannel],
      mutedInFile: false,
    })),
    notes,
  );

  const firstTrackName = smf.tracks[0]?.events.find((e) => e.type === 'trackName');
  const title =
    smf.format === 1 && firstTrackName?.type === 'trackName' && firstTrackName.text
      ? firstTrackName.text
      : fileName.replace(/\.[^.]+$/, '');

  return {
    format: { id: 'midi', label: `Standard MIDI (format ${smf.format})` },
    title,
    artist: '',
    score: null,
    tracks,
    notes,
    tempos,
    timeSignatures,
    bars: computeBars(timeSignatures, markers, endTick),
    chords: [],
    endTick,
    buildMidi: (pianoTracks) => buildMidiFile(logical, tempos, timeSignatures, pianoTracks),
  };
}

function splitTracks(smf: Smf): LogicalTrack[] {
  // Format 0 keeps everything in one track; splitting by channel handles both formats.
  const logical: LogicalTrack[] = [];
  smf.tracks.forEach((track, trackIndex) => {
    const channels = [
      ...new Set(track.events.filter((e) => e.type === 'noteOn').map((e) => channelOf(e))),
    ].sort((a, b) => a - b);
    const trackName = track.events.find((e) => e.type === 'trackName');
    const baseName =
      trackName?.type === 'trackName' && trackName.text
        ? trackName.text
        : `Track ${trackIndex + 1}`;
    for (const channel of channels) {
      const events = track.events.filter((e) => !('channel' in e) || e.channel === channel);
      const program = events.find((e) => e.type === 'program');
      logical.push({
        name: channels.length > 1 ? `${baseName} (ch. ${channel + 1})` : baseName,
        sourceChannel: channel,
        outChannel: channel,
        program: program?.type === 'program' ? program.program : 0,
        events: events.filter((e) => 'channel' in e),
      });
    }
  });
  assignOutputChannels(logical);
  return logical;
}

/** Gives every melodic logical track its own channel so per-track volume works. */
function assignOutputChannels(tracks: LogicalTrack[]): void {
  const free = Array.from({ length: 16 }, (_, c) => c).filter((c) => c !== PERCUSSION_CHANNEL);
  const used = new Set<number>();
  for (const t of tracks) {
    if (t.sourceChannel === PERCUSSION_CHANNEL) continue;
    if (!used.has(t.sourceChannel)) {
      used.add(t.sourceChannel);
      continue;
    }
    const next = free.find((c) => !used.has(c));
    if (next !== undefined) {
      t.outChannel = next;
      used.add(next);
    }
  }
}

function channelOf(e: SmfEvent): number {
  return 'channel' in e ? e.channel : -1;
}

function pairNotes(tracks: LogicalTrack[]): NoteEvent[] {
  const notes: NoteEvent[] = [];
  tracks.forEach((t, trackIndex) => {
    const open = new Map<number, { tick: number; velocity: number }[]>();
    for (const e of t.events) {
      if (e.type === 'noteOn') {
        const stack = open.get(e.key) ?? [];
        stack.push({ tick: e.tick, velocity: e.velocity });
        open.set(e.key, stack);
      } else if (e.type === 'noteOff') {
        const start = open.get(e.key)?.shift();
        if (start) {
          notes.push({
            trackIndex,
            startTick: start.tick,
            endTick: Math.max(e.tick, start.tick + 1),
            key: e.key,
            velocity: start.velocity,
            channel: t.outChannel,
          });
        }
      }
    }
  });
  return notes.sort((a, b) => a.startTick - b.startTick || a.key - b.key);
}

function computeBars(
  timeSignatures: TimeSignatureEvent[],
  markers: { tick: number; text: string }[],
  endTick: number,
): PlayedBar[] {
  const bars: PlayedBar[] = [];
  let tick = 0;
  let ts = { numerator: 4, denominator: 4 };
  let tsIndex = 0;
  let markerIndex = 0;
  while (tick < endTick || bars.length === 0) {
    while (tsIndex < timeSignatures.length && timeSignatures[tsIndex].tick <= tick) {
      ts = timeSignatures[tsIndex++];
    }
    const length = Math.max(1, Math.round((ts.numerator * 960 * 4) / ts.denominator));
    let section: string | null = null;
    while (markerIndex < markers.length && markers[markerIndex].tick < tick + length) {
      section ??= markers[markerIndex].text || null;
      markerIndex++;
    }
    bars.push({ number: bars.length + 1, startTick: tick, endTick: tick + length, section });
    tick += length;
  }
  return bars;
}

function buildMidiFile(
  tracks: LogicalTrack[],
  tempos: TempoEvent[],
  timeSignatures: TimeSignatureEvent[],
  pianoTracks: ReadonlySet<number>,
): alphaTab.midi.MidiFile {
  const m = alphaTab.midi;
  // Order within a tick: meta, then controllers/programs, note-offs, note-ons.
  const events: { order: number; event: alphaTab.midi.MidiEvent }[] = [];
  for (const t of tempos) {
    events.push({
      order: 0,
      event: new m.TempoChangeEvent(t.tick, Math.round(60_000_000 / t.bpm)),
    });
  }
  for (const ts of timeSignatures) {
    const denominatorIndex = Math.round(Math.log2(ts.denominator));
    events.push({
      order: 0,
      event: new m.TimeSignatureEvent(0, ts.tick, ts.numerator, denominatorIndex, 24, 8),
    });
  }
  tracks.forEach((t, index) => {
    const piano = pianoTracks.has(index) && t.sourceChannel !== PERCUSSION_CHANNEL;
    const ch = t.outChannel;
    events.push({ order: 1, event: new m.ProgramChangeEvent(0, 0, ch, piano ? 0 : t.program) });
    for (const e of t.events) {
      switch (e.type) {
        case 'program':
          events.push({
            order: 1,
            event: new m.ProgramChangeEvent(0, e.tick, ch, piano ? 0 : e.program),
          });
          break;
        case 'control':
          events.push({
            order: 1,
            event: new m.ControlChangeEvent(
              0,
              e.tick,
              ch,
              e.controller as alphaTab.midi.ControllerType,
              e.value,
            ),
          });
          break;
        case 'pitchBend':
          // A piano can't bend; see applyPianoMix.
          if (piano) break;
          events.push({ order: 1, event: new m.PitchBendEvent(0, e.tick, ch, e.value) });
          break;
        case 'noteOff':
          events.push({ order: 2, event: new m.NoteOffEvent(0, e.tick, ch, e.key, 0) });
          break;
        case 'noteOn':
          events.push({ order: 3, event: new m.NoteOnEvent(0, e.tick, ch, e.key, e.velocity) });
          break;
      }
    }
  });
  events.sort((a, b) => a.event.tick - b.event.tick || a.order - b.order);
  const file = new m.MidiFile();
  for (const { event } of events) file.addEvent(event);
  const end = events.length ? events[events.length - 1].event.tick : 0;
  file.addEvent(new m.EndOfTrackEvent(0, end));
  return file;
}
