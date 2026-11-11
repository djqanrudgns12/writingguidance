import type { Config } from '@geulbang/core/config';
import { isHangulCodePoint } from '@geulbang/core/text';

/**
 * 한글 반영 문(PRD 9.3, PLAN §6.3). **글 하나에 하나**: 제목·본문·메모 칸이 모두 이 조정자에 입력 상태를 알리고,
 * 조정자가 그 글 전체의 원격 반영 시점을 정한다(`Y.applyUpdate`는 칸을 가리지 않고 한꺼번에 바꾸므로).
 *
 * DOM을 모른다. 시각·예약은 주입받아 가짜 시계로 시험한다. 실제 반영(flush)은 `onFlush`가 한다.
 */

export interface FieldState {
  /** 조합 이벤트가 열려 있음(조합 이벤트를 보내는 브라우저 기준. Safari는 보내지 않는다) */
  readonly composing: boolean;
  /** 마지막 input·beforeinput·keydown·compositionstart/update/end 시각 */
  readonly lastActivityAt: number;
  /** 입력 없이 학생이 커서를 옮김(새 입력이 오면 false로 돌아감) */
  readonly caretMovedByUser: boolean;
  readonly focused: boolean;
  /** 커서(또는 선택 시작) 바로 앞 코드 포인트(없으면 undefined) */
  charBeforeCaret(): number | undefined;
  /** 선택 범위가 있을 때 선택 끝 바로 앞 코드 포인트(단일 커서면 undefined) */
  charBeforeSelectionEnd?(): number | undefined;
  /** `IME_STUCK_MS` 동안 활동이 없어 고착으로 판정됐을 때 조합 플래그를 내린다. */
  clearStuckComposing?(): void;
}

export type GateTimings = Pick<
  Config,
  | 'IME_IDLE_MS'
  | 'IME_LONG_IDLE_MS'
  | 'IME_MAX_HOLD_MS'
  | 'IME_RELAXED_IDLE_MS'
  | 'IME_STUCK_MS'
  | 'IME_HOLD_NOTICE_MS'
>;

