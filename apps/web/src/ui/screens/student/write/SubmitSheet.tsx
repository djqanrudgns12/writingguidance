import { ko } from '@geulbang/core/copy';
import { Button } from '../../../components/index.ts';
import { SheetSurface } from '../../common/SheetSurface.tsx';
import styles from './SmallSheets.module.css';

export interface SubmitSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly submitting?: boolean | undefined;
  readonly inline?: boolean | undefined;
}

/** 제출 확인 시트(PRD F-11): "제출할까요? …" + `제출하기`(주요) · `조금 더 쓸래요`. */
export function SubmitSheet({ open, onOpenChange, onConfirm, submitting = false, inline }: SubmitSheetProps) {
  return (
    <SheetSurface
      open={open}
      onOpenChange={onOpenChange}
      title={ko.student.submitConfirmTitle}
      headerIcon="submit"
      inline={inline}
    >
      <div className={styles.actions}>
        <Button size="lg" icon="submit" fullWidth loading={submitting} onClick={onConfirm}>
          {ko.student.submitConfirmAction}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          disabled={submitting}
          onClick={() => onOpenChange(false)}
        >
          {ko.student.submitKeepWritingAction}
        </Button>
      </div>
    </SheetSurface>
  );
}
