import { MS_PER_SECOND } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { defaultConfig } from '@geulbang/core/config';
import type { DocSummary, ParticipantSummary } from '@geulbang/core/protocol';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createBrowserRouter, createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDepsProvider } from '../providers.tsx';
import { START_CODE_KEY } from './hooks/startCode.ts';
import { teacherRoutes } from './routes.tsx';
import {
  createFakeDeps,
  helloOf,
  NOW,
  ROOM_ID,
  teacherEntry,
  uuidOf,
  type FakeDeps,
  type FakeSession,
} from './testFakes.ts';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

// 교사 경로는 지연 불러오기(lazyPage)라, 시험 전에 모듈을 미리 받아 두어 마이크로태스크 flush만으로 그려지게 한다.
beforeAll(async () => {
  await Promise.all([
    import('./TeacherHomeRoute.tsx'),
    import('./TeacherRegisterRoute.tsx'),
    import('./CreateRoomRoute.tsx'),
    import('./PinEntryRoute.tsx'),
    import('./DashboardRoute.tsx'),
    import('./RoomPrepRoute.tsx'),
    import('./TeacherLinkQrRoute.tsx'),
    import('./TeacherLinkRoute.tsx'),
  ]);
});

const P1 = uuidOf(901);
const P2 = uuidOf(902);
const DOC1 = uuidOf(801);
const REQ1 = uuidOf(701);
const REQ2 = uuidOf(702);
const REQ3 = uuidOf(703);

function participant(id: string, nickname: string): ParticipantSummary {
  return { participantId: id, nickname, presence: 'WRITING', joinedAt: NOW - 60_000 };
}

function summary(patch: Partial<DocSummary> = {}): DocSummary {
  return {
    docId: DOC1,
    participantId: P1,
    nickname: 'haneul',
    genre: 'news',
    subtype: null,
    chars: 10,
    lastInputAt: NOW - 5_000,
    lastInputBy: 'STUDENT',
    status: 'DRAFT',
    presence: 'WRITING',
    ...patch,
  };
}

/** 약속(promise) 사슬이 다 풀릴 때까지 넉넉히 돌린다(가짜 시계를 켠 시험에서도 쓰려고 마이크로태스크만). */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

