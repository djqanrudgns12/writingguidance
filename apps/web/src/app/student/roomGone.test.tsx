import { ko } from '@geulbang/core/copy';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomInfo } from '../../application/joinRoom.ts';
import {
  CODE,
  DOC_ID,
  fakeApi,
  fakeDeps,
  fakeRealtime,
  hello,
  PARTICIPANT_ID,
  roomInfo,
  type FakeRealtime,
} from './testFakes.ts';
import { buttonByText, click, renderStudent, waitFor, type Rendered } from './testRender.tsx';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

/**
 * PRD 16.6 경합: 쓰는 중에 수업방이 만료되면 `room.status`보다 `E_AUTH`가 먼저 올 수 있다.
 * 그때 흐름 묶음이 S1에서 조회해 둔 수업방 정보를 다시 쓰면 지워진 방의 카드(동의 체크된 채)가 보인다.
 * `E_AUTH`는 방 조회로 확인한다: 끝난 방이면 닫힌 문 + 기기 사본 정리, 아니면 토큰만 잊고 S1을 새로 조회한다.
 */

let view: Rendered | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

const screen = () => document.querySelector<HTMLElement>('[data-screen]')?.dataset['screen'] ?? null;
const consentBox = () => document.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]');

function realtimeWithNewDoc(): FakeRealtime {
  const realtime = fakeRealtime();
  realtime.onChannel = ch => {
    ch.hello.set(hello({ docs: [] }));
    ch.state.set('ready');
    ch.handlers.set('doc.create', () => ({ docId: DOC_ID }));
  };
  return realtime;
}

/** S1 카드(조회 1번) → 동의 체크 → 별명 → 입장 → 글 종류 → 쓰기(S5)까지 처음 입장으로 간다. */
async function enterAndWrite(roomByCode: () => Promise<RoomInfo>) {
  const realtime = realtimeWithNewDoc();
  const api = fakeApi({
    roomByCode,
    join: async () => ({ participantId: PARTICIPANT_ID, nickname: 'whale' }),
  });
  const { deps } = fakeDeps({ api, realtime });
  const purged: string[] = [];
  Object.assign(deps.localStore, {
    purgeRoom: async (roomId: string) => {
      purged.push(roomId);
      return 0;
    },
  });
  view = renderStudent(deps, `/${CODE}`);
  await waitFor(() => screen() === 'S1');
  click(consentBox()!);
  await waitFor(() => !buttonByText(ko.student.consentStartAction)!.disabled);
  click(buttonByText(ko.student.consentStartAction)!);
  await waitFor(() => screen() === 'S3');
  const input = document.querySelector<HTMLInputElement>('input')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'whale');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  click(buttonByText(ko.common.next)!);
  await waitFor(() => screen() === 'S4');
  click(buttonByText(ko.student.genreNewsLabel)!);
  await waitFor(() => screen() === 'S5', 5000);
  const channel = realtime.channels[0]!;
  return { deps, api, channel, purged };
}

/** 다시 연결하다 토큰이 무효로 판정된 것처럼 수업방 채널을 실패로 바꾼다. */
function failAuth(channel: { failure: { set(v: 'E_AUTH'): void }; state: { set(v: 'failed'): void } }) {
  act(() => {
    channel.failure.set('E_AUTH');
    channel.state.set('failed');
  });
}

describe('쓰는 중 `E_AUTH`(PRD 16.6)', () => {
  it('방 조회가 없음(만료·삭제)이면 지워진 방의 카드 대신 닫힌 문을 보이고 그 방 기기 사본을 지운다', async () => {
    let lookups = 0;
    const { deps, api, channel, purged } = await enterAndWrite(async () => {
      lookups++;
      if (lookups === 1) return roomInfo();
      throw { code: 'E_ROOM_NOT_FOUND', message: '', retryable: false };
    });
    failAuth(channel);

    await waitFor(() => screen() === 'closed');
    expect(document.body.textContent).toContain(ko.common.expiredRoomTitle);
    expect(document.querySelector('[data-screen="S1"]')).toBeNull();
    expect(view!.router.state.location.pathname).toBe(`/${CODE}`);
    await waitFor(() => purged.length > 0);
    expect(purged).toContain(roomInfo().roomId);
    expect(await deps.memory.student(roomInfo().roomId, Date.now())).toBeNull();
    // 만료를 확인한 뒤 S1이 다시 조회하지 않는다(카드 조회 1 + 확인 조회 1).
    expect(api.calls.filter(c => c.name === 'roomByCode')).toHaveLength(2);
  });

  it('방 조회가 만료 상태로 오면 닫힌 문', async () => {
    let lookups = 0;
    const { channel } = await enterAndWrite(async () =>
      ++lookups === 1 ? roomInfo() : roomInfo({ status: 'EXPIRED' }),
    );
    failAuth(channel);
    await waitFor(() => screen() === 'closed');
    expect(document.body.textContent).toContain(ko.common.expiredRoomTitle);
  });

  it('방이 살아 있으면 토큰만 잊고 S1을 새로 조회해 동의 체크가 풀린 카드로 보인다', async () => {
    let lookups = 0;
    const { deps, api, channel, purged } = await enterAndWrite(async () =>
      roomInfo({ className: `class-${++lookups}` }),
    );
    failAuth(channel);

    // 확인 조회(2번째) 뒤 S1이 다시 조회한(3번째) 정보가 보인다: 앞서 들고 있던 정보를 쓰지 않는다.
    await waitFor(() => screen() === 'S1' && document.body.textContent?.includes('class-3'));
    expect(api.calls.filter(c => c.name === 'roomByCode')).toHaveLength(3);
    expect(buttonByText(ko.student.consentStartAction)!.disabled).toBe(true);
    expect(await deps.memory.student(roomInfo().roomId, Date.now())).toBeNull();
    expect(purged).toEqual([]);
  });
});
