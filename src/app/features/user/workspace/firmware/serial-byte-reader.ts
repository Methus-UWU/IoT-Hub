/**
 * Byte-at-a-time reads with a deadline over a Web Serial stream.
 *
 * A stream read cannot be cancelled without giving up the reader, so a read that
 * outlives a timeout is kept and its bytes are used by the next call instead of
 * being lost.
 */
export class SerialTimeoutError extends Error {}

export class SerialByteReader {
  private buffer: number[] = [];
  private pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async read(count: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    while (this.buffer.length < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new SerialTimeoutError('The board stopped responding.');

      this.pending ??= this.reader.read();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        this.pending,
        new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), remaining))),
      ]);
      clearTimeout(timer);
      if (result === null) continue;

      this.pending = null;
      if (result.done) throw new SerialTimeoutError('The serial port closed.');
      for (const byte of result.value) this.buffer.push(byte);
    }
    return Uint8Array.from(this.buffer.splice(0, count));
  }

  /** Forgets bytes already received, e.g. bootloader noise after a reset. */
  discardBuffered(): void {
    this.buffer = [];
  }

  /** Releases the stream so the port can be closed. */
  async release(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
    this.reader.releaseLock();
  }
}
