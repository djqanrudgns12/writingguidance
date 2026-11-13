import { defaultConfig, type Config } from '../config.ts';
import { MS_PER_MINUTE, MS_PER_SECOND } from './clock.ts';
import { nicknameKey } from './participant.ts';
import type { ResumeStatus } from './status.ts';

/**
 * 다른 기기 이어 쓰기 요청 상태 전이·대기 요청 재사용·긴 조회 시간 자르기·기다림 안내(PRD F-14, PLAN §2.3 ④·§5.2·§7.2).
 *
 * - 상태 전이: `PENDING → APPROVED | REJECTED | CANCELLED`만 허용하며, 이미 끝난 상태는 바뀌지 않는다.
 * - 대기 요청 재사용: 같은 방·같은 참가자(별명 정규화 키 또는 참가자 ID)·같은 기기(`deviceId`)의 `PENDING` 요청이 있으면 재사용한다.
 * - 긴 조회 대기(`RESUME_LONGPOLL_SEC`): `0 ~ RESUME_LONGPOLL_SEC`(기본 20초)로 자른다.
 * - 기다림 안내(`RESUME_WAIT_HINT_MIN`): `PENDING`인 채로 30분 이상 지나면 추가 안내 문구를 보인다(자동 만료 없음).
 */

export type ResumeLongPollConfig = Pick<Config, 'RESUME_LONGPOLL_SEC'>;
export type ResumeWaitHintConfig = Pick<Config, 'RESUME_WAIT_HINT_MIN'>;
export type ResumeConfig = Pick<Config, 'RESUME_LONGPOLL_SEC' | 'RESUME_WAIT_HINT_MIN'>;

export const RESUME_TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ResumeTerminalStatus = (typeof RESUME_TERMINAL_STATUSES)[number];

export interface ResumeRequestState {
  readonly status: ResumeStatus;
  readonly decidedAt: number | null;
}

export interface ResumeReuseCandidate {
  readonly status: ResumeStatus;
  readonly deviceId: string;
  readonly roomId?: string | null | undefined;
  readonly participantId?: string | null | undefined;
  readonly nickname?: string | null | undefined;
}

export interface ResumeReuseQuery {
  readonly deviceId: string;
  readonly roomId?: string | null | undefined;
  readonly participantId?: string | null | undefined;
  readonly nickname?: string | null | undefined;
}

/** 요청이 아직 결정 전(`PENDING`)인지 확인한다. */
export function isResumePending(status: ResumeStatus): status is 'PENDING' {
  return status === 'PENDING';
}

/** 요청이 이미 결정·취소되어 끝난 상태(`APPROVED`·`REJECTED`·`CANCELLED`)인지 확인한다. */
export function isResumeTerminal(status: ResumeStatus): status is ResumeTerminalStatus {
  return status !== 'PENDING';
}

/**
 * 이어 쓰기 상태 전이 가능 여부를 판단한다(PLAN §2.3 ④).
 * 오직 `PENDING → APPROVED | REJECTED | CANCELLED`만 참이며,
 * `PENDING → PENDING`이나 이미 끝난 상태에서의 전이는 거짓이다.
 */
export function canTransitionResumeStatus(from: ResumeStatus, to: ResumeStatus): boolean {
  return from === 'PENDING' && isResumeTerminal(to);
}

/**
 * 이어 쓰기 상태를 전이한다.
 * `PENDING`에서 결정 상태(`APPROVED`·`REJECTED`·`CANCELLED`)로만 바뀌고,
 * 이미 끝난 상태이거나 목표가 `PENDING`이면 현재 상태를 그대로 돌려준다.
 */
export function transitionResumeStatus(current: ResumeStatus, target: ResumeStatus): ResumeStatus {
  return canTransitionResumeStatus(current, target) ? target : current;
}

/** 교사의 허용·거절 불리언 값을 목표 상태(`APPROVED` | `REJECTED`)로 바꾼다. */
export function resolveResumeDecisionStatus(approve: boolean): 'APPROVED' | 'REJECTED' {
  return approve ? 'APPROVED' : 'REJECTED';
}

/**
 * 이어 쓰기 요청 객체에 상태 전이를 적용한다.
 * `PENDING`일 때만 새 상태와 `decidedAt = nowMs`를 기록하고, 이미 끝난 요청은 그대로 돌려준다.
 */
export function transitionResumeRequest<T extends ResumeRequestState>(
  request: T,
  target: ResumeStatus,
  nowMs: number,
): { readonly changed: boolean; readonly request: T } {
  if (!canTransitionResumeStatus(request.status, target)) {
    return { changed: false, request };
  }
  return {
    changed: true,
    request: {
      ...request,
      status: target,
      decidedAt: nowMs,
    },
  };
}

