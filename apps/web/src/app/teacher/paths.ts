import type { Config } from '@geulbang/core/config';

/** 교사 경로(PLAN §6.1). 경로 글자를 한 곳에 둔다. */
export const teacherPaths = {
  home: '/t',
  register: '/t/register',
  create: '/t/new',
  pin: '/t/pin',
  room: (roomId: string) => `/t/room/${encodeURIComponent(roomId)}`,
  prep: (roomId: string) => `/t/room/${encodeURIComponent(roomId)}/prep`,
  /** 선생님 링크 QR 별도 창. 토큰은 `#` 뒤로 넘긴다(서버·방문 기록에 남지 않게). */
  linkQr: (roomId: string, token: string) =>
    `/t/room/${encodeURIComponent(roomId)}/qr#${encodeURIComponent(token)}`,
} as const;

/** `/t/:token`에서 토큰으로 보지 않는 첫 마디(PLAN §6.1). */
export const RESERVED_TEACHER_SEGMENTS: readonly string[] = ['register', 'new', 'pin', 'room'];

/** 선생님 링크 전체 주소(`createRoom`이 만드는 것과 같은 모양). */
export function teacherLinkOf(config: Pick<Config, 'PUBLIC_ORIGIN'>, token: string): string {
  return `${config.PUBLIC_ORIGIN}/t/${token}`;
}

/** 학생 입장 주소(QR에 담는 것). */
export function entryUrlOf(config: Pick<Config, 'PUBLIC_ORIGIN'>, entryCode: string): string {
  return `${config.PUBLIC_ORIGIN}/${entryCode}`;
}

/** 주소창에서 `#` 뒤(등록 코드·토큰)만 지운다. 라우터 상태(`history.state`)는 그대로 둔다. */
export function stripHashFromAddressBar(): void {
  const { pathname, search, hash } = globalThis.location;
  if (!hash) return;
  globalThis.history.replaceState(globalThis.history.state, '', `${pathname}${search}`);
}

/** 주소창 경로를 바꾼다(토큰을 지울 때). 라우터 이동은 부른 쪽이 따로 한다. */
export function replaceAddressBar(path: string): void {
  globalThis.history.replaceState(globalThis.history.state, '', path);
}
