/** Owns the creation panel instance and its language-sensitive rebuild. */
import type { CreateInput } from './shell.ts';
import type { ShellHandlers } from './shell.ts';
import { CreationPanel } from './creation.ts';
import { defaultCreateInput } from './creation.ts';
import { lang } from './i18n.ts';

export class CreationHost {
  private readonly host: HTMLDivElement;
  private readonly handlers: Pick<ShellHandlers, 'onCreate' | 'onPreviewRequest'>;
  private readonly onBack: () => void;
  private panel: CreationPanel | null = null;
  private builtFor = '';
  private last = defaultCreateInput();

  constructor(host: HTMLDivElement, handlers: Pick<ShellHandlers, 'onCreate' | 'onPreviewRequest'>, onBack: () => void) {
    this.host = host;
    this.handlers = handlers;
    this.onBack = onBack;
  }

  show(prefill?: Partial<CreateInput>): void {
    this.ensure().show(prefill);
  }

  hide(): void {
    this.panel?.hide();
  }

  hidePanelOnly(): void {
    this.panel?.hide();
  }

  drawPreview(width: number, height: number, biome: Uint8Array, elevation: Int16Array): void {
    this.panel?.drawPreview(width, height, biome, elevation);
  }

  showPreview(): void {
    this.panel?.showPreview();
  }

  setProgress(pct: number, busy = true): void {
    this.panel?.setProgress(pct, busy);
  }

  get currentInput(): CreateInput {
    return this.panel?.currentInput ?? this.last;
  }

  private ensure(): CreationPanel {
    const current = lang();
    if (!this.panel || this.builtFor !== current) {
      this.panel?.hide();
      this.host.replaceChildren();
      this.builtFor = current;
      this.panel = new CreationPanel(
        {
          onCreate: (input) => {
            this.last = input;
            this.handlers.onCreate(input);
          },
          onPreviewRequest: (input) => this.handlers.onPreviewRequest(input),
          onBack: () => this.onBack(),
        },
        this.last,
      );
      this.host.append(this.panel.root);
    }
    return this.panel;
  }
}
