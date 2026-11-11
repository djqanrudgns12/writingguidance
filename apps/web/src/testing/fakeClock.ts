import type { GateClock } from '../adapters/editor/gate.ts';

/** 시험용 가짜 시계: `advance(ms)`로 시간을 앞당기며 예약된 일을 차례로 실행한다. */
export class FakeClock implements GateClock {
  t = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private seq = 0;
  now = () => this.t;
  setTimer = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  };
  clearTimer = (handle: unknown) => {
    this.timers.delete(handle as number);
  };
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, v]) => v.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
}
