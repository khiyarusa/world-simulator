/** Presentation-only formatting. Never used by the simulation. */

const TIER_NAMES = ['Camp', 'Village', 'Town', 'City', 'Metropolis'] as const;

export function formatInt(n: number): string {
  const v = Math.round(n);
  const neg = v < 0;
  const digits = Math.abs(v).toString();
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return neg ? `-${out}` : out;
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return formatInt(n);
}

export function tierName(tier: number): string {
  return TIER_NAMES[tier] ?? 'Camp';
}

export function formatPercent(perMille: number): string {
  return `${(perMille / 10).toFixed(1)}%`;
}

export function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
