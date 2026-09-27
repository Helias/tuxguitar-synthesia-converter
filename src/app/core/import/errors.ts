/** A file that was recognised but could not be read (truncated, corrupt, unsupported version). */
export class FileFormatError extends Error {
  override readonly name = 'FileFormatError';
}

/** A file whose format is not recognised at all. */
export class UnsupportedFormatError extends Error {
  override readonly name = 'UnsupportedFormatError';
}
