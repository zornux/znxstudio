const MAX_BUFFERED_INPUT = 64 * 1024;

/** Preserves keystrokes and paste entered while the main-process PTY starts. */
export class TerminalInputBuffer {
  private chunks: string[] = [];
  private length = 0;
  private ready = false;
  private closed = false;

  accept(data: string, send: (data: string) => void): void {
    if (this.closed || !data) return;
    if (this.ready) {
      send(data);
      return;
    }
    const remaining = MAX_BUFFERED_INPUT - this.length;
    if (remaining <= 0) return;
    const chunk = data.slice(0, remaining);
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  markReady(send: (data: string) => void): void {
    if (this.closed || this.ready) return;
    this.ready = true;
    const buffered = this.chunks.join('');
    this.chunks = [];
    this.length = 0;
    if (buffered) send(buffered);
  }

  close(): void {
    this.closed = true;
    this.chunks = [];
    this.length = 0;
  }
}
