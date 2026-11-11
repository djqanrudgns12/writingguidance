import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MS_PER_MINUTE, MS_PER_SECOND } from './clock.ts';
import {
  pruneSnapshots,
  selectSnapshotsToPrune,
  shouldTakeAutoSnapshot,
  type SnapshotMeta,
} from './snapshotPolicy.ts';
import { SNAPSHOT_REASONS } from './status.ts';

describe('snapshotPolicy 자동 스냅샷 간격·300개 솎기', () => {
  const now = Date.UTC(2026, 10, 11, 12, 0, 0);

  it('변경이 있을 때 첫 스냅샷이거나 SNAPSHOT_INTERVAL_SEC 이상 지났을 때만 찍는다', () => {
    expect(shouldTakeAutoSnapshot({ changed: false, lastAutoAtMs: null, nowMs: now })).toBe(false);
    expect(shouldTakeAutoSnapshot({ changed: true, lastAutoAtMs: null, nowMs: now })).toBe(true);

    const last = now - 30 * MS_PER_SECOND;
    expect(
      shouldTakeAutoSnapshot(
        { changed: true, lastAutoAtMs: last + 1, nowMs: now },
        {
          SNAPSHOT_INTERVAL_SEC: 30,
        },
      ),
    ).toBe(false);
    expect(
      shouldTakeAutoSnapshot(
        { changed: true, lastAutoAtMs: last, nowMs: now },
        {
          SNAPSHOT_INTERVAL_SEC: 30,
        },
      ),
    ).toBe(true);
  });

  it('총 개수가 SNAPSHOT_MAX 이하이면 아무것도 솎지 않는다', () => {
    const snaps: SnapshotMeta[] = Array.from({ length: 300 }, (_, i) => ({
      id: `s-${i}`,
      createdAt: now - (300 - i) * 30 * MS_PER_SECOND,
      reason: 'AUTO',
    }));
    expect(selectSnapshotsToPrune(snaps, now, { SNAPSHOT_MAX: 300 })).toEqual([]);
    expect(pruneSnapshots(snaps, now, { SNAPSHOT_MAX: 300 }).keep).toHaveLength(300);
  });

  it('300개 초과 시 최근 10분 전체·10~60분 1분 간격·60분 초과 5분 간격으로 AUTO만 솎고 이벤트 스냅샷은 지킨다', () => {
    const snaps: SnapshotMeta[] = [];
    // 180분 전부터 현재까지 30초마다 AUTO 360개 생성
    for (let i = 360; i >= 1; i--) {
      snaps.push({
        id: `auto-${i}`,
        createdAt: now - i * 30 * MS_PER_SECOND,
        reason: 'AUTO',
      });
    }
    // 비-AUTO 이벤트 스냅샷 4개 추가(오래된 구간 포함)
    const events: SnapshotMeta[] = [
      { id: 'ev-submit', createdAt: now - 150 * MS_PER_MINUTE, reason: 'SUBMIT' },
      { id: 'ev-ai', createdAt: now - 90 * MS_PER_MINUTE, reason: 'AI' },
      { id: 'ev-teacher', createdAt: now - 40 * MS_PER_MINUTE, reason: 'TEACHER' },
      { id: 'ev-restore', createdAt: now - 5 * MS_PER_MINUTE, reason: 'RESTORE' },
    ];
    const all = [...snaps, ...events];

    const { keep, dropIds } = pruneSnapshots(all, now, { SNAPSHOT_MAX: 300 });

    expect(dropIds.length).toBeGreaterThan(0);
    expect(keep.length).toBeLessThanOrEqual(300);

    // 모든 이벤트 스냅샷 보존
    for (const ev of events) {
      expect(keep.some(k => k.id === ev.id)).toBe(true);
    }

    // 최근 10분 안(i = 1..20 -> 30초~10분 전)의 AUTO 20개는 전부 살아남는다.
    const recentAutos = keep.filter(k => k.reason === 'AUTO' && now - k.createdAt <= 10 * MS_PER_MINUTE);
    expect(recentAutos).toHaveLength(20);

    // 10~60분 사이 살아남은 AUTO는 인접 간격이 모두 1분 이상이다.
    const midAutos = keep
      .filter(
        k =>
          k.reason === 'AUTO' &&
          now - k.createdAt > 10 * MS_PER_MINUTE &&
          now - k.createdAt <= 60 * MS_PER_MINUTE,
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 1; i < midAutos.length; i++) {
      expect((midAutos[i]?.createdAt ?? 0) - (midAutos[i - 1]?.createdAt ?? 0)).toBeGreaterThanOrEqual(
        MS_PER_MINUTE,
      );
    }

    // 60분 초과 구간 살아남은 AUTO는 인접 간격이 모두 5분 이상이다.
    const oldAutos = keep
      .filter(k => k.reason === 'AUTO' && now - k.createdAt > 60 * MS_PER_MINUTE)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 1; i < oldAutos.length; i++) {
      expect((oldAutos[i]?.createdAt ?? 0) - (oldAutos[i - 1]?.createdAt ?? 0)).toBeGreaterThanOrEqual(
        5 * MS_PER_MINUTE,
      );
    }
  });

  it('최근 10분 안에만 AUTO가 몰려 상한을 넘어도 가장 오래된 AUTO부터 추가로 지워 상한을 맞춘다', () => {
    const denseRecent: SnapshotMeta[] = Array.from({ length: 12 }, (_, i) => ({
      id: `r-${String(i).padStart(2, '0')}`,
      createdAt: now - (12 - i) * MS_PER_SECOND,
      reason: 'AUTO',
    }));
    const { keep, dropIds } = pruneSnapshots(denseRecent, now, { SNAPSHOT_MAX: 5 });
    expect(dropIds).toEqual(['r-00', 'r-01', 'r-02', 'r-03', 'r-04', 'r-05', 'r-06']);
    expect(keep.map(k => k.id)).toEqual(['r-07', 'r-08', 'r-09', 'r-10', 'r-11']);
  });

  it('비-AUTO 스냅샷만으로도 상한을 넘을 때는 단 하나도 지우지 않는다', () => {
    const onlyEvents: SnapshotMeta[] = Array.from({ length: 8 }, (_, i) => ({
      id: `e-${i}`,
      createdAt: now - i * MS_PER_MINUTE,
      reason: 'AI',
    }));
    expect(selectSnapshotsToPrune(onlyEvents, now, { SNAPSHOT_MAX: 5 })).toEqual([]);
  });

  it('[성질] 비-AUTO 스냅샷은 절대 지워지지 않으며, 솎기 후 개수는 max(SNAPSHOT_MAX, 비-AUTO 수) 이하이고 멱등이다', () => {
    const snapshotArb = fc.record({
      ageMs: fc.integer({ min: 0, max: 180 * MS_PER_MINUTE }),
      reason: fc.constantFrom(...SNAPSHOT_REASONS),
    });

    fc.assert(
      fc.property(
        fc.array(snapshotArb, { minLength: 0, maxLength: 60 }),
        fc.integer({ min: 1, max: 30 }),
        (rawItems, maxLimit) => {
          const items: SnapshotMeta[] = rawItems.map((item, idx) => ({
            id: `snap-${String(idx).padStart(3, '0')}`,
            createdAt: now - item.ageMs,
            reason: item.reason,
          }));
          const nonAutoIds = items.filter(s => s.reason !== 'AUTO').map(s => s.id);

          const first = pruneSnapshots(items, now, { SNAPSHOT_MAX: maxLimit });

          // 1. 지워진 ID는 모두 원래 AUTO였던 것이어야 한다.
          const reasonById = new Map(items.map(s => [s.id, s.reason]));
          for (const id of first.dropIds) {
            expect(reasonById.get(id)).toBe('AUTO');
          }

          // 2. 모든 비-AUTO는 그대로 남아야 한다.
          const keptIds = new Set(first.keep.map(s => s.id));
          for (const id of nonAutoIds) {
            expect(keptIds.has(id)).toBe(true);
          }

          // 3. 상한 불변식
          expect(first.keep.length).toBeLessThanOrEqual(Math.max(maxLimit, nonAutoIds.length));

          // 4. 같은 시각·설정으로 다시 돌리면 더 지우는 것이 없다(멱등).
          const second = pruneSnapshots(first.keep, now, { SNAPSHOT_MAX: maxLimit });
          expect(second.dropIds).toEqual([]);
          expect(second.keep).toEqual(first.keep);
        },
      ),
      { numRuns: 150 },
    );
  });
});
