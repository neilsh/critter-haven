import { Frown, Trophy } from 'lucide-react';
import { useUIState } from '../state/store';

/** Centred result banners. Text only, so they never block the 3D view. */
export function Banners() {
  const s = useUIState();
  if (s.mode === 'survived') {
    return (
      <div
        data-testid="win-banner"
        role="status"
        className="pointer-events-none flex items-center gap-3 rounded-3xl bg-emerald-400 px-6 py-4 text-xl font-black text-emerald-950 shadow-2xl"
      >
        <Trophy size={32} aria-hidden />
        <span>Your building survived!</span>
      </div>
    );
  }
  if (s.mode === 'failed') {
    return (
      <div
        data-testid="lose-banner"
        role="status"
        className="pointer-events-none flex flex-col items-center gap-1 rounded-3xl bg-rose-300 px-6 py-4 text-center font-black text-rose-950 shadow-2xl"
      >
        <span className="flex items-center gap-3 text-xl">
          <Frown size={32} aria-hidden />
          Oh no, it fell down!
        </span>
        <span className="text-sm font-bold">
          {s.firstBrokenId ? 'Look for the glowing piece that snapped first.' : 'Rewind and try a stronger design.'}
        </span>
      </div>
    );
  }
  return null;
}
