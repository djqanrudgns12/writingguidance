import { koDev } from '@geulbang/core/copy/dev';
import { ko } from '@geulbang/core/copy';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevEditor } from './DevEditor.tsx';
import {
  consumeDevSecret,
  DEV_SECRET_STORAGE_KEY,
  extractDevSecretInput,
  parseDevEditorParams,
} from './devCredentials.ts';
import { computeAlignmentHighlights } from './devHighlights.ts';
import { planContinuousTickEdit, planScenarioEdit, type BotTokens } from './teacherBot.ts';

// React 19 act 환경 표시
(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

const TEST_TOKENS: BotTokens = {
  before: '[앞]',
  after: '[뒤]',
  word: '빛',
  paragraphHead: '[문단앞] ',
  paragraphTail: ' [문단끝]',
  tickPrefix: '[교사',
  tickSuffix: ']',
};

function applyPlan(text: string, plan: ReturnType<typeof planScenarioEdit>): string {
  if (plan.noop) return text;
  return text.slice(0, plan.deleteAt) + plan.insertText + text.slice(plan.deleteAt + plan.deleteCount);
}

describe('devCredentials', () => {
  it('#dev 비밀값을 읽자마자 sessionStorage에 저장하고 주소창 해시에서는 지운다', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    const secret43 = 'a'.repeat(43);
    let replacedUrl: string | null = null;

    const result = consumeDevSecret(
      {
        pathname: '/dev/editor',
        search: '?doc=dev-pad&role=student',
        hash: `#dev=${secret43}`,
      },
      {
        state: { keep: 1 },
        replaceState(_data, _unused, url) {
          replacedUrl = String(url);
        },
      },
      storage,
    );

    expect(result).toBe(secret43);
    expect(store.get(DEV_SECRET_STORAGE_KEY)).toBe(secret43);
    expect(replacedUrl).toBe('/dev/editor?doc=dev-pad&role=student');

    // 해시가 지워진 뒤 새로고침해도 sessionStorage에서 그대로 읽는다.
    const reloaded = consumeDevSecret(
      { pathname: '/dev/editor', search: '?doc=dev-pad&role=student', hash: '' },
      { state: null, replaceState() {} },
      storage,
    );
    expect(reloaded).toBe(secret43);
  });

  it('전체 주소나 #dev= 조각을 붙여 넣어도 비밀값만 꺼낸다', () => {
    const s = 'B9_x-'.repeat(8) + '123';
    expect(extractDevSecretInput(`http://127.0.0.1:4462/dev/editor#dev=${s}`)).toBe(s);
    expect(extractDevSecretInput(`#dev=${s}`)).toBe(s);
    expect(extractDevSecretInput(`  ${s}  `)).toBe(s);
  });

  it('쿼리 매개변수의 기본값과 dev- 문서 이름 규칙을 판정한다', () => {
    expect(parseDevEditorParams('')).toEqual({
      docId: 'dev-ime',
      validDocId: true,
      role: 'student',
    });
    expect(parseDevEditorParams('?doc=dev-tab-01&role=teacher')).toEqual({
      docId: 'dev-tab-01',
      validDocId: true,
      role: 'teacher',
    });
    expect(parseDevEditorParams('?doc=room-not-dev&role=other')).toEqual({
      docId: 'room-not-dev',
      validDocId: false,
      role: 'student',
    });
  });
});

