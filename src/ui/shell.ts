/**
 * DOM shell: HUD, selection chip, bottom sheets, toast, debug panel (UX doc §3–§6).
 *
 * The shell renders what it is told and reports gestures back. It contains no rule, no number and
 * no game state beyond the values it is currently displaying. World creation lives in
 * `creation.ts`; map labels live in `labels.ts`.
 */
import type { Speed } from '../worker/protocol.ts';
import { formatInt, tierName } from './format.ts';
import { CreationPanel, defaultCreateInput, type CreateInput } from './creation.ts';

export type { CreateInput, PresetId } from './creation.ts';

export interface ShellHandlers {
  onCreate(input: CreateInput): void;
  /** Named distinctly from the worker client's preview event, which has a different shape. */
  onPreviewRequest(input: CreateInput): void;
  onSpeed(speed: Speed): void;
  onSave(): void;
  onWorldInfo(): void;
  onChipTap(): void;
}

export interface WorldSummary {
  readonly seedText: string;
  readonly preset: string;
  readonly day: number;
  readonly settlements: number;
  readonly civs: number;
  readonly population: number;
  readonly landFraction: number;
}

export interface SettlementSheetInfo {
  name: string;
  civName: string;
  tier: number;
  population: number;
  x: number;
  y: number;
  biome: string;
  water: boolean;
  foundedDay: number;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

export class Shell {
  readonly labelsHost: HTMLElement;
  private readonly handlers: ShellHandlers;
  private readonly boot: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly debugEl: HTMLDivElement;
  private readonly topbar: HTMLDivElement;
  private readonly dateEl: HTMLElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly chip: HTMLDivElement;
  private readonly chipName: HTMLElement;
  private readonly chipMeta: HTMLElement;
  private readonly sheet: HTMLDivElement;
  private readonly sheetBody: HTMLDivElement;
  private readonly creation: CreationPanel;

  private speed: Speed = 0;
  private toastTimer: number | null = null;
  private summary: WorldSummary | null = null;
  private chipOpen = false;

  constructor(handlers: ShellHandlers) {
    this.handlers = handlers;
    const ui = el('ui');
    this.boot = el('boot');
    this.toastEl = el('toast');
    this.labelsHost = el('labels');

    this.debugEl = document.createElement('div');
    this.debugEl.className = 'debug';
    this.debugEl.style.display = 'none';
    ui.appendChild(this.debugEl);

    this.topbar = document.createElement('div');
    this.topbar.className = 'topbar hidden';
    this.dateEl = document.createElement('div');
    this.dateEl.className = 'date';
    this.topbar.appendChild(this.dateEl);
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    this.topbar.appendChild(spacer);
    this.topbar.appendChild(this.iconButton('Save', 'Save world', () => this.handlers.onSave()));
    this.topbar.appendChild(this.iconButton('☰', 'World information', () => this.handlers.onWorldInfo()));
    ui.appendChild(this.topbar);

    ui.appendChild(this.buildDock());

    this.chip = document.createElement('div');
    this.chip.className = 'chip';
    this.chip.hidden = true;
    this.chipName = document.createElement('span');
    this.chipName.className = 'name';
    this.chipMeta = document.createElement('span');
    this.chipMeta.className = 'meta';
    this.chip.append(this.chipName, this.chipMeta);
    this.chip.addEventListener('click', () => this.handlers.onChipTap());
    ui.appendChild(this.chip);

    this.sheet = document.createElement('div');
    this.sheet.className = 'sheet';
    const handle = document.createElement('div');
    handle.className = 'sheet-handle';
    this.sheetBody = document.createElement('div');
    this.sheet.append(handle, this.sheetBody);
    ui.appendChild(this.sheet);

    this.creation = new CreationPanel(
      {
        onCreate: (input) => this.handlers.onCreate(input),
        onPreviewRequest: (input) => this.handlers.onPreviewRequest(input),
      },
      defaultCreateInput(),
    );
    ui.appendChild(this.creation.root);

    this.speedBtn = el<HTMLButtonElement>('speed-btn');
  }

  private buildDock(): HTMLElement {
    const dock = document.createElement('div');
    dock.className = 'dock';

    const world = document.createElement('button');
    world.className = 'dock-btn';
    world.innerHTML = 'World<small>info</small>';
    world.addEventListener('click', () => this.handlers.onWorldInfo());
    dock.appendChild(world);

    const speed = document.createElement('button');
    speed.className = 'dock-btn speed';
    speed.id = 'speed-btn';
    speed.textContent = '❚❚';
    speed.setAttribute('aria-label', 'Simulation speed');
    speed.addEventListener('click', () => this.openSpeedSheet());
    dock.appendChild(speed);

    const fresh = document.createElement('button');
    fresh.className = 'dock-btn';
    fresh.innerHTML = 'New<small>world</small>';
    fresh.addEventListener('click', () => this.showCreation());
    dock.appendChild(fresh);

    return dock;
  }

