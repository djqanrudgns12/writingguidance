import { ko } from '@geulbang/core/copy';
import { useId } from 'react';
import { Button, Checkbox, PaperCard, TextButton } from '../../components/index.ts';
import { Icon } from '../../icons/Icon.tsx';
import { formatMonthDay } from '../common/format.ts';
import styles from './RoomCardView.module.css';

export interface RoomCardViewProps {
  readonly className: string;
  readonly roomTitle: string;
  /** 교사가 '학생에게 보이기'를 켰을 때만 값을 준다(PRD F-02). 꺼져 있으면 `null`. */
  readonly schoolName?: string | null | undefined;
  /** 수업방 삭제 예정 시각(PRD F-24 "동의 화면에 삭제 예정일"). */
  readonly expiresAt: number;
  readonly agreed: boolean;
  readonly onAgreedChange: (agreed: boolean) => void;
  readonly onStart: () => void;
  readonly onLearnMore: () => void;
  /** `시작하기`를 누른 뒤 기다리는 중. */
  readonly starting?: boolean | undefined;
}

/**
 * S1 수업 카드 + 동의(PRD F-02·F-03·13.1, 7.1 주요 버튼 `시작하기`). S2(정책이 바뀐 뒤 다시 동의)도 이 화면이다.
 * 학생에게는 학급명 + 수업명만, 학교명은 교사가 켰을 때만 보인다. 교사 이름·다른 학생 정보는 받지도 않는다.
 */
export function RoomCardView({
  className,
  roomTitle,
  schoolName,
  expiresAt,
  agreed,
  onAgreedChange,
  onStart,
  onLearnMore,
  starting = false,
}: RoomCardViewProps) {
  const headingId = useId();
  const consentId = useId();

  return (
    <main className={styles.page} data-screen="S1">
      <div className={styles.column}>
        <PaperCard as="section" handDrawnFrame="sm" aria-labelledby={headingId} className={styles.roomCard}>
          {schoolName ? <p className={styles.school}>{schoolName}</p> : null}
          <h1 id={headingId} className={styles.className}>
            {className}
          </h1>
          <p className={styles.roomTitle}>{roomTitle}</p>
        </PaperCard>

        <section className={styles.consent} aria-labelledby={consentId}>
          <h2 id={consentId} className={styles.consentHeading}>
            {ko.student.consentHeading}
          </h2>
          <ul className={styles.consentList}>
            <li>
              <Icon name="saved" size={20} className={styles.bulletIcon} />
              <span>{ko.student.consentItemSave}</span>
            </li>
            <li>
              <Icon name="clock" size={20} className={styles.bulletIcon} />
              <span>
                {ko.student.consentItemExpiryPrefix}
                <strong className="tabular">{formatMonthDay(expiresAt)}</strong>
                {ko.student.consentItemExpirySuffix}
              </span>
            </li>
            <li>
              <Icon name="book" size={20} className={styles.bulletIcon} />
              <span>{ko.student.consentItemAi}</span>
            </li>
            <li>
              <Icon name="warning" size={20} className={styles.bulletIcon} />
              <strong>{ko.student.consentItemPrivacy}</strong>
            </li>
          </ul>
        </section>

        <Checkbox
          size="lg"
          card
          checked={agreed}
          onCheckedChange={onAgreedChange}
          label={ko.student.consentAgreeCheck}
          disabled={starting}
        />

        <Button size="lg" fullWidth disabled={!agreed} loading={starting} onClick={onStart}>
          {ko.student.consentStartAction}
        </Button>

        <TextButton underline onClick={onLearnMore} className={styles.learnMore}>
          {ko.common.learnMore}
        </TextButton>
      </div>
    </main>
  );
}
