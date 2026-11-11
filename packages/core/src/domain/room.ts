import { defaultConfig, type Config } from '../config.ts';
import { isExpired, isInExpiryWarningWindow, type ExpiryWarningConfig } from './retention.ts';
import type { RoomDbStatus, RoomStatus } from './status.ts';

/**
 * 수업방 상태 판단(PRD F-02·F-17·F-22·F-23, PLAN §4.3).
 * DB에는 `ACTIVE`·`CLOSED`만 저장하고, 만료·삭제는 시각과 행 존재 여부로 결정한다.
 */

export interface RoomStateInput {
  readonly dbStatus: RoomDbStatus;
  readonly expiresAt: number;
  readonly deleted?: boolean | undefined;
}

export type RecentRoomsConfig = Pick<Config, 'RECENT_ROOMS_MAX'>;

/**
 * 현재 시각 기준 화면·프로토콜 수업방 상태를 계산한다.
 * 우선순위: 삭제(`DELETED`) > 만료(`EXPIRED`) > DB 상태(`ACTIVE` | `CLOSED`).
 */
export function resolveRoomStatus(room: RoomStateInput, nowMs: number): RoomStatus {
  if (room.deleted) return 'DELETED';
  if (isExpired(room.expiresAt, nowMs)) return 'EXPIRED';
  return room.dbStatus;
}

/** 새 학생 입장이 가능한 수업방 상태인가(PRD F-02: 닫힘·만료·삭제면 새 입장 차단). */
export function canJoinRoom(status: RoomStatus): boolean {
  return status === 'ACTIVE';
}

/** 이미 들어온 학생이나 교사가 열람할 수 있는 살아 있는 수업방인가. */
export function isRoomAccessible(status: RoomStatus): boolean {
  return status === 'ACTIVE' || status === 'CLOSED';
}

/** 이미 들어온 학생에게 읽기 전용으로 보이는 닫힌 상태인가(PRD F-02). */
export function isRoomReadOnlyForStudent(status: RoomStatus): boolean {
  return status === 'CLOSED';
}

/** 학생 화면 상단에 닫힘 안내 띠("지금은 읽기만 할 수 있어요")를 띄울지 판단한다. */
export function shouldShowClosedBanner(status: RoomStatus): boolean {
  return status === 'CLOSED';
}

/**
 * 교사 대시보드에 삭제 예정 3일 전 경고 띠를 띄울지 판단한다(PRD F-17).
 * 살아 있는 수업방(`ACTIVE`·`CLOSED`)이면서 경고 기간 안일 때만 참이다.
 */
export function shouldShowExpiryBanner(
  room: RoomStateInput,
  nowMs: number,
  config: ExpiryWarningConfig = defaultConfig,
): boolean {
  const status = resolveRoomStatus(room, nowMs);
  if (!isRoomAccessible(status)) return false;
  return isInExpiryWarningWindow(room.expiresAt, nowMs, config);
}

/**
 * 기기 기억의 최근 수업방 목록에서 만료된 항목을 걸러내고 상한(`RECENT_ROOMS_MAX`)까지만 남긴다(PRD F-23).
 * 입력 배열의 순서(최근 사용순)는 그대로 유지한다.
 */
export function filterAliveRoomMemories<T extends { readonly expiresAt: number }>(
  items: readonly T[],
  nowMs: number,
  config: RecentRoomsConfig = defaultConfig,
): T[] {
  const alive: T[] = [];
  for (const item of items) {
    if (isExpired(item.expiresAt, nowMs)) continue;
    alive.push(item);
    if (alive.length >= config.RECENT_ROOMS_MAX) break;
  }
  return alive;
}
