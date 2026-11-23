/**
 * OWNER: package E (Tailwind HUD). Contract: props below. Read state with `useUIState()`, call
 * `actions` for everything. Every interactive control needs a `data-testid`:
 * tool-block|brace|paint|erase, mirror-x, undo, clear-island, material-wood|stone|bamboo|foam,
 * disaster-earthquake|hurricane|flood|hail, preset-empty|house|tower, test-disaster (also Rewind),
 * countdown, strength-gentle|medium|strong, result-banner (title is win-banner/lose-banner), standing-percent, star-row, standing-sparkline, cam-front|right|back|left, mute-toggle.
 * Must not import three, Rapier or anything under src/engine.
 *
 * The HUD root ignores pointer events so the 3D view stays draggable everywhere except on the cards.
 */
import type { GameActions } from '../types/ui';
import { Banners } from './Banners';
import { BuildPanel } from './BuildPanel';
import { CameraPanel } from './CameraPanel';
import { DisasterPanel } from './DisasterPanel';
import { LevelPanel } from './LevelPanel';

export function HUD({ actions }: { actions: GameActions }) {
  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans text-sky-950">
      <div className="absolute left-2 top-2">
        <BuildPanel actions={actions} />
      </div>

      <div className="absolute inset-x-2 top-2 flex justify-center">
        <LevelPanel actions={actions} />
      </div>

      <div className="absolute right-2 top-2 sm:top-24">
        <CameraPanel actions={actions} />
      </div>

      {/* The result banner stacks just above the disaster bar so it never hides the building. */}
      <div className="absolute inset-x-2 bottom-2 flex flex-col items-center gap-2">
        <Banners />
        <DisasterPanel actions={actions} />
      </div>
    </div>
  );
}
