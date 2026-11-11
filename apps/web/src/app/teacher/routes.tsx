import type { RouteObject } from 'react-router';
import { lazyPage } from '../lazyPage.tsx';
import { TeacherLinkEntry } from './TeacherLinkEntry.tsx';

/**
 * 교사 경로(PLAN §6.1 `/t*`). 각 경로 요소는 `app/teacher/` 안의 결합 부품
 * (훅으로 유스케이스를 부르고 `ui/screens/teacher`의 View에 넘김)이다.
 * 고정 마디(`register`·`new`·`pin`·`room`)가 `/t/:token`보다 먼저 맞는다. `/t/room`처럼 예약어 하나만 온 주소는
 * 선생님 링크 결합 부품이 토큰으로 보지 않고 없는 주소로 보인다.
 * 교사 화면은 학생 첫 화면 묶음에 들어가지 않게 모두 나중에 불러온다(PLAN §2.6).
 */
export const teacherRoutes: RouteObject[] = [
  { path: '/t', element: lazyPage(() => import('./TeacherHomeRoute.tsx'), 'TeacherHomeRoute') },
  {
    path: '/t/register',
    element: lazyPage(() => import('./TeacherRegisterRoute.tsx'), 'TeacherRegisterRoute'),
  },
  { path: '/t/new', element: lazyPage(() => import('./CreateRoomRoute.tsx'), 'CreateRoomRoute', 8) },
  { path: '/t/pin', element: lazyPage(() => import('./PinEntryRoute.tsx'), 'PinEntryRoute') },
  { path: '/t/room/:roomId', element: lazyPage(() => import('./DashboardRoute.tsx'), 'DashboardRoute', 8) },
  {
    path: '/t/room/:roomId/prep',
    element: lazyPage(() => import('./RoomPrepRoute.tsx'), 'RoomPrepRoute', 6),
  },
  /** 선생님 링크 QR 별도 창(PRD F-16). 토큰은 `#` 뒤. */
  {
    path: '/t/room/:roomId/qr',
    element: lazyPage(() => import('./TeacherLinkQrRoute.tsx'), 'TeacherLinkQrRoute'),
  },
  {
    path: '/t/:token',
    element: <TeacherLinkEntry page={lazyPage(() => import('./TeacherLinkRoute.tsx'), 'TeacherLinkRoute')} />,
  },
];
