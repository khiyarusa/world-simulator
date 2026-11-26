/** Three contextual coach marks. They advance by doing the action, and persist only a completed count. */
import type { UiPrefs } from './prefs.ts';
import { button, el } from './dom.ts';
import { fmtNum, t } from './i18n.ts';

export class Coach {
  private readonly host: HTMLElement;
  private readonly getPrefs: () => UiPrefs;
  private readonly setPrefs: (prefs: UiPrefs) => void;
  private card: HTMLDivElement | null = null;
  private step = 0;

  constructor(host: HTMLElement, getPrefs: () => UiPrefs, setPrefs: (prefs: UiPrefs) => void) {
    this.host = host;
    this.getPrefs = getPrefs;
    this.setPrefs = setPrefs;
  }

  start(): void {
    const prefs = this.getPrefs();
    if (prefs.onboarding >= 3) return;
    this.show(Math.max(1, prefs.onboarding + 1));
  }

  notify(kind: 'settlement' | 'layer' | 'panel'): void {
    if (!this.card) return;
    if (kind === 'settlement' && this.step === 1) this.advance(2);
    if ((kind === 'layer' || kind === 'panel') && this.step === 2) this.advance(3);
  }

  close(): void {
    this.card?.remove();
    this.card = null;
  }

  private advance(step: number): void {
    this.setPrefs({ ...this.getPrefs(), onboarding: Math.min(3, Math.max(this.getPrefs().onboarding, step - 1)) });
    this.show(step);
  }

  private finish(): void {
    this.setPrefs({ ...this.getPrefs(), onboarding: 3 });
    this.close();
  }

  private show(step: number): void {
    this.close();
    if (step > 3) return;
    this.step = step;
    const card = el('div', { class: 'coach', role: 'status' });
    card.append(
      el('span', { class: 'coach-step', text: t('coach.step', { n: fmtNum(step) }) }),
      el('h3', { text: t(`coach.${step}.title`) }),
      el('p', { text: t(`coach.${step}.text`) }),
    );
    const row = el('div', { class: 'coach-actions' });
    const skip = button(t('coach.skip'), () => this.finish());
    skip.classList.add('ghost');
    row.append(skip, button(step === 3 ? t('coach.start') : t('coach.next'), () => {
      if (step === 3) this.finish();
      else this.advance(step + 1);
    }, { accent: true }));
    card.append(row);
    this.host.append(card);
    this.card = card;
  }
}
