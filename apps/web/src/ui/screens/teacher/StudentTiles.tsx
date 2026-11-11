import { ko } from '@geulbang/core/copy';
import { type ReactNode } from 'react';
import { Chip } from '../../components/Chip.tsx';
import { StudentTile } from '../../components/StudentTile.tsx';
import { formatAgo, formatClock } from './format.ts';
import styles from './StudentTiles.module.css';
import { countByFilter, tileMatchesFilter, type DashboardFilter, type StudentTileModel } from './tiles.ts';

const FILTERS: readonly { readonly id: DashboardFilter; readonly label: string }[] = [
  { id: 'all', label: ko.teacher.filterAll },
  { id: 'writing', label: ko.teacher.statusWriting },
  { id: 'idle', label: ko.teacher.statusIdle },
  { id: 'submitted', label: ko.teacher.statusSubmitted },
];

export function tileTimeText(tile: StudentTileModel, nowMs: number): string {
  if (tile.status === 'submitted' && tile.submittedAt !== null) {
    return `${formatClock(tile.submittedAt)} ${ko.teacher.submittedAtSuffix}`;
  }
  return tile.lastInputAt === null ? '' : formatAgo(tile.lastInputAt, nowMs);
}

export interface FilterChipsProps {
  readonly tiles: readonly StudentTileModel[];
  readonly filter: DashboardFilter;
  readonly onFilterChange: (filter: DashboardFilter) => void;
  readonly className?: string | undefined;
}

/** 위쪽 필터 칩 4개와 개수(PRD F-17). */
export function FilterChips({ tiles, filter, onFilterChange, className }: FilterChipsProps) {
  const counts = countByFilter(tiles);
  return (
    <div
      className={[styles.filters, className ?? ''].filter(Boolean).join(' ')}
      role="group"
      aria-label={ko.teacher.filterGroupLabel}
    >
      {FILTERS.map(f => (
        <Chip key={f.id} selected={filter === f.id} count={counts[f.id]} onClick={() => onFilterChange(f.id)}>
          {f.label}
        </Chip>
      ))}
    </div>
  );
}

export interface StudentTilesGridProps {
  /** 이미 별명 순으로 정렬된 타일(`sortTilesByNickname`). */
  readonly tiles: readonly StudentTileModel[];
  readonly filter: DashboardFilter;
  readonly nowMs: number;
  readonly selectedParticipantId?: string | null | undefined;
  readonly onSelect: (participantId: string) => void;
  /** 필터에 맞는 타일이 없을 때 보일 것. */
  readonly emptyFilter?: ReactNode | undefined;
}

/**
 * 학생 타일 격자(PRD F-17·8.4). 타일은 장식 없이 12px·옅은 선·왼쪽 상태 띠(`StudentTile` 부품).
 * 필터로 숨겨도 남은 타일의 순서는 그대로다.
 */
export function StudentTilesGrid({
  tiles,
  filter,
  nowMs,
  selectedParticipantId = null,
  onSelect,
  emptyFilter,
}: StudentTilesGridProps) {
  const visible = tiles.filter(t => tileMatchesFilter(t, filter));
  if (visible.length === 0) return emptyFilter ? <>{emptyFilter}</> : null;
  return (
    <ul className={styles.grid}>
      {visible.map(tile => (
        <li key={tile.participantId} className={styles.cell}>
          <StudentTile
            nickname={tile.nickname}
            status={tile.status}
            genreLabel={tile.genreLabel}
            charCount={tile.chars}
            timeText={tileTimeText(tile, nowMs)}
            selected={selectedParticipantId === tile.participantId}
            // 서랍을 닫으면 대시보드가 이 값으로 연 타일을 찾아 초점을 돌려준다(P5-1 [상-1]).
            data-participant-id={tile.participantId}
            onClick={() => onSelect(tile.participantId)}
          />
        </li>
      ))}
    </ul>
  );
}
