import type { SnapshotReason } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { Button } from '../../components/Button.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { Slider } from '../../components/Slider.tsx';
import { Icon } from '../../icons/Icon.tsx';
import { formatAgo, joinDot, snapshotReasonLabel } from './format.ts';
import styles from './RewindSheet.module.css';

/** 시간 되감기 목록 한 칸(`snapshot.list`, PLAN §4.4). 오래된 것부터. */
export interface RewindItem {
  readonly id: string;
  readonly at: number;
  readonly reason: SnapshotReason;
}

export interface RewindPanelViewProps {
  readonly items: readonly RewindItem[];
  /** 슬라이더가 가리키는 칸(0 = 가장 오래된 것). */
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  /** 고른 때의 글(`snapshot.get`). 받는 중이면 null. */
  readonly preview: { readonly title: string; readonly body: string } | null;
  readonly onRestore: () => void;
  readonly restoring?: boolean | undefined;
  readonly loading?: boolean | undefined;
  readonly offline?: boolean | undefined;
  readonly nowMs: number;
}

/**
 * 시간 되감기 내용(PRD F-10, 교사 서랍에서). 슬라이더 하나와 "3분 전 · 제출할 때", 그때의 글 미리 보기, `이때 글로 돌리기`.
 */
export function RewindPanelView({
  items,
  index,
  onIndexChange,
  preview,
  onRestore,
  restoring = false,
  loading = false,
  offline = false,
  nowMs,
}: RewindPanelViewProps) {
  if (offline) {
    return (
      <p className={styles.notice}>
        <Icon name="offline" size={20} />
        {ko.common.rewindOfflineGuide}
      </p>
    );
  }
  if (loading) return <Skeleton variant="card" lines={4} />;
  if (items.length === 0) {
    return (
      <p className={styles.notice}>
        <Icon name="clock" size={20} />
        {ko.common.rewindEmpty}
      </p>
    );
  }

  const safeIndex = Math.min(Math.max(0, index), items.length - 1);
  const current = items[safeIndex];
  const valueText = current ? joinDot(formatAgo(current.at, nowMs), snapshotReasonLabel(current.reason)) : '';

  return (
    <div className={styles.panel}>
      <Slider
        min={0}
        max={items.length - 1}
        step={1}
        value={safeIndex}
        valueText={valueText}
        onValueChange={onIndexChange}
      />
      {/* 넘치는 지난 글을 키보드로도 넘겨 보게 초점을 받는다(P5-1 [하-2]). */}
      <article
        className={styles.preview}
        aria-label={ko.common.rewindPreviewLabel}
        aria-busy={preview === null || undefined}
        tabIndex={0}
      >
        {preview === null ? (
          <Skeleton variant="line" lines={4} />
        ) : (
          <>
            {preview.title ? <h3 className={styles.previewTitle}>{preview.title}</h3> : null}
            <p className={styles.previewBody}>{preview.body}</p>
          </>
        )}
      </article>
      <Button
        variant="primary"
        icon="undo"
        fullWidth
        loading={restoring}
        disabled={preview === null}
        onClick={onRestore}
      >
        {ko.common.rewindRestoreAction}
      </Button>
    </div>
  );
}

export interface RewindSheetProps extends RewindPanelViewProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function RewindSheet({ open, onOpenChange, ...panel }: RewindSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      mode="bottom"
      headerIcon="clock"
      title={ko.common.rewindTitle}
    >
      <RewindPanelView {...panel} />
    </Sheet>
  );
}