function setInput(el: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function inputByLabel(host: HTMLElement, label: string): HTMLInputElement {
  const byAria = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (byAria) return byAria;
  const labelEl = [...host.querySelectorAll('label')].find(l => l.textContent?.trim() === label);
  const input = labelEl?.htmlFor ? document.getElementById(labelEl.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return input;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(b => b.textContent?.includes(text));
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function queryButton(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find(b => b.textContent?.includes(text));
}

describe('교사 화면 결합 (P4-13)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  function renderAt(deps: FakeDeps, path: string) {
    const router = createMemoryRouter(teacherRoutes, { initialEntries: [path] });
    act(() => {
      root.render(
        <AppDepsProvider deps={deps}>
          <RouterProvider router={router} />
        </AppDepsProvider>,
      );
    });
    return router;
  }

  async function openDashboard(deps: FakeDeps, path = `/t/room/${ROOM_ID}`) {
    deps.memory.teacherList.push(teacherEntry());
    const router = renderAt(deps, path);
    await flush();
    const session = deps.realtime.sessions.at(-1);
    if (!session) throw new Error('teacher session not opened');
    return { router, session };
  }

  function emitHello(session: FakeSession, patch: Parameters<typeof helloOf>[0] = {}) {
    act(() => session.channel.emit('hello', helloOf(patch)));
  }

  it('T1: 수업방 열기 → 실패 뒤 다시 누르면 같은 명령 ID·링크 토큰 → 만들어지면 T2로 간다', async () => {
    const calls: Parameters<FakeDeps['api']['createRoom']>[] = [];
    const deps = createFakeDeps({
      createRoom: async (input, startCode) => {
        calls.push([input, startCode]);
        if (calls.length === 1) throw { code: 'E_OFFLINE', message: '', retryable: true };
        return { roomId: ROOM_ID, entryCode: '482913', expiresAt: NOW + 1_000 };
      },
      teacherRoom: async () => ({
        room: {
          id: ROOM_ID,
          className: 'class-5-3',
          title: 'history',
          schoolName: null,
          showSchool: false,
          status: 'ACTIVE',
          genres: ['news'],
          aiButtons: ['SPELL'],
          sound: false,
          createdAt: NOW,
        },
        entryCode: '482913',
        shortUrl: 'write.example/482913',
        expiresAt: NOW + 1_000,
      }),
    });
    await deps.localStore.kv.set(START_CODE_KEY, '12345678');
    const router = renderAt(deps, '/t/new');
    await flush();

    // 시작 코드가 기기에 있으면 칸을 붙이지 않는다.
    expect(host.querySelector(`input[aria-label="${ko.teacher.startCodeLabel}"]`)).toBeNull();
    act(() => setInput(inputByLabel(host, ko.teacher.classNameLabel), 'class-5-3'));
    act(() => setInput(inputByLabel(host, ko.teacher.roomTitleLabel), 'history'));
    act(() => setInput(inputByLabel(host, ko.teacher.pinCreateLabel), '58203917'));
    act(() => setInput(inputByLabel(host, ko.teacher.pinConfirmLabel), '58203917'));

    act(() => buttonByText(host, ko.teacher.openRoomAction).click());
    await flush();
    expect(calls).toHaveLength(1);
    expect(host.textContent).toContain(ko.errors.E_OFFLINE);
    expect(router.state.location.pathname).toBe('/t/new');

    act(() => buttonByText(host, ko.teacher.openRoomAction).click());
    await flush();
    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    expect(second?.[0].commandId).toBe(first?.[0].commandId);
    expect(second?.[0].linkTokenHash).toBe(first?.[0].linkTokenHash);
    expect(second?.[1]).toBe('12345678');
    expect(second?.[0]).toMatchObject({ className: 'class-5-3', title: 'history', pin: '58203917' });

    expect(router.state.location.pathname).toBe(`/t/room/${ROOM_ID}/prep`);
    expect(deps.memory.teacherList.map(t => t.roomId)).toEqual([ROOM_ID]);
    await flush();
    expect(host.querySelector('[data-testid="prep-entry-code"]')?.textContent).toBe('482913');
  });

  it('T1: 기기에 시작 코드가 없으면 맨 위 칸으로 받고, 만들어지면 기기에 저장한다', async () => {
    const deps = createFakeDeps({
      createRoom: async () => ({ roomId: ROOM_ID, entryCode: '482913', expiresAt: NOW + 1_000 }),
    });
    renderAt(deps, '/t/new');
    await flush();
    const codeInput = inputByLabel(host, ko.teacher.startCodeLabel);
    // 화면 숫자판이 붙는 칸은 기기 키보드를 띄우지 않고, 8칸은 작은 칸이다(P3-11 판정 4).
    expect(codeInput.getAttribute('inputmode')).toBe('none');
    expect(host.querySelector('[data-slot-index="0"]')?.getAttribute('data-size')).toBe('sm');
    act(() => setInput(codeInput, '87654321'));
    act(() => setInput(inputByLabel(host, ko.teacher.classNameLabel), 'c'));
    act(() => setInput(inputByLabel(host, ko.teacher.roomTitleLabel), 't'));
    act(() => setInput(inputByLabel(host, ko.teacher.pinCreateLabel), '123456'));
    act(() => setInput(inputByLabel(host, ko.teacher.pinConfirmLabel), '123456'));
    act(() => buttonByText(host, ko.teacher.openRoomAction).click());
    await flush();
    expect(deps.localStore.kv.map.get(START_CODE_KEY)).toBe('87654321');
  });

  it('T3: hello 뒤 summary.batch를 합쳐 타일 글자 수가 바뀐다', async () => {
    const deps = createFakeDeps();
    const { session } = await openDashboard(deps);
    emitHello(session, { participants: [participant(P1, 'haneul')], summaries: [summary()] });
    expect(host.textContent).toContain(`10${ko.common.charCountSuffix}`);

    act(() => session.channel.emit('summary.batch', [summary({ chars: 42, lastInputAt: NOW - 1_000 })]));
    expect(host.textContent).toContain(`42${ko.common.charCountSuffix}`);
    expect(host.textContent).not.toContain(`10${ko.common.charCountSuffix}`);
  });

  it('T3: 이어 쓰기 요청을 허용하고, 2개 이상이면 모두 허용으로 한 번에 보낸다', async () => {
    const deps = createFakeDeps();
    const { session } = await openDashboard(deps);
    emitHello(session, {
      pendingResumes: [{ requestId: REQ1, participantId: P1, nickname: 'haneul', requestedAt: NOW }],
    });
    expect(queryButton(host, ko.teacher.resumeApproveAllAction)).toBeUndefined();

    act(() => buttonByText(host, ko.teacher.resumeApproveAction).click());
    await flush();
    expect(session.channel.sent.at(-1)).toMatchObject({
      name: 'resume.decide',
      args: { requestId: REQ1, approve: true },
    });
    expect(host.textContent).not.toContain(ko.teacher.resumeBannerLabel);

    act(() =>
      session.channel.emit('resume.pending', [
        { requestId: REQ2, participantId: P1, nickname: 'haneul', requestedAt: NOW },
        { requestId: REQ3, participantId: P2, nickname: 'byeol', requestedAt: NOW },
      ]),
    );
    act(() => buttonByText(host, ko.teacher.resumeApproveAllAction).click());
    await flush();
    expect(session.channel.sent.at(-1)).toMatchObject({
      name: 'resume.decide',
      args: { all: true, approve: true },
    });
    expect(host.textContent).not.toContain(ko.teacher.resumeBannerLabel);
  });

  it('T3: 지금 삭제는 설정 초(DELETE_CONFIRM_DELAY_SEC)가 지나야 눌리고, 지우면 기기 기억을 지우고 선생님 홈으로', async () => {
    const deps = createFakeDeps();
    const { router, session } = await openDashboard(deps);
    emitHello(session, { participants: [participant(P1, 'haneul')], summaries: [summary()] });

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const trigger = host.querySelector<HTMLElement>(`[aria-label="${ko.common.moreMenu}"]`);
    if (!trigger) throw new Error('more menu trigger missing');
    act(() => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      trigger.click();
    });
    await flush();
    const deleteItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el =>
      el.textContent?.includes(ko.teacher.deleteRoomNowAction),
    );
    if (!deleteItem) throw new Error('delete menu item missing');
    act(() => deleteItem.click());
    await flush();

    const confirmButton = () => {
      const sheet = [...document.querySelectorAll('[role="dialog"]')].find(d =>
        d.textContent?.includes(ko.teacher.deleteRoomConfirmGuide),
      );
      if (!sheet) throw new Error('delete sheet missing');
      return buttonByText(sheet, ko.teacher.deleteRoomNowAction);
    };
    expect(confirmButton().disabled).toBe(true);
    act(() => vi.advanceTimersByTime(defaultConfig.DELETE_CONFIRM_DELAY_SEC * MS_PER_SECOND - 1));
    expect(confirmButton().disabled).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(confirmButton().disabled).toBe(false);

    act(() => confirmButton().click());
    await flush();
    expect(session.channel.sent.at(-1)?.name).toBe('room.delete');
    expect(deps.memory.teacherList).toEqual([]);
    expect(deps.localStore.purgedRooms).toEqual([ROOM_ID]);
    expect(router.state.location.pathname).toBe('/t');
  });

  it('선생님 링크: 토큰을 주소창에서 지우고 기기에 저장한 뒤 T3로 간다', async () => {
    const token = 'link-token-abcdefghijklmnopqrstuvwxyz0123456789';
    const deps = createFakeDeps({
      teacherSession: async () => ({ roomId: ROOM_ID }),
      teacherRoom: async () => ({
        room: {
          id: ROOM_ID,
          className: 'class-5-3',
          title: 'history',
          schoolName: null,
          showSchool: false,
          status: 'ACTIVE',
          genres: ['news'],
          aiButtons: ['SPELL'],
          sound: false,
          createdAt: NOW,
        },
        entryCode: '482913',
        shortUrl: 'write.example/482913',
        expiresAt: NOW + 1_000,
      }),
    });
    window.history.pushState(null, '', `/t/${token}`);
    const router = createBrowserRouter(teacherRoutes);
    act(() => {
      root.render(
        <AppDepsProvider deps={deps}>
          <RouterProvider router={router} />
        </AppDepsProvider>,
      );
    });
    // 첫 효과에서 바로 지운다(서버 응답을 기다리지 않는다).
    expect(window.location.pathname).not.toContain(token);
    await flush();
    expect(window.location.pathname).toBe(`/t/room/${ROOM_ID}`);
    expect(window.location.href).not.toContain(token);
    expect(deps.memory.teacherList).toMatchObject([
      { roomId: ROOM_ID, teacherToken: token, tokenKind: 'LINK' },
    ]);
  });

  it('T4: 타일을 누르면 그 글 제공자를 열어 서랍에 붙이고, 닫으면 제공자를 닫는다', async () => {
    const deps = createFakeDeps();
    const { router, session } = await openDashboard(deps);
    emitHello(session, { participants: [participant(P1, 'haneul')], summaries: [summary()] });

    act(() => buttonByText(host, 'haneul').click());
    await flush();
    expect(router.state.location.search).toBe(`?doc=${DOC1}`);
    expect(session.docs.map(d => d.docId)).toEqual([DOC1]);
    const drawer = host.querySelector('aside');
    if (!drawer) throw new Error('drawer missing');
    expect(drawer.querySelector('[data-testid="drawer-body-input"]')).not.toBeNull();
    expect(session.docs[0]?.closed).toBe(false);

    const close = drawer.querySelector<HTMLButtonElement>(`button[aria-label="${ko.common.close}"]`);
    act(() => close?.click());
    await flush();
    expect(router.state.location.search).toBe('');
    expect(host.querySelector('aside')).toBeNull();
    expect(session.docs[0]?.closed).toBe(true);
  });
});
