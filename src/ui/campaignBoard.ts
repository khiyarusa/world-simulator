/**
 * Stewardship board: legacy, sustained milestones, world-state objectives and civic charters.
 *
 * A board sheet, not a seventh information layer: the map stays visible around it and every target can
 * be shown on the map. It renders only worker projections; it never invents progress.
 */
import type { CampaignView, CampaignObjectiveView, CampaignMilestoneView } from '../worker/queryCampaign.ts';
import { button, el } from './dom.ts';
import { fmtNum, t } from './i18n.ts';

export interface CampaignBoardHandlers {
  onClose(): void;
  onBegin(civ: number): void;
  onAccept(id: number): void;
  onDecline(id: number): void;
  onCharter(civ: number, kind: number, replace: boolean): void;
  onShowTarget(view: CampaignObjectiveView): void;
  onContinue(): void;
  onOpenCiv(civ: number): void;
}

const CHARTER_KEYS = ['', 'food', 'trade', 'scholarship', 'concord', 'defense', 'ecology'] as const;
const OBJECTIVE_KEYS = ['', 'food', 'tension', 'trade', 'ecology', 'knowledge', 'growth'] as const;
const METRIC_KEYS: Record<number, string> = {
  0: 'foodDays',
  1: 'stability',
  2: 'health',
  3: 'literacy',
  4: 'treaties',
  5: 'peaceDays',
  6: 'routes',
  7: 'treasury',
  8: 'tech',
  9: 'academies',
  10: 'fertility',
  11: 'vegetation',
  12: 'population',
  13: 'settlements',
  14: 'foodSecurity',
  15: 'crisisFree',
};

function pct(value: number, goal: number): number {
  if (goal <= 0) return value > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((value / goal) * 100)));
}

export class CampaignBoard {
  readonly root: HTMLDivElement;
  private readonly body: HTMLElement;
  private readonly handlers: CampaignBoardHandlers;
  private view: CampaignView | null = null;
  private charterCiv = 0;
  private charterKind = 1;
  private replace = false;
  private busy = false;

  constructor(handlers: CampaignBoardHandlers) {
    this.handlers = handlers;
    this.root = el('div', { class: 'board', role: 'dialog', 'aria-modal': 'false', hidden: true });
    const head = el('div', { class: 'board-head' });
    head.append(el('span', { class: 'board-kicker', text: t('campaign.kicker') }));
    const close = button('×', () => this.handlers.onClose(), {});
    close.classList.add('icon-btn', 'board-close');
    close.setAttribute('aria-label', t('nav.close'));
    head.append(close);
    this.body = el('div', { class: 'board-body' });
    this.root.append(head, this.body);
  }

  setView(view: CampaignView | null): void {
    this.view = view;
    if (this.charterCiv >= (view?.civs.length ?? 0)) this.charterCiv = view?.civs[0]?.id ?? 0;
    if (view && !view.civs.some((c) => c.id === this.charterCiv)) this.charterCiv = view.civs[0]?.id ?? 0;
    this.render();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.root.classList.toggle('busy', busy);
  }

  show(): void {
    this.root.hidden = false;
    this.root.classList.add('open');
  }

