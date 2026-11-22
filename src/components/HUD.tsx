/**
 * OWNER: package E (Tailwind HUD). Contract: props below. Read state with `useUIState()`, call
 * `actions` for everything. Every interactive control needs a `data-testid`:
 * tool-block|brace|paint|erase, mirror-x, undo, clear-island, material-wood|stone|bamboo|foam,
 * disaster-earthquake|hurricane|flood|hail, preset-empty|house|tower, test-disaster (also Rewind),
 * countdown, win-banner, cam-front|right|back|left, mute-toggle.
 * Must not import three, Rapier or anything under src/engine.
 */
import type { GameActions } from '../types/ui';

export function HUD(_props: { actions: GameActions }) {
  return null;
}
