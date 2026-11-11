import { ko } from '@geulbang/core/copy';
import { Button } from '../../components/Button.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Icon } from '../../icons/Icon.tsx';
import styles from './DeleteRoomSheet.module.css';

export interface DeleteRoomPanelViewProps {
  /** 실수 방지로 `지금 삭제`가 켜지기까지 기다리는 초(PRD F-22 "3초 뒤에 눌리는 버튼"). */
  readonly delaySec: number;
  readonly deleting?: boolean | undefined;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** 지금 삭제 확인 내용(PRD F-22): 무엇이 사라지는지 한 문장, 늦게 켜지는 `지금 삭제`와 `취소`. */
export function DeleteRoomPanelView({
  delaySec,
  deleting = false,
  onConfirm,
  onCancel,
}: DeleteRoomPanelViewProps) {
  return (
    <div className={styles.panel}>
      <p className={styles.guide}>
        <Icon name="warning" size={24} className={styles.icon} />
        <span>{ko.teacher.deleteRoomConfirmGuide}</span>
      </p>
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onCancel} disabled={deleting}>
          {ko.common.cancel}
        </Button>
        <Button variant="danger" delaySeconds={delaySec} loading={deleting} onClick={onConfirm}>
          {ko.teacher.deleteRoomNowAction}
        </Button>
      </div>
    </div>
  );
}

export interface DeleteRoomSheetProps extends Omit<DeleteRoomPanelViewProps, 'onCancel'> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** `··· > 지금 삭제` 확인 시트. 열 때마다 늦게 켜짐을 다시 센다(시트가 닫히면 내용이 사라지므로). */
export function DeleteRoomSheet({ open, onOpenChange, ...panel }: DeleteRoomSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} mode="bottom" title={ko.teacher.deleteRoomConfirmTitle}>
      <DeleteRoomPanelView {...panel} onCancel={() => onOpenChange(false)} />
    </Sheet>
  );
}
