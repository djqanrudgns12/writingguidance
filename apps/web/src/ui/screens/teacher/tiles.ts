import type { StudentStatusKind } from '../../components/StatusBadge.tsx';

/**
 * 대시보드 타일 한 장에 필요한 것(PRD F-17). 결합 쪽이 `summary.batch`·참가자 목록과
 * `resolvePresenceBadgeVariant`(core `domain/presence.ts`)로 만들어 준다.
 */
export interface StudentTileModel {
  readonly participantId: string;
  /** 아직 글 종류를 고르기 전이면 null(타일은 보이되 서랍은 열 글이 없다). */
  readonly docId: string | null;
  readonly nickname: string;
  readonly status: StudentStatusKind;
  /** 타일에 보일 글 종류 이름(`docKindLabel`). 고르기 전이면 빈 글자. */
  readonly genreLabel: string;
  readonly chars: number;
  readonly lastInputAt: number | null;
  /** 제출 시각(제출 상태일 때 "10:31 제출"). */
  readonly submittedAt: number | null;
}

/** 위쪽 필터 칩 4개(PRD F-17). */
export type DashboardFilter = 'all' | 'writing' | 'idle' | 'submitted';

export function tileMatchesFilter(tile: StudentTileModel, filter: DashboardFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'writing') return tile.status === 'writing' || tile.status === 'writing-flow';
  return tile.status === filter;
}

export function countByFilter(tiles: readonly StudentTileModel[]): Record<DashboardFilter, number> {
  return {
    all: tiles.length,
    writing: tiles.filter(t => tileMatchesFilter(t, 'writing')).length,
    idle: tiles.filter(t => tileMatchesFilter(t, 'idle')).length,
    submitted: tiles.filter(t => tileMatchesFilter(t, 'submitted')).length,
  };
}

const nicknameCollator = new Intl.Collator('ko');

/** 별명 가나다순 고정(PRD F-17: 상태가 바뀌어도 타일이 움직이지 않게). */
export function sortTilesByNickname(tiles: readonly StudentTileModel[]): StudentTileModel[] {
  return [...tiles].sort(
    (a, b) =>
      nicknameCollator.compare(a.nickname, b.nickname) || a.participantId.localeCompare(b.participantId),
  );
}
