import { ko } from '@geulbang/core/copy';
import { useId } from 'react';
import { Button } from '../../components/Button.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { Icon } from '../../icons/Icon.tsx';
import { formatMonthDay, joinDot } from './format.ts';
import { TeacherFrame } from './TeacherFrame.tsx';
import styles from './TeacherHome.module.css';

/** 이 기기가 기억하는 최근 수업방 한 줄(PRD F-20·F-23, `TeacherRoomMemory`에서 토큰을 뺀 것). */
export interface TeacherRecentRoom {
  readonly roomId: string;
  readonly displayName: string;
  readonly expiresAt: number;
}

export interface TeacherHomeViewProps {
  readonly recentRooms: readonly TeacherRecentRoom[];
  /** 기기 기억을 읽는 중이면 목록 자리에 종이 자리표시를 둔다. */
  readonly loading?: boolean | undefined;
  readonly onCreateRoom: () => void;
  readonly onOpenRoom: (roomId: string) => void;
  readonly onEnterWithPin: () => void;
  /** 학생 홈으로 돌아가기. */
  readonly onBack?: (() => void) | undefined;
}

/**
 * T0 선생님 홈(PRD 7.1·F-20). 주요 단추는 `새 수업방 만들기` 하나, 최근 수업방(최대 5개)과 PIN 들어가기는 보조.
 */
export function TeacherHomeView({
  recentRooms,
  loading = false,
  onCreateRoom,
  onOpenRoom,
  onEnterWithPin,
  onBack,
}: TeacherHomeViewProps) {
  const recentId = useId();
  return (
    <TeacherFrame title={ko.teacher.homeHeading} onBack={onBack}>
      <Button variant="primary" size="lg" icon="write" fullWidth onClick={onCreateRoom}>
        {ko.teacher.createNewRoomAction}
      </Button>

      <section className={styles.recent} aria-labelledby={recentId}>
        <h2 id={recentId} className={styles.sectionTitle}>
          {ko.teacher.recentRoomsHeading}
        </h2>
        {loading ? (
          <Skeleton variant="line" lines={3} />
        ) : recentRooms.length === 0 ? (
          <p className={styles.empty}>{ko.teacher.recentRoomsEmpty}</p>
        ) : (
          <ul className={styles.list}>
            {recentRooms.map(room => (
              <li key={room.roomId}>
                <button type="button" className={styles.room} onClick={() => onOpenRoom(room.roomId)}>
                  <span className={styles.roomIcon} aria-hidden="true">
                    <Icon name="book" size={20} />
                  </span>
                  <span className={styles.roomText}>
                    <span className={styles.roomName}>{room.displayName}</span>
                    <span className={styles.roomMeta}>
                      {joinDot(ko.teacher.expiryDateLabel, formatMonthDay(room.expiresAt))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={styles.pinRow}>
        <Button variant="secondary" icon="locked" fullWidth onClick={onEnterWithPin}>
          {ko.teacher.enterWithPinAction}
        </Button>
      </div>
    </TeacherFrame>
  );
}
