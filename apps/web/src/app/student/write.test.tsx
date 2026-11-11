import { DOC_KEYS } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { AiRequestInput } from '../../ports/api.ts';
import {
  CODE,
  DOC_ID,
  fakeApi,
  fakeDeps,
  fakeRealtime,
  hello,
  rememberedEntry,
  type FakeApi,
  type FakeRealtime,
} from './testFakes.ts';
import { buttonByText, click, renderStudent, waitFor, type Rendered } from './testRender.tsx';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

/** 기사 글(최소 20자 넘음). 화면 문구가 아니라 시험용 글이다. */
const BODY = 'This is a sample news article body that is long enough for the AI chips to light up.';

let view: Rendered | null = null;
let realtime: FakeRealtime;

beforeEach(() => {
  realtime = fakeRealtime();
  const net = new Y.Doc();
  net.getText(DOC_KEYS.body).insert(0, BODY);
  realtime.docs.set(DOC_ID, net);
  realtime.onChannel = ch => {
    ch.hello.set(hello());
    ch.state.set('ready');
  };
});

afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function openWrite(api: FakeApi = fakeApi()) {
  const { deps } = fakeDeps({ api, realtime });
  await deps.memory.rememberStudent(rememberedEntry(), deps.config.RECENT_ROOMS_MAX);
  view = renderStudent(deps, `/${CODE}/write/${DOC_ID}`);
  const body = await waitFor(() => {
    const el = document.querySelector<HTMLTextAreaElement>('textarea[data-editor-field="body"]');
    return el && el.value === BODY ? el : null;
  }, 5000);
  return { deps, body, channel: realtime.channels[0]! };
}

describe('S5 쓰기 결합', () => {
  it('제출: 확인 시트 → 편집 잠금 → 대기열 → 결과가 오면 도장과 `제출 완료`', async () => {
    const { body, channel } = await openWrite();
    click(buttonByText(ko.student.submitButton)!);
    click(await waitFor(() => buttonByText(ko.student.submitConfirmAction)));
    const entry = await waitFor(() => channel.enqueued[0]);
    expect(entry.docId).toBe(DOC_ID);
    expect(entry.args).toMatchObject({ docId: DOC_ID, generation: 0 });
    // 결과를 기다리는 동안 `제출 대기`이고 입력칸은 잠겨 있다(바인딩이 반영 문이 열린 뒤 바꿈).
    await waitFor(() => document.body.textContent?.includes(ko.student.submitPendingStatus));
    await waitFor(() => body.readOnly);

    act(() => channel.result({ commandId: entry.commandId, ok: true }));
    await waitFor(() => document.querySelector('[data-testid="stamp-text"]'));
    await waitFor(() => document.querySelector('[data-save-state="locked"]'));
    expect(buttonByText(ko.student.submitButton)).toBeNull();
    expect(body.readOnly).toBe(true);
  });

  it('제출이 옛 세대라 버려지면(`E_STALE`) 조용히 다시 쓸 수 있다', async () => {
    const { body, channel } = await openWrite();
    click(buttonByText(ko.student.submitButton)!);
    click(await waitFor(() => buttonByText(ko.student.submitConfirmAction)));
    const entry = await waitFor(() => channel.enqueued[0]);
    await waitFor(() => body.readOnly);
    act(() =>
      channel.result({ commandId: entry.commandId, ok: false, error: { code: 'E_STALE', retryable: false } }),
    );
    await waitFor(() => !body.readOnly);
    expect(buttonByText(ko.student.submitButton)).not.toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('AI 칩: 켜진 버튼이 `idle` → 누르면 기다림 → 결과 패널(글벗 한마디). 보낸 것은 본문뿐', async () => {
    let release: (() => void) | null = null;
    const api = fakeApi({
      aiStructured: (_roomId, _token, input: AiRequestInput) =>
        new Promise(resolve => {
          release = () =>
            resolve({
              button: 'FEEDBACK',
              result: { praise: 'praise-line', improve: ['improve-line'] },
              receivedAt: Date.now(),
              textHash: 'x',
            });
          expect(input.text).toBe(BODY);
        }),
    });
    await openWrite(api);
    const chip = await waitFor(() =>
      document.querySelector<HTMLElement>('[data-ai-button="FEEDBACK"][data-ai-state="idle"]'),
    );
    click(chip);
    await waitFor(() => document.querySelector('[data-result="FEEDBACK"][data-status="loading"]'));
    await waitFor(() => release);
    act(() => release!());
    await waitFor(() => document.querySelector('[data-result="FEEDBACK"][data-status="ready"]'));
    expect(document.body.textContent).toContain('praise-line');
    expect(document.body.textContent).toContain('improve-line');
    // 보낸 직후라 그 버튼은 쿨다운(상태 기계: 쿨다운이 결과 있음보다 앞선다)
    await waitFor(() => document.querySelector('[data-ai-button="FEEDBACK"][data-ai-state="cooldown"]'));
    const sent = api.calls.find(c => c.name === 'aiStructured')?.args[2] as AiRequestInput;
    expect(sent.button).toBe('FEEDBACK');
    expect(JSON.stringify(sent)).not.toContain('nick');
  });

  it('글이 짧으면 칩 줄 대신 "조금 더 써 볼까요?"', async () => {
    const net = new Y.Doc();
    net.getText(DOC_KEYS.body).insert(0, 'short');
    realtime.docs.set(DOC_ID, net);
    const { deps } = fakeDeps({ realtime });
    await deps.memory.rememberStudent(rememberedEntry(), deps.config.RECENT_ROOMS_MAX);
    view = renderStudent(deps, `/${CODE}/write/${DOC_ID}`);
    await waitFor(() => document.querySelector('[data-ai-bar="guide"]'), 5000);
    expect(document.body.textContent).toContain(ko.student.aiMoreCharsGuide);
  });

  it('한 번에 크게 지우면 되살리기 토스트 → `되살리기`가 지운 글을 돌린다(↶와 같음)', async () => {
    const { body } = await openWrite();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(body, BODY.slice(0, 10));
      body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    });
    const restore = await waitFor(() => buttonByText(ko.student.restoreAction));
    expect(document.body.textContent).toContain(ko.student.largeDeleteToast);
    click(restore);
    await waitFor(() => body.value === BODY);
    expect(buttonByText(ko.student.restoreAction)).toBeNull();
  });

  it('교사 알림 이벤트가 오면 상단 알림 자리에 보이고, 수업방이 닫히면 읽기만', async () => {
    const { body, channel } = await openWrite();
    act(() =>
      channel.emit('notice', {
        noticeId: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
        text: 'notice-text',
        sentAt: Date.now(),
        sound: false,
        kind: 'MANUAL',
      }),
    );
    const slot = await waitFor(() => document.querySelector('[data-notice-slot]'));
    expect(slot.textContent).toContain('notice-text');
    act(() => channel.emit('room.status', { status: 'CLOSED' }));
    await waitFor(() => document.body.textContent?.includes(ko.student.closedBanner));
    await waitFor(() => body.readOnly);
  });
});
