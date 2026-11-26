/**
 * Boot: find the host, build the session, expose a small typed surface for browser tests.
 *
 * Nothing here decides game behaviour. A failure is shown to the player instead of a blank screen.
 */
import { Session } from './session.ts';
import type { HistoryFilter, LayerKind, PlayerCommand } from '../worker/protocol.ts';
import type { CommandResult } from '../worker/client.ts';
import type { EventDetail, HistoryPage, LayerData, WorldView } from '../worker/queries.ts';
import type { PanelTab } from '../ui/panels.ts';
import type { WorldDoc } from '../platform/storage.ts';

export interface WsTestApi {
  readonly ready: boolean;
  state(): {
    day: number;
    savedDay: number;
    settlements: number;
    speed: number;
    world: boolean;
    zoom: number;
    selected: number | null;
    layer: LayerKind;
    panel: PanelTab | null;
  };
  screenOf(id: number): { x: number; y: number } | null;
  probe(): { min: number; max: number; sum: number };
  checksum(): Promise<number>;
  save(): Promise<void>;
  worlds(): WorldDoc[];
  openWorld(id: string): Promise<void>;
  openPanel(tab: PanelTab): void;
  showEvent(id: number): void;
  setLayer(layer: LayerKind): void;
  world(): Promise<WorldView>;
  history(filter?: HistoryFilter): Promise<HistoryPage>;
  event(id: number): Promise<EventDetail | null>;
  layer(layer: LayerKind): Promise<LayerData>;
  command(command: PlayerCommand): Promise<CommandResult>;
  select(id: number): void;
  layerProbe(): Record<string, number | string | boolean | null>;
  manageWorlds(): Promise<void>;
}

declare global {
  interface Window {
    __ws?: WsTestApi;
  }
}

export async function boot(): Promise<void> {
  const host = document.getElementById('world');
  if (!host) throw new Error('missing #world host');

  try {
    const session = await Session.create(host);
    await session.start();
    window.__ws = {
      ready: true,
      state: () => session.debugState(),
      screenOf: (id: number) => session.settlementScreen(id),
      probe: () => session.probe(),
      checksum: () => session.worldChecksum(),
      save: () => session.onSave(),
      worlds: () => session.listWorlds(),
      openWorld: (id: string) => session.onWorldsOpen(id),
      openPanel: (tab: PanelTab) => session.showPanel(tab),
      showEvent: (id: number) => session.openEvent(id),
      setLayer: (layer: LayerKind) => session.onLayer(layer),
      world: () => session.queryWorld(),
      history: (filter: HistoryFilter = {}) => session.queryHistory(filter, 0, 20),
      event: (id: number) => session.queryEvent(id),
      layer: (layer: LayerKind) => session.debugLayer(layer),
      command: (command: PlayerCommand) => session.debugCommand(command),
      select: (id: number) => session.selectSettlement(id),
      layerProbe: () => session.layerProbe(),
      manageWorlds: () => session.manageWorlds(),
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        session.pauseForBackground();
        if (window.__ws?.state().world) void window.__ws.save();
      } else {
        session.resumeFromBackground();
      }
    });

    const boot = document.getElementById('boot');
    boot?.classList.add('hidden');
  } catch (error) {
    const bootEl = document.getElementById('boot');
    if (bootEl) {
      bootEl.innerHTML = `<p class="boot-text">Could not start: ${(error as Error).message}</p>`;
    }
    throw error;
  }
}
