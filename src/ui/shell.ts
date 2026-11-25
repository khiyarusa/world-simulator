/**
 * DOM shell: creation screen, HUD, selection chip, bottom sheets, toast (UX doc §3–§6).
 *
 * The shell is dumb on purpose: it renders what it is told and reports gestures back. No rule,
 * no number and no formatting of game state lives here beyond presentation.
 */
import type { Speed } from '../worker/protocol.ts';
import { formatInt, tierName } from './format.ts';
import { BIOME_COLORS, css } from '../render/palette.ts';
import { PRESETS } from '../sim/world/presets.ts';

export type PresetId = 'small' | 'medium' | 'large';

export interface CreateInput {
  seedText: string;
  preset: PresetId;
  water: number;
  harshness: number;
  peoples: number;
}

export interface ShellHandlers {
  onCreate(input: CreateInput): void;
  /** Deliberately not `onPreview`: the worker client also has a preview event with another shape. */
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

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function randomSeedText(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const hex = (v: number): string => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${hex(buf[0] ?? 0)}-${hex(buf[1] ?? 0)}`;
}

export class Shell {
  readonly labelsHost: HTMLElement;
  private readonly handlers: ShellHandlers;
  private readonly ui: HTMLElement;
  private readonly boot: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly debugEl: HTMLDivElement;
  private readonly creation: HTMLDivElement;
  private readonly topbar: HTMLDivElement;
  private readonly dateEl: HTMLElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly chip: HTMLDivElement;
  private readonly chipName: HTMLElement;
  private readonly chipMeta: HTMLElement;
  private readonly sheet: HTMLDivElement;
  private readonly sheetBody: HTMLDivElement;
  private readonly previewCanvas: HTMLCanvasElement;
  private readonly progressBar: HTMLElement;

  private input: CreateInput = { seedText: randomSeedText(), preset: 'medium', water: 50, harshness: 50, peoples: 6 };
  private speed: Speed = 0;
  private toastTimer: number | null = null;
  private summary: WorldSummary | null = null;
  private chipOpen = false;

  constructor(handlers: ShellHandlers) {
    this.handlers = handlers;
    this.ui = el('ui');
    this.boot = el('boot');
    this.toastEl = el('toast');
    this.labelsHost = el('labels');

    this.debugEl = document.createElement('div');
    this.debugEl.className = 'debug';
    this.debugEl.style.display = 'none';
    this.ui.appendChild(this.debugEl);

    this.topbar = document.createElement('div');
    this.topbar.className = 'topbar hidden';
    this.ui.appendChild(this.topbar);

    this.dateEl = document.createElement('div');
    this.dateEl.className = 'date';
    this.topbar.appendChild(this.dateEl);

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    this.topbar.appendChild(spacer);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'icon-btn';
    saveBtn.textContent = 'Save';
    saveBtn.setAttribute('aria-label', 'Save world');
    saveBtn.addEventListener('click', () => this.handlers.onSave());
    this.topbar.appendChild(saveBtn);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'icon-btn';
    menuBtn.textContent = '☰';
    menuBtn.setAttribute('aria-label', 'World information');
    menuBtn.addEventListener('click', () => this.handlers.onWorldInfo());
    this.topbar.appendChild(menuBtn);

    // ---- dock
    const dock = document.createElement('div');
    dock.className = 'dock';
    this.ui.appendChild(dock);

    const worldBtn = document.createElement('button');
    worldBtn.className = 'dock-btn';
    worldBtn.innerHTML = 'World<small>info</small>';
    worldBtn.addEventListener('click', () => this.handlers.onWorldInfo());
    dock.appendChild(worldBtn);

    this.speedBtn = document.createElement('button');
    this.speedBtn.className = 'dock-btn speed';
    this.speedBtn.textContent = '❚❚';
    this.speedBtn.setAttribute('aria-label', 'Simulation speed');
    this.speedBtn.addEventListener('click', () => this.openSpeedSheet());
    dock.appendChild(this.speedBtn);

    const newBtn = document.createElement('button');
    newBtn.className = 'dock-btn';
    newBtn.innerHTML = 'New<small>world</small>';
    newBtn.addEventListener('click', () => this.showCreation());
    dock.appendChild(newBtn);

    // ---- chip
    this.chip = document.createElement('div');
    this.chip.className = 'chip';
    this.chip.hidden = true;
    this.chipName = document.createElement('span');
    this.chipName.className = 'name';
    this.chipMeta = document.createElement('span');
    this.chipMeta.className = 'meta';
    this.chip.append(this.chipName, this.chipMeta);
    this.chip.addEventListener('click', () => this.handlers.onChipTap());
    this.ui.appendChild(this.chip);

    // ---- sheet
    this.sheet = document.createElement('div');
    this.sheet.className = 'sheet';
    const handle = document.createElement('div');
    handle.className = 'sheet-handle';
    this.sheetBody = document.createElement('div');
    this.sheet.append(handle, this.sheetBody);
    this.ui.appendChild(this.sheet);

    // ---- creation
    this.creation = this.buildCreation();
    this.ui.appendChild(this.creation);
    this.previewCanvas = el<HTMLCanvasElement>('preview-canvas');
    this.progressBar = el('progress-bar');
  }

  // ------------------------------------------------------------------ boot / flow

  bootDone(): void {
    this.boot.classList.add('hidden');
  }

  showCreation(prefill?: Partial<CreateInput>): void {
    if (prefill) this.input = { ...this.input, ...prefill };
    this.creation.hidden = false;
    this.syncCreation();
  }

  hideCreation(): void {
    this.creation.hidden = true;
  }

  showWorld(summary: WorldSummary): void {
    this.summary = summary;
    this.creation.hidden = true;
    this.topbar.classList.remove('hidden');
    this.bootDone();
  }

  setProgress(pct: number): void {
    this.progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  setDate(text: string): void {
    this.dateEl.innerHTML = `<strong>${text}</strong>`;
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
    this.openSheet('Simulation speed', 'A tick is always exactly one day.', [], options.map(([label, value]) => ({
      label: `${label}${this.speed === value ? ' •' : ''}`,
      onClick: () => {
        this.handlers.onSpeed(value);
        this.closeSheet();
      },
      accent: this.speed === value,
    })));
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

  openSettlementSheet(info: {
    name: string;
    civName: string;
    tier: number;
    population: number;
    x: number;
    y: number;
    biome: string;
    water: boolean;
    foundedDay: number;
  }): void {
    this.openSheet(info.name, `${info.civName} · ${tierName(info.tier)}`, [
      ['Population', formatInt(info.population)],
      ['Founded', `Day ${formatInt(info.foundedDay)}`],
      ['Biome', info.biome],
      ['Terrain', info.water ? 'River / lake side' : 'Dry land'],
      ['Position', `${info.x}, ${info.y}`],
    ], []);
  }

  openSheet(
    title: string,
    sub: string,
    rows: ReadonlyArray<readonly [string, string]>,
    actions: ReadonlyArray<{ label: string; accent?: boolean; onClick: () => void }>,
  ): void {
    this.sheetBody.replaceChildren();

    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.className = 'sub';
    p.textContent = sub;
    this.sheetBody.append(h, p);

    if (rows.length > 0) {
      const dl = document.createElement('dl');
      dl.className = 'kv';
      for (const [k, v] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        dl.append(dt, dd);
      }
      this.sheetBody.appendChild(dl);
    }

    const actionRow = document.createElement('div');
    actionRow.className = 'sheet-actions';
    for (const action of actions) {
      const b = document.createElement('button');
      b.className = action.accent ? 'btn accent' : 'btn';
      b.textContent = action.label;
      b.addEventListener('click', action.onClick);
      actionRow.appendChild(b);
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
    const canvas = this.previewCanvas;
    const size = 256;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cw = size / width;
    const ch = size / height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const b = biome[i] ?? 0;
        const e = elevation[i] ?? 0;
        ctx.fillStyle = css(BIOME_COLORS[b] ?? BIOME_COLORS[8]!);
        ctx.fillRect(x * cw, y * ch, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
        if (e > 3000) {
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
          ctx.fillRect(x * cw, y * ch, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
        }
      }
    }
  }

  // ------------------------------------------------------------------ creation screen

  private buildCreation(): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'create';
    root.hidden = true;
    root.innerHTML = `
      <h1>Create a world</h1>
      <p class="lede">A generated world of terrain, rivers and biomes. Settlements are placed from
      real fertility, water and slope data. The same seed always produces the same world.</p>
      <div class="field">
        <label for="seed-input">Seed</label>
        <div class="row">
          <input id="seed-input" type="text" inputmode="text" autocomplete="off" spellcheck="false" />
          <button id="seed-random" class="btn" type="button" style="flex:0 0 96px">Random</button>
        </div>
        <span class="hint">Format: 8 hex digits - 8 hex digits</span>
      </div>
      <div class="field">
        <label>Size</label>
        <div class="seg" id="preset-seg">
          <button type="button" data-preset="small">Small</button>
          <button type="button" data-preset="medium">Medium</button>
          <button type="button" data-preset="large">Large</button>
        </div>
      </div>
      <div class="field">
        <label for="water">Water <span id="water-val" class="hint"></span></label>
        <input id="water" type="range" min="0" max="100" step="1" />
      </div>
      <div class="field">
        <label for="harsh">Harshness <span id="harsh-val" class="hint"></span></label>
        <input id="harsh" type="range" min="0" max="100" step="1" />
      </div>
      <div class="field">
        <label for="peoples">Peoples <span id="peoples-val" class="hint"></span></label>
        <input id="peoples" type="range" min="1" max="12" step="1" />
      </div>
      <div class="preview" id="preview">
        <span class="placeholder">Preview uses the real generator (small preset)</span>
        <canvas id="preview-canvas" width="256" height="256" hidden></canvas>
      </div>
      <div class="progress"><i id="progress-bar"></i></div>
      <div class="row">
        <button id="preview-btn" class="btn" type="button">Preview</button>
        <button id="create-btn" class="btn accent" type="button">Generate world</button>
      </div>
      <span class="hint" id="create-hint">Medium · 192 × 192 tiles · 6 peoples</span>
    `;
    return root;
  }

  private wiringDone = false;

  private syncCreation(): void {
    const seed = el<HTMLInputElement>('seed-input');
    const water = el<HTMLInputElement>('water');
    const harsh = el<HTMLInputElement>('harsh');
    const peoples = el<HTMLInputElement>('peoples');
    seed.value = this.input.seedText;
    water.value = String(this.input.water);
    harsh.value = String(this.input.harshness);
    peoples.value = String(this.input.peoples);
    this.syncLabels();

    if (this.wiringDone) return;
    this.wiringDone = true;

    seed.addEventListener('input', () => {
      this.input.seedText = seed.value.trim().toUpperCase();
    });
    water.addEventListener('input', () => {
      this.input.water = Number(water.value);
      this.syncLabels();
    });
    harsh.addEventListener('input', () => {
      this.input.harshness = Number(harsh.value);
      this.syncLabels();
    });
    peoples.addEventListener('input', () => {
      this.input.peoples = Number(peoples.value);
      this.syncLabels();
    });
    for (const btn of this.creation.querySelectorAll<HTMLButtonElement>('#preset-seg button')) {
      btn.addEventListener('click', () => {
        const preset = (btn.dataset.preset ?? 'medium') as PresetId;
        this.input.preset = preset;
        this.syncLabels();
      });
    }
    el('seed-random').addEventListener('click', () => {
      this.input.seedText = randomSeedText();
      seed.value = this.input.seedText;
    });
    el('preview-btn').addEventListener('click', () => this.handlers.onPreviewRequest({ ...this.input }));
    el('create-btn').addEventListener('click', () => this.handlers.onCreate({ ...this.input }));
  }

  private syncLabels(): void {
    const presetSizes: Record<PresetId, number> = {
      small: PRESETS.small.size,
      medium: PRESETS.medium.size,
      large: PRESETS.large.size,
    };
    for (const btn of this.creation.querySelectorAll<HTMLButtonElement>('#preset-seg button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.preset === this.input.preset));
    }
    el('water-val').textContent = `${this.input.water}%`;
    el('harsh-val').textContent = `${this.input.harshness}%`;
    el('peoples-val').textContent = `${this.input.peoples}`;
    el('create-hint').textContent = `${this.input.preset === 'small' ? 'Small' : this.input.preset === 'medium' ? 'Medium' : 'Large'} · ${presetSizes[this.input.preset]} × ${presetSizes[this.input.preset]} tiles · ${this.input.peoples} peoples`;
    const canvas = el<HTMLCanvasElement>('preview-canvas');
    if (canvas.hidden) this.progressBar.style.width = '0%';
  }

  showPreview(): void {
    el<HTMLCanvasElement>('preview-canvas').hidden = false;
    const ph = this.creation.querySelector('.preview .placeholder');
    if (ph) ph.remove();
  }

  get currentInput(): CreateInput {
    return { ...this.input };
  }

  get worldSummary(): WorldSummary | null {
    return this.summary;
  }
}
