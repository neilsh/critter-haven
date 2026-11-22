import type { ReactNode } from 'react';

interface ChipProps {
  testId: string;
  label: string;
  icon?: ReactNode;
  /** Set for toggle-style buttons (tools, materials, mirror, cameras, mute). Omit for one-shot actions. */
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** Colour override for one-shot action buttons such as Test and Rewind. */
  variant?: 'default' | 'go' | 'rewind';
  className?: string;
}

const VARIANTS = {
  default: 'bg-white text-sky-900 hover:bg-sky-50',
  go: 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300',
  rewind: 'bg-orange-300 text-orange-950 hover:bg-orange-200',
};

/** Big, friendly, icon-plus-word button. Touch target is at least 48px. */
export function Chip({
  testId,
  label,
  icon,
  active,
  disabled,
  onClick,
  variant = 'default',
  className = '',
}: ChipProps) {
  const tone = active ? 'bg-amber-300 text-amber-950 ring-4 ring-white' : VARIANTS[variant];
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`pointer-events-auto flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-2.5 py-1.5 text-xs font-extrabold shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${tone} ${className}`}
    >
      {icon}
      <span className="leading-none">{label}</span>
    </button>
  );
}

export function Swatch({ color }: { color: number }) {
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  return (
    <span
      aria-hidden
      className="block h-6 w-6 rounded-full border-2 border-white shadow-inner"
      style={{ backgroundColor: hex }}
    />
  );
}
