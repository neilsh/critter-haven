import {
  Activity,
  CloudHail,
  Flag,
  Flame,
  Lock,
  Map as MapIcon,
  Orbit,
  Snowflake,
  Star,
  Swords,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useLevelInfo } from '../levels/levelStore';
import { LEVELS, getLevel, type Level } from '../levels/levels';
import { useUIState } from '../state/store';
import { getMaterialDef, type BuiltinDisasterType } from '../types/blueprint';
import type { GameActions } from '../types/ui';

const DISASTER_LABEL: Record<BuiltinDisasterType, { label: string; icon: ReactNode }> = {
  earthquake: { label: 'Earthquake', icon: <Activity size={16} /> },
  hurricane: { label: 'Hurricane', icon: <Wind size={16} /> },
  flood: { label: 'Flood', icon: <Waves size={16} /> },
  hail: { label: 'Hail', icon: <CloudHail size={16} /> },
  fire_tornado: { label: 'Fire Tornado', icon: <Flame size={16} /> },
  snow_storm: { label: 'Snow Storm', icon: <Snowflake size={16} /> },
  raid: { label: 'Raids', icon: <Swords size={16} /> },
  meteor: { label: 'Meteor Shower', icon: <Orbit size={16} /> },
};

function StarRow({ earned, total = 3, size = 16 }: { earned: number; total?: number; size?: number }) {
  return (
    <span className="inline-flex" role="img" aria-label={`${earned} of ${total} stars`}>
      {Array.from({ length: total }, (_, i) => (
        <Star
          key={i}
          size={size}
          aria-hidden="true"
          className={i < earned ? 'fill-amber-400 text-amber-500' : 'text-sky-300'}
        />
      ))}
    </span>
  );
}

/** What the level asks for, in one short line per limit. Pure, so it is easy to test. */
export function goalLines(level: Level): string[] {
  const lines = [`Get ${level.goalStars} ${level.goalStars === 1 ? 'star' : 'stars'}`];
  const c = level.constraints;
  if (c?.maxBlocks !== undefined) lines.push(`Use up to ${c.maxBlocks} blocks`);
  if (c?.materials) lines.push(`Only ${c.materials.map((m) => getMaterialDef(m).label).join(' and ')}`);
  if (level.minHeight) lines.push(`Build ${level.minHeight} blocks tall`);
  return lines;
}

function LevelSelect({ actions, onClose }: { actions: GameActions; onClose: () => void }) {
  const ui = useUIState();
  const { best } = useLevelInfo();
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

  const pick = (id: string | null) => {
    actions.selectLevel(id);
    onClose();
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-sky-950/40 p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Challenge levels"
        data-testid="level-select"
        className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-3xl bg-sky-50 p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-black">Pick a challenge</h2>
          <button
            ref={closeRef}
            type="button"
            data-testid="level-close"
            aria-label="Close"
            onClick={onClose}
            className="flex size-12 items-center justify-center rounded-2xl bg-white shadow-md active:scale-95"
          >
            <X size={22} />
          </button>
        </div>

        <button
          type="button"
          data-testid="level-free-build"
          onClick={() => pick(null)}
          className={`rounded-2xl px-4 py-3 text-left font-extrabold shadow-md active:scale-95 ${
            ui.levelId === null ? 'bg-amber-300 text-amber-950' : 'bg-white'
          }`}
        >
          Free build <span className="font-semibold">Build anything, test any disaster.</span>
        </button>

        <ol className="grid gap-2 sm:grid-cols-2">
          {LEVELS.map((level, i) => {
            const unlocked = ui.unlocked.includes(level.id);
            const stars = best[level.id] ?? 0;
            return (
              <li key={level.id}>
                <button
                  type="button"
                  data-testid={`level-${level.id}`}
                  disabled={!unlocked}
                  aria-current={ui.levelId === level.id}
                  onClick={() => pick(level.id)}
                  className={`flex min-h-24 w-full flex-col gap-1 rounded-2xl p-3 text-left shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                    ui.levelId === level.id ? 'bg-amber-300 text-amber-950' : 'bg-white'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 font-black">
                    <span>
                      {i + 1}. {level.title}
                    </span>
                    {unlocked ? <StarRow earned={stars} /> : <Lock size={18} aria-label="Locked" />}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-sky-800">
                    {DISASTER_LABEL[level.disaster].icon}
                    {DISASTER_LABEL[level.disaster].label}, {level.strength}
                  </span>
                  <span className="text-sm font-semibold">{level.blurb}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function GoalCard({ level, actions }: { level: Level; actions: GameActions }) {
  const ui = useUIState();
  const info = useLevelInfo();
  const max = level.constraints?.maxBlocks;
  const finished = ui.mode === 'survived' || ui.mode === 'failed';
  const reached = finished && ui.stars >= level.goalStars;
  const next = info.justUnlocked ? getLevel(info.justUnlocked) : undefined;
  const full = max !== undefined && info.blocksUsed >= max;

  return (
    <section
      aria-label="Level goal"
      data-testid="goal-card"
      className="pointer-events-auto flex w-full max-w-xs flex-col gap-1.5 rounded-3xl bg-white/90 p-3 text-sm shadow-xl backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-black">
          <Flag size={16} aria-hidden="true" />
          {level.title}
        </h2>
        <button
          type="button"
          data-testid="level-exit"
          aria-label="Leave level"
          title="Leave level"
          onClick={() => actions.selectLevel(null)}
          className="flex size-8 items-center justify-center rounded-xl bg-sky-100 active:scale-95"
        >
          <X size={16} />
        </button>
      </div>
      <p className="font-semibold">{level.blurb}</p>
      <ul className="flex flex-col gap-0.5 font-bold text-sky-900">
        {goalLines(level).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {max !== undefined && (
        <p data-testid="block-count" className={`font-extrabold ${full ? 'text-orange-600' : ''}`}>
          Blocks: {info.blocksUsed} / {max}
          {full ? ' (full!)' : ''}
        </p>
      )}
      {info.notice && (
        <p role="status" data-testid="level-notice" className="rounded-xl bg-orange-100 px-2 py-1 font-bold">
          {info.notice}
        </p>
      )}
      {finished && (
        <p role="status" data-testid="level-result" className="flex flex-col gap-1 font-extrabold">
          <span className="flex items-center gap-1">
            <StarRow earned={ui.stars} />
            {reached ? 'Level complete!' : `Need ${level.goalStars} to move on. Rewind and try again!`}
          </span>
          {reached && next && (
            <button
              type="button"
              data-testid="level-next"
              onClick={() => actions.selectLevel(next.id)}
              className="rounded-2xl bg-emerald-400 px-3 py-2 text-emerald-950 shadow-md active:scale-95"
            >
              Next: {next.title}
            </button>
          )}
        </p>
      )}
    </section>
  );
}

/** Level-select button and, during a challenge, the goal card. */
export function LevelPanel({ actions, extra }: { actions: GameActions; extra?: ReactNode }) {
  const ui = useUIState();
  const [open, setOpen] = useState(false);
  const level = ui.levelId ? getLevel(ui.levelId) : undefined;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="level-toggle"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex min-h-12 items-center gap-1.5 rounded-2xl bg-white/90 px-4 text-sm font-extrabold shadow-md backdrop-blur active:scale-95"
        >
          <MapIcon size={20} aria-hidden="true" />
          {level ? 'Levels' : 'Challenges'}
        </button>
        {extra}
      </div>
      {level && <GoalCard level={level} actions={actions} />}
      {open && <LevelSelect actions={actions} onClose={() => setOpen(false)} />}
    </div>
  );
}