  hide(): void {
    this.root.classList.remove('open');
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  private render(): void {
    this.body.replaceChildren();
    const view = this.view;
    if (!view || view.mode !== 1) {
      this.body.append(el('p', { class: 'hint', text: t('campaign.noCampaign') }));
      return;
    }
    if (view.targetCiv === 255) {
      this.renderSetup(view);
      return;
    }
    this.renderBoard(view);
  }

  private renderSetup(view: CampaignView): void {
    const hero = el('div', { class: 'board-hero' });
    hero.append(
      el('span', { class: 'board-kicker', text: t('campaign.choose') }),
      el('h2', { text: t(`legacy.${view.legacyName}`) }),
      el('p', { class: 'lede', text: t(`legacy.${view.legacyName}.fantasy`) }),
    );
    this.body.append(hero);

    const list = el('div', { class: 'civ-list' });
    for (const civ of view.civs) {
      const row = el('button', { class: 'civ-choice', type: 'button' });
      row.append(
        el('span', { class: 'civ-name', text: civ.name }),
        el('span', { class: 'civ-meta', text: `${civ.capital} · ${fmtNum(civ.population)} · ${t('campaign.settlementsN', { n: fmtNum(civ.settlements) })}` }),
      );
      row.addEventListener('click', () => {
        if (!this.busy) this.handlers.onBegin(civ.id);
      });
      list.append(row);
    }
    this.body.append(el('h3', { class: 'board-section', text: t('campaign.choosePeople') }), list);
    this.body.append(el('p', { class: 'hint', text: t('campaign.chooseHint') }));
  }

  private renderBoard(view: CampaignView): void {
    const hero = el('div', { class: 'board-hero' });
    const name = el('div', { class: 'board-hero-name' });
    name.append(
      el('span', { class: 'board-kicker', text: t('campaign.legacy') }),
      el('h2', { text: t(`legacy.${view.legacyName}`) }),
      el('span', { class: 'board-era', text: `${t('campaign.era')} ${fmtNum(view.era + 1)} · ${t(`era.${view.eraName}`)}` }),
    );
    const stats = el('div', { class: 'board-hero-stats' });
    stats.append(
      stat(t('campaign.steward'), view.targetCivName),
      stat(t('campaign.capital'), view.targetCapital),
      stat(t('campaign.seals'), fmtNum(view.seals)),
      stat(t('campaign.slots'), `${fmtNum(view.activeCharters)}/${fmtNum(view.charterSlots)}`),
    );
    hero.append(name, stats);
    if (view.completed) hero.append(el('span', { class: 'board-complete', text: t('campaign.completed') }));
    if (view.canSucceed) {
      const warn = el('div', { class: 'board-warn' });
      warn.append(el('p', { text: t('campaign.extinct') }));
      this.body.append(hero, warn);
      this.renderSuccession(view);
      return;
    }
    this.body.append(hero);

    const next = view.milestones.find((m) => !m.done);
    if (next) this.body.append(this.milestoneCard(next, true));
    else this.body.append(this.completionCard(view));

    this.body.append(el('h3', { class: 'board-section', text: t('campaign.milestones') }));
    const chain = el('div', { class: 'milestone-chain' });
    for (const m of view.milestones) chain.append(this.milestoneRow(m));
    this.body.append(chain);

    this.renderObjectives(view);
    this.renderCharters(view);
    this.renderMetrics(view);

    const foot = el('div', { class: 'board-foot' });
    foot.append(
      button(t('campaign.showCapital'), () => this.handlers.onOpenCiv(view.targetCiv), {}),
      button(t('nav.close'), () => this.handlers.onClose(), {}),
    );
    this.body.append(foot);
  }

  private milestoneCard(m: CampaignMilestoneView, hero: boolean): HTMLElement {
    const card = el('div', { class: hero ? 'board-card next-milestone' : 'board-card' });
    card.append(el('span', { class: 'board-kicker', text: t('campaign.nextMilestone') }), el('h3', { text: t(m.titleKey) }));
    card.append(this.condition(m, 1));
    if (m.hasSecond) card.append(this.condition(m, 2));
    card.append(el('p', { class: 'hint', text: t('campaign.sustained', { n: fmtNum(m.holdGoal) }) }));
    return card;
  }

  private condition(m: CampaignMilestoneView, which: 1 | 2): HTMLElement {
    const progress = which === 1 ? m.progress : m.progress2;
    const goal = which === 1 ? m.threshold : m.threshold2;
    const met = progress >= goal;
    const shown = Math.min(progress, goal);
    const wrap = el('div', { class: 'board-progress' });
    const bar = el('div', { class: 'bar' });
    const fill = el('i');
    fill.style.width = `${pct(progress, goal)}%`;
    bar.append(fill);
    wrap.append(
      el('span', {
        class: `board-progress-label${met ? ' met' : ''}`,
        text: `${met ? '✓ ' : ''}${t('campaign.condition', { value: fmtNum(shown), goal: fmtNum(goal) })}`,
      }),
      bar,
    );
    return wrap;
  }

  private milestoneRow(m: CampaignMilestoneView): HTMLElement {
    const row = el('div', { class: `milestone-row${m.done ? ' done' : ''}` });
    row.append(
      el('span', { class: 'milestone-mark', text: m.done ? '✓' : fmtNum(m.index + 1) }),
      el('span', { class: 'milestone-title', text: t(m.titleKey) }),
    );
    if (!m.done) {
      const held = Math.min(m.holdGoal, m.holdDays);
      row.append(el('span', { class: 'milestone-hold', text: `${fmtNum(held)}/${fmtNum(m.holdGoal)}` }));
    }
    return row;
  }

  private renderObjectives(view: CampaignView): void {
    const live = view.objectives.filter((o) => o.state === 1 || o.state === 2);
    this.body.append(el('h3', { class: 'board-section', text: t('campaign.objectives') }));
    if (live.length === 0) {
      this.body.append(el('p', { class: 'hint', text: t('campaign.noObjectives') }));
      return;
    }
    const list = el('div', { class: 'objective-list' });
    for (const o of live) list.append(this.objectiveCard(o, view));
    this.body.append(list);
  }

  private objectiveCard(o: CampaignObjectiveView, view: CampaignView): HTMLElement {
    const card = el('div', { class: `objective-card${o.state === 2 ? ' active' : ''}` });
    const kindKey = OBJECTIVE_KEYS[o.kind] ?? 'food';
    const head = el('div', { class: 'objective-head' });
    head.append(
      el('span', { class: 'objective-kind', text: t(`objective.${kindKey}.title`) }),
      el('span', { class: `objective-state${o.state === 2 ? ' active' : ''}`, text: o.state === 2 ? t('campaign.active') : t('campaign.offer') }),
    );
    card.append(head, el('p', { class: 'objective-target', text: o.targetName }));
    card.append(el('p', { class: 'hint', text: t(`objective.${kindKey}.why`) }));
    const bar = el('div', { class: 'board-progress' });
    const track = el('div', { class: 'bar' });
    const fill = el('i');
    fill.style.width = `${pct(o.progress, o.goal)}%`;
    track.append(fill);
    bar.append(
      el('span', {
        class: 'board-progress-label',
        text: t('campaign.condition', { value: fmtNum(o.progress), goal: fmtNum(o.goal) }),
      }),
      track,
    );
    card.append(bar);
    if (o.state === 2) {
      const days = Math.max(0, o.endDay - view.day);
      card.append(
        el('p', { class: 'hint', text: t('campaign.deadline', { n: fmtNum(days) }) }),
        el('p', { class: 'hint', text: t('campaign.hold', { n: fmtNum(Math.min(o.holdDays, o.holdGoal)), goal: fmtNum(o.holdGoal) }) }),
      );
    }
    const actions = el('div', { class: 'board-actions' });
    if (o.state === 1) {
      const accept = button(t('campaign.accept'), () => this.act(() => this.handlers.onAccept(o.id)), { accent: true });
      accept.disabled = this.busy;
      const decline = button(t('campaign.decline'), () => this.act(() => this.handlers.onDecline(o.id)), {});
      decline.disabled = this.busy;
      actions.append(accept, decline);
    }
    actions.append(button(t('campaign.showTarget'), () => this.handlers.onShowTarget(o), {}));
    card.append(actions);
    return card;
  }

  private renderCharters(view: CampaignView): void {
    this.body.append(el('h3', { class: 'board-section', text: t('campaign.charters') }));
    this.body.append(
      el('p', { class: 'hint', text: t('campaign.charterSlots', { used: fmtNum(view.activeCharters), total: fmtNum(view.charterSlots) }) }),
    );
    const active = el('div', { class: 'charter-list' });
    for (const ch of view.charters) {
      const card = el('div', { class: 'charter-card active' });
      card.append(
        el('span', { class: 'charter-name', text: t(`charter.${CHARTER_KEYS[ch.kind] ?? 'food'}`) }),
        el('span', { class: 'charter-meta', text: `${ch.civName} · ${t('campaign.daysLeft', { n: fmtNum(ch.daysLeft) })}` }),
      );
      active.append(card);
    }
    if (view.charters.length === 0) active.append(el('p', { class: 'hint', text: t('campaign.noCharters') }));
    this.body.append(active);

    const candidates = view.civs;
    if (candidates.length === 0) {
      this.body.append(el('p', { class: 'hint', text: t('campaign.allChartered') }));
      return;
    }
    if (!candidates.some((c) => c.id === this.charterCiv)) this.charterCiv = candidates[0]?.id ?? 0;
    const selectedCiv = candidates.find((c) => c.id === this.charterCiv) ?? candidates[0]!;
    const hasActive = selectedCiv.charter !== 0;
    const issue = el('div', { class: 'charter-issue' });
    const select = el('select', { class: 'input', 'aria-label': t('campaign.charterTarget') });
    for (const civ of candidates) {
      const opt = el('option', {
        value: civ.id,
        text: `${civ.name} · ${fmtNum(civ.population)}${civ.charter !== 0 ? ` · ${t(`charter.${CHARTER_KEYS[civ.charter] ?? 'food'}`)}` : ''}`,
      });
      if (civ.id === this.charterCiv) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      this.charterCiv = Number(select.value);
      this.replace = false;
      this.render();
    });
    issue.append(el('span', { class: 'field-label', text: t('campaign.charterTarget') }), select);
    const cards = el('div', { class: 'charter-picks' });
    for (let kind = 1; kind <= 6; kind++) {
      const card = el('button', { class: `charter-pick${kind === this.charterKind ? ' sel' : ''}`, type: 'button' });
      card.append(
        el('span', { class: 'charter-name', text: t(`charter.${CHARTER_KEYS[kind]}`) }),
        el('span', { class: 'hint', text: t(`charter.${CHARTER_KEYS[kind]}.desc`) }),
      );
      card.addEventListener('click', () => {
        this.charterKind = kind;
        this.render();
      });
      cards.append(card);
    }
    issue.append(cards);
    issue.append(
      el('p', { class: 'hint', text: t(`charter.${CHARTER_KEYS[this.charterKind]}.tradeoff`) }),
      el('p', { class: 'hint', text: t('campaign.charterTerm') }),
    );
    if (hasActive) {
      const toggle = el('label', { class: 'board-check' });
      const box = el('input', { type: 'checkbox' });
      box.checked = this.replace;
      box.addEventListener('change', () => {
        this.replace = box.checked;
      });
      toggle.append(box, el('span', { text: t('campaign.replace', { charter: t(`charter.${CHARTER_KEYS[selectedCiv.charter] ?? 'food'}`) }) }));
      issue.append(toggle);
    }
    const confirm = button(t('campaign.issueCharter'), () => {
      if (!this.busy) {
        this.handlers.onCharter(this.charterCiv, this.charterKind, this.replace);
        this.replace = false;
      }
    }, { accent: true });
    confirm.disabled = this.busy || (view.activeCharters >= view.charterSlots && !hasActive);
    issue.append(confirm);
    if (view.activeCharters >= view.charterSlots && !hasActive) {
      issue.append(el('p', { class: 'hint warn-text', text: t('campaign.noSlots') }));
    }
    this.body.append(issue);
  }

