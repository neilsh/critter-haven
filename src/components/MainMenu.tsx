import { Hammer, Map as MapIcon, Play, ShieldAlert, ShoppingBag, Sparkles, Trophy } from 'lucide-react';
import { useUIState } from '../state/store';
import type { GameActions } from '../types/ui';

interface MainMenuProps {
  actions: GameActions;
  onOpenChallenges: () => void;
  onOpenShop: () => void;
}

/** Full-screen mode selection & pause menu over the live 3D island. */
export function MainMenu({ actions, onOpenChallenges, onOpenShop }: MainMenuProps) {
  const s = useUIState();
  if (!s.menuOpen) return null;

  return (
    <div
      data-testid="main-menu"
      aria-label="Main Menu"
      className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-sky-950/45 p-4 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-3xl flex-col gap-4 rounded-3xl bg-sky-50/95 p-6 text-sky-950 shadow-2xl ring-2 ring-white/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-sky-950">Disaster Village</h1>
            <p className="text-sm font-bold text-sky-800">
              Build your shelter, step inside in 1st person, and brave the storm!
            </p>
          </div>
          {s.hasStarted && (
            <button
              type="button"
              data-testid="menu-resume"
              onClick={() => actions.resumeGame()}
              className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-emerald-400 px-5 py-2.5 text-sm font-black text-emerald-950 shadow-md transition hover:bg-emerald-300 active:scale-95"
            >
              <Play size={18} fill="currentColor" aria-hidden="true" />
              Resume
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            data-testid="menu-creative"
            onClick={() => actions.startPlayMode('creative')}
            className={`group flex flex-col justify-between gap-3 rounded-3xl p-5 text-left shadow-lg transition hover:-translate-y-0.5 active:scale-[0.98] ${
              s.hasStarted && s.playMode === 'creative' && s.levelId === null
                ? 'bg-amber-200 ring-2 ring-amber-400'
                : 'bg-white hover:bg-amber-50'
            }`}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-300 text-amber-950 shadow-sm">
                  <Hammer size={24} aria-hidden="true" />
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-950">
                  <Sparkles size={13} aria-hidden="true" />
                  All Unlocked
                </span>
              </div>
              <h2 className="text-xl font-black">Creative Mode</h2>
              <p className="text-sm font-semibold text-sky-900">
                Build anything with every material, quick-builder, armor, and weapon unlocked. You are
                invincible during disasters, and Mods are ready to use!
              </p>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-2xl bg-amber-300 px-4 py-2 text-sm font-black text-amber-950 shadow-sm">
              Play Creative
            </span>
          </button>

          <button
            type="button"
            data-testid="menu-survival"
            onClick={() => actions.startPlayMode('survival')}
            className={`group flex flex-col justify-between gap-3 rounded-3xl p-5 text-left shadow-lg transition hover:-translate-y-0.5 active:scale-[0.98] ${
              s.hasStarted && s.playMode === 'survival'
                ? 'bg-rose-100 ring-2 ring-rose-400'
                : 'bg-white hover:bg-rose-50'
            }`}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-sm">
                  <ShieldAlert size={24} aria-hidden="true" />
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {s.survivalBestWave > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-black text-rose-900">
                      <Trophy size={13} aria-hidden="true" />
                      Best: Wave {s.survivalBestWave}
                    </span>
                  )}
                  <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-black text-amber-950">
                    {s.points} pts
                  </span>
                </div>
              </div>
              <h2 className="text-xl font-black">Survival Mode</h2>
              <p className="text-sm font-semibold text-sky-900">
                Survive escalating disaster waves with real HP and real Shop unlocks. Keep your shelter
                standing and earn bonus Shop points after every wave!
              </p>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-2xl bg-rose-500 px-4 py-2 text-sm font-black text-white shadow-sm">
              Play Survival
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sky-200 pt-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="menu-challenges"
              onClick={onOpenChallenges}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-black text-sky-950 shadow-sm transition hover:bg-sky-100 active:scale-95"
            >
              <MapIcon size={18} aria-hidden="true" />
              Challenges
            </button>
            <button
              type="button"
              data-testid="menu-shop"
              onClick={onOpenShop}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-black text-sky-950 shadow-sm transition hover:bg-sky-100 active:scale-95"
            >
              <ShoppingBag size={18} aria-hidden="true" />
              Tech Shop ({s.points} pts)
            </button>
          </div>
          <span className="text-xs font-extrabold text-sky-700">Press Esc anytime to open Menu</span>
        </div>
      </div>
    </div>
  );
}
