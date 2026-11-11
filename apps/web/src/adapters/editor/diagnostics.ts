/**
 * 진단 기록(PRD 13.2, PLAN §10.3·§10.7). 운영자 시험 때만 켜고 정해진 시험 문장으로만 쓴다.
 * 입력 이벤트 순서·시각과 그때의 입력칸 값·선택 위치, 반영 문 판단을 **이 기기에만** 모아 파일로 내려받는다.
 * 서버로 보내지 않는다. 기록은 `tests/fixtures/ime-traces/`의 재생 시험 자료가 된다.
 */
export interface TraceEvent {
  /** 기록 시작부터 ms */
  readonly t: number;
  readonly field: string;
  readonly type: string;
  readonly inputType?: string;
  readonly data?: string | null;
  readonly key?: string;
  readonly isComposing?: boolean;
  readonly value?: string;
  readonly selectionStart?: number | null;
  readonly selectionEnd?: number | null;
  readonly gate?: string;
}

/** 메모리를 지키는 상한. 넘으면 오래된 것부터 버린다. */
const MAX_EVENTS = 20_000;

export interface Diagnostics {
  readonly enabled: boolean;
  record(event: Omit<TraceEvent, 't'>): void;
  events(): readonly TraceEvent[];
  /** 기기 정보와 함께 JSON 문자열(내려받기용) */
  export(meta: Record<string, unknown>): string;
}

export function createDiagnostics(
  enabled: boolean,
  now: () => number = () => performance.now(),
): Diagnostics {
  const started = now();
  const list: TraceEvent[] = [];
  return {
    enabled,
    record(event) {
      if (!enabled) return;
      list.push({ t: Math.round((now() - started) * 10) / 10, ...event });
      if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
    },
    events: () => list,
    export(meta) {
      return JSON.stringify({ v: 1, meta, events: list });
    },
  };
}
