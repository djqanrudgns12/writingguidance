import { createBrowserRouter } from 'react-router';
import { studentRoutes } from './student/routes.tsx';
import { teacherRoutes } from './teacher/routes.tsx';

/**
 * 화면 경로(PLAN §6.1). 학생 경로가 `/`와 없는 주소(`*`)까지 맡는다.
 * 개발 전용 화면(`/dev/*`)은 이 묶음에 넣지 않는다(`src/dev/`, 운영 빌드에서 빠짐).
 */
export const router = createBrowserRouter([...teacherRoutes, ...studentRoutes]);
