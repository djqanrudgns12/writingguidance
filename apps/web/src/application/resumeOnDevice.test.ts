import { describe, expect, it } from 'vitest';
import { fakeApi, fakeDeps, PARTICIPANT_ID, roomInfo } from '../app/student/testFakes.ts';
import type { ResumeRequestInput } from '../ports/api.ts';
import { pendingResume, requestResume, waitForDecision } from './resumeOnDevice.ts';

const REQUEST_ID = '5f0c2b7a-9d3e-4a61-8b24-7e1f0a9c3d52';
const KEY = 'resume.pending';

describe('이어 쓰기 요청을 보내기 전에 기기에 적는다(검토 B05)', () => {
  it('서버가 요청을 만든 뒤 응답을 잃고 다시 열어도, 같은 명령 ID·토큰으로 다시 보내 서버 요청과 기기 토큰이 맞는다', async () => {
    const posts: ResumeRequestInput[] = [];
    let serverHash: string | null = null;
    const api = fakeApi({
      resumeRequest: async (_roomId, input) => {
        posts.push(input);
        // 서버는 같은 참가자·기기의 대기 요청을 그대로 돌려준다(토큰 해시는 처음 것).
        serverHash ??= input.deviceTokenHash;
        if (posts.length === 1) throw { code: 'E_SERVER_DOWN', message: '', retryable: true };
        return { requestId: REQUEST_ID };
      },
    });
    const { deps } = fakeDeps({ api });
    const room = roomInfo();

    await expect(
      requestResume(deps, room, '482913', 'whale', 'cmd-first', 'token-first'),
    ).rejects.toMatchObject({ code: 'E_SERVER_DOWN' });
    // 새로고침: 화면은 새 명령 ID·토큰을 만든다.
    const pending = await requestResume(
      deps,
      room,
      '482913',
      'whale',
      'cmd-after-reload',
      'token-after-reload',
    );

    expect(posts).toHaveLength(2);
    expect(posts[1]?.commandId).toBe(posts[0]?.commandId);
    expect(posts[1]?.deviceTokenHash).toBe(posts[0]?.deviceTokenHash);
    expect(await deps.sha256Hex(pending.deviceToken)).toBe(serverHash);
    expect(pending.requestId).toBe(REQUEST_ID);
    expect((await pendingResume(deps))?.requestId).toBe(REQUEST_ID);
  });
});

describe('허용된 토큰을 기억한 뒤에 대기를 지운다(검토 B06)', () => {
  it('허용 직후 참가자 확인이 실패해도 대기가 남아 다시 하기로 이어 가고, 기억한 뒤에야 지운다', async () => {
    const api = fakeApi({
      resumeRequest: async () => ({ requestId: REQUEST_ID }),
      resumeStatus: async () => ({ status: 'APPROVED' }),
    });
    const { deps, kv } = fakeDeps({ api });
    const room = roomInfo();
    const pending = await requestResume(deps, room, '482913', 'whale', 'cmd-1', 'token-1');

    const failing = () => Promise.reject({ code: 'E_SERVER_DOWN', retryable: true });
    await expect(
      waitForDecision(deps, room, pending, failing, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'E_SERVER_DOWN' });
    expect(kv.map.has(KEY)).toBe(true);
    expect(await deps.memory.student(room.roomId, Date.now())).toBeNull();

    // 다시 하기: 같은 대기로 다시 조회 → 허용 → 기억 → 대기 지움.
    const again = await pendingResume(deps);
    expect(again?.deviceToken).toBe('token-1');
    const entry = await waitForDecision(
      deps,
      room,
      again!,
      async () => PARTICIPANT_ID,
      new AbortController().signal,
    );
    expect(entry?.deviceToken).toBe('token-1');
    expect((await deps.memory.student(room.roomId, Date.now()))?.deviceToken).toBe('token-1');
    expect(kv.map.has(KEY)).toBe(false);
  });

  it('허용을 받은 뒤 화면을 떠났으면(취소 신호) 늦게 기억하지 않고 대기를 남긴다', async () => {
    const api = fakeApi({
      resumeRequest: async () => ({ requestId: REQUEST_ID }),
      resumeStatus: async () => ({ status: 'APPROVED' }),
    });
    const { deps, kv } = fakeDeps({ api });
    const room = roomInfo();
    const pending = await requestResume(deps, room, '482913', 'whale', 'cmd-1', 'token-1');
    const controller = new AbortController();
    const entry = await waitForDecision(
      deps,
      room,
      pending,
      async () => {
        controller.abort();
        return PARTICIPANT_ID;
      },
      controller.signal,
    );
    expect(entry).toBeNull();
    expect(await deps.memory.student(room.roomId, Date.now())).toBeNull();
    expect(kv.map.has(KEY)).toBe(true);
  });
});