describe('teacherBot 편집 계획', () => {
  it('시나리오 1·2: 커서 앞 글자 왼쪽과 커서 바로 오른쪽에 각각 끼워 넣는다', () => {
    const text = '우리 한';
    // 학생이 마지막 글자 '한' 끝(index 4)에 커서를 둔 상태
    const beforePlan = planScenarioEdit('before-caret', text, { start: 4, end: 4, head: 4 }, TEST_TOKENS);
    expect(applyPlan(text, beforePlan)).toBe('우리 [앞]한');

    const afterPlan = planScenarioEdit('after-caret', text, { start: 4, end: 4, head: 4 }, TEST_TOKENS);
    expect(applyPlan(text, afterPlan)).toBe('우리 한[뒤]');
  });

  it('시나리오 3: 같은 어절 안쪽 경계에 끼워 넣고, 공백에 있으면 가까운 어절 안을 찾는다', () => {
    const text = '학교생활 기록';
    // '학교생활' 끝(index 4)에서 치는 중이면 마지막 글자 앞('생'과 '활' 사이)에 들어간다.
    const planAtWordEnd = planScenarioEdit('inside-word', text, { start: 4, end: 4, head: 4 }, TEST_TOKENS);
    expect(applyPlan(text, planAtWordEnd)).toBe('학교생빛활 기록');

    // 공백 자리(index 4~5 사이 공백 뒤, '기' 앞이 아닌 공백만 있는 경우)에서도 같은 문단 어절 안을 찾는다.
    const spaced = '가을   하늘';
    const planInSpace = planScenarioEdit('inside-word', spaced, { start: 3, end: 3, head: 3 }, TEST_TOKENS);
    expect(applyPlan(spaced, planInSpace)).toBe('가빛을   하늘');
  });

  it('시나리오 4: 다른 문단은 건드리지 않고 학생이 있는 문단의 반대쪽을 고친다', () => {
    const text = '첫째 문단입니다.\n둘째 문단 한가운데서 계속 쓰는 중입니다.\n셋째 문단입니다.';
    const head = text.indexOf('계속 쓰는 중입니다.') + '계속 쓰는 중입니다.'.length;
    const plan = planScenarioEdit('same-paragraph', text, { start: head, end: head, head }, TEST_TOKENS);
    const next = applyPlan(text, plan);
    const lines = next.split('\n');
    expect(lines[0]).toBe('첫째 문단입니다.');
    expect(lines[1]?.startsWith('[문단앞] 둘째 문단')).toBe(true);
    expect(lines[2]).toBe('셋째 문단입니다.');
  });

  it('시나리오 5: 커서를 가로지르는 범위를 지우고 빈 글이면 건드리지 않는다', () => {
    const emptyPlan = planScenarioEdit('delete-across-caret', '', { start: 0, end: 0, head: 0 }, TEST_TOKENS);
    expect(emptyPlan.noop).toBe(true);

    const text = '맑은가을하늘';
    const plan = planScenarioEdit('delete-across-caret', text, { start: 3, end: 3, head: 3 }, TEST_TOKENS);
    expect(plan.deleteAt).toBe(1);
    expect(plan.deleteCount).toBe(4);
    expect(applyPlan(text, plan)).toBe('맑늘');
  });

  it('시나리오 6: 같은 문단에 이전 봇 표지가 있고 커서와 떨어져 있으면 번호만 갱신한다', () => {
    const first = applyPlan(
      '오늘 운동장에서 달렸다',
      planContinuousTickEdit('오늘 운동장에서 달렸다', { start: 12, end: 12, head: 12 }, 1, TEST_TOKENS),
    );
    expect(first).toBe('[교사1] 오늘 운동장에서 달렸다');

    const second = applyPlan(
      first,
      planContinuousTickEdit(
        first,
        { start: first.length, end: first.length, head: first.length },
        2,
        TEST_TOKENS,
      ),
    );
    expect(second).toBe('[교사2] 오늘 운동장에서 달렸다');
  });
});

describe('긴 글 견본과 형광 정렬 범위', () => {
  it('30줄이 넘는 견본 글에서 첫 줄부터 마지막 줄까지 유효한 형광 구간을 만든다', () => {
    const lines = koDev.longSampleBody.split('\n');
    expect(lines.length).toBeGreaterThan(30);

    const ranges = computeAlignmentHighlights(koDev.longSampleBody);
    expect(ranges.length).toBeGreaterThanOrEqual(10);
    for (const r of ranges) {
      expect(r.field).toBe('body');
      expect(r.start).toBeGreaterThanOrEqual(0);
      expect(r.end).toBeGreaterThan(r.start);
      expect(r.end).toBeLessThanOrEqual(koDev.longSampleBody.length);
    }
  });
});

describe('DevEditor 화면', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/dev/editor');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('비밀값이 없으면 안내 카드를 띄우고 시나리오 단추를 비활성화한다', () => {
    act(() => {
      root.render(<DevEditor />);
    });

    const alert = host.querySelector('[data-testid="dev-auth-alert"]');
    expect(alert?.textContent).toContain(koDev.authMissingTitle);
    const bot1 = host.querySelector('[data-testid="dev-bot-1"]') as HTMLButtonElement | null;
    expect(bot1?.disabled).toBe(true);
    const checklist = host.querySelector('[data-testid="dev-checklist"]') as HTMLDetailsElement | null;
    expect(checklist?.open).toBe(false);
    expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(koDev.checklistItems.length);
  });

  it('잘못된 문서 이름이면 문서 형식 안내를 보여 준다', () => {
    window.history.replaceState(null, '', '/dev/editor?doc=not-allowed');
    act(() => {
      root.render(<DevEditor />);
    });

    const alert = host.querySelector('[data-testid="dev-auth-alert"]');
    expect(alert?.textContent).toContain(koDev.invalidDocTitle);
  });
});
