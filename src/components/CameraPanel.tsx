import { Camera, Eye, Volume2, VolumeX } from 'lucide-react';
import { useUIState } from '../state/store';
import type { Azimuth } from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { Chip } from './Chip';

const VIEWS: Array<{ az: Azimuth; testId: string; label: string }> = [
  { az: 0, testId: 'cam-front', label: 'Front' },
  { az: 90, testId: 'cam-right', label: 'Right' },
  { az: 180, testId: 'cam-back', label: 'Back' },
  { az: 270, testId: 'cam-left', label: 'Left' },
];

/** Camera snaps, first-person toggle, and mute, stacked on the right edge. */
export function CameraPanel({ actions }: { actions: GameActions }) {
  const s = useUIState();
  return (
    <section aria-label="Camera and sound" className="pointer-events-none flex flex-col gap-2">
      <Chip
        testId="cam-first-person"
        label="1st Person"
        icon={<Eye size={18} />}
        active={s.firstPerson}
        onClick={() => actions.setFirstPerson(!s.firstPerson)}
        className="min-w-14"
      />
      {VIEWS.map((v) => (
        <Chip
          key={v.testId}
          testId={v.testId}
          label={v.label}
          icon={<Camera size={18} />}
          active={!s.firstPerson && s.azimuth === v.az}
          onClick={() => actions.setCameraAzimuth(v.az)}
          className="min-w-14"
        />
      ))}
      <Chip
        testId="mute-toggle"
        label="Mute"
        icon={s.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        active={s.muted}
        onClick={() => actions.setMuted(!s.muted)}
        className="min-w-14"
      />
    </section>
  );
}
