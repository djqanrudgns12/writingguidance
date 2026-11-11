import { encodeQR } from 'qr';
import { useMemo } from 'react';
import styles from './Qr.module.css';

export interface QrSvgProps {
  /** QR에 담을 주소. */
  readonly value: string;
  /** 읽기 이름(예: "입장 주소 QR"). */
  readonly label: string;
  readonly className?: string | undefined;
}

/** QR 규격의 조용한 여백(모듈 4칸, ISO/IEC 18004). 화면 설정값이 아니라 규격 값이다. */
const QUIET_ZONE_MODULES = 4;

/** 한 줄씩 이어진 검은 칸을 가로 막대 하나로 묶어 경로 글자를 짧게 만든다. */
function matrixToPath(matrix: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      parts.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
    }
  });
  return parts.join('');
}

/**
 * QR 그림(`qr` 0.7.2, PLAN §6.7 T2). 이 파일은 `LazyQr`가 나중에 불러오는 조각 안에만 들어간다.
 * 색은 `currentColor`(잉크)와 흰 종이 바탕이라 화면 CSS에 색 코드를 쓰지 않는다.
 */
export function QrSvg({ value, label, className }: QrSvgProps) {
  const { size, path } = useMemo(() => {
    const matrix = encodeQR(value, 'raw', { ecc: 'medium', border: QUIET_ZONE_MODULES });
    return { size: matrix.length, path: matrixToPath(matrix) };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={[styles.svg, className ?? ''].filter(Boolean).join(' ')}
      data-testid="teacher-qr-svg"
    >
      <rect width={size} height={size} className={styles.paper} />
      <path d={path} fill="currentColor" />
    </svg>
  );
}
