import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { AppDeps } from '../../application/deps.ts';
import { AppDepsProvider } from '../providers.tsx';
import { studentRoutes } from './routes.tsx';

/** 학생 결합 시험용: 메모리 라우터 + 가짜 묶음으로 학생 경로 전체를 그린다(시험 파일만 쓴다). */
export interface Rendered {
  readonly router: ReturnType<typeof createMemoryRouter>;
  readonly root: Root;
  readonly host: HTMLDivElement;
  unmount(): void;
}

export function renderStudent(deps: AppDeps, path: string): Rendered {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const router = createMemoryRouter(studentRoutes, { initialEntries: [path] });
  act(() => {
    root.render(
      <AppDepsProvider deps={deps}>
        <RouterProvider router={router} />
      </AppDepsProvider>,
    );
  });
  return {
    router,
    root,
    host,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** 조건이 참이 될 때까지 기다린다(약속·지연 불러오기·타이머가 돌게 act 안에서 잠깐씩 쉰다). */
export async function waitFor<T>(check: () => T | null | undefined | false, timeoutMs = 3000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor timeout');
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
  }
}

export function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

export function buttonByText(text: string, root: ParentNode = document.body): HTMLButtonElement | null {
  return [...root.querySelectorAll('button')].find(b => b.textContent?.includes(text)) ?? null;
}
