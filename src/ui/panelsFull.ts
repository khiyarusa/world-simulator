/** Influence panel (the final specialised layer, and the class the shell instantiates). */
import type { CivSummary, InterventionInfo } from '../worker/queries.ts';
import type { PlayerCommand } from '../worker/protocol.ts';
import type { PanelTab } from './panels.ts';
import { PanelHostHistory } from './panelsHistory.ts';
import { button, el, empty, field, kv, numberInput, pill, raw, section, select } from './dom.ts';
import { fmtNum, resourceLabel, t } from './i18n.ts';

export class PanelHost extends PanelHostHistory {
  protected override async renderPanel4(tab: PanelTab): Promise<HTMLElement> {
    if (tab === 'influence') return this.renderInfluence();
    return empty(t('common.noData'));
  }

  // ------------------------------------------------------------------ influence

  private async renderInfluence(): Promise<HTMLElement> {
    const [info, civs] = await Promise.all([this.api.queryInterventions(), this.api.queryCivs()]);
    const selected = this.api.selectedSettlement();
    const wrap = el('div', { class: 'panel-content' });
    wrap.append(el('p', { class: 'lede', text: t('influence.lede') }));

    if (this.influence.bless.settlement === null) this.influence.bless.settlement = selected;
    if (this.influence.blight.settlement === null) this.influence.blight.settlement = selected;
    if (this.influence.fertilize.settlement === null) this.influence.fertilize.settlement = selected;
    if (civs.length > 0 && (this.influence.incite.a >= civs.length || this.influence.incite.b >= civs.length)) {
      this.influence.incite.a = civs[0]?.id ?? 0;
      this.influence.incite.b = civs[1]?.id ?? civs[0]?.id ?? 0;
    }

    const opTabs = el('div', { class: 'seg wrap' });
    for (const op of ['bless', 'blight', 'fertilize', 'incite'] as const) {
      opTabs.append(button(t(`influence.${op}`), () => {
        this.influence.op = op;
        void this.render();
      }, { accent: this.influence.op === op }));
    }
    wrap.append(opTabs);
    wrap.append(el('p', { class: 'hint', text: t(`influence.${this.influence.op}.desc`) }));

    const card = el('div', { class: 'influence-card' });
    if (this.influence.op === 'incite') card.append(this.inciteForm(civs, info));
    else card.append(await this.settlementForm(info));
    wrap.append(card);

    if (this.influence.result) {
      const result = this.influence.result;
      const box = section(t('influence.result'));
      box.append(pill(result.ok ? t('influence.applied') : t('influence.refused', { msg: result.message }), result.ok ? 'good' : 'danger'));
      for (const effect of result.effects) {
        const label = effect.kind === 'stock' ? resourceLabel(effect.resource ?? 0) : t(`effect.${effect.kind}`);
        box.append(kv(label, el('span', { dir: 'ltr', text: `${fmtNum(effect.before)} → ${fmtNum(effect.after)} (${effect.delta >= 0 ? '+' : ''}${fmtNum(effect.delta)})` })));
      }
      if (result.eventId > 0) {
        const link = button(t('influence.eventLink', { id: fmtNum(result.eventId) }), () => this.api.openEvent(result.eventId));
        box.append(link);
      }
      wrap.append(box);
    }

    const cooldowns = section(t('influence.active'));
    for (const item of info) {
      const row = el('div', { class: 'list-row' });
      row.append(el('span', { class: 'k', text: t(`influence.${item.name}`) }));
      row.append(
        item.ready
          ? pill(t('influence.ready'), 'good')
          : pill(t('influence.cooldown', { n: fmtNum(item.remainingDays) }), 'warn'),
      );
      cooldowns.append(row);
      if (item.active.length > 0) {
        for (const active of item.active) {
          cooldowns.append(el('p', { class: 'hint', text: `${active.label} · ${t('influence.until', { day: fmtNum(active.endDay) })}` }));
        }
      }
    }
    wrap.append(cooldowns);
    return wrap;
  }

