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
import { Heart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLevelInfo } from '../levels/levelStore';
import { useUIState } from '../state/store';
import type { GameActions } from '../types/ui';
import { Banners } from './Banners';
import { BuildPanel } from './BuildPanel';
import { CameraPanel } from './CameraPanel';
import { DisasterPanel } from './DisasterPanel';
import { LevelPanel } from './LevelPanel';
import { ModsPanel } from './ModsPanel';
import { ShopPanel } from './ShopPanel';

export function HUD({ actions }: { actions: GameActions }) {
  const s = useUIState();
  const info = useLevelInfo();
  const [clearedFlash, setClearedFlash] = useState(0);
  const flashing = s.damageFlash > clearedFlash;

  useEffect(() => {
    if (s.damageFlash <= clearedFlash) return;
    const id = window.setTimeout(() => setClearedFlash(s.damageFlash), 260);
    return () => window.clearTimeout(id);
  }, [s.damageFlash, clearedFlash]);

  const hpPct = Math.max(0, Math.min(100, (s.playerHp / s.playerMaxHp) * 100));
  const hpColor = hpPct > 60 ? 'bg-emerald-500' : hpPct > 30 ? 'bg-amber-400' : 'bg-rose-500';

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans text-sky-950">
      {s.firstPerson && flashing && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-10 bg-rose-600/35 ring-8 ring-inset ring-rose-500/60"
        />
      )}

      <div className="absolute left-2 top-2">
        <BuildPanel actions={actions} />
      </div>

      <div className="absolute inset-x-2 top-2 flex justify-center">
        <LevelPanel
          actions={actions}
          extra={
            <>
              <ShopPanel actions={actions} />
              <ModsPanel actions={actions} />
            </>
          }
        />
      </div>

      <div className="absolute right-2 top-2 sm:top-24">
        <CameraPanel actions={actions} />
      </div>

      {/* The result banner and FP HP bar stack just above the disaster bar so they never hide the building. */}
      <div className="absolute inset-x-2 bottom-2 flex flex-col items-center gap-2">
        {s.levelId === null && info.notice && (
          <p
            role="status"
            data-testid="freebuild-notice"
            className="rounded-2xl bg-orange-100/95 px-4 py-1.5 text-sm font-extrabold text-orange-950 shadow-lg"
          >
            {info.notice}
          </p>
        )}
        <Banners />
        {s.firstPerson && (
          <div
            data-testid="player-hp"
            className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/90 px-3.5 py-2 text-xs font-extrabold shadow-lg backdrop-blur"
          >
            <span className="flex items-center gap-1.5 text-sm font-black">
              <Heart size={18} aria-hidden="true" className="fill-rose-500 text-rose-500" />
              HP {Math.ceil(s.playerHp)} / {s.playerMaxHp}
            </span>
            <div className="h-3 w-36 overflow-hidden rounded-full bg-sky-100 shadow-inner">
              <div
                className={`h-full transition-all duration-150 ${hpColor}`}
                style={{ width: `${hpPct}%` }}
              />
            </div>
            <span className="text-sky-700">WASD move · Space jump · Drag to look</span>
          </div>
        )}
        <DisasterPanel actions={actions} />
      </div>
    </div>
  );
}
