import { describe, expect, it } from 'vitest';
import { MS_PER_DAY } from './clock.ts';
import {
  canJoinRoom,
  filterAliveRoomMemories,
  isRoomAccessible,
  isRoomReadOnlyForStudent,
  resolveRoomStatus,
  shouldShowClosedBanner,
  shouldShowExpiryBanner,
} from './room.ts';

describe('room 상태 판단', () => {
  const now = Date.UTC(2026, 10, 10, 0, 0, 0);
  const future = now + 10 * MS_PER_DAY;

  it('우선순위는 DELETED > EXPIRED > ACTIVE/CLOSED 순이다', () => {
    expect(resolveRoomStatus({ dbStatus: 'ACTIVE', expiresAt: future }, now)).toBe('ACTIVE');
    expect(resolveRoomStatus({ dbStatus: 'CLOSED', expiresAt: future }, now)).toBe('CLOSED');
    expect(resolveRoomStatus({ dbStatus: 'ACTIVE', expiresAt: now }, now)).toBe('EXPIRED');
    expect(resolveRoomStatus({ dbStatus: 'CLOSED', expiresAt: now - 1 }, now)).toBe('EXPIRED');
    expect(resolveRoomStatus({ dbStatus: 'ACTIVE', expiresAt: future, deleted: true }, now)).toBe('DELETED');
    expect(resolveRoomStatus({ dbStatus: 'CLOSED', expiresAt: now - 1, deleted: true }, now)).toBe('DELETED');
  });

  it('입장·열람·읽기 전용·닫힘 안내 띠 여부를 상태별로 가른다', () => {
    expect(canJoinRoom('ACTIVE')).toBe(true);
    expect(canJoinRoom('CLOSED')).toBe(false);
    expect(canJoinRoom('EXPIRED')).toBe(false);
    expect(canJoinRoom('DELETED')).toBe(false);

    expect(isRoomAccessible('ACTIVE')).toBe(true);
    expect(isRoomAccessible('CLOSED')).toBe(true);
    expect(isRoomAccessible('EXPIRED')).toBe(false);
    expect(isRoomAccessible('DELETED')).toBe(false);

    expect(isRoomReadOnlyForStudent('CLOSED')).toBe(true);
    expect(isRoomReadOnlyForStudent('ACTIVE')).toBe(false);
    expect(shouldShowClosedBanner('CLOSED')).toBe(true);
    expect(shouldShowClosedBanner('ACTIVE')).toBe(false);
  });

  it('삭제 예정 3일 전 경고 띠는 살아 있는 방(ACTIVE·CLOSED)이 경고 창 안에 있을 때만 켠다', () => {
    const expiresIn2Days = now + 2 * MS_PER_DAY;
    const expiresIn4Days = now + 4 * MS_PER_DAY;
    const cfg = { EXPIRY_WARNING_DAYS: 3 };

    expect(shouldShowExpiryBanner({ dbStatus: 'ACTIVE', expiresAt: expiresIn4Days }, now, cfg)).toBe(false);
    expect(shouldShowExpiryBanner({ dbStatus: 'ACTIVE', expiresAt: expiresIn2Days }, now, cfg)).toBe(true);
    expect(shouldShowExpiryBanner({ dbStatus: 'CLOSED', expiresAt: expiresIn2Days }, now, cfg)).toBe(true);
    expect(shouldShowExpiryBanner({ dbStatus: 'ACTIVE', expiresAt: now }, now, cfg)).toBe(false);
    expect(
      shouldShowExpiryBanner({ dbStatus: 'ACTIVE', expiresAt: expiresIn2Days, deleted: true }, now, cfg),
    ).toBe(false);
  });

  it('최근 수업방 목록에서 만료된 방을 빼고 RECENT_ROOMS_MAX 개수까지만 순서대로 남긴다', () => {
    const memories = [
      { roomId: 'r1', expiresAt: now + 5000 },
      { roomId: 'r2', expiresAt: now }, // 정각 만료 -> 제외
      { roomId: 'r3', expiresAt: now + 1000 },
      { roomId: 'r4', expiresAt: now - 100 }, // 지남 -> 제외
      { roomId: 'r5', expiresAt: now + 2000 },
      { roomId: 'r6', expiresAt: now + 3000 },
      { roomId: 'r7', expiresAt: now + 4000 },
      { roomId: 'r8', expiresAt: now + 6000 },
    ];

    const filtered = filterAliveRoomMemories(memories, now, { RECENT_ROOMS_MAX: 5 });
    expect(filtered.map(m => m.roomId)).toEqual(['r1', 'r3', 'r5', 'r6', 'r7']);
  });
});
