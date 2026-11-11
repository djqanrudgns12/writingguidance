import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './ui/tokens.css';
import './ui/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AppDepsProvider, createAppDeps } from './app/providers.tsx';
import { router } from './app/routes.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root 없음');
// 기기 저장소를 먼저 연다(글 사본이 바로 보이게). 서비스 워커는 운영 빌드에서만.
void createAppDeps(undefined, { serviceWorker: import.meta.env.PROD }).then(deps => {
  createRoot(root).render(
    <StrictMode>
      <AppDepsProvider deps={deps}>
        <RouterProvider router={router} />
      </AppDepsProvider>
    </StrictMode>,
  );
});
