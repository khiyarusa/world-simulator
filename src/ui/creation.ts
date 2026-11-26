/**
 * World creation screen: name, seed, preset, sliders and a real generator preview.
 *
 * The panel owns its form state only; the session owns the recipe and the worker. All strings are
 * localised, and the preview colours come from the renderer palette so the thumbnail and the map
 * cannot disagree.
 */
import { BIOME_COLORS, css } from '../render/palette.ts';
import { PRESETS } from '../sim/world/presets.ts';
import { button, el, field, input } from './dom.ts';
import { fmtNum, presetLabel, t } from './i18n.ts';

export type PresetId = 'small' | 'medium' | 'large';

export interface CreateInput {
  name: string;
  seedText: string;
  preset: PresetId;
  water: number;
  harshness: number;
  peoples: number;
}

export interface CreationHandlers {
  onCreate(input: CreateInput): void;
  onPreviewRequest(input: CreateInput): void;
  onBack(): void;
}

export function randomSeedText(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const hex = (v: number): string => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${hex(buf[0] ?? 0)}-${hex(buf[1] ?? 0)}`;
}

export function defaultCreateInput(): CreateInput {
  return { name: '', seedText: randomSeedText(), preset: 'medium', water: 50, harshness: 50, peoples: 6 };
}

export class CreationPanel {
  readonly root: HTMLDivElement;
  private readonly handlers: CreationHandlers;
  private readonly progressBar: HTMLElement;
  private readonly progressText: HTMLElement;
  private readonly previewCanvas: HTMLCanvasElement;
  private readonly previewPlaceholder: HTMLElement;
  private readonly summary: HTMLElement;
  private input: CreateInput;
  private wired = false;

  constructor(handlers: CreationHandlers, initial: CreateInput) {
    this.handlers = handlers;
    this.input = { ...initial };
    this.root = el('div', { class: 'create', hidden: true });

    const head = el('header', { class: 'create-head' });
    const back = button(`← ${t('nav.backToWorlds')}`, () => this.handlers.onBack(), {});
    back.classList.add('ghost', 'back');
    head.append(back);
    head.append(el('h1', { text: t('create.title') }), el('p', { class: 'lede', text: t('create.lede') }));
    this.root.append(head);

    this.root.append(field(t('create.name'), input(this.input.name, (v) => {
      this.input.name = v;
    }, 'text')));
    const nameInput = this.root.querySelector<HTMLInputElement>('input');
    if (nameInput) {
      nameInput.id = 'create-name';
      nameInput.placeholder = t('create.namePlaceholder');
    }

    const seedField = el('div', { class: 'field' });
    seedField.append(el('span', { class: 'field-label', text: t('create.seed') }));
    const seedRow = el('div', { class: 'row' });
    const seedInput = el('input', { class: 'input', id: 'seed-input', type: 'text', value: this.input.seedText, spellcheck: 'false', autocomplete: 'off' });
    seedInput.addEventListener('input', () => {
      this.input.seedText = seedInput.value.trim().toUpperCase();
    });
    const random = button(t('create.random'), () => {
      this.input.seedText = randomSeedText();
      seedInput.value = this.input.seedText;
    });
    random.classList.add('compact');
    seedRow.append(seedInput, random);
    seedField.append(seedRow, el('span', { class: 'hint', text: t('create.seedHint') }));
    this.root.append(seedField);

    const sizeField = el('div', { class: 'field' });
    sizeField.append(el('span', { class: 'field-label', text: t('create.size') }));
    const seg = el('div', { class: 'seg' });
    for (const preset of ['small', 'medium', 'large'] as const) {
      const b = button(presetLabel(preset), () => {
        this.input.preset = preset;
        this.sync();
      });
      b.dataset.preset = preset;
      seg.append(b);
    }
    sizeField.append(seg);
    this.root.append(sizeField);

    for (const key of ['water', 'harshness', 'peoples'] as const) {
      const wrap = el('div', { class: 'field' });
      const label = el('span', { class: 'field-label' });
      const value = el('span', { class: 'hint value' });
      label.textContent = t(`create.${key}`);
      const range = el('input', {
        type: 'range',
        min: key === 'peoples' ? 1 : 0,
        max: key === 'peoples' ? 12 : 100,
        value: this.input[key],
        class: 'range',
      });
      range.addEventListener('input', () => {
        this.input[key] = Number(range.value);
        this.sync();
      });
      wrap.append(label, value, range);
      wrap.dataset.field = key;
      this.root.append(wrap);
    }

    const preview = el('div', { class: 'preview' });
    this.previewPlaceholder = el('span', { class: 'placeholder', text: t('create.previewHint') });
    this.previewCanvas = el('canvas', { width: 256, height: 256, hidden: true, id: 'preview-canvas' });
    preview.append(this.previewPlaceholder, this.previewCanvas);
    this.root.append(preview);

    this.summary = el('p', { class: 'hint summary' });
    this.root.append(this.summary);

    const progress = el('div', { class: 'progress' });
    this.progressBar = el('i');
    progress.append(this.progressBar);
    this.progressText = el('span', { class: 'hint progress-text' });
    this.root.append(progress, this.progressText);

    const actions = el('div', { class: 'row' });
    actions.append(button(t('create.preview'), () => this.handlers.onPreviewRequest(this.currentInput)));
    const generate = button(t('create.generate'), () => this.handlers.onCreate(this.currentInput), { accent: true });
    generate.id = 'create-btn';
    actions.append(generate);
    this.root.append(actions);
    this.root.append(el('p', { class: 'hint', text: t('create.seedHint') }));
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

  setProgress(pct: number, busy = true): void {
    const clamped = Math.max(0, Math.min(100, pct));
    this.progressBar.style.width = `${clamped}%`;
    this.progressText.textContent = busy ? t('create.progress', { pct: fmtNum(Math.round(clamped)) }) : '';
  }

  showPreview(): void {
    this.previewCanvas.hidden = false;
    this.previewPlaceholder.hidden = true;
  }

  drawPreview(width: number, height: number, biome: Uint8Array, elevation: Int16Array): void {
    const size = 256;
    this.previewCanvas.hidden = false;
    this.previewCanvas.width = size;
    this.previewCanvas.height = size;
    const ctx = this.previewCanvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
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
    this.sync();
  }

  private sync(): void {
    for (const preset of ['small', 'medium', 'large'] as const) {
      for (const b of this.root.querySelectorAll<HTMLButtonElement>(`button[data-preset="${preset}"]`)) {
        b.setAttribute('aria-pressed', String(preset === this.input.preset));
        b.classList.toggle('accent', preset === this.input.preset);
      }
    }
    for (const key of ['water', 'harshness', 'peoples'] as const) {
      const wrap = this.root.querySelector<HTMLElement>(`[data-field="${key}"]`);
      if (!wrap) continue;
      const range = wrap.querySelector<HTMLInputElement>('input[type="range"]');
      const value = wrap.querySelector<HTMLElement>('.value');
      if (range) range.value = String(this.input[key]);
      if (value) value.textContent = `${fmtNum(this.input[key])}${key === 'peoples' ? '' : '%'}`;
    }
    const size = PRESETS[this.input.preset].size;
    this.summary.textContent = t('create.summary', {
      preset: presetLabel(this.input.preset),
      size: fmtNum(size),
      peoples: fmtNum(this.input.peoples),
    });
  }
}
