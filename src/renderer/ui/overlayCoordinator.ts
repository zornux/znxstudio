/** One modal overlay owns keyboard/focus at a time across the workbench. */
let active: { owner: object; dismiss: () => void } | null = null;

export function claimOverlay(owner: object, dismiss: () => void): () => void {
  if (active?.owner !== owner) active?.dismiss();
  active = { owner, dismiss };
  return () => {
    if (active?.owner === owner) active = null;
  };
}

/** Test/lifecycle seam: dismiss any overlay still registered by a disposed shell. */
export function dismissActiveOverlay(): void {
  const current = active;
  active = null;
  current?.dismiss();
}