  private iconButton(label: string, aria: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'icon-btn';
    button.textContent = label;
    button.setAttribute('aria-label', aria);
    button.addEventListener('click', onClick);
    return button;
  }

  // ------------------------------------------------------------------ flow

  bootDone(): void {
    this.boot.classList.add('hidden');
  }

  showCreation(prefill?: Partial<CreateInput>): void {
    this.creation.show(prefill);
  }

  hideCreation(): void {
    this.creation.hide();
  }

  showWorld(summary: WorldSummary): void {
    this.summary = summary;
    this.creation.hide();
    this.topbar.classList.remove('hidden');
    this.bootDone();
  }

  setProgress(pct: number): void {
    this.creation.setProgress(pct);
  }

  setDate(text: string): void {
    this.dateEl.textContent = text;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.speedBtn.textContent = speed === 0 ? '❚❚' : `${speed}×`;
  }

  setSummary(summary: WorldSummary): void {
    this.summary = summary;
  }

  // ------------------------------------------------------------------ chip

  showChip(name: string, meta: string): void {
    this.chipName.textContent = name;
    this.chipMeta.textContent = meta;
    this.chip.hidden = false;
    this.chipOpen = true;
  }

  hideChip(): void {
    this.chip.hidden = true;
    this.chipOpen = false;
  }

  get chipVisible(): boolean {
    return this.chipOpen;
  }

  // ------------------------------------------------------------------ sheets

  closeSheet(): void {
    this.sheet.classList.remove('open');
  }

  openSpeedSheet(): void {
    const options: Array<[string, Speed]> = [
      ['Pause', 0],
      ['1× — a day every 400 ms', 1],
      ['2×', 2],
      ['4×', 4],
      ['8×', 8],
    ];
    this.openSheet(
      'Simulation speed',
      'A tick is always exactly one day.',
      [],
      options.map(([label, value]) => ({
        label: `${label}${this.speed === value ? ' •' : ''}`,
        onClick: () => {
          this.handlers.onSpeed(value);
          this.closeSheet();
        },
        accent: this.speed === value,
      })),
    );
  }

  openWorldSheet(summary: WorldSummary): void {
    this.openSheet(
      'World',
      `Seed ${summary.seedText}`,
      [
        ['Preset', summary.preset],
        ['Day', formatInt(summary.day)],
        ['Settlements', formatInt(summary.settlements)],
        ['Peoples', formatInt(summary.civs)],
        ['Population', formatInt(summary.population)],
        ['Land', `${(summary.landFraction / 10).toFixed(1)}%`],
      ],
      [{ label: 'Save now', accent: true, onClick: () => this.handlers.onSave() }],
    );
  }

  openSettlementSheet(info: SettlementSheetInfo): void {
    this.openSheet(
      info.name,
      `${info.civName} · ${tierName(info.tier)}`,
      [
        ['Population', formatInt(info.population)],
        ['Founded', `Day ${formatInt(info.foundedDay)}`],
        ['Biome', info.biome],
        ['Terrain', info.water ? 'River / lake side' : 'Dry land'],
        ['Position', `${info.x}, ${info.y}`],
      ],
      [],
    );
  }

  openSheet(
    title: string,
    sub: string,
    rows: ReadonlyArray<readonly [string, string]>,
    actions: ReadonlyArray<{ label: string; accent?: boolean; onClick: () => void }>,
  ): void {
    this.sheetBody.replaceChildren();

    const heading = document.createElement('h2');
    heading.textContent = title;
    const subtitle = document.createElement('p');
    subtitle.className = 'sub';
    subtitle.textContent = sub;
    this.sheetBody.append(heading, subtitle);

    if (rows.length > 0) {
      const list = document.createElement('dl');
      list.className = 'kv';
      for (const [key, value] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
        dd.textContent = value;
        list.append(dt, dd);
      }
      this.sheetBody.appendChild(list);
    }

    const actionRow = document.createElement('div');
    actionRow.className = 'sheet-actions';
    for (const action of actions) {
      const button = document.createElement('button');
      button.className = action.accent ? 'btn accent' : 'btn';
      button.textContent = action.label;
      button.addEventListener('click', action.onClick);
      actionRow.appendChild(button);
    }
    const close = document.createElement('button');
    close.className = 'btn ghost';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.closeSheet());
    actionRow.appendChild(close);
    this.sheetBody.appendChild(actionRow);
    this.sheet.classList.add('open');
  }

  // ------------------------------------------------------------------ misc

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('show');
      this.toastTimer = null;
    }, 2600);
  }

  setDebug(text: string | null): void {
    if (text === null) {
      this.debugEl.style.display = 'none';
      return;
    }
    this.debugEl.style.display = 'block';
    this.debugEl.textContent = text;
  }

  drawPreview(width: number, height: number, biome: Uint8Array, elevation: Int16Array): void {
    this.creation.drawPreview(width, height, biome, elevation);
  }

  showPreview(): void {
    this.creation.showPreview();
  }

  get currentInput(): CreateInput {
    return this.creation.currentInput;
  }

  get worldSummary(): WorldSummary | null {
    return this.summary;
  }
}
