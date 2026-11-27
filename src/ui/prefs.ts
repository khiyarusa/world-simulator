/**
 * Player interface preferences (Stage 5 WP9). These are UI-only, live in localStorage and never
 * enter the world save or the simulation. Settings are applied as data attributes / variables on the
 * document root so one place owns the visual contract.
 */
export type TextScale = 1 | 1.25 | 1.5 | 1.75 | 2;
export type MotionPref = 'auto' | 'reduced';
export type HandPref = 'right' | 'left';
export type QualityPref = 'high' | 'balanced' | 'performance';

export interface UiPrefs {
  readonly textScale: TextScale;
  readonly motion: MotionPref;
  readonly hand: HandPref;
  readonly lowPower: boolean;
  /** Atlas quality. High uses the 2048 overview and regional chunks. */
  readonly quality: QualityPref;
  /** Completed onboarding steps, 0..3. */
  readonly onboarding: number;
}

const KEY = 'ws.prefs.v1';

export const DEFAULT_PREFS: UiPrefs = {
  textScale: 1,
  motion: 'auto',
  hand: 'right',
  lowPower: false,
  quality: 'high',
  onboarding: 0,
};

export function loadPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    const textScale: TextScale = [1, 1.25, 1.5, 1.75, 2].includes(Number(parsed.textScale))
      ? (Number(parsed.textScale) as TextScale)
      : 1;
    return {
      textScale,
      motion: parsed.motion === 'reduced' ? 'reduced' : 'auto',
      hand: parsed.hand === 'left' ? 'left' : 'right',
      lowPower: parsed.lowPower === true,
      quality: parsed.quality === 'balanced' || parsed.quality === 'performance' ? parsed.quality : 'high',
      onboarding: Math.max(0, Math.min(3, Math.floor(Number(parsed.onboarding) || 0))),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // private mode / storage disabled: the preferences still apply for this session
  }
}

export function applyPrefs(prefs: UiPrefs): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--text-scale', String(prefs.textScale));
  root.dataset.motion = prefs.motion === 'reduced' ? 'reduced' : 'auto';
  root.dataset.hand = prefs.hand;
  root.dataset.power = prefs.lowPower ? 'low' : 'normal';
  root.classList.toggle('left-handed', prefs.hand === 'left');
  root.classList.toggle('large-text', prefs.textScale >= 1.5);
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionReduced(prefs: UiPrefs): boolean {
  return prefs.motion === 'reduced' || (prefs.motion === 'auto' && prefersReducedMotion());
}

export function withPrefs(prefs: UiPrefs, patch: Partial<UiPrefs>): UiPrefs {
  return { ...prefs, ...patch };
}
