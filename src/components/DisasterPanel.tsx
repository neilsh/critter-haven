import { Activity, CloudHail, Play, RotateCcw, Waves, Wind } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUIState } from '../state/store';
import { DISASTER_ORDER, DISASTER_SECONDS, type DisasterType } from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { Chip } from './Chip';

const DISASTERS: Record<DisasterType, { label: string; icon: ReactNode }> = {
  earthquake: { label: 'Quake', icon: <Activity size={22} /> },
  hurricane: { label: 'Wind', icon: <Wind size={22} /> },
  flood: { label: 'Flood', icon: <Waves size={22} /> },
  hail: { label: 'Hail', icon: <CloudHail size={22} /> },
};

/** Disaster picker, the Test/Rewind button and the countdown. */
export function DisasterPanel({ actions }: { actions: GameActions }) {
  const s = useUIState();
  const building = s.mode === 'build';
  const seconds = s.mode === 'simulating' ? Math.max(0, Math.ceil(s.timeRemaining)) : DISASTER_SECONDS;

  return (
    <section
      aria-label="Disasters"
      className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-2 rounded-3xl bg-white/85 p-2.5 shadow-xl backdrop-blur"
    >
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Pick a disaster">
        {DISASTER_ORDER.map((d) => (
          <Chip
            key={d}
            testId={`disaster-${d}`}
            label={DISASTERS[d].label}
            icon={DISASTERS[d].icon}
            active={s.disaster === d}
            disabled={!building}
            onClick={() => actions.setDisaster(d)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span
          data-testid="countdown"
          role="timer"
          aria-live="polite"
          aria-label={`${seconds} seconds`}
          className="flex h-14 min-w-14 items-center justify-center rounded-full bg-sky-600 px-3 text-2xl font-black tabular-nums text-white shadow-md"
        >
          {seconds}
        </span>
        <Chip
          testId="test-disaster"
          label={building ? 'Test it!' : 'Rewind'}
          icon={building ? <Play size={22} fill="currentColor" /> : <RotateCcw size={22} />}
          variant={building ? 'go' : 'rewind'}
          onClick={() => actions.toggleDisaster()}
        />
      </div>
    </section>
  );
}