export interface GateClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const realClock: GateClock = {
  now: () => performance.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** 왜 지금 반영하지 않는가(진단 기록·시험용). */
export type GateReason = 'open' | 'composing' | 'idle' | 'relaxed-idle' | 'syllable';

export interface GateDecision {
  readonly open: boolean;
  readonly reason: GateReason;
  /** 닫혀 있으면 다시 볼 가장 이른 시각(없으면 다음 입력 때) */
  readonly recheckAt: number | null;
}

/** PLAN §6.3 `canFlush`. 순수 함수. */
export function decide(
  fields: readonly FieldState[],
  holdSince: number | null,
  now: number,
  t: GateTimings,
): GateDecision {
  // 3·7번: 조합이 열려 있으면 기다린다. 단 5초 동안 활동이 없으면 끝난 것으로 본다.
  let stuckAt: number | null = null;
  for (const f of fields) {
    if (f.composing && now - f.lastActivityAt < t.IME_STUCK_MS) {
      const at = f.lastActivityAt + t.IME_STUCK_MS;
      stuckAt = stuckAt === null ? at : Math.min(stuckAt, at);
    }
  }
  if (stuckAt !== null) return { open: false, reason: 'composing', recheckAt: stuckAt };

  const active = fields.find(f => f.focused);
  if (!active) return { open: true, reason: 'open', recheckAt: null };
  const idle = now - active.lastActivityAt;

  // 6번: 보류가 너무 길면 음절 경계를 빼고 짧은 멈춤만 본다.
  if (holdSince !== null && now - holdSince >= t.IME_MAX_HOLD_MS) {
    return idle >= t.IME_RELAXED_IDLE_MS
      ? { open: true, reason: 'open', recheckAt: null }
      : { open: false, reason: 'relaxed-idle', recheckAt: active.lastActivityAt + t.IME_RELAXED_IDLE_MS };
  }

  // 4번: 마지막 입력 뒤 멈춤
  if (idle < t.IME_IDLE_MS) {
    const relaxAt = holdSince === null ? Infinity : holdSince + t.IME_MAX_HOLD_MS;
    return {
      open: false,
      reason: 'idle',
      recheckAt: Math.min(active.lastActivityAt + t.IME_IDLE_MS, relaxAt),
    };
  }

  // 5번: 음절 경계 (선택 범위가 있으면 시작·끝 앞 글자 중 하나라도 한글일 때 음절 경계가 아님)
  const before = active.charBeforeCaret();
  const beforeEnd = active.charBeforeSelectionEnd?.();
  const hasHangulBefore =
    (before !== undefined && isHangulCodePoint(before)) ||
    (beforeEnd !== undefined && isHangulCodePoint(beforeEnd));
  const boundary =
    !hasHangulBefore || active.caretMovedByUser || !active.focused || idle >= t.IME_LONG_IDLE_MS;
  if (boundary) return { open: true, reason: 'open', recheckAt: null };
  const relaxAt = holdSince === null ? Infinity : holdSince + t.IME_MAX_HOLD_MS;
  return {
    open: false,
    reason: 'syllable',
    recheckAt: Math.min(active.lastActivityAt + t.IME_LONG_IDLE_MS, relaxAt),
  };
}

export interface GateEvents {
  /** 문이 열려 반영해도 될 때(한 번의 동기 작업으로 반영해야 한다) */
  onFlush(): void;
  /** 보류가 `IME_HOLD_NOTICE_MS`를 넘김/풀림: "선생님이 고친 곳은 잠시 뒤 보여요" */
  onHoldChange(holding: boolean): void;
  /** 진단 기록용 */
  onDecision?(decision: GateDecision): void;
}

/**
 * 반영 문 조정자. 원격 변경이 오면 `markPending()`, 입력칸에 무슨 일이 생기면 `poke()`.
 * 열렸다고 판단되면 `onFlush`를 부른다. 앱 변경·읽기 전용·되돌리기는 `whenOpen`으로 반영 문 열림을 기다린다.
 */
export class Gate {
  private readonly fields = new Set<FieldState>();
  private readonly clock: GateClock;
  private readonly timings: GateTimings;
  private readonly events: GateEvents;
  private pending = false;
  private holdSince: number | null = null;
  private waiterHoldSince: number | null = null;
  private holding = false;
  private timer: unknown = null;
  private noticeTimer: unknown = null;
  private idleWaiters: Array<() => void> = [];
  private openWaiters: Array<() => void> = [];
  private destroyed = false;

  constructor(timings: GateTimings, events: GateEvents, clock: GateClock = realClock) {
    this.timings = timings;
    this.events = events;
    this.clock = clock;
  }

  addField(field: FieldState): () => void {
    this.fields.add(field);
    return () => {
      this.fields.delete(field);
      this.poke();
    };
  }

  get isPending(): boolean {
    return this.pending;
  }

  markPending(): void {
    if (this.destroyed) return;
    if (!this.pending) {
      this.pending = true;
      this.holdSince = this.clock.now();
      this.noticeTimer = this.clock.setTimer(() => this.setHolding(true), this.timings.IME_HOLD_NOTICE_MS);
    }
    this.check();
  }

  /** 입력·키·조합·커서·초점 사건이 생겼다. 판단을 다시 한다. */
  poke(): void {
    if (this.destroyed) return;
    if (this.pending || this.idleWaiters.length > 0 || this.openWaiters.length > 0) this.check();
  }

  /** 지금 이 순간 반영 문이 열려 있는가(고착된 조합 플래그도 함께 정리한다). */
  isOpenNow(): boolean {
    const now = this.clock.now();
    this.releaseStuckComposing(now);
    return decide([...this.fields], this.effectiveHoldSince(), now, this.timings).open;
  }

