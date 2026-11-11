import { ko } from '@geulbang/core/copy';
import { useId } from 'react';
import { Button } from '../../components/Button.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { Icon } from '../../icons/Icon.tsx';
import styles from './DevicesSheet.module.css';
import { formatAgo, formatClock, joinDot } from './format.ts';

/** 그 학생에게 연결된 기기 하나(`device.list`). */
export interface DeviceItem {
  readonly deviceRowId: string;
  readonly approvedAt: number;
  readonly lastSeenAt: number | null;
}

export interface DevicesPanelViewProps {
  readonly devices: readonly DeviceItem[];
  readonly onRevoke: (deviceRowId: string) => void;
  /** 끊는 중인 기기. */
  readonly revokingId?: string | null | undefined;
  readonly loading?: boolean | undefined;
  readonly nowMs: number;
}

/**
 * 기기 연결 끊기 내용(PRD F-14·F-18): 잘못 허용한 기기를 골라 끊는다. 기기마다 허용 시각과 마지막 사용을 보인다.
 */
export function DevicesPanelView({
  devices,
  onRevoke,
  revokingId = null,
  loading = false,
  nowMs,
}: DevicesPanelViewProps) {
  const baseId = useId();
  if (loading) return <Skeleton variant="line" lines={3} />;
  return (
    <ul className={styles.list}>
      {devices.map((device, i) => {
        // 줄마다 같은 `기기 연결 끊기`가 되풀이되지 않게 이름에 기기 번호를, 설명에 허용·사용 시각을 잇는다(P5-1 [중-9]).
        const numberLabel = `${ko.teacher.deviceNumberPrefix} ${i + 1}`;
        const textId = `${baseId}-${i}`;
        return (
          <li key={device.deviceRowId} className={styles.item}>
            <span className={styles.badge} aria-hidden="true">
              <Icon name="student" size={20} />
              <span className={styles.number}>{i + 1}</span>
            </span>
            <span className={styles.text} id={textId}>
              <span>{joinDot(ko.teacher.deviceApprovedAtLabel, formatClock(device.approvedAt))}</span>
              {device.lastSeenAt !== null ? (
                <span className={styles.sub}>
                  {joinDot(ko.teacher.deviceLastSeenLabel, formatAgo(device.lastSeenAt, nowMs))}
                </span>
              ) : null}
            </span>
            <Button
              variant="danger"
              icon="offline"
              loading={revokingId === device.deviceRowId}
              disabled={revokingId !== null && revokingId !== device.deviceRowId}
              aria-label={`${numberLabel} ${ko.teacher.disconnectDeviceShortAction}`}
              aria-describedby={textId}
              onClick={() => onRevoke(device.deviceRowId)}
            >
              {ko.teacher.disconnectDeviceAction}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export interface DevicesSheetProps extends DevicesPanelViewProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function DevicesSheet({ open, onOpenChange, ...panel }: DevicesSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      mode="bottom"
      headerIcon="offline"
      title={ko.teacher.deviceListHeading}
    >
      <DevicesPanelView {...panel} />
    </Sheet>
  );
}
