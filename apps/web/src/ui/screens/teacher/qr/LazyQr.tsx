import { lazy, Suspense } from 'react';
import styles from './Qr.module.css';

/** `qr` 묶음은 QR이 처음 보일 때 따로 불러온다(PLAN §6.7 T2, 첫 화면 무게를 줄이려고). */
const QrSvgLazy = lazy(() => import('./QrSvg.tsx').then(m => ({ default: m.QrSvg })));

export interface LazyQrProps {
  readonly value: string;
  readonly label: string;
  readonly className?: string | undefined;
}

/**
 * 크기는 바깥 상자가 정한다(정사각형, 폭 100%). 불러오는 동안은 같은 크기의 옅은 종이 자리만 보인다.
 */
export function LazyQr({ value, label, className }: LazyQrProps) {
  return (
    <div className={[styles.box, className ?? ''].filter(Boolean).join(' ')}>
      <Suspense fallback={<div className={styles.placeholder} aria-busy="true" aria-label={label} />}>
        <QrSvgLazy value={value} label={label} />
      </Suspense>
    </div>
  );
}
