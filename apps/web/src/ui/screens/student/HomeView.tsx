import { ko } from '@geulbang/core/copy';
import { useId } from 'react';
import { Button, Gulbeot, PaperCard, TextButton } from '../../components/index.ts';
import { Icon } from '../../icons/Icon.tsx';
import { cx } from '../common/cx.ts';
import { formatAgo } from '../common/format.ts';
import styles from './HomeView.module.css';

/** 이 기기에 기억한 수업방 하나(PRD F-23 기기 기억 중 화면에 보일 것만). */
export interface HomeRoomEntry {
  readonly roomId: string;
  readonly className: string;
  readonly roomTitle: string;
  readonly nickname: string;
  readonly lastUsedAt: number;
}

export interface HomeViewProps {
  /** 가장 최근에 쓴 살아 있는 수업방. 있으면 카드의 `이어 쓰기`가 주요 버튼이 된다(PRD F-01). */
  readonly resume?: HomeRoomEntry | null | undefined;
  /** 나머지 최근 수업방(이어 쓰기 카드를 뺀 것, 합쳐 최대 `RECENT_ROOMS_MAX`). */
  readonly recentRooms?: readonly HomeRoomEntry[] | undefined;
  /** 상대 시각("3분 전") 기준. 결합 때 서버 시각 보정값을 넣는다. */
  readonly now: number;
  /** 홈 화면 추가 안내 카드(한 번만, PRD F-09). */
  readonly showAddToHome?: boolean | undefined;
  readonly onStartWrite: () => void;
  readonly onResume: (roomId: string) => void;
  readonly onOpenRecent: (roomId: string) => void;
  readonly onTeacher: () => void;
  readonly onPrivacy: () => void;
  readonly onDismissAddToHome?: (() => void) | undefined;
}

/**
 * S0 홈(PRD F-01, F-09, F-23, PLAN §6.7). 화면에 채운 주요 버튼은 늘 하나다:
 * 이어 쓰기 카드가 있으면 카드의 `이어 쓰기`, 없으면 `글 쓰러 가기`.
 * 입장 코드 시트(`EntryCodeSheet`)는 결합하는 쪽이 이 화면 옆에 함께 그린다.
 */
export function HomeView({
  resume,
  recentRooms = [],
  now,
  showAddToHome = false,
  onStartWrite,
  onResume,
  onOpenRecent,
  onTeacher,
  onPrivacy,
  onDismissAddToHome,
}: HomeViewProps) {
  const hasResume = Boolean(resume);
  const resumeId = useId();
  const recentId = useId();

  return (
    <main className={styles.home} data-screen="S0">
      <div className={styles.column}>
        {resume ? (
          <PaperCard
            as="section"
            handDrawnFrame="sm"
            className={styles.resumeCard}
            aria-labelledby={resumeId}
          >
            <div className={styles.resumeBody}>
              <p id={resumeId} className={styles.resumeTitle}>
                {resume.className} · {resume.roomTitle}
              </p>
              <p className={styles.resumeMeta}>
                <Icon name="student" size={16} />
                <span>{resume.nickname}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular">{formatAgo(now, resume.lastUsedAt)}</span>
              </p>
            </div>
            <Button size="lg" icon="write" fullWidth onClick={() => onResume(resume.roomId)}>
              {ko.student.homeResumeAction}
            </Button>
          </PaperCard>
        ) : null}

        <div className={cx(styles.hero, hasResume && styles.heroCompact)}>
          <Gulbeot name="home-book" size={220} priority className={styles.heroArt} />
          <h1 className={styles.appName}>{ko.common.appName}</h1>
        </div>

        <Button
          variant={hasResume ? 'secondary' : 'primary'}
          size="lg"
          icon="book"
          fullWidth
          className={styles.startButton}
          onClick={onStartWrite}
        >
          {ko.student.homeStartWrite}
        </Button>

        {recentRooms.length > 0 ? (
          <section className={styles.recent} aria-labelledby={recentId}>
            <h2 id={recentId} className={styles.recentHeading}>
              {ko.student.homeRecentRoomsHeading}
            </h2>
            <ul className={styles.recentList}>
              {recentRooms.map(room => (
                <li key={room.roomId}>
                  <button
                    type="button"
                    className={styles.recentRow}
                    onClick={() => onOpenRecent(room.roomId)}
                  >
                    <span className={styles.recentText}>
                      <span className={styles.recentName}>
                        {room.className} · {room.roomTitle}
                      </span>
                      <span className={styles.recentMeta}>
                        {room.nickname} · <span className="tabular">{formatAgo(now, room.lastUsedAt)}</span>
                      </span>
                    </span>
                    <span className={styles.recentAction}>{ko.student.homeResumeAction}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {showAddToHome ? (
          <PaperCard readOnly padding="sm" className={styles.addToHome}>
            <div className={styles.addToHomeRow}>
              <Icon name="saved" size={20} />
              <p className={styles.addToHomeText}>{ko.student.addToHomeTitle}</p>
              {onDismissAddToHome ? (
                <TextButton tone="ink" onClick={onDismissAddToHome}>
                  {ko.student.addToHomeDismiss}
                </TextButton>
              ) : null}
            </div>
          </PaperCard>
        ) : null}
      </div>

      <footer className={styles.footer}>
        <TextButton tone="ink" onClick={onTeacher} className={styles.teacherLink}>
          {ko.student.homeTeacherPrompt}
        </TextButton>
        <TextButton underline onClick={onPrivacy} className={styles.privacyLink}>
          {ko.common.privacyPolicy}
        </TextButton>
      </footer>
    </main>
  );
}
