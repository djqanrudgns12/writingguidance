import { describe, expect, it } from 'vitest';
import {
  bindKeyboardOffset,
  computeKeyboardOffsetPx,
  type VisualViewportLike,
  type WindowViewportLike,
} from './keyboardOffset.ts';

function createFakeViewport(initial: { innerHeight: number; height: number; offsetTop?: number }) {
  const vvListeners = {
    resize: new Set<() => void>(),
    scroll: new Set<() => void>(),
  };
  const winResize = new Set<() => void>();

  const state = {
    innerHeight: initial.innerHeight,
    height: initial.height,
    offsetTop: initial.offsetTop ?? 0,
  };

  const vv: VisualViewportLike = {
    get height() {
      return state.height;
    },
    get offsetTop() {
      return state.offsetTop;
    },
    addEventListener(type, fn) {
      vvListeners[type].add(fn);
    },
    removeEventListener(type, fn) {
      vvListeners[type].delete(fn);
    },
  };

  const win: WindowViewportLike = {
    get innerHeight() {
      return state.innerHeight;
    },
    visualViewport: vv,
    addEventListener(_type, fn) {
      winResize.add(fn);
    },
    removeEventListener(_type, fn) {
      winResize.delete(fn);
    },
  };

  const writes: Array<{ prop: string; value: string }> = [];
  const target = {
    style: {
      setProperty(prop: string, value: string) {
        writes.push({ prop, value });
      },
    },
  };

  return {
    state,
    win,
    target,
    writes,
    vvListeners,
    winResize,
    emitVvResize() {
      for (const fn of [...vvListeners.resize]) fn();
    },
    emitVvScroll() {
      for (const fn of [...vvListeners.scroll]) fn();
    },
    emitWinResize() {
      for (const fn of [...winResize]) fn();
    },
  };
}

describe('keyboardOffset', () => {
  it('시각 뷰포트 높이와 offsetTop을 함께 반영하고 오버스크롤 음수는 0으로 맞춘다', () => {
    expect(computeKeyboardOffsetPx({ layoutHeight: 1024, visualHeight: 1024, visualOffsetTop: 0 })).toBe(0);
    expect(computeKeyboardOffsetPx({ layoutHeight: 1024, visualHeight: 680, visualOffsetTop: 0 })).toBe(344);
    expect(computeKeyboardOffsetPx({ layoutHeight: 1024, visualHeight: 680, visualOffsetTop: 120.4 })).toBe(
      224,
    );
    expect(computeKeyboardOffsetPx({ layoutHeight: 800, visualHeight: 800, visualOffsetTop: 32 })).toBe(0);
  });

  it('resize·scroll 때만 바뀐 값을 CSS 변수에 쓰고, 정리하면 0px로 되돌린다', () => {
    const env = createFakeViewport({ innerHeight: 900, height: 900 });
    const observed: number[] = [];
    const unbind = bindKeyboardOffset({
      win: env.win,
      target: env.target,
      onChange: px => observed.push(px),
    });

    expect(env.writes).toEqual([{ prop: '--kb-offset', value: '0px' }]);
    expect(observed).toEqual([0]);

    // 같은 높이에서 이벤트가 한 번 더 와도 중복 쓰기를 하지 않는다.
    env.emitVvResize();
    expect(env.writes).toHaveLength(1);

    // 가상 키보드 열림
    env.state.height = 560;
    env.emitVvResize();
    expect(env.writes.at(-1)).toEqual({ prop: '--kb-offset', value: '340px' });

    // iOS Safari처럼 키보드가 열린 채 시각 뷰포트가 스크롤됨
    env.state.offsetTop = 80;
    env.emitVvScroll();
    expect(env.writes.at(-1)).toEqual({ prop: '--kb-offset', value: '260px' });

    // 화면 회전으로 레이아웃 뷰포트가 바뀜
    env.state.innerHeight = 768;
    env.state.height = 468;
    env.state.offsetTop = 0;
    env.emitWinResize();
    expect(env.writes.at(-1)).toEqual({ prop: '--kb-offset', value: '300px' });
    expect(observed).toEqual([0, 340, 260, 300]);

    unbind();
    expect(env.vvListeners.resize.size).toBe(0);
    expect(env.vvListeners.scroll.size).toBe(0);
    expect(env.winResize.size).toBe(0);
    expect(env.writes.at(-1)).toEqual({ prop: '--kb-offset', value: '0px' });
  });

  it('visualViewport가 없는 환경에서도 0px로 초기화하고 안전하게 끝난다', () => {
    const writes: Array<{ prop: string; value: string }> = [];
    const win: WindowViewportLike = {
      innerHeight: 800,
      visualViewport: null,
      addEventListener() {},
      removeEventListener() {},
    };
    const unbind = bindKeyboardOffset({
      win,
      target: {
        style: {
          setProperty(prop, value) {
            writes.push({ prop, value });
          },
        },
      },
    });
    expect(writes).toEqual([{ prop: '--kb-offset', value: '0px' }]);
    unbind();
  });
});
