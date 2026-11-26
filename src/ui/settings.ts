/** Settings sheet content (Stage 5 WP9). UI-only preferences; no world state is touched. */
import type { Lang } from './i18n.ts';
import { fmtNum, t } from './i18n.ts';
import type { TextScale, UiPrefs } from './prefs.ts';
import { button, el } from './dom.ts';

export interface SettingsHandlers {
  onPrefs(next: UiPrefs): void;
  onLanguage(lang: Lang): void;
  onReplayOnboarding(): void;
}

export function renderSettings(prefs: UiPrefs, currentLang: Lang, handlers: SettingsHandlers): HTMLElement {
  const wrap = el('div', { class: 'settings' });
  wrap.append(el('h2', { text: t('settings.title') }), el('p', { class: 'sub', text: t('settings.lede') }));

  const language = el('div', { class: 'settings-row' });
  language.append(el('span', { class: 'settings-label', text: t('common.language') }));
  const langSeg = el('div', { class: 'seg' });
  for (const code of ['fa', 'en'] as const) {
    langSeg.append(button(code === 'fa' ? t('common.persian') : t('common.english'), () => handlers.onLanguage(code), {
      accent: currentLang === code,
    }));
  }
  language.append(langSeg);
  wrap.append(language);

  const text = el('div', { class: 'settings-row' });
  const textHead = el('div', { class: 'settings-head' });
  textHead.append(
    el('span', { class: 'settings-label', text: t('settings.textSize') }),
    el('span', { class: 'hint', text: t('settings.textSizeValue', { n: fmtNum(Math.round(prefs.textScale * 100)) }) }),
  );
  text.append(textHead);
  const scaleSeg = el('div', { class: 'seg wrap' });
  for (const scale of [1, 1.25, 1.5, 1.75, 2] as TextScale[]) {
    const b = button(`${fmtNum(Math.round(scale * 100))}%`, () => handlers.onPrefs({ ...prefs, textScale: scale }), {
      accent: prefs.textScale === scale,
    });
    b.classList.add('small');
    scaleSeg.append(b);
  }
  text.append(scaleSeg, el('p', { class: 'hint', text: t('settings.textSizeHint') }));
  wrap.append(text);

  const motion = el('div', { class: 'settings-row' });
  motion.append(el('span', { class: 'settings-label', text: t('settings.motion') }));
  const motionSeg = el('div', { class: 'seg' });
  for (const mode of ['auto', 'reduced'] as const) {
    motionSeg.append(button(mode === 'auto' ? t('settings.motionAuto') : t('settings.motionReduced'), () => handlers.onPrefs({ ...prefs, motion: mode }), {
      accent: prefs.motion === mode,
    }));
  }
  motion.append(motionSeg, el('p', { class: 'hint', text: t('settings.motionHint') }));
  wrap.append(motion);

  const hand = el('div', { class: 'settings-row' });
  hand.append(el('span', { class: 'settings-label', text: t('settings.handedness') }));
  const handSeg = el('div', { class: 'seg' });
  for (const side of ['right', 'left'] as const) {
    handSeg.append(button(side === 'right' ? t('settings.rightHanded') : t('settings.leftHanded'), () => handlers.onPrefs({ ...prefs, hand: side }), {
      accent: prefs.hand === side,
    }));
  }
  hand.append(handSeg, el('p', { class: 'hint', text: t('settings.handednessHint') }));
  wrap.append(hand);

  const power = el('div', { class: 'settings-row' });
  power.append(el('span', { class: 'settings-label', text: t('settings.lowPower') }));
  const powerSeg = el('div', { class: 'seg' });
  for (const value of [false, true] as const) {
    powerSeg.append(button(value ? t('common.on') : t('common.off'), () => handlers.onPrefs({ ...prefs, lowPower: value }), {
      accent: prefs.lowPower === value,
    }));
  }
  power.append(powerSeg, el('p', { class: 'hint', text: t('settings.lowPowerHint') }));
  wrap.append(power);

  const coach = el('div', { class: 'settings-row' });
  coach.append(el('span', { class: 'settings-label', text: t('settings.onboarding') }));
  coach.append(button(t('settings.replayOnboarding'), () => handlers.onReplayOnboarding(), { accent: true }));
  wrap.append(coach);

  return wrap;
}
