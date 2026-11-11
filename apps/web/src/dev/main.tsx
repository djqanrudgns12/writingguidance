import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '../ui/tokens.css';
import '../ui/base.css';
import '../adapters/editor/mirror.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { DevEditor } from './DevEditor.tsx';
import { DevGallery } from './DevGallery.tsx';
import { DevScreensStudent } from './DevScreensStudent.tsx';
import { DevScreensTeacher } from './DevScreensTeacher.tsx';

/**
 * 개발 전용 화면 묶음(PLAN §11.4·§11.5). 개발 서버(Vite)와 실기기 시험 빌드(`--mode devices`)에만 들어가고
 * 운영 빌드에는 없다(`tools/checks/bundle.mjs`가 확인).
 */
const router = createBrowserRouter([
  { path: '/dev/ui', element: <DevGallery /> },
  { path: '/dev/editor', element: <DevEditor /> },
  { path: '/dev/screens/student', element: <DevScreensStudent /> },
  { path: '/dev/screens/teacher', element: <DevScreensTeacher /> },
  { path: '*', element: <DevGallery /> },
]);

const root = document.getElementById('root');
if (!root) throw new Error('#root 없음');
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