/**
 * 기존 요청이 새 요청과 같은 기기·같은 별명(또는 참가자 ID)의 `PENDING` 대기 요청이어서
 * 새로 만들지 않고 재사용할 수 있는지 판단한다(PLAN §2.3 ④, §5.2 `resume_requests_one_pending`).
 */
export function shouldReusePendingResume(
  existing: ResumeReuseCandidate,
  incoming: ResumeReuseQuery,
): boolean {
  if (existing.status !== 'PENDING') return false;
  if (existing.deviceId.length === 0 || existing.deviceId !== incoming.deviceId) return false;

  if (
    existing.roomId !== undefined &&
    existing.roomId !== null &&
    incoming.roomId !== undefined &&
    incoming.roomId !== null &&
    existing.roomId !== incoming.roomId
  ) {
    return false;
  }

  let matchedIdentity = false;

  if (
    existing.participantId !== undefined &&
    existing.participantId !== null &&
    incoming.participantId !== undefined &&
    incoming.participantId !== null
  ) {
    if (existing.participantId !== incoming.participantId) return false;
    matchedIdentity = true;
  }

  if (
    existing.nickname !== undefined &&
    existing.nickname !== null &&
    incoming.nickname !== undefined &&
    incoming.nickname !== null
  ) {
    const existingKey = nicknameKey(existing.nickname);
    const incomingKey = nicknameKey(incoming.nickname);
    if (existingKey.length === 0 || existingKey !== incomingKey) return false;
    matchedIdentity = true;
  }

  return matchedIdentity;
}

/** 요청 목록에서 재사용할 수 있는 같은 기기·같은 별명의 `PENDING` 요청을 찾는다. */
export function findReusablePendingResume<T extends ResumeReuseCandidate>(
  requests: readonly T[],
  incoming: ResumeReuseQuery,
): T | null {
  for (const req of requests) {
    if (shouldReusePendingResume(req, incoming)) {
      return req;
    }
  }
  return null;
}

/**
 * 긴 조회(`GET .../resume-requests/:id?wait=`)의 대기 시간(초)을 `0 ~ RESUME_LONGPOLL_SEC` 정수 범위로 자른다.
 * 값이 생략(`undefined`·`null`)되면 기본값 `RESUME_LONGPOLL_SEC`(20초)를 돌려준다.
 */
export function clampResumeLongPollSec(
  requestedSec?: number | null | undefined,
  config: ResumeLongPollConfig = defaultConfig,
): number {
  if (requestedSec === undefined || requestedSec === null) {
    return config.RESUME_LONGPOLL_SEC;
  }
  if (!Number.isFinite(requestedSec) || requestedSec <= 0) {
    return 0;
  }
  return Math.min(config.RESUME_LONGPOLL_SEC, Math.floor(requestedSec));
}

/** 긴 조회 대기 시간을 밀리초(`0 ~ RESUME_LONGPOLL_SEC * 1000`)로 계산한다. */
export function clampResumeLongPollMs(
  requestedSec?: number | null | undefined,
  config: ResumeLongPollConfig = defaultConfig,
): number {
  return clampResumeLongPollSec(requestedSec, config) * MS_PER_SECOND;
}

/**
 * 학생 기다림 화면(S6)에서 추가 안내("선생님이 아직 못 보셨어요. 조금 더 기다려요.")가 켜지는 시각(UTC ms)을 계산한다(PRD F-14).
 */
export function computeResumeWaitHintAt(
  createdAtMs: number,
  config: ResumeWaitHintConfig = defaultConfig,
): number {
  return createdAtMs + config.RESUME_WAIT_HINT_MIN * MS_PER_MINUTE;
}

/**
 * 요청한 뒤 `RESUME_WAIT_HINT_MIN`(기본 30분) 이상 지나 추가 기다림 안내를 보일지 판단한다(PRD F-14).
 * 요청이 이미 결정·취소된 상태면 `false`를 돌려준다.
 */
export function shouldShowResumeWaitHint(
  createdAtMs: number,
  nowMs: number,
  config: ResumeWaitHintConfig = defaultConfig,
  status: ResumeStatus = 'PENDING',
): boolean {
  if (status !== 'PENDING') return false;
  return nowMs >= computeResumeWaitHintAt(createdAtMs, config);
}

/** 교사 대시보드 상단 띠에 `모두 허용` 단추를 보일지 판단한다(PRD F-14: 대기 요청 2개 이상). */
export function shouldShowApproveAll(pendingCount: number): boolean {
  return pendingCount >= 2;
}
