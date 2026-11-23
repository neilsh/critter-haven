export function intToHex(n: number): string {
  const clamped = Math.max(0, Math.min(0xffffff, Math.floor(n)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}

export function hexToInt(hex: string, fallback = 0x38bdf8): number {
  const parsed = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(parsed) ? fallback : parsed;
}
