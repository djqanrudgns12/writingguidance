import { Popover as BasePopover } from '@base-ui/react/popover';
import { ko } from '@geulbang/core/copy';
import { type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './Popover.module.css';

export interface PopoverProps {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly trigger?: ReactElement | undefined;
  readonly triggerLabel?: ReactNode | undefined;
  readonly triggerIcon?: IconName | undefined;
  readonly title?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly side?: 'top' | 'bottom' | 'left' | 'right' | undefined;
  readonly align?: 'start' | 'center' | 'end' | undefined;
  readonly sideOffset?: number | undefined;
  readonly showCloseButton?: boolean | undefined;
  readonly closeLabel?: string | undefined;
  readonly children?: ReactNode | undefined;
  readonly className?: string | undefined;
}

/**
 * 종이 카드 모양 팝오버 부품(교사 알림·타이머 팝오버 등, PRD F-19, 8.3, 8.4, PLAN §9.2).
 */
export function Popover({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  triggerLabel,
  triggerIcon,
  title,
  description,
  side = 'bottom',
  align = 'end',
  sideOffset = 8,
  showCloseButton = false,
  closeLabel = ko.common.close,
  children,
  className,
}: PopoverProps) {
  const popupClasses = [styles.popup, className ?? ''].filter(Boolean).join(' ');
  const hasHeader = Boolean(title || showCloseButton);

  return (
    <BasePopover.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={next => {
        onOpenChange?.(next);
      }}
    >
      {trigger ? (
        <BasePopover.Trigger render={trigger} />
      ) : (
        <BasePopover.Trigger className={styles.triggerButton}>
          {triggerIcon ? <Icon name={triggerIcon} size={16} /> : null}
          {triggerLabel ? <span>{triggerLabel}</span> : null}
        </BasePopover.Trigger>
      )}
      <BasePopover.Portal>
        <BasePopover.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          className={styles.positioner}
        >
          <BasePopover.Popup className={popupClasses}>
            {hasHeader ? (
              <header className={styles.header}>
                {title ? <BasePopover.Title className={styles.title}>{title}</BasePopover.Title> : <span />}
                {showCloseButton ? (
                  <BasePopover.Close aria-label={closeLabel} className={styles.closeButton}>
                    <Icon name="close" size={16} />
                  </BasePopover.Close>
                ) : null}
              </header>
            ) : null}
            {description ? (
              <BasePopover.Description className={styles.description}>{description}</BasePopover.Description>
            ) : null}
            <div className={styles.body}>{children}</div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
