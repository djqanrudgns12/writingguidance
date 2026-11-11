/**
 * 상태값 한 곳(PLAN §5.2 CHECK와 같은 글자). 서버·기기·프로토콜이 모두 여기서 가져온다.
 * 대문자 상태값은 DB 규칙(AGENTS.md §3)을 그대로 따른다.
 */

/** DB에 저장되는 수업방 상태. 만료·삭제는 저장하지 않고 시각·행 존재로 판단한다. */
export const ROOM_DB_STATUSES = ['ACTIVE', 'CLOSED'] as const;
export type RoomDbStatus = (typeof ROOM_DB_STATUSES)[number];

/** 화면·이벤트에 보이는 수업방 상태(`room.status`, PLAN §4.4). */
export const ROOM_STATUSES = ['ACTIVE', 'CLOSED', 'EXPIRED', 'DELETED'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const DOC_STATUSES = ['DRAFT', 'SUBMITTED', 'REOPENED'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const SNAPSHOT_REASONS = ['AUTO', 'SUBMIT', 'AI', 'TEACHER', 'RESTORE'] as const;
export type SnapshotReason = (typeof SNAPSHOT_REASONS)[number];

export const SNAPSHOT_AUTHORS = ['STUDENT', 'TEACHER', 'SYSTEM'] as const;
export type SnapshotAuthor = (typeof SNAPSHOT_AUTHORS)[number];

export const RESUME_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ResumeStatus = (typeof RESUME_STATUSES)[number];

export const TIMER_STATUSES = ['IDLE', 'RUNNING', 'PAUSED'] as const;
export type TimerStatus = (typeof TIMER_STATUSES)[number];

export const NOTICE_KINDS = ['MANUAL', 'TIMER'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const AI_BUTTONS = ['SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH'] as const;
export type AiButton = (typeof AI_BUTTONS)[number];

export const LAST_INPUT_BY = ['STUDENT', 'TEACHER'] as const;
export type LastInputBy = (typeof LAST_INPUT_BY)[number];

/** 교사 대시보드 타일 상태(PRD F-17). 우선순위 `제출 > 오프라인 > 멈춤 > 쓰는 중`은 `domain/presence.ts`가 계산한다. */
export const PRESENCE_STATES = ['WRITING', 'IDLE', 'OFFLINE', 'SUBMITTED'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

/** 학생 글에서 지금 글을 고칠 수 있는 상태인가(PLAN §4.3: 방 ACTIVE + 글 DRAFT·REOPENED). */
export function studentCanEdit(room: RoomStatus, doc: DocStatus): boolean {
  return room === 'ACTIVE' && (doc === 'DRAFT' || doc === 'REOPENED');
}
