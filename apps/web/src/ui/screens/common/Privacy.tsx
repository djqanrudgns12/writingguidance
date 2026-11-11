import { ko } from '@geulbang/core/copy';
import { type ReactNode } from 'react';
import { Button } from '../../components/index.ts';
import styles from './common.module.css';

export interface PrivacyViewProps {
  readonly onBack: () => void;
  /** 처리방침 본문(PRD 13.2). 문서는 결합 때 Claude가 넣는다. */
  readonly children?: ReactNode | undefined;
}

/** `/privacy` 개인정보처리방침(PRD 13.2). 이 화면은 제목과 본문 자리만 둔다. */
export function PrivacyView({ onBack, children }: PrivacyViewProps) {
  return (
    <main className={styles.document} data-screen="privacy">
      <header className={styles.documentHeader}>
        <Button variant="ghost" icon="back" onClick={onBack}>
          {ko.common.back}
        </Button>
      </header>
      <article className={styles.documentBody}>
        <h1 className={styles.documentTitle}>{ko.common.privacyPolicy}</h1>
        <div className={styles.documentText}>{children}</div>
      </article>
    </main>
  );
}
