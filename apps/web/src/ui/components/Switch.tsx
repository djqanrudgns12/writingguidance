import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { useId, type ReactNode } from 'react';
import styles from './Switch.module.css';

export interface SwitchProps {
  readonly checked?: boolean | undefined;
  readonly defaultChecked?: boolean | undefined;
  readonly onCheckedChange?: ((checked: boolean) => void) | undefined;
  readonly label?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly required?: boolean | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * 스위치 부품(PRD F-15, F-19, F-22, 8.4, PLAN §9.2).
 * - `@base-ui/react` Switch 위에 종이·잉크 토큰과 48px 터치 높이를 입힌다.
 */
export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  readOnly = false,
  required = false,
  name,
  id,
  ariaLabel,
  className,
}: SwitchProps) {
  const reactId = useId();
  const labelId = label ? `${id ?? reactId}-label` : undefined;
  const descId = description ? `${id ?? reactId}-desc` : undefined;
  const classes = [styles.wrapper, disabled ? styles.disabled : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <label className={classes}>
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
      <BaseSwitch.Root
        id={id}
        name={name}
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
        className={styles.track}
      >
        <BaseSwitch.Thumb className={styles.thumb} />
      </BaseSwitch.Root>
    </label>
  );
}
