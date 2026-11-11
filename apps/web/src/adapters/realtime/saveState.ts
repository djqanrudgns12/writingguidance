import { snapshotCovers, type CoverageSnapshot } from '@geulbang/core/protocol';
import type { SaveState } from '../../ports/realtime.ts';

/**
 * 저장 상태 계산(PRD F-09, PLAN §6.5). 순수 함수라 시험하기 쉽다.
 * `저장됨`은 서버 DB에 이 기기의 상태가 다 들어갔을 때만이다(ADR-049): 서버가 받기만 하고 아직 쓰기 전이면 `보내는 중`.
 */
export interface SaveInputs {
  /** 소켓이 열려 있고 이 글이 동기화됨 */
  readonly online: boolean;
  /** 서버가 아직 받았다고 하지 않은 내 편집 수 */
  readonly unsynced: number;
  /** 마지막 `doc.persisted`가 기기 상태(지우기 포함, `persistedCovers`)를 다 덮는가 */
  readonly persistedCoversLocal: boolean;
  /** 서버가 저장 실패를 알렸고 아직 회복 알림이 없음 */
  readonly persistFailed: boolean;
  readonly locked: boolean;
}

export function computeSaveState(i: SaveInputs): SaveState {
  if (i.locked) return 'locked';
  if (!i.online) return 'local';
  if (i.unsynced > 0 || i.persistFailed || !i.persistedCoversLocal) return 'sending';
  return 'saved';
}

/** 상태 벡터 `saved`가 `local`의 모든 클라이언트 시계를 덮는가. */
export function stateVectorCovers(
  saved: ReadonlyMap<number, number>,
  local: ReadonlyMap<number, number>,
): boolean {
  for (const [client, clock] of local) if ((saved.get(client) ?? 0) < clock) return false;
  return true;
}

/**
 * 마지막 `doc.persisted` 표시. 판 N 서버는 스냅숏(상태 벡터 + 삭제 집합)을 주고, 판 N-1 서버는 상태 벡터만 준다.
 */
export type PersistedMark =
  | { readonly kind: 'snapshot'; readonly snapshot: CoverageSnapshot }
  | { readonly kind: 'vector'; readonly vector: ReadonlyMap<number, number> };

/**
 * 저장 표시가 기기 상태를 덮는가(검토 5번). 스냅숏이면 지우기까지 본다(`coverage.ts`).
 * 상태 벡터만 있으면(판 N-1) 지우기만 한 변경을 놓칠 수 있지만 예전과 같은 판정으로 둔다.
 */
export function persistedCovers(mark: PersistedMark | null, local: CoverageSnapshot): boolean {
  if (!mark) return stateVectorCovers(new Map(), local.sv);
  return mark.kind === 'snapshot'
    ? snapshotCovers(mark.snapshot, local)
    : stateVectorCovers(mark.vector, local.sv);
}
