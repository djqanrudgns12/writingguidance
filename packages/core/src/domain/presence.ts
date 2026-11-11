import { defaultConfig, type Config } from '../config.ts';
import { MS_PER_SECOND } from './clock.ts';
import type { DocStatus, PresenceState } from './status.ts';

/**
 * 교사 대시보드 접속·활동 상태 계산(PRD F-17, PLAN §4.6·§10.2).
 * 상태가 겹치면 `SUBMITTED(제출) > OFFLINE(오프라인) > IDLE(멈춤) > WRITING(쓰는 중)` 순으로 하나만 보인다.
 */

export type OfflineConfig = Pick<Config, 'OFFLINE_AFTER_SEC' | 'HEARTBEAT_SEC'>;
export type PresenceTimingConfig = Pick<Config, 'ACTIVE_WINDOW_SEC' | 'IDLE_AFTER_SEC'>;

/** 상태 우선순위 숫자(클수록 우선). */
export const PRESENCE_PRIORITY: Readonly<Record<PresenceState, number>> = {
  SUBMITTED: 4,
  OFFLINE: 3,
  IDLE: 2,
  WRITING: 1,
};

/** 화면 `StatusBadge` 부품과 1:1로 대응하는 세부 표현(30초 안 채운 연필 vs 30~180초 테두리 연필). */
export type PresenceBadgeVariant = 'writing' | 'writing-flow' | 'idle' | 'submitted' | 'offline';

export interface OfflineCheckInput {
  readonly activeConnections: number;
  readonly disconnectedAt?: number | null | undefined;
  readonly lastHeartbeatAt?: number | null | undefined;
}

export interface PresenceInput {
  readonly docStatus: DocStatus;
  readonly offline: boolean;
  readonly lastInputAt: number | null;
  /** 아직 첫 입력 전일 때 멈춤 시간을 잴 기준 시각(예: 글 생성 시각·입장 시각). */
  readonly idleSinceAt?: number | null | undefined;
}

/**
 * 참가자의 연결 정보로 오프라인 여부를 판정한다(PRD F-17, PLAN §4.6).
 * - 열린 연결이 0개이고 끊긴 시각이 없거나 `OFFLINE_AFTER_SEC`(10초) 이상 지났으면 오프라인.
 * - 연결이 남아 있어도 마지막 하트비트가 `2 * HEARTBEAT_SEC` 이상 멈췄으면(하트비트 두 번 놓침) 오프라인.
 */
export function isParticipantOffline(
  conn: OfflineCheckInput,
  nowMs: number,
  config: OfflineConfig = defaultConfig,
): boolean {
  if (conn.activeConnections <= 0) {
    if (conn.disconnectedAt === undefined || conn.disconnectedAt === null) return true;
    return nowMs - conn.disconnectedAt >= config.OFFLINE_AFTER_SEC * MS_PER_SECOND;
  }

  if (conn.lastHeartbeatAt !== undefined && conn.lastHeartbeatAt !== null) {
    const missedTwoHeartbeatsMs = 2 * config.HEARTBEAT_SEC * MS_PER_SECOND;
    if (nowMs - conn.lastHeartbeatAt >= missedTwoHeartbeatsMs) return true;
  }

  return false;
}

/** 최근 `ACTIVE_WINDOW_SEC`(30초) 안에 실제 입력이 있었는지(채운 연필 아이콘 기준, PRD F-17). */
export function isActivelyWriting(
  lastInputAt: number | null,
  nowMs: number,
  config: Pick<Config, 'ACTIVE_WINDOW_SEC'> = defaultConfig,
): boolean {
  if (lastInputAt === null) return false;
  return nowMs - lastInputAt <= config.ACTIVE_WINDOW_SEC * MS_PER_SECOND;
}

/**
 * 대시보드 상태 4종 계산(우선순위: `SUBMITTED > OFFLINE > IDLE > WRITING`).
 * - 최근 입력(또는 `idleSinceAt`) 후 `IDLE_AFTER_SEC`(180초) 이하까지는 `WRITING`이고,
 *   180초를 넘으면(`>`) `IDLE`이다(PRD F-17 "30초~180초 사이도 쓰는 중, 180초 넘게 입력 없음 = 멈춤").
 */
export function resolvePresence(
  input: PresenceInput,
  nowMs: number,
  config: Pick<Config, 'IDLE_AFTER_SEC'> = defaultConfig,
): PresenceState {
  if (input.docStatus === 'SUBMITTED') return 'SUBMITTED';
  if (input.offline) return 'OFFLINE';

  const referenceAt = input.lastInputAt ?? input.idleSinceAt ?? null;
  if (referenceAt === null) return 'IDLE';
  if (nowMs - referenceAt > config.IDLE_AFTER_SEC * MS_PER_SECOND) return 'IDLE';

  return 'WRITING';
}

/** 대시보드 배지 변형(`writing` 채운 연필 vs `writing-flow` 테두리 연필 포함)을 계산한다. */
export function resolvePresenceBadgeVariant(
  input: PresenceInput,
  nowMs: number,
  config: PresenceTimingConfig = defaultConfig,
): PresenceBadgeVariant {
  const state = resolvePresence(input, nowMs, config);
  if (state === 'SUBMITTED') return 'submitted';
  if (state === 'OFFLINE') return 'offline';
  if (state === 'IDLE') return 'idle';
  return isActivelyWriting(input.lastInputAt, nowMs, config) ? 'writing' : 'writing-flow';
}

/** 두 `PresenceState` 중 우선순위가 더 높은 상태를 고른다. */
export function higherPriorityPresence(a: PresenceState, b: PresenceState): PresenceState {
  return PRESENCE_PRIORITY[a] >= PRESENCE_PRIORITY[b] ? a : b;
}
