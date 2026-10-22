/** Where a flasher reports what it is doing; the console panel implements it. */
export interface FlashReporter {
  log(line: string): void;
  /** 0–100 over the whole operation. */
  progress(percent: number): void;
}
