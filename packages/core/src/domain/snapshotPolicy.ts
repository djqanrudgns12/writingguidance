import { defaultConfig, type Config } from '../config.ts';
import { MS_PER_MINUTE, MS_PER_SECOND } from './clock.ts';
import type { SnapshotReason } from './status.ts';

/**
 * 시간 되감기 스냅샷 정책(PRD F-10, PLAN §4.5, ADR-007).
 * - 자동 스냅샷: 글이 바뀐 채 `SNAPSHOT_INTERVAL_SEC`(30초)가 지날 때마다 저장.
 * - 상한 정리: 문서당 총 개수가 `SNAPSHOT_MAX`(300)를 넘으면 `AUTO` 스냅샷만 간격을 넓혀 솎고
 *   이벤트 스냅샷(`SUBMIT`·`AI`·`TEACHER`·`RESTORE`)은 절대 지우지 않는다.
 */

export type AutoSnapshotConfig = Pick<Config, 'SNAPSHOT_INTERVAL_SEC'>;
export type SnapshotPruneConfig = Pick<Config, 'SNAPSHOT_MAX'>;

export interface AutoSnapshotCheckInput {
  readonly changed: boolean;
  readonly lastAutoAtMs: number | null;
  readonly nowMs: number;
}

export interface SnapshotMeta {
  readonly id: string;
  readonly createdAt: number;
  readonly reason: SnapshotReason;
}

/** PRD F-10 고정 솎기 구간: 최근 10분 전체 유지, 10~60분 1분 간격, 60분 초과 5분 간격. */
const RECENT_KEEP_ALL_MS = 10 * MS_PER_MINUTE;
const MID_WINDOW_MS = 60 * MS_PER_MINUTE;
const MID_STRIDE_MS = MS_PER_MINUTE;
const OLD_STRIDE_MS = 5 * MS_PER_MINUTE;

/** 지금 저장 시점에 새 `AUTO` 스냅샷을 남길지 판단한다. */
export function shouldTakeAutoSnapshot(
  input: AutoSnapshotCheckInput,
  config: AutoSnapshotConfig = defaultConfig,
): boolean {
  if (!input.changed) return false;
  if (input.lastAutoAtMs === null) return true;
  return input.nowMs - input.lastAutoAtMs >= config.SNAPSHOT_INTERVAL_SEC * MS_PER_SECOND;
}

function compareSnapshotChronological(a: SnapshotMeta, b: SnapshotMeta): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 상한(`SNAPSHOT_MAX`) 초과 시 삭제할 `AUTO` 스냅샷 ID 목록을 고른다.
 * 1단계: PRD F-10 구간별 간격(60분 초과 → 5분당 1개, 10~60분 → 1분당 1개, 최근 10분 → 모두 유지)으로 `AUTO`를 솎는다.
 * 2단계: 1단계 뒤에도 전체 개수가 `SNAPSHOT_MAX`를 넘으면(예: 짧은 시험 간격·많은 이벤트 스냅샷),
 *        남아 있는 `AUTO` 중 가장 오래된 것부터 상한 이하가 될 때까지만 추가로 솎는다.
 * 비-AUTO 스냅샷은 어떤 경우에도 선택하지 않는다.
 */
export function selectSnapshotsToPrune(
  snapshots: readonly SnapshotMeta[],
  nowMs: number,
  config: SnapshotPruneConfig = defaultConfig,
): string[] {
  if (snapshots.length <= config.SNAPSHOT_MAX) return [];

  const autos = snapshots.filter(s => s.reason === 'AUTO').sort(compareSnapshotChronological);
  if (autos.length === 0) return [];

  const dropped = new Set<string>();
  const survivorsAfterTier: SnapshotMeta[] = [];

  let lastKeptOldAt: number | null = null;
  let lastKeptMidAt: number | null = null;

  for (const snap of autos) {
    const ageMs = nowMs - snap.createdAt;

    if (ageMs > MID_WINDOW_MS) {
      if (lastKeptOldAt !== null && snap.createdAt - lastKeptOldAt < OLD_STRIDE_MS) {
        dropped.add(snap.id);
      } else {
        lastKeptOldAt = snap.createdAt;
        survivorsAfterTier.push(snap);
      }
      continue;
    }

    if (ageMs > RECENT_KEEP_ALL_MS) {
      if (lastKeptMidAt !== null && snap.createdAt - lastKeptMidAt < MID_STRIDE_MS) {
        dropped.add(snap.id);
      } else {
        lastKeptMidAt = snap.createdAt;
        survivorsAfterTier.push(snap);
      }
      continue;
    }

    survivorsAfterTier.push(snap);
  }

  let excess = snapshots.length - dropped.size - config.SNAPSHOT_MAX;
  if (excess > 0) {
    for (const snap of survivorsAfterTier) {
      if (excess <= 0) break;
      dropped.add(snap.id);
      excess--;
    }
  }

  const orderedDropIds: string[] = [];
  for (const snap of autos) {
    if (dropped.has(snap.id)) orderedDropIds.push(snap.id);
  }
  return orderedDropIds;
}

/** 솎기 결과를 남길 배열(`keep`)과 지울 ID(`dropIds`)로 함께 돌려준다. */
export function pruneSnapshots<T extends SnapshotMeta>(
  snapshots: readonly T[],
  nowMs: number,
  config: SnapshotPruneConfig = defaultConfig,
): { readonly keep: T[]; readonly dropIds: string[] } {
  const dropIds = selectSnapshotsToPrune(snapshots, nowMs, config);
  if (dropIds.length === 0) {
    return { keep: [...snapshots], dropIds: [] };
  }
  const dropSet = new Set(dropIds);
  return {
    keep: snapshots.filter(s => !dropSet.has(s.id)),
    dropIds,
  };
}
