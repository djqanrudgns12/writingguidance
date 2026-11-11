import { studentCanEdit, type DocStatus, type RoomStatus } from '@geulbang/core';
import type { DocumentRef } from '@geulbang/core/protocol';
import type { RoomActor } from './context.ts';

/**
 * 권한 표(PLAN §4.3)를 한 함수로. 문서 이름 + 실행 주체 + 방·글 상태 → 거부 / 읽기 / 쓰기.
 * 순수 함수라 인증 때뿐 아니라 방·글 상태가 바뀔 때(제출·다시 쓰게 하기·닫기, P4) 열린 연결마다 다시 계산하는 데 쓴다.
 *
 * | 행동                  | 학생                                         | 교사                          |
 * |-----------------------|----------------------------------------------|-------------------------------|
 * | room:{자기 방}        | 읽기(채널 문서에 쓸 일이 없음, §4.7 대응 6)  | 읽기(같은 이유)               |
 * | doc:{자기 글}         | 방 ACTIVE + 글 DRAFT·REOPENED면 쓰기, 아니면 읽기 | —                         |
 * | doc:{남의 글}         | 거부 E_FORBIDDEN                             | 그 방 글이면 쓰기(제출·닫힘도, ADR-048) |
 * | 방 만료               | 거부 E_ROOM_EXPIRED                          | 거부 E_ROOM_EXPIRED           |
 * | 동의 판이 지금과 다름 | doc:{자기 글} 읽기(재동의 전 편집 막기, PRD F-03) | 해당 없음                 |
 *
 * 동의 판이 지난 학생은 거부하지 않고 읽기로 둔다: 기기 사본의 편집은 남고, `consent.update` 뒤 쓰기로 바뀌면
 * `doc.status {locked:false}`를 받아 다시 보낸다(P5-5b 검토 B03). 재동의 명령은 수업방 채널이라 막히지 않는다.
 *
 * 없는 글과 남의 글은 같은 `E_FORBIDDEN`이다(있는지 없는지를 알려 주지 않는다).
 */
export type AccessDecision =
  | { readonly kind: 'deny'; readonly code: 'E_FORBIDDEN' | 'E_ROOM_EXPIRED' }
  | { readonly kind: 'read' }
  | { readonly kind: 'write' };

export interface AccessFacts {
  /** 실행 주체가 속한 수업방의 지금 상태(만료는 시각으로 계산한 값) */
  readonly roomStatus: RoomStatus;
  /** 학생이면 그 참가자의 동의 판이 지금 `POLICY_VERSION`과 같은가. 교사는 늘 true. */
  readonly consentCurrent: boolean;
  /** `doc:*`일 때 그 글. 없으면 undefined */
  readonly doc?:
    | {
        readonly roomId: string | null;
        readonly participantId: string;
        readonly status: DocStatus;
      }
    | undefined;
}

const DENY_FORBIDDEN: AccessDecision = { kind: 'deny', code: 'E_FORBIDDEN' };
const DENY_EXPIRED: AccessDecision = { kind: 'deny', code: 'E_ROOM_EXPIRED' };
const READ: AccessDecision = { kind: 'read' };
const WRITE: AccessDecision = { kind: 'write' };

export function decideAccess(ref: DocumentRef, actor: RoomActor, facts: AccessFacts): AccessDecision {
  if (facts.roomStatus === 'EXPIRED' || facts.roomStatus === 'DELETED') return DENY_EXPIRED;

  if (ref.kind === 'room') return ref.id === actor.roomId ? READ : DENY_FORBIDDEN;

  const doc = facts.doc;
  if (!doc || doc.roomId !== actor.roomId) return DENY_FORBIDDEN;
  if (actor.kind === 'teacher') return WRITE;
  if (doc.participantId !== actor.participantId) return DENY_FORBIDDEN;
  if (!facts.consentCurrent) return READ;
  return studentCanEdit(facts.roomStatus, doc.status) ? WRITE : READ;
}
