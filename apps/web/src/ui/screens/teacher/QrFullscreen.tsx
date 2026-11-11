import { ko } from '@geulbang/core/copy';
import { useEffect, useRef } from 'react';
import { Icon } from '../../icons/Icon.tsx';
import { joinDot } from './format.ts';
import styles from './QrFullscreen.module.css';
import { LazyQr } from './qr/LazyQr.tsx';

export interface QrFullscreenViewProps {
  readonly roomTitle: string;
  readonly className: string;
  readonly entryCode: string;
  readonly entryUrl: string;
  readonly shortUrl: string;
  readonly onClose: () => void;
}

function isRestorable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected || el === document.body) return false;
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return false;
  return !(el instanceof HTMLInputElement);
}

/**
 * `QR 크게 띄우기`(PRD F-16, TV용 전체 화면): QR + 입장 코드 + 주소만 크게.
 * 가로로 긴 화면(TV·PC)은 QR과 글자를 나란히, 세로 화면은 위아래로 둔다. Esc로 닫는다.
 */
export function QrFullscreenView({
  roomTitle,
  className,
  entryCode,
  entryUrl,
  shortUrl,
  onClose,
}: QrFullscreenViewProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // 연 단추를 기억했다가 닫힐 때 돌려준다(P5-1 [하-1]). 글 입력칸이면 돌려주지 않는다:
    // 화면은 편집기 입력칸의 초점을 건드리지 않는다(PLAN §6.3).
    const opener = document.activeElement;
    // 전체 화면이 열리면 닫기 단추에 초점을 둬 키보드·리모컨으로 바로 닫을 수 있게 한다(열릴 때 한 번만).
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // 대화상자 안에서 누를 곳은 닫기 단추 하나뿐: Tab이 뒤 화면으로 빠져나가지 않게 가둔다.
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (isRestorable(opener)) opener.focus();
    };
  }, []);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={ko.teacher.openQrLargeAction}>
      <button
        ref={closeRef}
        type="button"
        className={styles.close}
        aria-label={ko.common.close}
        onClick={onClose}
      >
        <Icon name="close" size={32} />
      </button>
      <div className={styles.content}>
        <div className={styles.qr}>
          <LazyQr value={entryUrl} label={joinDot(ko.teacher.shortUrlHeading, shortUrl)} />
        </div>
        <div className={styles.text}>
          <p className={styles.room}>{joinDot(roomTitle, className)}</p>
          <div className={styles.block}>
            <span className={styles.caption}>{ko.teacher.entryCodeHeading}</span>
            <span className={styles.code}>{entryCode}</span>
          </div>
          <div className={styles.block}>
            <span className={styles.caption}>{ko.teacher.shortUrlHeading}</span>
            <span className={styles.url}>{shortUrl}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
