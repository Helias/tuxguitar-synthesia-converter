import { FileFormatError } from '../errors';

/** Big-endian reader with java.io.DataInputStream semantics. */
export class DataInput {
  private readonly view: DataView;
  pos = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new FileFormatError('The file is truncated.');
    }
  }

  /** Unsigned byte, like InputStream.read(). */
  read(): number {
    this.need(1);
    return this.bytes[this.pos++];
  }

  /** Signed byte, like `(byte) in.read()`. */
  readByte(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }

  readBoolean(): boolean {
    return this.read() !== 0;
  }

  readShort(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos);
    this.pos += 2;
    return v;
  }

  readInt(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }

  readChars(length: number): string {
    this.need(length * 2);
    let s = '';
    for (let i = 0; i < length; i++) {
      s += String.fromCharCode(this.view.getUint16(this.pos));
      this.pos += 2;
    }
    return s;
  }

  /** 1 length byte + UTF-16BE chars (readUnsignedByteString). */
  readUnsignedByteString(): string {
    return this.readChars(this.read());
  }

  /** 4-byte length + UTF-16BE chars (readIntegerString). */
  readIntegerString(): string {
    const length = this.readInt();
    if (length < 0 || length * 2 > this.remaining) {
      throw new FileFormatError('The file is truncated.');
    }
    return this.readChars(length);
  }

  /** Multi-byte header as read by TGSongReaderImpl.readHeader(bCount). */
  readHeader(byteCount: number): number {
    let header = 0;
    for (let i = byteCount; i > 0; i--) {
      header += this.read() << (8 * i - 8);
    }
    return header;
  }
}

/** The leading header string of a binary TuxGuitar file (1 length byte + UTF-16BE), or null. */
export function readTgHeader(bytes: Uint8Array): string | null {
  if (bytes.length < 1) return null;
  const length = bytes[0];
  if (length === 0 || bytes.length < 1 + length * 2) return null;
  return new DataInput(bytes).readUnsignedByteString();
}

const TG_HEADER_PREFIX = 'TuxGuitar File Format - ';

/** The `x.y` of a `TuxGuitar File Format - x.y` header, or null. */
export function readTgVersion(bytes: Uint8Array): string | null {
  const header = readTgHeader(bytes);
  return header?.startsWith(TG_HEADER_PREFIX) ? header.slice(TG_HEADER_PREFIX.length) : null;
}
