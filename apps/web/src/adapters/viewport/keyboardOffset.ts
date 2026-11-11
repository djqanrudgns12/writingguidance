import type { Unsubscribe } from '../../ports/observable.ts';

/**
 * 가상 키보드가 올라왔을 때 하단 고정 바가 가려지지 않게 `--kb-offset` CSS 변수를 갱신한다(PRD 16.5, PLAN §6.7).
 * 쓰기 화면(S5)과 실기기 한글 시험 화면(`/dev/editor`)이 같은 함수를 쓴다.
 */
export interface ViewportMetrics {
  readonly layoutHeight: number;
  readonly visualHeight: number;
  readonly visualOffsetTop: number;
}

export interface VisualViewportLike {
  readonly height: number;
  readonly offsetTop: number;
  addEventListener(type: 'resize' | 'scroll', listener: () => void): void;
  removeEventListener(type: 'resize' | 'scroll', listener: () => void): void;
}

export interface KeyboardOffsetTarget {
  readonly style: {
    setProperty(property: string, value: string): void;
  };
}

export interface WindowViewportLike {
  readonly innerHeight: number;
  readonly visualViewport?: VisualViewportLike | null | undefined;
  addEventListener(type: 'resize', listener: () => void): void;
  removeEventListener(type: 'resize', listener: () => void): void;
}

export interface KeyboardOffsetOptions {
  readonly win?: WindowViewportLike | undefined;
  readonly target?: KeyboardOffsetTarget | undefined;
  readonly cssVar?: string | undefined;
  readonly onChange?: ((offsetPx: number) => void) | undefined;
}

const DEFAULT_CSS_VAR = '--kb-offset';

/**
 * 레이아웃 뷰포트 하단(`position: fixed; bottom: 0` 기준점)에서 시각 뷰포트 하단까지의 거리를 구한다.
 * iOS Safari 바운스 스크롤 등으로 음수가 나오면 0으로 맞춘다.
 */
export function computeKeyboardOffsetPx(metrics: ViewportMetrics): number {
  const raw = metrics.layoutHeight - (metrics.visualOffsetTop + metrics.visualHeight);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw);
}

/**
 * `visualViewport`의 `resize`·`scroll`과 창 크기 변경을 구독해 `--kb-offset`을 픽셀 단위로 맞춘다.
 * 정리 함수를 부르면 구독을 풀고 변수를 `0px`로 되돌린다.
 */
export function bindKeyboardOffset(options: KeyboardOffsetOptions = {}): Unsubscribe {
  const win = options.win ?? (globalThis.window as WindowViewportLike | undefined);
  const target = options.target ?? (globalThis.document?.documentElement as KeyboardOffsetTarget | undefined);
  const cssVar = options.cssVar ?? DEFAULT_CSS_VAR;

  if (!win || !target) return () => {};

  const vv = win.visualViewport;
  if (!vv) {
    target.style.setProperty(cssVar, '0px');
    options.onChange?.(0);
    return () => {};
  }

  let lastPx: number | null = null;
  let active = true;

  const update = () => {
    if (!active) return;
    const nextPx = computeKeyboardOffsetPx({
      layoutHeight: win.innerHeight,
      visualHeight: vv.height,
      visualOffsetTop: vv.offsetTop,
    });
    if (nextPx === lastPx) return;
    lastPx = nextPx;
    target.style.setProperty(cssVar, `${nextPx}px`);
    options.onChange?.(nextPx);
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  win.addEventListener('resize', update);
  update();

  return () => {
    if (!active) return;
    active = false;
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
    win.removeEventListener('resize', update);
    target.style.setProperty(cssVar, '0px');
  };
}
