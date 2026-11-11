import { ko } from '@geulbang/core/copy';
import { EmptyState } from '../../components/index.ts';
import styles from './common.module.css';

/** `expired`: 만료된 수업방, `missingRoom`: 없는 수업방(QR·링크), `missingPage`: 없는 주소. */
export type ClosedKind = 'expired' | 'missingRoom' | 'missingPage';

export interface ClosedViewProps {
  readonly kind?: ClosedKind | undefined;
  readonly onHome: () => void;
}

/**
 * 만료·없음(PRD 7.2, F-02): 닫힌 문 그림 + "이 수업방은 문을 닫았어요" + `처음으로`.
 * 닫힘(읽기만)은 이 화면이 아니라 쓰기 화면 위 띠다(만료와 닫힘은 다르게 보인다).
 */
export function ClosedView({ kind = 'expired', onHome }: ClosedViewProps) {
  const title = kind === 'missingPage' ? ko.common.notFoundTitle : ko.common.expiredRoomTitle;
  return (
    <main className={styles.page} data-screen="closed" data-kind={kind}>
      <EmptyState
        artName="closed-door"
        artWidth={200}
        artPriority
        frameSize="md"
        title={title}
        actionLabel={ko.common.goHome}
        onAction={onHome}
      />
    </main>
  );
}
