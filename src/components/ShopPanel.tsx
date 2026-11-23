import { Check, Lock, ShoppingBag, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useUIState } from '../state/store';
import { MATERIALS, UNLOCKABLE_MATERIALS, type BuiltinMaterialType } from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { Swatch } from './Chip';

function ShopModal({ actions, onClose }: { actions: GameActions; onClose: () => void }) {
  const ui = useUIState();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    actions.setModalOpen(true);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      actions.setModalOpen(false);
    };
  }, [actions, onClose]);

  return (
    <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-sky-950/40 p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tech shop"
        data-testid="shop-modal"
        className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-3xl bg-sky-50 p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black">Tech Shop</h2>
            <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950 shadow-sm">
              {ui.points} pts
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            data-testid="shop-close"
            aria-label="Close"
            onClick={onClose}
            className="flex size-12 items-center justify-center rounded-2xl bg-white shadow-md active:scale-95"
          >
            <X size={22} />
          </button>
        </div>

        <p className="text-sm font-bold text-sky-900">
          Win challenge levels to earn stars and points, then unlock new gear for your village!
        </p>

        <ul className="grid gap-2.5 sm:grid-cols-2">
          {UNLOCKABLE_MATERIALS.map((m: BuiltinMaterialType) => {
            const def = MATERIALS[m];
            const cost = def.cost ?? 0;
            const owned = ui.unlockedMaterials.includes(m);
            const affordable = ui.points >= cost;
            return (
              <li
                key={m}
                className={`flex flex-col justify-between gap-3 rounded-2xl p-3.5 shadow-md ${
                  owned ? 'bg-emerald-50 ring-2 ring-emerald-300' : 'bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Swatch color={def.color} />
                    <div>
                      <div className="text-base font-black">{def.label}</div>
                      <div className="text-xs font-extrabold text-sky-700">{cost} pts</div>
                    </div>
                  </div>
                  {owned ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-200 px-2.5 py-1 text-xs font-black text-emerald-950">
                      <Check size={14} aria-hidden="true" />
                      Owned
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-black text-sky-900">
                      <Lock size={14} aria-hidden="true" />
                      Locked
                    </span>
                  )}
                </div>

                {def.description && <p className="text-sm font-semibold text-sky-950">{def.description}</p>}

                <button
                  type="button"
                  data-testid={`unlock-${m}`}
                  disabled={owned || !affordable}
                  onClick={() => actions.unlockMaterial(m)}
                  className={`flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-black shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                    owned
                      ? 'bg-emerald-200 text-emerald-950'
                      : affordable
                        ? 'bg-amber-300 text-amber-950 hover:bg-amber-200'
                        : 'bg-sky-100 text-sky-900'
                  }`}
                >
                  {owned ? (
                    <>
                      <Check size={16} aria-hidden="true" />
                      Unlocked
                    </>
                  ) : affordable ? (
                    <>
                      <Sparkles size={16} aria-hidden="true" />
                      Unlock ({cost} pts)
                    </>
                  ) : (
                    `Need ${cost} pts`
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Shop button with live point balance and modal for unlocking tech blocks. */
export function ShopPanel({ actions }: { actions: GameActions }) {
  const ui = useUIState();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="shop-open"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex min-h-12 items-center gap-1.5 rounded-2xl bg-white/90 px-3.5 text-sm font-extrabold shadow-md backdrop-blur active:scale-95"
      >
        <ShoppingBag size={20} aria-hidden="true" />
        <span>Shop</span>
        <span
          data-testid="points-balance"
          className="rounded-full bg-amber-300 px-2 py-0.5 text-xs font-black text-amber-950"
        >
          {ui.points} pts
        </span>
      </button>
      {open && <ShopModal actions={actions} onClose={() => setOpen(false)} />}
    </>
  );
}
