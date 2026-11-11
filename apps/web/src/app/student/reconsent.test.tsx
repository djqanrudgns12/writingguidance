import { DOC_KEYS } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  CODE,
  DOC_ID,
  fakeDeps,
  fakeRealtime,
  hello,
  PARTICIPANT_ID,
  POLICY,
  rememberedEntry,
  type FakeRealtime,
} from './testFakes.ts';
import { buttonByText, click, renderStudent, waitFor, type Rendered } from './testRender.tsx';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

/** 처리방침 판이 바뀐 뒤(검토 B03): 서버는 새 판, 기기 학생은 옛 판에 동의했다. */
const NEW_POLICY = `${POLICY}-next`;
const BODY = 'A short sample body for the reconsent test.';

let view: Rendered | null = null;
let realtime: FakeRealtime;

beforeEach(() => {
  realtime = fakeRealtime();
  const net = new Y.Doc();
  net.getText(DOC_KEYS.body).insert(0, BODY);
  realtime.docs.set(DOC_ID, net);
  realtime.onChannel = ch => {
    ch.hello.set(
      hello({
        config: { POLICY_VERSION: NEW_POLICY },
        me: { participantId: PARTICIPANT_ID, nickname: 'nick', consentVersion: POLICY },
      }),
    );
    ch.state.set('ready');
  };
});

afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

const screen = () => document.querySelector<HTMLElement>('[data-screen]')?.dataset['screen'] ?? null;

async function agreeOnCard() {
  click(document.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]')!);
  await waitFor(() => !buttonByText(ko.student.consentStartAction)!.disabled);
  click(buttonByText(ko.student.consentStartAction)!);
}

describe('정책 판이 바뀐 뒤 직접 들어오기(검토 B03)', () => {
  it('쓰기 주소로 바로 열어도 다시 동의(S1)를 먼저 보이고, 그 전에는 글을 열지 않는다', async () => {
    const { deps } = fakeDeps({ realtime });
    await deps.memory.rememberStudent(rememberedEntry(), deps.config.RECENT_ROOMS_MAX);
    view = renderStudent(deps, `/${CODE}/write/${DOC_ID}`);
    await waitFor(() => screen() === 'S1', 5000);
    expect(view.router.state.location.pathname).toBe(`/${CODE}/write/${DOC_ID}`);
    // 동의 전에는 글 연결을 열지 않는다(기기 사본이 새 판 동의 없이 올라가지 않게).
    expect(realtime.opened.has(DOC_ID)).toBe(false);
    expect(document.querySelector('textarea[data-editor-field="body"]')).toBeNull();

    await agreeOnCard();
    const body = await waitFor(() => {
      const el = document.querySelector<HTMLTextAreaElement>('textarea[data-editor-field="body"]');
      return el && el.value === BODY ? el : null;
    }, 5000);
    expect(body).not.toBeNull();
    const consent = realtime.channels[0]?.sent.filter(s => s.name === 'consent.update') ?? [];
    expect(consent).toEqual([{ name: 'consent.update', args: { consentVersion: NEW_POLICY } }]);
  });

  it('글 종류 주소(S4)로 바로 열어도 다시 동의를 먼저 보인다', async () => {
    const { deps } = fakeDeps({ realtime });
    await deps.memory.rememberStudent(rememberedEntry({ lastDocId: null }), deps.config.RECENT_ROOMS_MAX);
    view = renderStudent(deps, `/${CODE}/genre`);
    await waitFor(() => screen() === 'S1', 5000);
    expect(view.router.state.location.pathname).toBe(`/${CODE}/genre`);
    await agreeOnCard();
    await waitFor(() => screen() === 'S4', 5000);
    expect(realtime.channels[0]?.sent.some(s => s.name === 'consent.update')).toBe(true);
  });

  it('입장 화면에서 다시 동의했으면 쓰기 화면에서 또 묻지 않는다(같은 연결)', async () => {
    const { deps } = fakeDeps({ realtime });
    await deps.memory.rememberStudent(rememberedEntry(), deps.config.RECENT_ROOMS_MAX);
    view = renderStudent(deps, `/${CODE}`);
    await waitFor(() => screen() === 'S1', 5000);
    await agreeOnCard();
    await waitFor(() => screen() === 'S5', 5000);
    expect(view.router.state.location.pathname).toBe(`/${CODE}/write/${DOC_ID}`);
    expect(realtime.channels[0]?.sent.filter(s => s.name === 'consent.update')).toHaveLength(1);
  });
});
