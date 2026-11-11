import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { useId, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.tsx';
import styles from './Checkbox.module.css';

export type CheckboxSize = 'md' | 'lg';

export interface CheckboxProps {
  readonly checked?: boolean | undefined;
  readonly defaultChecked?: boolean | undefined;
  readonly onCheckedChange?: ((checked: boolean) => void) | undefined;
  readonly label?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  /** `lg`: 첫 입장 동의 화면의 큰 체크(기본값), `md`: 설정·타이머 알림 체크(PRD F-03, F-15, F-19, PLAN §9.2). */
  readonly size?: CheckboxSize | undefined;
  readonly card?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly required?: boolean | undefined;
  readonly name?: string | undefined;
  readonly value?: string | undefined;
  readonly id?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * 체크 상자 부품(PRD F-03 큰 체크, F-15, F-19, 8.4, PLAN §9.2).
 * - 선택되면 버터 바탕(`--butter`)과 코코아 잉크 체크 아이콘을 함께 표시해 색만으로 구분하지 않는다.
 * - 터치 영역 최소 48×48px을 보장한다.
 */
export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  label,
  description,
  size = 'lg',
  card = false,
  disabled = false,
  readOnly = false,
  required = false,
  name,
  value,
  id,
  ariaLabel,
  className,
}: CheckboxProps) {
  const reactId = useId();
  const labelId = label ? `${id ?? reactId}-label` : undefined;
  const descId = description ? `${id ?? reactId}-desc` : undefined;
  const classes = [
    styles.wrapper,
    styles[size],
    card ? styles.card : '',
    disabled ? styles.disabled : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const iconSize = size === 'lg' ? 20 : 16;

  return (
    <label className={classes} data-size={size}>
      <BaseCheckbox.Root
        id={id}
        name={name}
        value={value}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-label={ariaLabel}
        aria-labelledby={labelId}
        aria-describedby={descId}
        onCheckedChange={next => {
          onCheckedChange?.(next);
        }}
        className={styles.box}
      >
        <BaseCheckbox.Indicator className={styles.indicator}>
          <Icon name="check" size={iconSize} />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {label || description ? (
        <span className={styles.textGroup}>
          {label ? (
            <span id={labelId} className={styles.label}>
              {label}
            </span>
          ) : null}
          {description ? (
            <span id={descId} className={styles.description}>
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}
