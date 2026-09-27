import { FileFormatError } from '../errors';

/** A channel or meta event from a Standard MIDI File, ticks rescaled to 960 PPQ. */
export type SmfEvent =
  | { type: 'noteOn'; tick: number; channel: number; key: number; velocity: number }
  | { type: 'noteOff'; tick: number; channel: number; key: number }
  | { type: 'program'; tick: number; channel: number; program: number }
  | { type: 'control'; tick: number; channel: number; controller: number; value: number }
  | { type: 'pitchBend'; tick: number; channel: number; value: number }
  | { type: 'tempo'; tick: number; usPerQuarter: number }
  | { type: 'timeSignature'; tick: number; numerator: number; denominator: number }
  | { type: 'marker'; tick: number; text: string }
  | { type: 'trackName'; tick: number; text: string };

export interface SmfTrack {
  events: SmfEvent[];
}

export interface Smf {
  format: number;
  /** Original ticks per quarter note (events are already rescaled to 960). */
  division: number;
  tracks: SmfTrack[];
}

export const SMF_PPQ = 960;

export function isSmf(bytes: Uint8Array): boolean {
  return bytes.length >= 14 && String.fromCharCode(...bytes.subarray(0, 4)) === 'MThd';
}

/** Parses a Standard MIDI File (format 0 or 1; format 2 tracks are read as format 1). */
export function parseSmf(bytes: Uint8Array): Smf {
  const r = new Reader(bytes);
  if (r.ascii(4) !== 'MThd') throw new FileFormatError('Not a MIDI file.');
  const headerLength = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.pos += headerLength - 6;
  if (division & 0x8000) {
    throw new FileFormatError('SMPTE-timed MIDI files are not supported.');
  }
  const scale = SMF_PPQ / division;

  const tracks: SmfTrack[] = [];
  for (let t = 0; t < trackCount && r.remaining > 8; t++) {
    const id = r.ascii(4);
    const length = r.u32();
    const end = Math.min(r.pos + length, bytes.length);
    if (id !== 'MTrk') {
      r.pos = end;
      continue;
    }
    tracks.push({ events: readTrack(r, end, scale) });
    r.pos = end;
  }
  if (tracks.length === 0) throw new FileFormatError('The MIDI file has no tracks.');
  return { format, division, tracks };
}

function readTrack(r: Reader, end: number, scale: number): SmfEvent[] {
  const events: SmfEvent[] = [];
  let tick = 0;
  let status = 0;
  while (r.pos < end) {
    tick += r.varInt();
    const at = Math.round(tick * scale);
    let byte = r.u8();
    if (byte < 0x80) {
      // Running status: reuse the previous status byte, this byte is data.
      if (status === 0) throw new FileFormatError('Corrupt MIDI track.');
      r.pos--;
      byte = status;
    }
    if (byte === 0xff) {
      const metaType = r.u8();
      const length = r.varInt();
      const data = r.bytes(length);
      if (metaType === 0x2f) break;
      const meta = readMeta(metaType, data, at);
      if (meta) events.push(meta);
      continue;
    }
    if (byte === 0xf0 || byte === 0xf7) {
      r.pos += r.varInt();
      continue;
    }
    status = byte;
    const channel = byte & 0x0f;
    switch (byte & 0xf0) {
      case 0x80:
        events.push({ type: 'noteOff', tick: at, channel, key: r.u8() });
        r.u8();
        break;
      case 0x90: {
        const key = r.u8();
        const velocity = r.u8();
        events.push(
          velocity === 0
            ? { type: 'noteOff', tick: at, channel, key }
            : { type: 'noteOn', tick: at, channel, key, velocity },
        );
        break;
      }
      case 0xa0:
        r.pos += 2;
        break;
      case 0xb0:
        events.push({ type: 'control', tick: at, channel, controller: r.u8(), value: r.u8() });
        break;
      case 0xc0:
        events.push({ type: 'program', tick: at, channel, program: r.u8() });
        break;
      case 0xd0:
        r.pos += 1;
        break;
      case 0xe0: {
        const lsb = r.u8();
        const msb = r.u8();
        events.push({ type: 'pitchBend', tick: at, channel, value: (msb << 7) | lsb });
        break;
      }
      default:
        throw new FileFormatError('Corrupt MIDI track.');
    }
  }
  return events;
}

function readMeta(type: number, data: Uint8Array, tick: number): SmfEvent | null {
  switch (type) {
    case 0x51:
      return data.length >= 3
        ? { type: 'tempo', tick, usPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] }
        : null;
    case 0x58:
      return data.length >= 2
        ? { type: 'timeSignature', tick, numerator: data[0], denominator: 2 ** data[1] }
        : null;
    case 0x03:
      return { type: 'trackName', tick, text: decodeText(data) };
    case 0x06:
      return { type: 'marker', tick, text: decodeText(data) };
    default:
      return null;
  }
}

/** MIDI text is nominally ASCII; UTF-8 is common, Latin-1 the usual fallback. */
function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).trim();
  } catch {
    return new TextDecoder('latin1').decode(data).trim();
  }
}

class Reader {
  pos = 0;

  constructor(private readonly data: Uint8Array) {}

  get remaining(): number {
    return this.data.length - this.pos;
  }

  u8(): number {
    if (this.pos >= this.data.length) throw new FileFormatError('The MIDI file is truncated.');
    return this.data[this.pos++];
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }

  varInt(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new FileFormatError('Corrupt MIDI variable-length value.');
  }

  ascii(n: number): string {
    return String.fromCharCode(...this.bytes(n));
  }

  bytes(n: number): Uint8Array {
    if (this.pos + n > this.data.length) throw new FileFormatError('The MIDI file is truncated.');
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}
