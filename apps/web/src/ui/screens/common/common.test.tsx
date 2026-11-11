import { ko } from '@geulbang/core/copy';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClosedView } from './Closed.tsx';
import { ErrorStateView } from './ErrorState.tsx';
import { LoadingView } from './Loading.tsx';
import { PrivacyView } from './Privacy.tsx';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

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
});

function render(node: ReactNode) {
  act(() => root.render(node));
}

describe('공통 상태 화면(PRD 7.2)', () => {
  it('만료·없음: 닫힌 문 그림 + 문구 + `처음으로` 하나', () => {
    const onHome = vi.fn();
    render(<ClosedView onHome={onHome} />);
    expect(host.textContent).toContain(ko.common.expiredRoomTitle);
    expect(host.querySelector('img[data-art="closed-door"]')).not.toBeNull();
    const primaries = host.querySelectorAll<HTMLButtonElement>('button[data-variant="primary"]');
    expect(primaries).toHaveLength(1);
    act(() => primaries[0]?.click());
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('없는 주소는 다른 제목을 쓴다', () => {
    render(<ClosedView kind="missingPage" onHome={() => {}} />);
    expect(host.textContent).toContain(ko.common.notFoundTitle);
  });

  it('오류: 오류 코드 문구 한 줄 + `다시 하기`', () => {
    const onRetry = vi.fn();
    render(<ErrorStateView code="E_AI_PROVIDER" onRetry={onRetry} />);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(ko.errors.E_AI_PROVIDER);
    const retry = [...host.querySelectorAll('button')].find(b => b.textContent === ko.common.retry);
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('불러오는 중: 바로 보이기 옵션이면 "준비하고 있어요"가 보인다', () => {
    render(<LoadingView showLabelImmediately />);
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.textContent).toContain(ko.common.loading);
  });

  it('처리방침: 제목과 본문 자리', () => {
    render(
      <PrivacyView onBack={() => {}}>
        <p data-testid="policy-body" />
      </PrivacyView>,
    );
    expect(host.querySelector('h1')?.textContent).toBe(ko.common.privacyPolicy);
    expect(host.querySelector('[data-testid="policy-body"]')).not.toBeNull();
  });
});
