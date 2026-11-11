import type { CreateRoomInput } from '../ports/api.ts';
import type { AppDeps } from './deps.ts';

/**
 * 교사: 수업방 만들기(PLAN §2.3 ①, PRD F-15). 기기가 선생님 링크 토큰을 직접 만들고 해시만 보낸다.
 * 같은 `commandId`로 다시 보내면 서버가 같은 결과를 준다(응답이 사라져도 안전) — 화면은 실패 뒤 다시 누를 때
 * `retryOf`로 이전 시도를 넘긴다.
 */
export interface CreateRoomForm {
  readonly className: string;
  readonly title: string;
  readonly schoolName?: string;
  readonly showSchool: boolean;
  readonly genres: readonly string[];
  readonly aiButtons: CreateRoomInput['aiButtons'];
  readonly pin: string;
  /** 시작 코드(PRD F-15). 기기에 저장된 것이 있으면 화면이 넣는다. */
  readonly startCode: string | null;
}

export interface CreateRoomAttempt {
  readonly commandId: string;
  readonly linkToken: string;
}

export interface CreatedRoom {
  readonly roomId: string;
  readonly entryCode: string;
  readonly expiresAt: number;
  /** `https://…/t/{토큰}` — 기기가 스스로 만든다 */
  readonly teacherLink: string;
  readonly linkToken: string;
}

export function newCreateRoomAttempt(deps: Pick<AppDeps, 'newId' | 'newToken'>): CreateRoomAttempt {
  return { commandId: deps.newId(), linkToken: deps.newToken() };
}

export async function createRoom(
  deps: AppDeps,
  form: CreateRoomForm,
  attempt: CreateRoomAttempt,
): Promise<CreatedRoom> {
  const deviceId = await deps.memory.deviceId();
  const linkTokenHash = await deps.sha256Hex(attempt.linkToken);
  const result = await deps.api.createRoom(
    {
      className: form.className,
      title: form.title,
      ...(form.schoolName ? { schoolName: form.schoolName } : {}),
      showSchool: form.showSchool,
      genres: form.genres,
      aiButtons: form.aiButtons,
      pin: form.pin,
      linkTokenHash,
      deviceId,
      commandId: attempt.commandId,
    },
    form.startCode,
  );
  await deps.memory.rememberTeacher({
    roomId: result.roomId,
    displayName: form.title,
    teacherToken: attempt.linkToken,
    tokenKind: 'LINK',
    lastUsedAt: deps.now(),
    expiresAt: result.expiresAt,
  });
  return {
    ...result,
    linkToken: attempt.linkToken,
    teacherLink: `${deps.config.PUBLIC_ORIGIN}/t/${attempt.linkToken}`,
  };
}
