import { Menu as BaseMenu } from '@base-ui/react/menu';
import { ko } from '@geulbang/core/copy';
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './Menu.module.css';

export interface MenuItemEntry {
  readonly id: string;
  readonly label: ReactNode;
  readonly icon?: IconName | undefined;
  readonly tone?: 'default' | 'danger' | undefined;
  readonly disabled?: boolean | undefined;
  readonly separatorBefore?: boolean | undefined;
  readonly onSelect?: (() => void) | undefined;
}

export interface MenuProps {
  readonly items: readonly MenuItemEntry[];
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly trigger?: ReactElement | undefined;
  readonly triggerLabel?: string | undefined;
  readonly triggerText?: ReactNode | undefined;
  readonly triggerIcon?: IconName | undefined;
  readonly align?: 'start' | 'center' | 'end' | undefined;
  readonly sideOffset?: number | undefined;
  readonly className?: string | undefined;
}

/**
 * 종이 카드 모양 더 보기(`···`) 메뉴 부품(PRD F-06, F-12, F-18, F-22, 8.3, 8.4, PLAN §9.2).
 */
export function Menu({
  items,
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  triggerLabel = ko.common.moreMenu,
  triggerText,
  triggerIcon = 'more',
  align = 'end',
  sideOffset = 6,
  className,
}: MenuProps) {
  const popupClasses = [styles.popup, className ?? ''].filter(Boolean).join(' ');

  return (
    <BaseMenu.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={next => {
        onOpenChange?.(next);
      }}
    >
      {trigger ? (
        <BaseMenu.Trigger render={trigger} />
      ) : (
        <BaseMenu.Trigger aria-label={triggerLabel} className={styles.triggerButton}>
          <Icon name={triggerIcon} size={20} />
          {triggerText ? <span>{triggerText}</span> : null}
        </BaseMenu.Trigger>
      )}
      <BaseMenu.Portal>
        <BaseMenu.Positioner align={align} sideOffset={sideOffset} className={styles.positioner}>
          <BaseMenu.Popup className={popupClasses}>
            {items.map(item => (
              <Fragment key={item.id}>
                {item.separatorBefore ? <BaseMenu.Separator className={styles.separator} /> : null}
                <BaseMenu.Item
                  disabled={item.disabled}
                  onClick={() => {
                    if (!item.disabled) {
                      item.onSelect?.();
                    }
                  }}
                  data-tone={item.tone ?? 'default'}
                  className={[styles.item, item.tone === 'danger' ? styles.dangerItem : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {item.icon ? <Icon name={item.icon} size={16} className={styles.itemIcon ?? ''} /> : null}
                  <span className={styles.itemLabel}>{item.label}</span>
                </BaseMenu.Item>
              </Fragment>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
