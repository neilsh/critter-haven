import { Star } from 'lucide-react';
import { useUIState } from '../state/store';
import type { Stars } from '../types/blueprint';
import { StandingSparkline } from './StandingSparkline';

const COPY: Record<Stars, { title: string; hint: string }> = {
  0: { title: 'Good try!', hint: 'Rewind and see what you can make stronger.' },
  1: { title: 'Nice start!', hint: 'Some of it held. Can you keep even more standing?' },
  2: { title: 'Great job!', hint: 'Most of your building made it. So close to three!' },
  3: { title: 'Amazing!', hint: 'Your whole building stood strong!' },
};

/** Centred result banner with 0-3 stars. Never blocks the 3D view. */
export function Banners() {
  const s = useUIState();
  if (s.mode !== 'survived' && s.mode !== 'failed') return null;

  const copy = COPY[s.stars];
  const hint = s.stars < 3 && s.firstBrokenId ? 'Look for the glowing piece that gave way first.' : copy.hint;
  const percent = Math.round(s.standingRatio * 100);

  return (
    <div
      data-testid="result-banner"
      role="status"
      className="pointer-events-none flex flex-col items-center gap-2 rounded-3xl bg-white/95 px-6 py-4 text-center text-sky-950 shadow-2xl"
    >
      <div data-testid="star-row" aria-label={`${s.stars} out of 3 stars`} className="flex gap-1">
        {([1, 2, 3] as const).map((n) => (
          <Star
            key={n}
            data-testid={n <= s.stars ? 'star-earned' : 'star-empty'}
            size={44}
            aria-hidden
            className={n <= s.stars ? 'fill-amber-300 text-amber-400' : 'fill-sky-100 text-sky-200'}
          />
        ))}
      </div>
      <span
        data-testid={s.mode === 'survived' ? 'win-banner' : 'lose-banner'}
        className="text-2xl font-black"
      >
        {copy.title}
      </span>
      <span className="text-sm font-bold">{hint}</span>
      <span data-testid="standing-percent" className="text-xs font-extrabold text-sky-700">
        {percent}% of your building was still standing
      </span>
      <StandingSparkline values={s.standingHistory} />
    </div>
  );
}