  private renderMetrics(view: CampaignView): void {
    this.body.append(el('h3', { class: 'board-section', text: t('campaign.measured') }));
    const grid = el('div', { class: 'metric-grid' });
    for (const m of view.metrics) {
      const label = METRIC_KEYS[m.key];
      if (!label) continue;
      const cell = el('div', { class: 'metric-cell' });
      cell.append(
        el('span', { class: 'metric-label', text: t(`metric.${label}`) }),
        el('strong', { text: fmtNum(m.value) }),
        el('span', { class: 'hint', text: t('campaign.baseline', { n: fmtNum(m.baseline) }) }),
      );
      grid.append(cell);
    }
    this.body.append(grid);
  }

  private completionCard(view: CampaignView): HTMLElement {
    const card = el('div', { class: 'board-card completion' });
    const years = Math.max(1, Math.round((view.completedDay - view.begunDay) / 360));
    const population = (view.metrics.find((m) => m.key === 12)?.value ?? 0) * 100;
    card.append(
      el('span', { class: 'board-kicker', text: t('campaign.legacyConclusion') }),
      el('h3', { text: t(`legacy.${view.legacyName}.conclusion`) }),
      el('p', {
        class: 'lede',
        text: t('campaign.conclusionBody', {
          civ: view.targetCivName,
          pop: fmtNum(population),
          seals: fmtNum(view.seals),
          years: fmtNum(years),
        }),
      }),
      el('p', { class: 'hint', text: t('campaign.conclusionKeep') }),
    );
    card.append(button(t('campaign.continue'), () => this.handlers.onContinue(), { accent: true }));
    return card;
  }

  private renderSuccession(view: CampaignView): void {
    this.body.append(el('h3', { class: 'board-section', text: t('campaign.succession') }));
    const list = el('div', { class: 'civ-list' });
    for (const civ of view.civs) {
      const row = button(`${civ.name} · ${fmtNum(civ.population)}`, () => {
        if (!this.busy) this.handlers.onBegin(civ.id);
      }, {});
      row.classList.add('civ-choice');
      list.append(row);
    }
    this.body.append(list, el('p', { class: 'hint', text: t('campaign.successionHint') }));
  }

  private act(fn: () => void): void {
    if (this.busy) return;
    fn();
  }
}

function stat(label: string, value: string): HTMLElement {
  const wrap = el('div', { class: 'board-stat' });
  wrap.append(el('span', { class: 'board-stat-label', text: label }), el('strong', { text: value }));
  return wrap;
}
