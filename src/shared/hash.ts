/**
 * Fast, dependency-free content hash for incremental caching. Two decorrelated
 * FNV-1a-style accumulators are combined into a 64-bit hex string — cheap enough
 * to run on every keystroke, wide enough that collisions are negligible for a
 * per-session compile cache. Not cryptographic; do not use for security.
 */
export function fastHash(input: string): string {
  let h1 = 0x811c9dc5; // FNV offset basis
  let h2 = 0x811c9dc5 ^ 0x9e3779b9; // decorrelated seed
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193); // FNV prime
    h2 = Math.imul(h2 ^ c, 0x85ebca6b); // distinct multiplier → independent stream
  }
  // Fold in the length so trivial prefixes/suffixes differ, then emit 64 bits.
  h1 = Math.imul(h1 ^ input.length, 0x01000193) >>> 0;
  h2 = Math.imul(h2 ^ input.length, 0x85ebca6b) >>> 0;
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
