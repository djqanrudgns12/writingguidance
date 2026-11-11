import { Select as BaseSelect } from '@base-ui/react/select';
import { useId, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.tsx';
import styles from './Dropdown.module.css';

export interface DropdownOption<V extends string = string> {
  readonly value: V;
  readonly label: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
}

export interface DropdownProps<V extends string = string> {
  readonly options: readonly DropdownOption<V>[];
  readonly value?: V | undefined;
  readonly defaultValue?: V | undefined;
  readonly onValueChange?: ((value: V) => void) | undefined;
  readonly label?: ReactNode | undefined;
  readonly ariaLabel?: string | undefined;
  readonly placeholder?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly variant?: 'pill' | 'field' | undefined;
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * 종이 카드 모양 드롭다운 부품(PRD F-06 상단 하위 종류 칩, 8.3, 8.4, 8.10, PLAN §9.2).
 * - 브라우저 기본 select 요소는 금지이므로 `@base-ui/react` Select 위에 종이·잉크 토큰을 입힌다.
 * - 선택된 항목은 버터 바탕(`--butter`)과 체크 아이콘을 함께 표시한다.
 */
export function Dropdown<V extends string = string>({
  options,
  value,
  defaultValue,
  onValueChange,
  label,
  ariaLabel,
  placeholder,
  disabled = false,
  variant = 'pill',
  open,
  defaultOpen,
  onOpenChange,
  className,
}: DropdownProps<V>) {
  const reactId = useId();
  const labelId = label ? `${reactId}-label` : undefined;
  const itemsMap: Record<string, ReactNode> = {};
  for (const opt of options) {
    itemsMap[opt.value] = opt.label;
  }

  const rootClasses = [styles.wrapper, className ?? ''].filter(Boolean).join(' ');
  const triggerClasses = [styles.trigger, variant === 'field' ? styles.fieldTrigger : styles.pillTrigger]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClasses}>
      {label ? (
        <span id={labelId} className={styles.label}>
          {label}
        </span>
      ) : null}
      <BaseSelect.Root
        items={itemsMap}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={next => {
          onOpenChange?.(next);
        }}
        onValueChange={next => {
          if (typeof next === 'string') {
            onValueChange?.(next as V);
          }
        }}
      >
        <BaseSelect.Trigger aria-label={ariaLabel} aria-labelledby={labelId} className={triggerClasses}>
          <BaseSelect.Value placeholder={placeholder} className={styles.valueText} />
          <BaseSelect.Icon className={styles.caret} aria-hidden="true">
            <svg viewBox="0 0 16 16" width={14} height={14} fill="none">
              <path
                d="M3.5 6L8 10.5L12.5 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner
            alignItemWithTrigger={false}
            sideOffset={6}
            align="start"
            className={styles.positioner}
          >
            <BaseSelect.Popup className={styles.popup}>
              <BaseSelect.List className={styles.list}>
                {options.map(opt => (
                  <BaseSelect.Item
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.disabled}
                    className={styles.item}
                  >
                    <div className={styles.itemTextWrap}>
                      <BaseSelect.ItemText className={styles.itemLabel}>{opt.label}</BaseSelect.ItemText>
                      {opt.description ? (
                        <span className={styles.itemDescription}>{opt.description}</span>
                      ) : null}
                    </div>
                    <BaseSelect.ItemIndicator className={styles.itemIndicator}>
                      <Icon name="check" size={16} />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </div>
  );
}
