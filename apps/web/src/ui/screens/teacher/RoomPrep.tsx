import { ko } from '@geulbang/core/copy';
import { Button } from '../../components/Button.tsx';
import { TextButton } from '../../components/TextButton.tsx';
import { Icon } from '../../icons/Icon.tsx';
import { ConnectionCheckView, type ConnectionCheckModel } from './ConnectionCheck.tsx';
import { formatMonthDay, joinDot } from './format.ts';
import { LazyQr } from './qr/LazyQr.tsx';
import styles from './RoomPrep.module.css';
import { TeacherFrame } from './TeacherFrame.tsx';

/** PIN은 가려 두고 `보기`를 누를 때만 서버에서 받아 보인다(PRD F-16·F-20). */
export type PinReveal =
  | { readonly state: 'hidden' }
  | { readonly state: 'loading' }
  | { readonly state: 'shown'; readonly value: string };

export interface RoomPrepViewProps {
  readonly className: string;
  readonly roomTitle: string;
  readonly entryCode: string;
  /** QR에 담는 입장 주소(전체). */
  readonly entryUrl: string;
  /** 화면에 보이는 짧은 주소. */
  readonly shortUrl: string;
  readonly expiresAt: number;
  readonly pin: PinReveal;
  readonly onTogglePin: () => void;
  readonly check: ConnectionCheckModel;
  readonly onRunCheck: () => void;
  readonly onOpenQrLarge: () => void;
  readonly onCopyTeacherLink: () => void;
  readonly onOpenTeacherLinkQr: () => void;
  readonly onGoDashboard: () => void;
  readonly onBack?: (() => void) | undefined;
  /** PIN 가림 점 개수(실제 길이를 드러내지 않게 늘 같은 수). */
  readonly pinMaskLength?: number | undefined;
}

const DEFAULT_PIN_MASK = 6;

/**
 * T2 수업 준비(PRD F-16). 큰 QR·입장 코드·짧은 주소·삭제 예정일·30일 안내, 보조 단추 넷, 주요 단추 `대시보드로` 하나.
 * 900px 이상은 QR 칸과 정보 칸을 나란히, 그보다 좁으면 위아래로 둔다.
 */
export function RoomPrepView({
  className,
  roomTitle,
  entryCode,
  entryUrl,
  shortUrl,
  expiresAt,
  pin,
  onTogglePin,
  check,
  onRunCheck,
  onOpenQrLarge,
  onCopyTeacherLink,
  onOpenTeacherLinkQr,
  onGoDashboard,
  onBack,
  pinMaskLength = DEFAULT_PIN_MASK,
}: RoomPrepViewProps) {
  return (
    <TeacherFrame
      width="wide"
      title={ko.teacher.prepHeading}
      subtitle={joinDot(roomTitle, className)}
      onBack={onBack}
    >
      <div className={styles.layout}>
        <section className={styles.qrCard} aria-label={ko.teacher.shortUrlHeading}>
          <div className={styles.qrWrap}>
            <LazyQr value={entryUrl} label={joinDot(ko.teacher.shortUrlHeading, shortUrl)} />
          </div>
          <div className={styles.codeBlock}>
            <span className={styles.caption}>{ko.teacher.entryCodeHeading}</span>
            <span className={styles.entryCode} data-testid="prep-entry-code">
              {entryCode}
            </span>
          </div>
          <div className={styles.urlBlock}>
            <span className={styles.caption}>{ko.teacher.shortUrlHeading}</span>
            <span className={styles.shortUrl}>{shortUrl}</span>
          </div>
          <Button variant="secondary" icon="qr" fullWidth onClick={onOpenQrLarge}>
            {ko.teacher.openQrLargeAction}
          </Button>
        </section>

        <div className={styles.side}>
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt className={styles.caption}>{ko.teacher.expiryDateLabel}</dt>
              <dd className={styles.factValue}>{formatMonthDay(expiresAt)}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.caption}>{ko.teacher.pinCreateLabel}</dt>
              <dd className={styles.pinRow}>
                {pin.state === 'shown' ? (
                  <span className={styles.pinDigits} data-testid="prep-pin-digits">
                    {pin.value}
                  </span>
                ) : (
                  <span
                    className={styles.pinMask}
                    role="img"
                    aria-label={ko.teacher.pinHiddenMaskLabel}
                    data-testid="prep-pin-mask"
                  >
                    {Array.from({ length: pinMaskLength }, (_, i) => (
                      <span key={i} className={styles.pinDot} />
                    ))}
                  </span>
                )}
                <TextButton
                  tone="ink"
                  underline
                  disabled={pin.state === 'loading'}
                  aria-busy={pin.state === 'loading' || undefined}
                  onClick={onTogglePin}
                >
                  {pin.state === 'shown' ? ko.teacher.hidePinAction : ko.teacher.showPinAction}
                </TextButton>
              </dd>
            </div>
          </dl>

          <p className={styles.retention}>
            <Icon name="clock" size={20} className={styles.retentionIcon} />
            <span>{ko.teacher.roomRetentionGuide}</span>
          </p>

          <div className={styles.links}>
            <Button variant="secondary" icon="copy" onClick={onCopyTeacherLink}>
              {ko.teacher.copyTeacherLinkAction}
            </Button>
            <Button variant="secondary" icon="qr" onClick={onOpenTeacherLinkQr}>
              {ko.teacher.openTeacherLinkQrAction}
            </Button>
          </div>

          <ConnectionCheckView check={check} onRun={onRunCheck} />

          <div className={styles.primary}>
            <Button variant="primary" size="lg" fullWidth onClick={onGoDashboard}>
              {ko.teacher.goDashboardAction}
            </Button>
          </div>
        </div>
      </div>
    </TeacherFrame>
  );
}
