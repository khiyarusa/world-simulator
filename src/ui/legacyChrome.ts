/** Top-bar legacy button, compact legacy strip and the stewardship board sheet. */
import type { CampaignCommand, CampaignSummary } from '../worker/protocol.ts';
import type { CampaignView } from '../worker/queryCampaign.ts';
import { CampaignBoard } from './campaignBoard.ts';
import { el } from './dom.ts';
import { icon } from './icons.ts';
import { fmtNum, t } from './i18n.ts';

export interface LegacyHandlers {
  onOpen(): void;
  onClose(): void;
  onCommand(command: CampaignCommand): void;
  onShowTarget(target: number, kind: number): void;
  onOpenCiv(civ: number): void;
}

export class LegacyChrome {
  readonly button: HTMLButtonElement;
  readonly strip: HTMLButtonElement;
  readonly board: CampaignBoard;
  private summary: CampaignSummary | null = null;

  constructor(handlers: LegacyHandlers) {
    this.button = el('button', { class: 'icon-btn legacy-btn', type: 'button', 'aria-label': t('campaign.kicker'), title: t('campaign.kicker') });
    this.button.append(icon('legacy'));
    this.button.hidden = true;
    this.button.addEventListener('click', () => {
      if (this.board.isOpen) handlers.onClose();
      else handlers.onOpen();
    });
    this.strip = el('button', { class: 'legacy-strip', type: 'button', hidden: true });
    this.strip.addEventListener('click', () => handlers.onOpen());
    this.board = new CampaignBoard({
      onClose: () => handlers.onClose(),
      onBegin: (civ) => handlers.onCommand({ op: 'begin', civ }),
      onAccept: (id) => handlers.onCommand({ op: 'accept', id }),
      onDecline: (id) => handlers.onCommand({ op: 'decline', id }),
      onCharter: (civ, kind, replace) => handlers.onCommand({ op: 'charter', civ, kind, replace }),
      onShowTarget: (o) => handlers.onShowTarget(o.target, o.kind),
      onContinue: () => handlers.onClose(),
      onOpenCiv: (civ) => handlers.onOpenCiv(civ),
    });
  }

  setSummary(summary: CampaignSummary | undefined): void {
    this.summary = summary && summary.mode === 1 ? summary : null;
    const on = this.summary !== null;
    this.button.hidden = !on;
    this.strip.hidden = !on;
    if (!on) {
      this.strip.replaceChildren();
      return;
    }
    const c = this.summary!;
    const pending = c.targetCiv === 255;
    const key = c.legacy === 1 ? 'haven' : c.legacy === 2 ? 'concord' : c.legacy === 3 ? 'prosperity' : c.legacy === 4 ? 'enlightenment' : 'renewal';
    this.strip.replaceChildren(
      el('span', { class: 'legacy-strip-kicker', text: t('campaign.kicker') }),
      el('span', { class: 'legacy-strip-main', text: t(`legacy.${key}`) }),
      el('span', {
        class: 'legacy-strip-meta',
        text: pending ? t('campaign.choose') : `${t('era.short', { n: fmtNum(c.era + 1) })} · ${fmtNum(c.milestones)}/5${c.completed ? ' ✓' : ''}`,
      }),
    );
  }

  setView(view: CampaignView | null): void {
    this.board.setView(view);
    if (view) {
      this.setSummary({
        mode: view.mode,
        legacy: view.legacy,
        era: view.era,
        targetCiv: view.targetCiv,
        completed: view.completed,
        milestones: view.milestones.filter((m) => m.done).length,
      });
    }
  }

  open(): void {
    this.board.show();
  }

  close(): void {
    this.board.hide();
  }

  setBusy(busy: boolean): void {
    this.board.setBusy(busy);
  }

  get isOpen(): boolean {
    return this.board.isOpen;
  }

  get current(): CampaignSummary | null {
    return this.summary;
  }
}
