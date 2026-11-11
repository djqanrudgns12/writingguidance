import { Skeleton } from '../../components/index.ts';
import styles from './common.module.css';

export interface LoadingViewProps {
  /** 자리표시 줄 수(쓰기 화면처럼 큰 화면은 늘린다). */
  readonly lines?: number | undefined;
  /** 시험·견본용: 1초를 기다리지 않고 "준비하고 있어요"를 바로 보인다. */
  readonly showLabelImmediately?: boolean | undefined;
}

/** 불러오는 중(PRD 7.2): 종이 카드 모양의 옅은 자리표시, 1초가 넘으면 "준비하고 있어요"(`Skeleton`이 맡음). */
export function LoadingView({ lines = 4, showLabelImmediately = false }: LoadingViewProps) {
  return (
    <main className={styles.page} data-screen="loading">
      <div className={styles.column}>
        <Skeleton variant="card" lines={lines} showLabelImmediately={showLabelImmediately} />
      </div>
    </main>
  );
}
