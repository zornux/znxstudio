/** One modal overlay owns keyboard/focus at a time across the workbench. */
let active: { owner: object; dismiss: () => void } | null = null;

export function claimOverlay(owner: object, dismiss: () => void): () => void {
  if (active?.owner !== owner) active?.dismiss();
  active = { owner, dismiss };
  return () => {
    if (active?.owner === owner) active = null;
  };
}
