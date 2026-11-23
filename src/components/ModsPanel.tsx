import { Check, Download, Pencil, Plus, Puzzle, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { exportModJson, slugifyId, type GameMod, type ModBlockDef, type ModDisasterDef } from '../mods/mods';
import { useMods } from '../mods/modStore';
import { DISASTER_SECONDS } from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { Swatch } from './Chip';

const hexToInt = (hex: string) => Number.parseInt(hex.replace('#', ''), 16) || 0x38bdf8;
const intToHex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function patchAt<T extends object>(list: readonly T[], index: number, patch: Partial<T>): T[] {
  const out: T[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item) continue;
    out.push(i === index ? Object.assign({}, item, patch) : item);
  }
  return out;
}

function downloadModJson(mod: GameMod): void {
  const json = exportModJson(mod);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${mod.id.replace(/[^a-z0-9-]+/gi, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

interface BlockDraft {
  id: string;
  label: string;
  color: string;
  density: number;
  stiffness: number;
  maxStress: number;
  buoyancy: number;
  power: 'none' | 'anchor' | 'shield' | 'laser';
}

interface DisasterDraft {
  id: string;
  label: string;
  color: string;
  quake: number;
  wind: number;
  flood: boolean;
  projMode: 'none' | 'rain' | 'targeted';
  projRate: number;
  projSpeed: number;
  projRadius: number;
}

function toBlockDraft(b: ModBlockDef): BlockDraft {
  const power =
    b.special === 'shield'
      ? 'shield'
      : b.special === 'laser'
        ? 'laser'
        : b.anchorMultiplier && b.anchorMultiplier > 1
          ? 'anchor'
          : 'none';
  return {
    id: b.id,
    label: b.label,
    color: intToHex(b.color),
    density: b.density,
    stiffness: b.stiffness,
    maxStress: b.maxStress,
    buoyancy: b.buoyancy,
    power,
  };
}

function toDisasterDraft(d: ModDisasterDef): DisasterDraft {
  return {
    id: d.id,
    label: d.label,
    color: intToHex(d.color),
    quake: d.quake ?? 0,
    wind: d.wind ?? 0,
    flood: Boolean(d.flood),
    projMode: d.projectiles?.mode ?? 'none',
    projRate: d.projectiles?.rate ?? 5,
    projSpeed: d.projectiles?.speed ?? 15,
    projRadius: d.projectiles?.radius ?? 0.4,
  };
}

function ModCreator({
  initial,
  existingIds,
  onCancel,
  onSave,
}: {
  initial: GameMod | null;
  existingIds: ReadonlySet<string>;
  onCancel: () => void;
  onSave: (mod: GameMod) => void;
}) {
  const uid = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [gravity, setGravity] = useState(initial?.rules?.gravityMultiplier ?? 1);
  const [duration, setDuration] = useState(initial?.rules?.durationSeconds ?? DISASTER_SECONDS);
  const [blocks, setBlocks] = useState<BlockDraft[]>(() => (initial ? initial.blocks.map(toBlockDraft) : []));
  const [disasters, setDisasters] = useState<DisasterDraft[]>(() =>
    initial ? initial.disasters.map(toDisasterDraft) : [],
  );

  const addBlock = () => {
    const n = blocks.length + 1;
    setBlocks([
      ...blocks,
      {
        id: `block-${Date.now()}-${n}`,
        label: `Block ${n}`,
        color: '#38bdf8',
        density: 1.0,
        stiffness: 1.2,
        maxStress: 1.8,
        buoyancy: 0.5,
        power: 'none',
      },
    ]);
  };

  const addDisaster = () => {
    const n = disasters.length + 1;
    setDisasters([
      ...disasters,
      {
        id: `storm-${Date.now()}-${n}`,
        label: `Storm ${n}`,
        color: '#a855f7',
        quake: 0,
        wind: 0.6,
        flood: false,
        projMode: 'rain',
        projRate: 5,
        projSpeed: 15,
        projRadius: 0.4,
      },
    ]);
  };

  const handleSave = () => {
    const cleanName = name.trim();
    if (!cleanName) return;
    let modId = initial?.id;
    if (!modId) {
      const base = slugifyId('custom', cleanName);
      let candidate = base;
      let i = 2;
      while (existingIds.has(candidate)) candidate = `${base}-${i++}`;
      modId = candidate;
    }
    const cleanBlocks: ModBlockDef[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b || !b.label.trim()) continue;
      const item: ModBlockDef = {
        id: b.id.startsWith(`${modId}:`) ? b.id : `${modId}:b:${i}-${slugifyId('blk', b.label)}`,
        label: b.label.trim().slice(0, 20),
        color: hexToInt(b.color),
        density: b.density,
        stiffness: b.stiffness,
        maxStress: b.maxStress,
        buoyancy: b.buoyancy,
      };
      if (b.power === 'anchor') item.anchorMultiplier = 3;
      if (b.power === 'shield' || b.power === 'laser') item.special = b.power;
      cleanBlocks.push(item);
    }
    const cleanDisasters: ModDisasterDef[] = [];
    for (let i = 0; i < disasters.length; i++) {
      const d = disasters[i];
      if (!d || !d.label.trim()) continue;
      const item: ModDisasterDef = {
        id: d.id.startsWith(`${modId}:`) ? d.id : `${modId}:d:${i}-${slugifyId('dis', d.label)}`,
        label: d.label.trim().slice(0, 20),
        color: hexToInt(d.color),
      };
      if (d.quake > 0) item.quake = d.quake;
      if (d.wind > 0) item.wind = d.wind;
      if (d.flood) item.flood = true;
      if (d.projMode !== 'none') {
        item.projectiles = {
          mode: d.projMode,
          rate: d.projRate,
          speed: d.projSpeed,
          radius: d.projRadius,
          density: 2.2,
        };
      }
      cleanDisasters.push(item);
    }
    const hasRules = gravity !== 1 || duration !== DISASTER_SECONDS;
    onSave({
      id: modId,
      name: cleanName.slice(0, 40),
      description: description.trim().slice(0, 160) || 'Custom mod pack.',
      builtIn: false,
      enabled: true,
      blocks: cleanBlocks,
      disasters: cleanDisasters,
      ...(hasRules ? { rules: { gravityMultiplier: gravity, durationSeconds: duration } } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label htmlFor={`${uid}-name`} className="flex flex-col gap-1 text-xs font-extrabold">
          Mod Name
          <input
            id={`${uid}-name`}
            data-testid="mod-name-input"
            type="text"
            value={name}
            maxLength={40}
            placeholder="e.g. Super Emerald Pack"
            onChange={(e) => setName(e.target.value)}
            className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-bold"
          />
        </label>
        <label htmlFor={`${uid}-desc`} className="flex flex-col gap-1 text-xs font-extrabold">
          Description
          <input
            id={`${uid}-desc`}
            data-testid="mod-desc-input"
            type="text"
            value={description}
            maxLength={160}
            placeholder="What does this mod add?"
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-bold"
          />
        </label>
      </div>

      <div className="grid gap-2 rounded-2xl bg-white p-3 shadow-sm sm:grid-cols-2">
        <label htmlFor={`${uid}-grav`} className="flex flex-col gap-1 text-xs font-extrabold">
          Gravity ({gravity.toFixed(2)}x)
          <input
            id={`${uid}-grav`}
            type="range"
            min={0.2}
            max={2.5}
            step={0.05}
            value={gravity}
            onChange={(e) => setGravity(Number(e.target.value))}
          />
        </label>
        <label htmlFor={`${uid}-dur`} className="flex flex-col gap-1 text-xs font-extrabold">
          Disaster Length ({duration}s)
          <input
            id={`${uid}-dur`}
            type="range"
            min={4}
            max={20}
            step={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black">Custom Blocks ({blocks.length})</h3>
          <button
            type="button"
            data-testid="mod-add-block"
            onClick={addBlock}
            className="flex items-center gap-1 rounded-xl bg-sky-100 px-2.5 py-1.5 text-xs font-black text-sky-900 active:scale-95"
          >
            <Plus size={14} aria-hidden="true" />
            Add Block
          </button>
        </div>
        {blocks.map((b, i) => (
          <div key={b.id} className="grid gap-2 rounded-xl bg-sky-50 p-2.5 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`Block ${i + 1} color`}
                value={b.color}
                onChange={(e) => setBlocks(patchAt(blocks, i, { color: e.target.value }))}
                className="h-9 w-9 cursor-pointer rounded-lg border border-sky-200 bg-white p-0.5"
              />
              <input
                type="text"
                aria-label={`Block ${i + 1} name`}
                value={b.label}
                maxLength={20}
                onChange={(e) => setBlocks(patchAt(blocks, i, { label: e.target.value }))}
                className="w-full rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs font-bold"
              />
            </div>
            <div className="flex flex-col justify-center gap-1 text-xs font-bold">
              <span>Strength: {b.maxStress.toFixed(1)}x</span>
              <input
                type="range"
                aria-label={`Block ${i + 1} strength`}
                min={0.3}
                max={5}
                step={0.1}
                value={b.maxStress}
                onChange={(e) => setBlocks(patchAt(blocks, i, { maxStress: Number(e.target.value) }))}
              />
              <span>Weight: {b.density.toFixed(1)}</span>
              <input
                type="range"
                aria-label={`Block ${i + 1} weight`}
                min={0.1}
                max={5}
                step={0.1}
                value={b.density}
                onChange={(e) => setBlocks(patchAt(blocks, i, { density: Number(e.target.value) }))}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                aria-label={`Block ${i + 1} special power`}
                value={b.power}
                onChange={(e) => {
                  const v = e.target.value;
                  const power = v === 'anchor' || v === 'shield' || v === 'laser' ? v : 'none';
                  setBlocks(patchAt(blocks, i, { power }));
                }}
                className="rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs font-bold"
              >
                <option value="none">Normal block</option>
                <option value="anchor">Anchor grip (3x)</option>
                <option value="shield">Shield aura</option>
                <option value="laser">Laser turret</option>
              </select>
              <button
                type="button"
                aria-label={`Remove block ${i + 1}`}
                onClick={() => setBlocks(blocks.filter((_, idx) => idx !== i))}
                className="flex size-8 items-center justify-center rounded-lg bg-red-100 text-red-700 active:scale-95"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black">Custom Disasters ({disasters.length})</h3>
          <button
            type="button"
            data-testid="mod-add-disaster"
            onClick={addDisaster}
            className="flex items-center gap-1 rounded-xl bg-sky-100 px-2.5 py-1.5 text-xs font-black text-sky-900 active:scale-95"
          >
            <Plus size={14} aria-hidden="true" />
            Add Disaster
          </button>
        </div>
        {disasters.map((d, i) => (
          <div key={d.id} className="flex flex-col gap-2 rounded-xl bg-sky-50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`Disaster ${i + 1} color`}
                  value={d.color}
                  onChange={(e) => setDisasters(patchAt(disasters, i, { color: e.target.value }))}
                  className="h-9 w-9 cursor-pointer rounded-lg border border-sky-200 bg-white p-0.5"
                />
                <input
                  type="text"
                  aria-label={`Disaster ${i + 1} name`}
                  value={d.label}
                  maxLength={20}
                  onChange={(e) => setDisasters(patchAt(disasters, i, { label: e.target.value }))}
                  className="rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs font-bold"
                />
              </div>
              <button
                type="button"
                aria-label={`Remove disaster ${i + 1}`}
                onClick={() => setDisasters(disasters.filter((_, idx) => idx !== i))}
                className="flex size-8 items-center justify-center rounded-lg bg-red-100 text-red-700 active:scale-95"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="grid gap-2 text-xs font-bold sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                Quake ({d.quake.toFixed(1)}x)
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={d.quake}
                  onChange={(e) => setDisasters(patchAt(disasters, i, { quake: Number(e.target.value) }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                Wind ({d.wind.toFixed(1)}x)
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={d.wind}
                  onChange={(e) => setDisasters(patchAt(disasters, i, { wind: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  checked={d.flood}
                  onChange={(e) => setDisasters(patchAt(disasters, i, { flood: e.target.checked }))}
                />
                Rising Flood
              </label>
            </div>
            <div className="grid gap-2 text-xs font-bold sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                Projectiles
                <select
                  value={d.projMode}
                  onChange={(e) => {
                    const v = e.target.value;
                    const projMode = v === 'rain' || v === 'targeted' ? v : 'none';
                    setDisasters(patchAt(disasters, i, { projMode }));
                  }}
                  className="rounded-lg border border-sky-200 bg-white px-2 py-1.5"
                >
                  <option value="none">None</option>
                  <option value="rain">Falling Rain</option>
                  <option value="targeted">Targeted Raid</option>
                </select>
              </label>
              {d.projMode !== 'none' && (
                <>
                  <label className="flex flex-col gap-1">
                    Rate ({d.projRate}/s)
                    <input
                      type="range"
                      min={1}
                      max={12}
                      step={0.5}
                      value={d.projRate}
                      onChange={(e) =>
                        setDisasters(patchAt(disasters, i, { projRate: Number(e.target.value) }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Speed ({d.projSpeed})
                    <input
                      type="range"
                      min={6}
                      max={28}
                      step={1}
                      value={d.projSpeed}
                      onChange={(e) =>
                        setDisasters(patchAt(disasters, i, { projSpeed: Number(e.target.value) }))
                      }
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-2xl bg-white px-4 py-2 text-sm font-extrabold shadow-sm active:scale-95"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="mod-save"
          disabled={!name.trim()}
          onClick={handleSave}
          className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-black text-emerald-950 shadow-sm active:scale-95 disabled:opacity-50"
        >
          Save Mod
        </button>
      </div>
    </div>
  );
}

function ModsModal({ actions, onClose }: { actions: GameActions; onClose: () => void }) {
  const { mods, active } = useMods();
  const [editing, setEditing] = useState<GameMod | null | 'new'>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const handleImportText = (raw: string) => {
    const res = actions.importMod(raw);
    if (res.ok) {
      setImportText('');
      setShowImport(false);
      setImportFeedback('Mod imported and enabled!');
    } else {
      setImportFeedback(res.error ?? 'Could not import mod.');
    }
  };

  const existingIds = new Set(mods.map((m) => m.id));

  return (
    <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-sky-950/40 p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mods"
        data-testid="mods-modal"
        className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-3xl bg-sky-50 p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black">
              {editing === 'new' ? 'Create Mod' : editing ? 'Edit Mod' : 'Mods'}
            </h2>
            {!editing && active.activeCount > 0 && (
              <span className="rounded-full bg-purple-600 px-2.5 py-0.5 text-xs font-black text-white">
                {active.activeCount} active
              </span>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            data-testid="mods-close"
            aria-label="Close"
            onClick={onClose}
            className="flex size-12 items-center justify-center rounded-2xl bg-white shadow-md active:scale-95"
          >
            <X size={22} />
          </button>
        </div>

        {editing ? (
          <ModCreator
            initial={editing === 'new' ? null : editing}
            existingIds={existingIds}
            onCancel={() => setEditing(null)}
            onSave={(mod) => {
              actions.saveMod(mod);
              setEditing(null);
            }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-sky-900">
                Toggle mod packs or create your own blocks, storms, and rules for Free Build!
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowImport(!showImport);
                    setImportFeedback(null);
                  }}
                  className="flex items-center gap-1 rounded-2xl bg-white px-3 py-2 text-xs font-black shadow-sm active:scale-95"
                >
                  <Upload size={15} aria-hidden="true" />
                  Import .json
                </button>
                <button
                  type="button"
                  data-testid="mod-create-open"
                  onClick={() => setEditing('new')}
                  className="flex items-center gap-1 rounded-2xl bg-amber-300 px-3 py-2 text-xs font-black text-amber-950 shadow-sm active:scale-95"
                >
                  <Plus size={15} aria-hidden="true" />
                  Create Mod
                </button>
              </div>
            </div>

            {importFeedback && (
              <p className="rounded-xl bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-950">
                {importFeedback}
              </p>
            )}

            {showImport && (
              <div className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black">Upload or paste a mod .json file</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      void file
                        .text()
                        .then((txt) => handleImportText(txt))
                        .catch(() => setImportFeedback('Could not read that file.'));
                    }}
                    className="text-xs font-semibold"
                  />
                </div>
                <textarea
                  rows={3}
                  aria-label="Paste mod JSON"
                  placeholder='{"name":"My Mod","blocks":[...],"disasters":[...]}'
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  className="w-full rounded-xl border border-sky-200 p-2 font-mono text-xs"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!importText.trim()}
                    onClick={() => handleImportText(importText)}
                    className="rounded-xl bg-emerald-400 px-3 py-1.5 text-xs font-black text-emerald-950 active:scale-95 disabled:opacity-50"
                  >
                    Import JSON
                  </button>
                </div>
              </div>
            )}

            <ul className="grid gap-2.5 sm:grid-cols-2">
              {mods.map((m) => (
                <li
                  key={m.id}
                  className={`flex flex-col justify-between gap-2.5 rounded-2xl p-3.5 shadow-md ${
                    m.enabled ? 'bg-purple-50 ring-2 ring-purple-300' : 'bg-white'
                  }`}
                >
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-base font-black">{m.name}</div>
                        <span className="text-xs font-bold text-sky-700">
                          {m.builtIn ? 'Starter Pack' : 'Custom Mod'}
                        </span>
                      </div>
                      <button
                        type="button"
                        data-testid={`mod-toggle-${m.id}`}
                        aria-pressed={m.enabled}
                        onClick={() => actions.toggleMod(m.id)}
                        className={`flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-black shadow-sm active:scale-95 ${
                          m.enabled ? 'bg-emerald-400 text-emerald-950' : 'bg-sky-100 text-sky-900'
                        }`}
                      >
                        {m.enabled && <Check size={14} aria-hidden="true" />}
                        {m.enabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <p className="text-sm font-semibold text-sky-950">{m.description}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {m.blocks.map((b) => (
                        <span
                          key={b.id}
                          className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-bold shadow-xs"
                        >
                          <Swatch color={b.color} />
                          {b.label}
                        </span>
                      ))}
                      {m.disasters.map((d) => (
                        <span
                          key={d.id}
                          className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-950"
                        >
                          {d.label}
                        </span>
                      ))}
                      {m.rules?.gravityMultiplier !== undefined && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold">
                          {m.rules.gravityMultiplier}x gravity
                        </span>
                      )}
                      {m.rules?.durationSeconds !== undefined && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold">
                          {m.rules.durationSeconds}s timer
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      aria-label={`Export ${m.name}`}
                      onClick={() => downloadModJson(m)}
                      className="flex items-center gap-1 rounded-xl bg-sky-100 px-2.5 py-1.5 text-xs font-bold text-sky-900 active:scale-95"
                    >
                      <Download size={13} aria-hidden="true" />
                      Export
                    </button>
                    {!m.builtIn && (
                      <>
                        <button
                          type="button"
                          aria-label={`Edit ${m.name}`}
                          onClick={() => setEditing(m)}
                          className="flex items-center gap-1 rounded-xl bg-amber-100 px-2.5 py-1.5 text-xs font-bold text-amber-950 active:scale-95"
                        >
                          <Pencil size={13} aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          type="button"
                          data-testid={`mod-delete-${m.id}`}
                          aria-label={`Delete ${m.name}`}
                          onClick={() => actions.deleteMod(m.id)}
                          className="flex items-center gap-1 rounded-xl bg-red-100 px-2.5 py-1.5 text-xs font-bold text-red-800 active:scale-95"
                        >
                          <Trash2 size={13} aria-hidden="true" />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/** Mods button with active badge and Mod Manager / Visual Mod Creator modal. */
export function ModsPanel({ actions }: { actions: GameActions }) {
  const { active } = useMods();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="mods-open"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex min-h-12 items-center gap-1.5 rounded-2xl bg-white/90 px-3.5 text-sm font-extrabold shadow-md backdrop-blur active:scale-95"
      >
        <Puzzle size={20} aria-hidden="true" />
        <span>Mods</span>
        {active.activeCount > 0 && (
          <span
            data-testid="mods-active-count"
            className="rounded-full bg-purple-600 px-2 py-0.5 text-xs font-black text-white"
          >
            {active.activeCount}
          </span>
        )}
      </button>
      {open && <ModsModal actions={actions} onClose={() => setOpen(false)} />}
    </>
  );
}
