import { lazy, Suspense, type ComponentType } from 'react';
import { LoadingView } from '../ui/screens/common/Loading.tsx';

/**
 * 경로마다 화면 묶음을 따로 나눈다(PLAN §2.6 첫 화면 예산, §6.7). 첫 화면(학생 홈)만 처음 묶음에 두고
 * 나머지는 그 경로에 들어갈 때 불러온다. 불러오는 동안은 종이 카드 모양 자리표시(PRD 7.2).
 */
export function lazyPage<M extends Record<string, unknown>>(
  load: () => Promise<M>,
  name: keyof M & string,
  lines = 4,
) {
  const Page = lazy(async () => ({ default: (await load())[name] as ComponentType }));
  return (
    <Suspense fallback={<LoadingView lines={lines} />}>
      <Page />
    </Suspense>
  );
}
