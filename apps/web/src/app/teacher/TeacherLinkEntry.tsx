import { useLayoutEffect, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { replaceAddressBar, RESERVED_TEACHER_SEGMENTS, teacherPaths } from './paths.ts';

/**
 * 선생님 링크 `/t/:token`의 바깥 껍데기(첫 묶음에 들어가는 작은 부품).
 * 화면 묶음(`TeacherLinkRoute`)은 나중에 불러오므로, 그 사이에도 토큰이 주소창·방문 기록에 남지 않게
 * 그리기 직후 바로 지운다(PRD F-20). 라우터 상태는 그대로라 안쪽 부품은 같은 토큰을 읽는다.
 */
export function TeacherLinkEntry({ page }: { readonly page: ReactNode }) {
  const token = useParams()['token'] ?? '';
  useLayoutEffect(() => {
    if (token && !RESERVED_TEACHER_SEGMENTS.includes(token)) replaceAddressBar(teacherPaths.home);
  }, [token]);
  return page;
}
