import { ko } from '@geulbang/core/copy';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODE,
  DOC_ID,
  fakeApi,
  fakeDeps,
  fakeRealtime,
  hello,
  PARTICIPANT_ID,
  rememberedEntry,
  roomInfo,
} from './testFakes.ts';
import { buttonByText, click, renderStudent, waitFor, type Rendered } from './testRender.tsx';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

let view: Rendered | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

const screen = () => document.querySelector<HTMLElement>('[data-screen]')?.dataset['screen'] ?? null;

describe('S0 홈', () => {
  it('기억한 수업방이 있으면 이어 쓰기 카드의 `이어 쓰기`가 유일한 주요 버튼이고, 누르면 마지막 글로 간다', async () => {
    const { deps } = fakeDeps();
    await deps.memory.rememberStudent(rememberedEntry(), deps.config.RECENT_ROOMS_MAX);
    view = renderStudent(deps, '/');
    const primary = await waitFor(() => {
      const list = [...document.querySelectorAll<HTMLButtonElement>('button[data-variant="primary"]')];
      return list.length === 1 && list[0]?.textContent?.includes(ko.student.homeResumeAction) ? list : null;
    });
    expect(buttonByText(ko.student.homeStartWrite)?.dataset['variant']).toBe('secondary');
    click(primary[0]!);
    expect(view.router.state.location.pathname).toBe(`/${CODE}/write/${DOC_ID}`);
  });

  it('코드 6자리를 누르면 바로 조회하고 수업 카드(S1)로 간다', async () => {
    const api = fakeApi({ roomByCode: async () => roomInfo({ className: 'class-z' }) });
    const { deps } = fakeDeps({ api });
    view = renderStudent(deps, '/');
    click(buttonByText(ko.student.homeStartWrite)!);
    for (const d of CODE) {
      const key = await waitFor(() => document.querySelector(`button[data-digit="${d}"]`));
      click(key);
    }
    await waitFor(() => screen() === 'S1');
    expect(view.router.state.location.pathname).toBe(`/${CODE}`);
    expect(api.calls.filter(c => c.name === 'roomByCode')).toHaveLength(1);
    expect(document.body.textContent).toContain('class-z');
  });

  it('없는 코드면 시트 안에 "코드를 다시 확인해 주세요."', async () => {
    const api = fakeApi({
      roomByCode: () => Promise.reject({ code: 'E_ROOM_NOT_FOUND', message: '', retryable: false }),
    });
    const { deps } = fakeDeps({ api });
    view = renderStudent(deps, '/');
    click(buttonByText(ko.student.homeStartWrite)!);
    for (const d of CODE) click(await waitFor(() => document.querySelector(`button[data-digit="${d}"]`)));
    await waitFor(() => document.body.textContent?.includes(ko.errors.E_ROOM_NOT_FOUND));
    expect(view.router.state.location.pathname).toBe('/');
  });
});

describe('S1 → S3 → S4', () => {
  it('`알겠어요`를 체크해야 `시작하기`가 켜지고, 누르면 별명 화면(S3)', async () => {
    const api = fakeApi({ roomByCode: async () => roomInfo() });
    const { deps } = fakeDeps({ api });
    view = renderStudent(deps, `/${CODE}`);
    await waitFor(() => screen() === 'S1');
    const start = buttonByText(ko.student.consentStartAction)!;
    expect(start.disabled).toBe(true);
    const check = document.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]')!;
    click(check);
    await waitFor(() => !buttonByText(ko.student.consentStartAction)!.disabled);
    click(buttonByText(ko.student.consentStartAction)!);
    await waitFor(() => screen() === 'S3');
    expect(view.router.state.location.pathname).toBe(`/${CODE}/name`);
  });

  it('별명이 겹치면 `내가 쓰던 거예요` → 이어 쓰기 요청 → 기다림(S6)', async () => {
    const realtime = fakeRealtime();
    const api = fakeApi({
      roomByCode: async () => roomInfo(),
      join: () => Promise.reject({ code: 'E_NICK_TAKEN', message: '', retryable: false }),
      resumeRequest: async () => ({ requestId: '5f0c2b7a-9d3e-4a61-8b24-7e1f0a9c3d52' }),
      // 결정이 나기 전까지는 계속 기다림
      resumeStatus: (_r, _q, _t, _w, signal) =>
        new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => reject({ code: 'E_OFFLINE', retryable: true }));
        }),
    });
    const { deps } = fakeDeps({ api, realtime });
    view = renderStudent(deps, `/${CODE}`);
    await waitFor(() => screen() === 'S1');
    click(document.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]')!);
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
    const mine = await waitFor(() => buttonByText(ko.student.nicknameMineAction));
    expect(document.body.textContent).toContain(ko.student.nicknameTakenGuide);
    click(mine);
    await waitFor(() => screen() === 'S6');
    expect(view.router.state.location.pathname).toBe(`/${CODE}/wait`);
    expect(document.body.textContent).toContain(ko.student.resumeWaitTitle);
    const req = api.calls.find(c => c.name === 'resumeRequest');
    expect((req?.args[1] as { nickname: string }).nickname).toBe('whale');
  });

  it('처음 입장: 별명 → 입장 → 글 종류(S4) → 바로 쓰기 타일 → 새 글 → 쓰기(S5)', async () => {
    const realtime = fakeRealtime();
    realtime.onChannel = ch => {
      ch.hello.set(hello({ docs: [] }));
      ch.state.set('ready');
      ch.handlers.set('doc.create', () => ({ docId: DOC_ID }));
    };
    const api = fakeApi({
      roomByCode: async () => roomInfo(),
      join: async () => ({ participantId: PARTICIPANT_ID, nickname: 'whale' }),
    });
    const { deps } = fakeDeps({ api, realtime });
    view = renderStudent(deps, `/${CODE}`);
    await waitFor(() => screen() === 'S1');
    click(document.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]')!);
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
    // 기사: 바로 쓰기 타일
    click(buttonByText(ko.student.genreNewsLabel)!);
    await waitFor(() => screen() === 'S5', 5000);
    expect(view.router.state.location.pathname).toBe(`/${CODE}/write/${DOC_ID}`);
    const create = realtime.channels[0]?.sent.find(s => s.name === 'doc.create');
    expect(create?.args).toEqual({ genre: 'news', subtype: 'newspaper' });
    expect((await deps.memory.student(roomInfo().roomId, Date.now()))?.lastDocId).toBe(DOC_ID);
  });
});

