/** Reusable render-delta buffers. The main thread returns them through `release`. */
import { CAPACITY } from '../sim/state/worldState.ts';

interface MirrorSet {
  id: Uint16Array;
  pop: Int32Array;
  civ: Uint8Array;
  tier: Uint8Array;
  state: Uint8Array;
}

export class MirrorPool {
  private readonly free: MirrorSet[] = [];
  private readonly cap = CAPACITY.settlements;
  private inFlight = 0;

  acquire(): MirrorSet | null {
    const reused = this.free.pop();
    if (reused) {
      this.inFlight++;
      return reused;
    }
    if (this.inFlight >= 4) return null;
    this.inFlight++;
    return {
      id: new Uint16Array(this.cap),
      pop: new Int32Array(this.cap),
      civ: new Uint8Array(this.cap),
      tier: new Uint8Array(this.cap),
      state: new Uint8Array(this.cap),
    };
  }

  release(buffers: readonly ArrayBuffer[]): void {
    if (buffers.length !== 5) return;
    const [idBuf, popBuf, civBuf, tierBuf, stateBuf] = buffers;
    if (!idBuf || !popBuf || !civBuf || !tierBuf || !stateBuf) return;
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.free.push({
      id: new Uint16Array(idBuf),
      pop: new Int32Array(popBuf),
      civ: new Uint8Array(civBuf),
      tier: new Uint8Array(tierBuf),
      state: new Uint8Array(stateBuf),
    });
  }
}
