import { ko } from '@geulbang/core/copy';
import { afterEach, describe, expect, it } from 'vitest';
import { CODE, fakeApi, fakeDeps, fakeRealtime, hello, rememberedEntry, roomInfo } from './testFakes.ts';
import { buttonByText, click, renderStudent, waitFor, type Rendered } from './testRender.tsx';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

/**
 * 검토 B08(P5-5b 2차): 서버 문제(`E_SERVER_DOWN`)로 멈춘 수업방 채널에서 `다시 하기`를 누르면 같은 실패 채널을
 * 다시 쓰지 말고 새 연결로 다시 인증해야 한다. 영구 자격 오류(`E_AUTH`)는 그대로 둔다(기억을 지우는 흐름).
 */

let view: Rendered | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

const screen = () => document.querySelector<HTMLElement>('[data-screen]')?.dataset['screen'] ?? null;

describe('수업방 흐름: 서버 문제로 멈춘 연결 다시 하기(B08)', () => {
  it('`E_SERVER_DOWN`으로 멈춘 뒤 `다시 하기`를 누르면 새 채널로 다시 인증하고 이어 간다', async () => {
    const realtime = fakeRealtime();
    let opened = 0;
    realtime.onChannel = ch => {
      opened++;
      if (opened === 1) {
        // 인증 훅 일시 오류가 상한까지 이어져 멈춘 채널(진짜 채널처럼 연결 중에서 바뀐다)
        setTimeout(() => {
          ch.failure.set('E_SERVER_DOWN');
          ch.state.set('failed');
        }, 0);
        return;
      }
      setTimeout(() => {
        ch.hello.set(hello());
        ch.state.set('ready');
      }, 0);
    };
    const api = fakeApi({ roomByCode: async () => roomInfo() });
    const { deps } = fakeDeps({ api, realtime });
    // 마지막 글이 없으면 오프라인 쓰기로 넘어가지 않고 다시 하기를 보인다.
    await deps.memory.rememberStudent(rememberedEntry({ lastDocId: null }), deps.config.RECENT_ROOMS_MAX);
    view = renderStudent(deps, `/${CODE}`);

    const retry = await waitFor(() => buttonByText(ko.common.retry));
    expect(document.body.textContent).toContain(ko.errors.E_SERVER_DOWN);
    click(retry);

    await waitFor(() => screen() === 'S5');
    expect(realtime.channels).toHaveLength(2);
  });

  it('영구 자격 오류(`E_AUTH`)로 실패한 채널은 같은 토큰으로 다시 열지 않는다', async () => {
    const realtime = fakeRealtime();
    realtime.onChannel = ch => {
      setTimeout(() => {
        ch.failure.set('E_AUTH');
        ch.state.set('failed');
      }, 0);
    };
    const api = fakeApi({ roomByCode: async () => roomInfo() });
    const { deps } = fakeDeps({ api, realtime });
    await deps.memory.rememberStudent(rememberedEntry(), deps.config.RECENT_ROOMS_MAX);
    view = renderStudent(deps, `/${CODE}`);
    await waitFor(() => screen() === 'S1');
    expect(realtime.channels).toHaveLength(1);
  });
});