describe('다시 들어오기(③)', () => {
  it('기기에 살아 있는 기억이 있으면 수업 카드 없이 바로 마지막 글(S5)', async () => {
    const realtime = fakeRealtime();
    realtime.onChannel = ch => {
      ch.hello.set(hello());
      ch.state.set('ready');
    };
    const api = fakeApi({ roomByCode: async () => roomInfo() });
    const { deps } = fakeDeps({ api, realtime });
    await deps.memory.rememberStudent(rememberedEntry(), deps.config.RECENT_ROOMS_MAX);
    view = renderStudent(deps, `/${CODE}`);
    await waitFor(() => screen() === 'S5', 5000);
    expect(view.router.state.location.pathname).toBe(`/${CODE}/write/${DOC_ID}`);
    expect(document.querySelector('[data-screen="S1"]')).toBeNull();
  });

  it('토큰이 무효(`E_AUTH`)면 그 기억을 지우고 수업 카드(S1)', async () => {
    const realtime = fakeRealtime();
    // 진짜 채널처럼 연결 중에서 실패로 바뀐다(`waitHello`는 바뀜을 듣는다).
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
    expect(await deps.memory.student(roomInfo().roomId, Date.now())).toBeNull();
  });

  it('토큰이 무효인데 방 조회도 없으면(삭제됨) 기억과 함께 그 방 기기 사본·이어 쓰기 대기를 지운다(검토 B04)', async () => {
    const realtime = fakeRealtime();
    realtime.onChannel = ch => {
      setTimeout(() => {
        ch.failure.set('E_AUTH');
        ch.state.set('failed');
      }, 0);
    };
    const api = fakeApi({
      roomByCode: () => Promise.reject({ code: 'E_ROOM_NOT_FOUND', message: '', retryable: false }),
    });
    const { deps, kv } = fakeDeps({ api, realtime });
    const purged: { roomId: string; docIds: readonly string[] }[] = [];
    Object.assign(deps.localStore, {
      purgeRoom: async (roomId: string, docIds: readonly string[] = []) => {
        purged.push({ roomId, docIds });
        return 0;
      },
    });
    await deps.memory.rememberStudent(rememberedEntry(), deps.config.RECENT_ROOMS_MAX);
    await kv.set('resume.pending', {
      roomId: roomInfo().roomId,
      requestId: '5f0c2b7a-9d3e-4a61-8b24-7e1f0a9c3d52',
      commandId: '5f0c2b7a-9d3e-4a61-8b24-7e1f0a9c3d53',
      deviceToken: 'resume-token',
      nickname: 'nick',
      entryCode: CODE,
      expiresAt: roomInfo().expiresAt,
    });
    view = renderStudent(deps, `/${CODE}`);
    await waitFor(() => screen() === 'closed');
    await waitFor(() => purged.length > 0);
    expect(purged[0]).toEqual({ roomId: roomInfo().roomId, docIds: [DOC_ID] });
    expect(await deps.memory.student(roomInfo().roomId, Date.now())).toBeNull();
    expect(kv.map.has('resume.pending')).toBe(false);
  });

  it('토큰만 무효이고 방은 살아 있으면 기억만 지우고 사본은 만료 때까지 둔다', async () => {
    const realtime = fakeRealtime();
    realtime.onChannel = ch => {
      setTimeout(() => {
        ch.failure.set('E_AUTH');
        ch.state.set('failed');
      }, 0);
    };
    const api = fakeApi({ roomByCode: async () => roomInfo() });
    const { deps } = fakeDeps({ api, realtime });
    const purged: string[] = [];
    Object.assign(deps.localStore, {
      purgeRoom: async (roomId: string) => {
        purged.push(roomId);
        return 0;
      },
    });
    await deps.memory.rememberStudent(rememberedEntry(), deps.config.RECENT_ROOMS_MAX);
    view = renderStudent(deps, `/${CODE}`);
    await waitFor(() => screen() === 'S1');
    expect(await deps.memory.student(roomInfo().roomId, Date.now())).toBeNull();
    expect(purged).toEqual([]);
  });
});