  private async settlementForm(info: InterventionInfo[]): Promise<HTMLElement> {
    const box = el('div', { class: 'influence-form' });
    const op = this.influence.op;
    const state = op === 'blight' ? this.influence.blight : op === 'fertilize' ? this.influence.fertilize : this.influence.bless;
    const settlementId = state.settlement;
    if (settlementId === null) {
      box.append(empty(t('influence.chooseSettlement')));
      return box;
    }
    const settlement = await this.api.querySettlement(settlementId);
    if (!settlement) {
      box.append(empty(t('influence.chooseSettlement')));
      return box;
    }
    box.append(kv(t('influence.target'), raw(settlement.name)));
    const cooldown = info.find((i) => i.name === op);
    box.append(pill(cooldown?.ready ? t('influence.ready') : t('influence.cooldown', { n: fmtNum(cooldown?.remainingDays ?? 0) }), cooldown?.ready ? 'good' : 'warn'));

    if (op === 'bless') {
      const resource = select(
        Array.from({ length: 6 }, (_, r) => ({ value: String(r), label: resourceLabel(r) })),
        String(this.influence.bless.resource),
        (value) => {
          this.influence.bless.resource = Number(value);
          this.influence.bless.amount = Math.min(this.influence.bless.amount, settlement.blessMax[Number(value)] ?? 1);
          void this.render();
        },
      );
      box.append(field(t('influence.resource'), resource));
      const max = settlement.blessMax[this.influence.bless.resource] ?? 1;
      const amount = numberInput(this.influence.bless.amount, 1, max, (value) => {
        this.influence.bless.amount = value;
      });
      box.append(field(t('influence.amount'), amount, t('influence.max', { n: fmtNum(max) })));
      box.append(button(t('influence.bless'), async () => {
        await this.runCommand({
          op: 'bless',
          settlement: settlement.id,
          resource: this.influence.bless.resource,
          amount: this.influence.bless.amount,
        });
      }, { accent: true, disabled: !cooldown?.ready }));
    } else if (op === 'blight') {
      box.append(field(t('influence.intensity'), this.intensityControl(this.influence.blight)));
      box.append(field(t('influence.duration'), select(
        [90, 180, 270, 360].map((d) => ({ value: String(d), label: t(`influence.duration.${d}`) })),
        String(this.influence.blight.duration),
        (value) => {
          this.influence.blight.duration = Number(value);
        },
      )));
      box.append(el('p', { class: 'hint danger', text: t('influence.confirmBlight', { name: settlement.name, days: fmtNum(this.influence.blight.duration) }) }));
      box.append(button(t('influence.confirm'), async () => {
        await this.runCommand({
          op: 'blight',
          settlement: settlement.id,
          intensity: this.influence.blight.intensity,
          durationDays: this.influence.blight.duration,
        });
      }, { danger: true, disabled: !cooldown?.ready }));
    } else {
      box.append(field(t('influence.intensity'), this.intensityControl(this.influence.fertilize)));
      box.append(button(t('influence.confirm'), async () => {
        await this.runCommand({ op: 'fertilize', settlement: settlement.id, intensity: this.influence.fertilize.intensity });
      }, { accent: true, disabled: !cooldown?.ready }));
    }
    return box;
  }

  private intensityControl(state: { intensity: number }): HTMLElement {
    const row = el('div', { class: 'seg' });
    for (const value of [1, 2, 3]) {
      row.append(button(String(value), () => {
        state.intensity = value;
        void this.render();
      }, { accent: state.intensity === value }));
    }
    return row;
  }

  private inciteForm(civs: readonly CivSummary[], info: InterventionInfo[]): HTMLElement {
    const box = el('div', { class: 'influence-form' });
    if (civs.length < 2) {
      box.append(empty(t('influence.chooseCivs')));
      return box;
    }
    const options = civs.map((c) => ({ value: String(c.id), label: c.name }));
    box.append(field(t('influence.civA'), select(options, String(this.influence.incite.a), (value) => {
      this.influence.incite.a = Number(value);
      void this.render();
    })));
    box.append(field(t('influence.civB'), select(options.filter((o) => o.value !== String(this.influence.incite.a)), String(this.influence.incite.b), (value) => {
      this.influence.incite.b = Number(value);
      void this.render();
    })));
    const cooldown = info.find((i) => i.name === 'incite');
    box.append(pill(cooldown?.ready ? t('influence.ready') : t('influence.cooldown', { n: fmtNum(cooldown?.remainingDays ?? 0) }), cooldown?.ready ? 'good' : 'warn'));
    box.append(el('p', { class: 'hint danger', text: t('influence.confirmIncite', { a: civs.find((c) => c.id === this.influence.incite.a)?.name ?? '—', b: civs.find((c) => c.id === this.influence.incite.b)?.name ?? '—' }) }));
    box.append(button(t('influence.confirm'), async () => {
      if (this.influence.incite.a === this.influence.incite.b) {
        this.api.notify(t('influence.chooseCivs'));
        return;
      }
      await this.runCommand({ op: 'incite', civA: this.influence.incite.a, civB: this.influence.incite.b });
    }, { danger: true, disabled: !cooldown?.ready }));
    return box;
  }

  protected async runCommand(command: PlayerCommand): Promise<void> {
    const result = await this.api.command(command);
    this.influence.result = result;
    if (result.ok) this.api.notify(result.message);
    else this.api.notify(t('influence.refused', { msg: result.message }));
    void this.render();
  }
}
