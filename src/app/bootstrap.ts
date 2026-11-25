/**
 * Boot: find the host element, build the session, and expose a tiny surface for smoke tests.
 *
 * Nothing here decides game behaviour; failures are surfaced to the player instead of leaving a
 * blank screen.
 */
import { Session } from './session.ts';

export interface WsTestApi {
  readonly ready: boolean;
  state(): { day: number; settlements: number; speed: number; world: boolean; zoom: number };
  screenOf(id: number): { x: number; y: number } | null;
  probe(): { min: number; max: number; sum: number };
  save(): Promise<void>;
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
      save: () => session.onSave(),
    };

    // Save when the app is backgrounded: the WebView can be killed without another chance.
    // Hidden = pause + save; visible = restore the previous speed. The simulation never runs
    // against a throttled background timer.
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
