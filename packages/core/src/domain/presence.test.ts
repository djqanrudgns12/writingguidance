import { describe, expect, it } from 'vitest';
import { MS_PER_SECOND } from './clock.ts';
import {
  higherPriorityPresence,
  isActivelyWriting,
  isParticipantOffline,
  PRESENCE_PRIORITY,
  resolvePresence,
  resolvePresenceBadgeVariant,
} from './presence.ts';

describe('presence 오프라인 판정 및 상태 우선순위', () => {
  const now = Date.UTC(2026, 10, 11, 10, 0, 0);
  const offlineCfg = { OFFLINE_AFTER_SEC: 10, HEARTBEAT_SEC: 25 };
  const timingCfg = { ACTIVE_WINDOW_SEC: 30, IDLE_AFTER_SEC: 180 };

  it('연결이 0개인 뒤 10초 경계와 하트비트 2회 누락(50초) 경계에서 오프라인을 가른다', () => {
    expect(isParticipantOffline({ activeConnections: 0 }, now, offlineCfg)).toBe(true);
    expect(isParticipantOffline({ activeConnections: 0, disconnectedAt: now - 9999 }, now, offlineCfg)).toBe(
      false,
    );
    expect(
      isParticipantOffline(
        { activeConnections: 0, disconnectedAt: now - 10 * MS_PER_SECOND },
        now,
        offlineCfg,
      ),
    ).toBe(true);

    expect(
      isParticipantOffline({ activeConnections: 1, lastHeartbeatAt: now - 49_999 }, now, offlineCfg),
    ).toBe(false);
    expect(
      isParticipantOffline(
        { activeConnections: 1, lastHeartbeatAt: now - 50 * MS_PER_SECOND },
        now,
        offlineCfg,
      ),
    ).toBe(true);
    expect(isParticipantOffline({ activeConnections: 2 }, now, offlineCfg)).toBe(false);
  });

  it('겹치는 상태에서 항상 SUBMITTED > OFFLINE > IDLE > WRITING 우선순위를 지킨다', () => {
    // 제출한 학생은 오프라인이거나 오래 입력이 없어도 항상 SUBMITTED
    expect(
      resolvePresence({ docStatus: 'SUBMITTED', offline: true, lastInputAt: null }, now, timingCfg),
    ).toBe('SUBMITTED');
    expect(
      resolvePresence({ docStatus: 'SUBMITTED', offline: false, lastInputAt: now }, now, timingCfg),
    ).toBe('SUBMITTED');

    // 초안(DRAFT)·다시 열림(REOPENED)이고 오프라인이면 최근 입력이 있어도 OFFLINE
    expect(
      resolvePresence({ docStatus: 'DRAFT', offline: true, lastInputAt: now - 1000 }, now, timingCfg),
    ).toBe('OFFLINE');
    expect(
      resolvePresence(
        { docStatus: 'REOPENED', offline: true, lastInputAt: now - 500 * MS_PER_SECOND },
        now,
        timingCfg,
      ),
    ).toBe('OFFLINE');

    // 온라인 + 미제출(DRAFT·REOPENED)일 때 180초 이하까지는 WRITING, 180초 초과부터 IDLE
    expect(
      resolvePresence(
        { docStatus: 'DRAFT', offline: false, lastInputAt: now - 180 * MS_PER_SECOND },
        now,
        timingCfg,
      ),
    ).toBe('WRITING');
    expect(
      resolvePresence(
        { docStatus: 'REOPENED', offline: false, lastInputAt: now - 180 * MS_PER_SECOND - 1 },
        now,
        timingCfg,
      ),
    ).toBe('IDLE');

    // 첫 입력 전에도 idleSinceAt 기준 180초 안이면 WRITING, 기준 시각도 없으면 IDLE
    expect(
      resolvePresence(
        {
          docStatus: 'DRAFT',
          offline: false,
          lastInputAt: null,
          idleSinceAt: now - 60 * MS_PER_SECOND,
        },
        now,
        timingCfg,
      ),
    ).toBe('WRITING');
    expect(
      resolvePresence(
        {
          docStatus: 'DRAFT',
          offline: false,
          lastInputAt: null,
          idleSinceAt: now - 181 * MS_PER_SECOND,
        },
        now,
        timingCfg,
      ),
    ).toBe('IDLE');
    expect(resolvePresence({ docStatus: 'DRAFT', offline: false, lastInputAt: null }, now, timingCfg)).toBe(
      'IDLE',
    );
  });

  it('30초 경계에서 채운 연필(writing)과 테두리 연필(writing-flow) 배지를 구분한다', () => {
    expect(isActivelyWriting(null, now, timingCfg)).toBe(false);
    expect(isActivelyWriting(now - 30 * MS_PER_SECOND, now, timingCfg)).toBe(true);
    expect(isActivelyWriting(now - 30 * MS_PER_SECOND - 1, now, timingCfg)).toBe(false);

    expect(
      resolvePresenceBadgeVariant(
        { docStatus: 'DRAFT', offline: false, lastInputAt: now - 30 * MS_PER_SECOND },
        now,
        timingCfg,
      ),
    ).toBe('writing');
    expect(
      resolvePresenceBadgeVariant(
        { docStatus: 'REOPENED', offline: false, lastInputAt: now - 31 * MS_PER_SECOND },
        now,
        timingCfg,
      ),
    ).toBe('writing-flow');
    expect(
      resolvePresenceBadgeVariant(
        { docStatus: 'DRAFT', offline: false, lastInputAt: now - 181 * MS_PER_SECOND },
        now,
        timingCfg,
      ),
    ).toBe('idle');
    expect(
      resolvePresenceBadgeVariant({ docStatus: 'DRAFT', offline: true, lastInputAt: now }, now, timingCfg),
    ).toBe('offline');
    expect(
      resolvePresenceBadgeVariant(
        { docStatus: 'SUBMITTED', offline: true, lastInputAt: null },
        now,
        timingCfg,
      ),
    ).toBe('submitted');
  });

  it('higherPriorityPresence가 PRESENCE_PRIORITY 순서를 그대로 따른다', () => {
    expect(PRESENCE_PRIORITY.SUBMITTED).toBeGreaterThan(PRESENCE_PRIORITY.OFFLINE);
    expect(PRESENCE_PRIORITY.OFFLINE).toBeGreaterThan(PRESENCE_PRIORITY.IDLE);
    expect(PRESENCE_PRIORITY.IDLE).toBeGreaterThan(PRESENCE_PRIORITY.WRITING);

    expect(higherPriorityPresence('WRITING', 'IDLE')).toBe('IDLE');
    expect(higherPriorityPresence('OFFLINE', 'IDLE')).toBe('OFFLINE');
    expect(higherPriorityPresence('OFFLINE', 'SUBMITTED')).toBe('SUBMITTED');
  });
});
