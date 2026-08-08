/** Scope renderer-provided terminal ids to their owning BrowserWindow. */
export function terminalSessionKey(ownerId: number, terminalId: string): string {
  return `${ownerId}:${terminalId}`;
}
