import { ko } from '@geulbang/core/copy';
import { Sheet } from '../../components/Sheet.tsx';
import { Icon } from '../../icons/Icon.tsx';
import styles from './ExportSheet.module.css';

export type ExportKind = 'submitted' | 'all';

export interface ExportPanelViewProps {
  readonly submittedCount: number;
  readonly totalCount: number;
  /** zip을 묶는 중인 쪽(그 동안 두 단추 모두 막는다). */
  readonly exporting?: ExportKind | null | undefined;
  readonly onExport: (kind: ExportKind) => void;
}

/**
 * 모두 내려받기 내용(PRD F-21): `제출한 글만` / `모든 글` 두 갈래, 고르면 바로 zip 하나.
 * 큰 줄 단추 두 개로 두고 글 수를 함께 보인다.
 */
export function ExportPanelView({
  submittedCount,
  totalCount,
  exporting = null,
  onExport,
}: ExportPanelViewProps) {
  const options: readonly { kind: ExportKind; label: string; count: number }[] = [
    { kind: 'submitted', label: ko.teacher.exportSubmittedOnlyAction, count: submittedCount },
    { kind: 'all', label: ko.teacher.exportAllDocsAction, count: totalCount },
  ];
  return (
    <div className={styles.options}>
      {options.map(opt => {
        const busy = exporting === opt.kind;
        return (
          <button
            key={opt.kind}
            type="button"
            className={styles.option}
            disabled={exporting !== null || opt.count === 0}
            aria-busy={busy || undefined}
            onClick={() => onExport(opt.kind)}
          >
            <span className={styles.icon} aria-hidden="true">
              <Icon name={busy ? 'sending' : 'download'} size={24} />
            </span>
            <span className={styles.label}>{opt.label}</span>
            <span className={styles.count}>{opt.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface ExportSheetProps extends ExportPanelViewProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ExportSheet({ open, onOpenChange, ...panel }: ExportSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      mode="bottom"
      headerIcon="download"
      title={ko.teacher.exportSheetTitle}
    >
      <ExportPanelView {...panel} />
    </Sheet>
  );
}
