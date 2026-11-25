/**
 * World creation screen: seed, preset, sliders, real generator preview.
 *
 * Kept separate from the HUD shell so neither file grows into a god module (AGENTS.md §4). The
 * panel owns its form state only; the session owns the recipe and the worker.
 */
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

export interface CreationHandlers {
  onCreate(input: CreateInput): void;
  onPreviewRequest(input: CreateInput): void;
}

export function randomSeedText(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const hex = (v: number): string => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${hex(buf[0] ?? 0)}-${hex(buf[1] ?? 0)}`;
}

export function defaultCreateInput(): CreateInput {
  return { seedText: randomSeedText(), preset: 'medium', water: 50, harshness: 50, peoples: 6 };
}

export class CreationPanel {
  readonly root: HTMLDivElement;
  private readonly handlers: CreationHandlers;
  private readonly progressBar: HTMLElement;
  private readonly previewCanvas: HTMLCanvasElement;
  private input: CreateInput;
  private wired = false;

  constructor(handlers: CreationHandlers, input: CreateInput) {
    this.handlers = handlers;
    this.input = { ...input };
    this.root = document.createElement('div');
    this.root.className = 'create';
    this.root.hidden = true;
    this.root.innerHTML = TEMPLATE;
    const progress = this.root.querySelector<HTMLElement>('#progress-bar');
    const canvas = this.root.querySelector<HTMLCanvasElement>('#preview-canvas');
    if (!progress || !canvas) throw new Error('creation screen template is incomplete');
    this.progressBar = progress;
    this.previewCanvas = canvas;
  }

  get currentInput(): CreateInput {
    return { ...this.input };
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(prefill?: Partial<CreateInput>): void {
    if (prefill) this.input = { ...this.input, ...prefill };
    this.root.hidden = false;
    this.wire();
    this.sync();
  }

  hide(): void {
    this.root.hidden = true;
  }

  setProgress(pct: number): void {
    this.progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  showPreview(): void {
    this.previewCanvas.hidden = false;
    const placeholder = this.root.querySelector('.preview .placeholder');
    if (placeholder) placeholder.remove();
  }

  /**
   * Draw the real preview returned by the worker. Colours come from the renderer palette, so the
   * preview and the map can never disagree about what a biome looks like.
   */
  drawPreview(width: number, height: number, biome: Uint8Array, elevation: Int16Array): void {
    const size = 256;
    this.previewCanvas.hidden = false;
    this.previewCanvas.width = size;
    this.previewCanvas.height = size;
    const ctx = this.previewCanvas.getContext('2d');
    if (!ctx) return;
    const cw = size / width;
    const ch = size / height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        ctx.fillStyle = css(BIOME_COLORS[biome[i] ?? 0] ?? BIOME_COLORS[8]!);
        ctx.fillRect(x * cw, y * ch, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
        const elev = elevation[i] ?? 0;
        if (elev > 3000) {
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
          ctx.fillRect(x * cw, y * ch, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
        }
      }
    }
    this.showPreview();
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;

    const seed = this.need<HTMLInputElement>('#seed-input');
    seed.addEventListener('input', () => {
      this.input.seedText = seed.value.trim().toUpperCase();
    });
    for (const id of ['#water', '#harsh', '#peoples'] as const) {
      this.need<HTMLInputElement>(id).addEventListener('input', () => {
        this.input.water = Number(this.need<HTMLInputElement>('#water').value);
        this.input.harshness = Number(this.need<HTMLInputElement>('#harsh').value);
        this.input.peoples = Number(this.need<HTMLInputElement>('#peoples').value);
        this.sync();
      });
    }
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('#preset-seg button')) {
      btn.addEventListener('click', () => {
        this.input.preset = (btn.dataset.preset ?? 'medium') as PresetId;
        this.sync();
      });
    }
    this.need('#seed-random').addEventListener('click', () => {
      this.input.seedText = randomSeedText();
      this.need<HTMLInputElement>('#seed-input').value = this.input.seedText;
    });
    this.need('#preview-btn').addEventListener('click', () => this.handlers.onPreviewRequest(this.currentInput));
    this.need('#create-btn').addEventListener('click', () => this.handlers.onCreate(this.currentInput));
  }

  private sync(): void {
    this.need<HTMLInputElement>('#seed-input').value = this.input.seedText;
    this.need<HTMLInputElement>('#water').value = String(this.input.water);
    this.need<HTMLInputElement>('#harsh').value = String(this.input.harshness);
    this.need<HTMLInputElement>('#peoples').value = String(this.input.peoples);
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('#preset-seg button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.preset === this.input.preset));
    }
    this.need('#water-val').textContent = `${this.input.water}%`;
    this.need('#harsh-val').textContent = `${this.input.harshness}%`;
    this.need('#peoples-val').textContent = `${this.input.peoples}`;
    this.need('#create-hint').textContent = this.describe();
  }

  private describe(): string {
    const size = PRESETS[this.input.preset].size;
    const label = this.input.preset[0]!.toUpperCase() + this.input.preset.slice(1);
    return `${label} · ${size} × ${size} tiles · ${this.input.peoples} peoples`;
  }

  private need<T extends HTMLElement>(selector: string): T {
    const node = this.root.querySelector<T>(selector);
    if (!node) throw new Error(`creation screen is missing ${selector}`);
    return node;
  }
}

const TEMPLATE = `
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
  <div class="preview">
    <span class="placeholder">Preview uses the real generator (small preset)</span>
    <canvas id="preview-canvas" width="256" height="256" hidden></canvas>
  </div>
  <div class="progress"><i id="progress-bar"></i></div>
  <div class="row">
    <button id="preview-btn" class="btn" type="button">Preview</button>
    <button id="create-btn" class="btn accent" type="button">Generate world</button>
  </div>
  <span class="hint" id="create-hint"></span>
`;
