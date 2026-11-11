import { ko } from '@geulbang/core/copy';
import { type ReactNode } from 'react';
import { TextButton } from '../../components/TextButton.tsx';
import styles from './TeacherFrame.module.css';

export interface TeacherFrameProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode | undefined;
  /** 있으면 머리 왼쪽에 `뒤로` 글자 단추를 둔다. */
  readonly onBack?: (() => void) | undefined;
  readonly backLabel?: string | undefined;
  /** 머리 오른쪽 작은 단추 자리. */
  readonly actions?: ReactNode | undefined;
  /** narrow: 입력 화면(640), wide: 수업 준비처럼 두 칸(1040). */
  readonly width?: 'narrow' | 'wide' | undefined;
  readonly children?: ReactNode | undefined;
  readonly className?: string | undefined;
}

/**
 * 교사 입력·안내 화면(T0·등록·T1·T2·T5)의 바깥 틀. 크림 바탕 위에 가운데 정렬된 한 줄 머리와 본문만 둔다.
 * 대시보드(T3)는 정보 밀도가 달라 이 틀을 쓰지 않는다(PRD 8.4 교사 화면).
 */
export function TeacherFrame({
  title,
  subtitle,
  onBack,
  backLabel = ko.common.back,
  actions,
  width = 'narrow',
  children,
  className,
}: TeacherFrameProps) {
  return (
    <main className={[styles.page, className ?? ''].filter(Boolean).join(' ')}>
      <div className={[styles.inner, width === 'wide' ? styles.wide : styles.narrow].join(' ')}>
        <header className={styles.header}>
          {onBack ? (
            <TextButton tone="ink" onClick={onBack} className={styles.back}>
              {backLabel}
            </TextButton>
          ) : null}
          <div className={styles.titles}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </header>
        {children}
      </div>
    </main>
  );
}
