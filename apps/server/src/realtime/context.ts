/**
 * 연결마다 붙는 정보. `ip`는 연결 때 넣는 초기값(PLAN §4.7 대응 7), `actor`는 인증 훅이 채운다.
 * 문서 연결마다 따로 인증하므로(같은 소켓이라도) `actor`도 문서 연결마다 있다.
 */
export type DevActor = {
  readonly kind: 'dev';
  readonly role: 'student' | 'teacher';
  readonly deviceId: string;
};

/** 기기 토큰으로 들어온 학생. `deviceRowId`는 `devices.id`(명령 기록의 실행 주체). */
export type StudentActor = {
  readonly kind: 'student';
  readonly role: 'student';
  readonly roomId: string;
  readonly participantId: string;
  readonly deviceRowId: string;
  readonly deviceId: string;
};

/** 선생님 링크(LINK)·PIN 세션 토큰으로 들어온 교사. `sessionId`는 `teacher_sessions.id`. */
export type TeacherActor = {
  readonly kind: 'teacher';
  readonly role: 'teacher';
  readonly roomId: string;
  readonly sessionId: string;
  readonly deviceId: string;
};

export type RoomActor = StudentActor | TeacherActor;
export type Actor = DevActor | RoomActor;

/** 인증 때 읽은 글 행(`doc:*` 연결만). 상태 같은 바뀌는 값은 그 순간의 값이라 판단에는 다시 읽는다. */
export interface ConnectedDoc {
  readonly id: string;
  readonly roomId: string;
  readonly participantId: string;
}

export interface RealtimeContext {
  readonly ip: string;
  readonly actor?: Actor;
  readonly doc?: ConnectedDoc;
}

export function isRoomActor(actor: Actor | undefined): actor is RoomActor {
  return actor?.kind === 'student' || actor?.kind === 'teacher';
}