  /** 반영 문 조건(조합 아님 + 멈춤 + 음절 경계, 10초 완화 포함)이 열릴 때까지 기다린다. */
  whenOpen(): Promise<void> {
    if (this.destroyed || this.isOpenNow()) return Promise.resolve();
    return new Promise(resolve => {
      if (this.waiterHoldSince === null) this.waiterHoldSince = this.clock.now();
      this.openWaiters.push(resolve);
      this.check();
    });
  }

  /** 조합 중이 아니고 마지막 입력 뒤 `IME_IDLE_MS`가 지날 때까지 기다린다. */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise(resolve => {
      this.idleWaiters.push(resolve);
      this.check();
    });
  }

  /** 반영을 마쳤다(onFlush 안에서 부른다). */
  flushed(): void {
    this.pending = false;
    this.holdSince = null;
    if (this.noticeTimer !== null) this.clock.clearTimer(this.noticeTimer);
    this.noticeTimer = null;
    this.setHolding(false);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    if (this.noticeTimer !== null) this.clock.clearTimer(this.noticeTimer);
    this.idleWaiters = [];
    this.openWaiters = [];
    this.waiterHoldSince = null;
  }

  private effectiveHoldSince(): number | null {
    if (this.holdSince !== null && this.waiterHoldSince !== null) {
      return Math.min(this.holdSince, this.waiterHoldSince);
    }
    return this.holdSince ?? this.waiterHoldSince;
  }

  private releaseStuckComposing(now: number): void {
    for (const f of this.fields) {
      if (f.composing && now - f.lastActivityAt >= this.timings.IME_STUCK_MS) {
        f.clearStuckComposing?.();
      }
    }
  }

  private isIdle(): boolean {
    const now = this.clock.now();
    this.releaseStuckComposing(now);
    for (const f of this.fields) {
      if (f.composing && now - f.lastActivityAt < this.timings.IME_STUCK_MS) return false;
      if (f.focused && now - f.lastActivityAt < this.timings.IME_IDLE_MS) return false;
    }
    return true;
  }

  private nextIdleAt(): number {
    let at = this.clock.now();
    for (const f of this.fields) {
      if (f.composing) at = Math.max(at, f.lastActivityAt + this.timings.IME_STUCK_MS);
      if (f.focused) at = Math.max(at, f.lastActivityAt + this.timings.IME_IDLE_MS);
    }
    return at;
  }

  private check(): void {
    if (this.timer !== null) {
      this.clock.clearTimer(this.timer);
      this.timer = null;
    }
    const now = this.clock.now();
    this.releaseStuckComposing(now);
    let recheckAt: number | null = null;

    if (this.idleWaiters.length > 0) {
      if (this.isIdle()) {
        const ready = this.idleWaiters;
        this.idleWaiters = [];
        for (const resolve of ready) resolve();
      } else {
        recheckAt = this.nextIdleAt();
      }
    }

    if (this.pending || this.openWaiters.length > 0) {
      const decision = decide([...this.fields], this.effectiveHoldSince(), now, this.timings);
      if (this.pending) this.events.onDecision?.(decision);
      if (decision.open) {
        if (this.pending) this.events.onFlush();
        if (this.openWaiters.length > 0) {
          const ready = this.openWaiters;
          this.openWaiters = [];
          for (const resolve of ready) resolve();
          // 깨어난 마이크로태스크들이 같은 시점에 `isOpenNow()`를 재확인한 뒤 대기 시각을 비운다.
          queueMicrotask(() => {
            if (this.openWaiters.length === 0) this.waiterHoldSince = null;
          });
        }
      } else if (decision.recheckAt !== null) {
        recheckAt = recheckAt === null ? decision.recheckAt : Math.min(recheckAt, decision.recheckAt);
      }
    }

    if (recheckAt !== null) {
      this.timer = this.clock.setTimer(
        () => {
          this.timer = null;
          this.check();
        },
        Math.max(0, recheckAt - now),
      );
    }
  }

  private setHolding(holding: boolean): void {
    if (this.holding === holding) return;
    this.holding = holding;
    this.events.onHoldChange(holding);
  }
}
