import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { ko } from '@geulbang/core/copy';
import { type ReactElement, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.tsx';
import styles from './Dialog.module.css';

export interface DialogProps {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly trigger?: ReactElement | undefined;
  readonly triggerLabel?: ReactNode | undefined;
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly footer?: ReactNode | undefined;
  readonly closeLabel?: string | undefined;
  readonly hideCloseButton?: boolean | undefined;
  readonly children?: ReactNode | undefined;
  readonly className?: string | undefined;
}

/**
 * 종이 카드 모양 대화상자 부품(PRD 8.3, 8.4, 8.9, PLAN §9.2).
 * - `@base-ui/react` Dialog 위에 비대칭 둥근 모서리(`--r-card`), 잉크 실선, 종이 그림자를 입힌다.
 */
export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  triggerLabel,
  title,
  description,
  footer,
  closeLabel = ko.common.close,
  hideCloseButton = false,
  children,
  className,
}: DialogProps) {
  const popupClasses = [styles.popup, className ?? ''].filter(Boolean).join(' ');

  return (
    <BaseDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={next => {
        onOpenChange?.(next);
      }}
    >
      {trigger ? (
        <BaseDialog.Trigger render={trigger} />
      ) : triggerLabel ? (
        <BaseDialog.Trigger className={styles.triggerButton}>{triggerLabel}</BaseDialog.Trigger>
      ) : null}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Viewport className={styles.viewport}>
          <BaseDialog.Popup className={popupClasses}>
            <header className={styles.header}>
              <BaseDialog.Title className={styles.title}>{title}</BaseDialog.Title>
              {!hideCloseButton ? (
                <BaseDialog.Close aria-label={closeLabel} className={styles.closeButton}>
                  <Icon name="close" size={20} />
                </BaseDialog.Close>
              ) : null}
            </header>
            {description ? (
              <BaseDialog.Description className={styles.description}>{description}</BaseDialog.Description>
            ) : null}
            {children ? <div className={styles.body}>{children}</div> : null}
            {footer ? <footer className={styles.footer}>{footer}</footer> : null}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
