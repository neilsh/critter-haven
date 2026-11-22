import type { ReactNode } from 'react';
import { Box, Building2, Eraser, FlipHorizontal2, House, Paintbrush, Square, Trash2, Undo2, Waypoints } from 'lucide-react';
import { useUIState } from '../state/store';
import { MATERIALS, MATERIAL_ORDER, type MaterialType, type PresetName, type ToolType } from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { Chip, Swatch } from './Chip';

const TOOLS: Array<{ id: ToolType; label: string; icon: ReactNode }> = [
  { id: 'block', label: 'Block', icon: <Box size={22} /> },
  { id: 'brace', label: 'Brace', icon: <Waypoints size={22} /> },
  { id: 'paint', label: 'Paint', icon: <Paintbrush size={22} /> },
  { id: 'erase', label: 'Erase', icon: <Eraser size={22} /> },
];

const PRESETS: Array<{ id: PresetName; label: string; icon: ReactNode }> = [
  { id: 'empty', label: 'Empty', icon: <Square size={20} /> },
  { id: 'house', label: 'House', icon: <House size={20} /> },
  { id: 'tower', label: 'Tower', icon: <Building2 size={20} /> },
];

/** Build tools, materials, mirror/undo/clear and starter presets. Reads the UI store only. */
export function BuildPanel({ actions }: { actions: GameActions }) {
  const s = useUIState();
  return (
    <section
      aria-label="Build tools"
      className="pointer-events-auto flex w-full max-w-[calc(100%-6rem)] flex-col gap-2 rounded-3xl bg-sky-100/90 p-2.5 shadow-xl backdrop-blur sm:max-w-md"
    >
      <div className="flex flex-wrap gap-2">
        {TOOLS.map((t) => (
          <Chip
            key={t.id}
            testId={`tool-${t.id}`}
            label={t.label}
            icon={t.icon}
            active={s.tool === t.id}
            onClick={() => actions.setTool(t.id)}
          />
        ))}
        <Chip
          testId="mirror-x"
          label="Mirror"
          icon={<FlipHorizontal2 size={22} />}
          active={s.mirrorX}
          onClick={() => actions.setMirrorX(!s.mirrorX)}
        />
        <Chip
          testId="undo"
          label="Undo"
          icon={<Undo2 size={22} />}
          disabled={!s.canUndo}
          onClick={() => actions.undo()}
        />
        <Chip testId="clear-island" label="Clear" icon={<Trash2 size={22} />} onClick={() => actions.clearIsland()} />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Materials">
        {MATERIAL_ORDER.map((m: MaterialType) => (
          <Chip
            key={m}
            testId={`material-${m}`}
            label={MATERIALS[m].label}
            icon={<Swatch color={MATERIALS[m].color} />}
            active={s.material === m}
            onClick={() => actions.setMaterial(m)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Starter shapes">
        {PRESETS.map((p) => (
          <Chip
            key={p.id}
            testId={`preset-${p.id}`}
            label={p.label}
            icon={p.icon}
            onClick={() => actions.loadPreset(p.id)}
          />
        ))}
      </div>
    </section>
  );
}
