import { Dialog as BaseDialog, type DialogPopupProps } from '@base-ui/react/dialog';
import { ko } from '@geulbang/core/copy';
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import { Gulbeot } from './Gulbeot.tsx';
import styles from './Sheet.module.css';

export type SheetMode = 'responsive' | 'bottom' | 'side';
export type SheetHeight = 'default' | 'result' | 'fit';

export interface SheetProps {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /**
   * - `responsive`(기본값): 900px 미만은 60% 바텀시트(끌어 닫기), 900px 이상은 오른쪽 옆 패널(PRD 7.3, F-06, PLAN §9.2)
   * - `bottom`: 화면 폭과 관계없이 바텀시트(입장 코드 시트·제출 확인 시트 등)
   * - `side`: 오른쪽 옆 패널(900px 미만에서는 전체 화면 서랍)
   */
  readonly mode?: SheetMode | undefined;
  /**
   * - `default`(기본값): 바텀시트 높이 60~85dvh(입장 코드·제출 확인 등)
   * - `result`: 900px 미만 AI 결과 바텀시트 높이를 화면 60%(60dvh)로 고정하고 본문만 내부 스크롤(PRD F-06)
   * - `fit`: 900px 미만 바텀시트를 내용 높이에 맞춘다(최대 85dvh). 한두 줄 안내뿐인 시트가 빈 종이로 보이지 않게
   *   (P5-4 시각 검토 3번: AI 한도 안내)
   */
  readonly height?: SheetHeight | undefined;
  /**
   * - `true`(기본값): 배경막과 초점 가두기를 켜는 모달 시트
   * - `false`: 비모달 시트(좁은 화면 결과 시트에서 맞춤법 항목을 누를 때 쓰기 칸 선택·조작이 보이도록 배경막·바깥 클릭 닫기를 끈다)
   */
  readonly modal?: boolean | undefined;
  /**
   * 열릴 때 초점(Base UI `initialFocus`). 주지 않으면 모달은 기본 동작, 비모달은 옮기지 않는다.
   * 비모달 결과 시트는 칩을 키보드로 눌렀을 때만 시트 안으로 옮기려고 함수를 넘긴다(P5-1 [중-3]).
   */
  readonly initialFocus?: DialogPopupProps['initialFocus'];
  readonly trigger?: ReactElement | undefined;
  readonly triggerLabel?: ReactNode | undefined;
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly headerIcon?: IconName | undefined;
  /** 결과 패널 머리말에 작은 글벗 기본 얼굴(32px)을 함께 보여 줄지 여부(PRD 8.4, F-08). */
  readonly showGulbeot?: boolean | undefined;
  readonly badgeText?: ReactNode | undefined;
  readonly footer?: ReactNode | undefined;
  readonly closeLabel?: string | undefined;
  readonly dragCloseThresholdPx?: number | undefined;
  readonly children?: ReactNode | undefined;
  readonly className?: string | undefined;
}

/**
 * 바텀시트(끌어 닫기, 높이 60%) 및 900px 이상 옆 패널 부품(PRD 7.3, F-01, F-06, F-11, F-18, 8.4, PLAN §9.2).
 */
export function Sheet({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  mode = 'responsive',
  height = 'default',
  modal = true,
  initialFocus,
  trigger,
  triggerLabel,
  title,
  description,
  headerIcon,
  showGulbeot = false,
  badgeText,
  footer,
  closeLabel = ko.common.close,
  dragCloseThresholdPx = 72,
  children,
  className,
}: SheetProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState<boolean>(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const [dragOffsetY, setDragOffsetY] = useState<number>(0);
  const dragStartYRef = useRef<number | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(next);
    }
    setDragOffsetY(0);
    dragStartYRef.current = null;
    onOpenChange?.(next);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartYRef.current = event.clientY;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // jsdom 등 포인터 캡처 미지원 환경 무시
      }
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const deltaY = Math.max(0, event.clientY - dragStartYRef.current);
    setDragOffsetY(deltaY);
  };

  const finishDrag = (clientY: number) => {
    if (dragStartYRef.current === null) return;
    const deltaY = Math.max(0, clientY - dragStartYRef.current);
    dragStartYRef.current = null;
    setDragOffsetY(0);
    if (deltaY >= dragCloseThresholdPx) {
      handleOpenChange(false);
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    finishDrag(event.clientY);
  };

  const handlePointerCancel = () => {
    dragStartYRef.current = null;
    setDragOffsetY(0);
  };

  const hasBadge = Boolean(badgeText);
  const viewportClasses = [styles.viewport, styles[`viewport_${mode}`]].filter(Boolean).join(' ');
  const popupClasses = [
    styles.popup,
    styles[`popup_${mode}`],
    height === 'result' ? styles.popup_height_result : height === 'fit' ? styles.popup_height_fit : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <BaseDialog.Root
      open={isOpen}
      modal={modal}
      disablePointerDismissal={!modal}
      onOpenChange={next => {
        handleOpenChange(next);
      }}
    >
      {trigger ? (
        <BaseDialog.Trigger render={trigger} />
      ) : triggerLabel ? (
        <BaseDialog.Trigger className={styles.triggerButton}>{triggerLabel}</BaseDialog.Trigger>
      ) : null}
      <BaseDialog.Portal>
        {modal ? <BaseDialog.Backdrop className={styles.backdrop} /> : null}
        <BaseDialog.Viewport className={viewportClasses}>
          <BaseDialog.Popup
            data-mode={mode}
            data-height={height}
            data-modal={modal ? 'true' : 'false'}
            data-dragging={dragOffsetY > 0 ? 'true' : undefined}
            initialFocus={initialFocus ?? (modal ? undefined : false)}
            finalFocus={modal ? undefined : false}
            className={popupClasses}
            style={
              dragOffsetY > 0 ? { transform: `translateY(${dragOffsetY}px)`, transition: 'none' } : undefined
            }
          >
            {mode !== 'side' ? (
              <div
                data-testid="sheet-drag-handle"
                className={styles.dragHandleArea}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              >
                <span className={styles.dragPill} aria-hidden="true" />
              </div>
            ) : null}
            <header className={styles.header}>
              <div className={styles.headerMain}>
                {hasBadge ? (
                  <div className={styles.badgeRow}>
                    {showGulbeot ? <Gulbeot size={32} /> : null}
                    <span className={styles.badge}>
                      {headerIcon ? <Icon name={headerIcon} size={16} /> : null}
                      <span>{badgeText}</span>
                    </span>
                  </div>
                ) : null}
                <div className={styles.titleRow}>
                  {!hasBadge && showGulbeot ? <Gulbeot size={32} /> : null}
                  {!hasBadge && headerIcon ? (
                    <span className={styles.titleIcon} data-testid="sheet-header-icon">
                      <Icon name={headerIcon} size={20} />
                    </span>
                  ) : null}
                  <BaseDialog.Title className={styles.title}>{title}</BaseDialog.Title>
                </div>
              </div>
              <BaseDialog.Close aria-label={closeLabel} className={styles.closeButton}>
                <Icon name="close" size={20} />
              </BaseDialog.Close>
            </header>
            {description ? (
              <BaseDialog.Description className={styles.description}>{description}</BaseDialog.Description>
            ) : null}
            <div className={styles.body}>{children}</div>
            {footer ? <footer className={styles.footer}>{footer}</footer> : null}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
