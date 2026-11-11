import type { SnapshotReason } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { type CSSProperties } from 'react';
import { Button, EmptyState, PaperCard, Skeleton, Slider } from '../../../components/index.ts';
import { formatAgo } from '../../common/format.ts';
import { SheetSurface } from '../../common/SheetSurface.tsx';
import styles from './RewindSheet.module.css';
import type { RewindView } from './types.ts';

const REASON_LABEL: Record<SnapshotReason, string> = {
  AUTO: ko.common.rewindReasonAuto,
  SUBMIT: ko.common.rewindReasonSubmit,
  AI: ko.common.rewindReasonAi,
  TEACHER: ko.common.rewindReasonTeacher,
  RESTORE: ko.common.rewindReasonRestore,
};

export interface RewindSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly view: RewindView;
  readonly now: number;
  readonly fontSize: number;
  readonly onSelect: (index: number) => void;
  readonly onRestore: () => void;
  readonly inline?: boolean | undefined;
}

/**
 * 시간 되감기 시트(PRD F-10 2번): 슬라이더 하나와 시각 표시("3분 전 · 제출할 때"),
 * 움직이면 그때 글을 미리 보고 `이때 글로 돌리기`로 복원한다(복원은 차이만, 결합하는 쪽이 맡음).
 */
export function RewindSheet({
  open,
  onOpenChange,
  view,
  now,
  fontSize,
  onSelect,
  onRestore,
  inline,
}: RewindSheetProps) {
  const count = view.snapshots.length;
  const index = Math.min(Math.max(0, view.selectedIndex), Math.max(0, count - 1));
  const selected = view.snapshots[index];
  const ready = view.status === 'ready' && selected !== undefined;

  return (
    <SheetSurface
      open={open}
      onOpenChange={onOpenChange}
      mode="responsive"
      title={ko.common.rewindTitle}
      headerIcon="clock"
      inline={inline}
      bodyStyle={{ '--panel-fs': `${fontSize}px` } as CSSProperties}
      footer={
        ready ? (
          <Button fullWidth icon="undo" loading={view.restoring === true} onClick={onRestore}>
            {ko.common.rewindRestoreAction}
          </Button>
        ) : undefined
      }
    >
      {view.status === 'loading' ? <Skeleton variant="card" lines={4} /> : null}
      {view.status === 'offline' ? (
        <EmptyState
          artName="offline-umbrella"
          artWidth={140}
          // 상태 그림 틀은 모든 화면에서 같은 손그림 테두리(P5-4 시각 검토 5번). 시트 안이라 작은 틀.
          frameSize="sm"
          title={ko.common.rewindOfflineGuide}
        />
      ) : null}
      {view.status === 'empty' || (view.status === 'ready' && !selected) ? (
        <p className={styles.empty}>{ko.common.rewindEmpty}</p>
      ) : null}
      {ready ? (
        <>
          <Slider
            min={0}
            max={Math.max(0, count - 1)}
            step={1}
            value={index}
            disabled={count < 2 || view.restoring === true}
            onValueChange={onSelect}
            valueText={`${formatAgo(now, selected.at)} · ${REASON_LABEL[selected.reason]}`}
          />
          {/* 이름 있는 영역(section)이어야 aria-label이 읽히고, 넘치는 지난 글은 키보드로도 넘겨 본다(P5-1 [하-2]). */}
          <PaperCard
            as="section"
            readOnly
            padding="sm"
            aria-label={ko.common.rewindPreviewLabel}
            tabIndex={0}
            className={styles.preview}
          >
            {selected.title ? <p className={styles.previewTitle}>{selected.title}</p> : null}
            <p className={styles.previewBody}>{selected.body}</p>
          </PaperCard>
        </>
      ) : null}
    </SheetSurface>
  );
}
