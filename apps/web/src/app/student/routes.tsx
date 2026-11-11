import type { RouteObject } from 'react-router';
import { lazyPage } from '../lazyPage.tsx';
import { StudentHome } from './StudentHome.tsx';

/**
 * 학생 경로(PLAN §6.1 `/`, `/:code*`, `/privacy`). 각 경로 요소는 `app/student/` 안의 결합 부품
 * (훅으로 유스케이스를 부르고 `ui/screens/student`의 View에 넘김)이다.
 * `/:code`는 숫자 6자리만(아니면 없는 주소). 교사 경로(`/t*`)는 고정 글자라 먼저 맞는다.
 * 첫 화면 예산(PLAN §2.6): 홈만 처음 묶음에 두고, 나머지는 그 경로에 들어갈 때 불러온다. S5 쓰기 화면은
 * 편집기·거울 층·키보드 높이·제출(Yjs)까지 들어 있어 가장 크다.
 */
const flow = () => import('./RoomFlow.tsx');
const entry = () => import('./RoomEntryPage.tsx');
const nickname = () => import('./NicknamePage.tsx');
const wait = () => import('./ResumeWaitPage.tsx');
const genre = () => import('./GenrePage.tsx');
const write = () => import('./WritePage.tsx');
const common = () => import('./CommonPages.tsx');

export const studentRoutes: RouteObject[] = [
  { path: '/', element: <StudentHome /> },
  { path: '/privacy', element: lazyPage(common, 'PrivacyPage', 12) },
  {
    path: '/:code',
    element: lazyPage(flow, 'RoomFlowRoute'),
    children: [
      { index: true, element: lazyPage(entry, 'RoomEntryPage') },
      { path: 'name', element: lazyPage(nickname, 'NicknamePage') },
      { path: 'wait', element: lazyPage(wait, 'ResumeWaitPage') },
      { path: 'genre', element: lazyPage(genre, 'GenrePage') },
      { path: 'write/:docId', element: lazyPage(write, 'WritePage', 8) },
      { path: '*', element: lazyPage(common, 'MissingPage') },
    ],
  },
  { path: '*', element: lazyPage(common, 'MissingPage') },
];
