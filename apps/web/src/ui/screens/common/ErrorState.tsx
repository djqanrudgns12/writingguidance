import type { ErrorCode } from '@geulbang/core/errors';
import { ko } from '@geulbang/core/copy';
import { Toast } from '../../components/index.ts';
import styles from './common.module.css';

export interface ErrorStateViewProps {
  /** 화면 문구는 `ko.errors[code]`에서 온다. `message`를 주면 그것을 쓴다. */
  readonly code?: ErrorCode | undefined;
  readonly message?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
}

/**
 * 오류 화면(PRD 7.2): 종이 토스트 한 줄 + `다시 하기`. 기술 용어 없이 `ko.errors` 문구만 쓴다.
 * 문구가 빈 코드(조용한 코드)는 결합하는 쪽이 이 화면을 띄우지 않는다.
 */
export function ErrorStateView({ code, message, onRetry }: ErrorStateViewProps) {
  const text = message ?? (code ? ko.errors[code] : ko.errors.E_INTERNAL);
  return (
    <main className={styles.page} data-screen="error">
      <div className={styles.column}>
        <Toast
          tone="danger"
          icon="warning"
          message={text}
          actionLabel={onRetry ? ko.common.retry : undefined}
          onAction={onRetry}
          className={styles.errorToast}
        />
      </div>
    </main>
  );
}
