import { ko } from '@geulbang/core/copy';
import { type HTMLAttributes } from 'react';
import { Icon } from '../icons/Icon.tsx';
import styles from './Keypad.module.css';

export interface KeypadProps extends HTMLAttributes<HTMLDivElement> {
  readonly onDigit: (digit: string) => void;
  readonly onBackspace: () => void;
  readonly onClear?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
  readonly backspaceLabel?: string | undefined;
  readonly clearLabel?: string | undefined;
}

const TOP_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * 화면 숫자 키패드 부품(3×4 숫자 + 지우기, PRD F-01, F-15, F-20, PLAN §6.7, §9.2).
 * 태블릿·스마트폰에서 한/영 전환 없이 입장 코드·PIN·시작 코드를 입력할 때 쓴다.
 */
export function Keypad({
  onDigit,
  onBackspace,
  onClear,
  disabled = false,
  ariaLabel = ko.common.keypadLabel,
  backspaceLabel = ko.common.keypadBackspace,
  clearLabel = ko.common.keypadClear,
  className,
  ...rest
}: KeypadProps) {
  const classes = [styles.keypad, className ?? ''].filter(Boolean).join(' ');

  return (
    <div role="group" aria-label={ariaLabel} className={classes} {...rest}>
      {TOP_DIGITS.map(digit => (
        <button
          key={digit}
          type="button"
          disabled={disabled}
          data-digit={digit}
          className={styles.key}
          onClick={() => onDigit(digit)}
        >
          {digit}
        </button>
      ))}
      {onClear ? (
        <button
          type="button"
          disabled={disabled}
          data-action="clear"
          aria-label={clearLabel}
          className={`${styles.key} ${styles.subKey}`}
          onClick={onClear}
        >
          <Icon name="close" size={20} />
        </button>
      ) : (
        <span aria-hidden="true" className={styles.spacer} />
      )}
      <button
        type="button"
        disabled={disabled}
        data-digit="0"
        className={styles.key}
        onClick={() => onDigit('0')}
      >
        0
      </button>
      <button
        type="button"
        disabled={disabled}
        data-action="backspace"
        aria-label={backspaceLabel}
        className={`${styles.key} ${styles.subKey}`}
        onClick={onBackspace}
      >
        <Icon name="backspace" size={20} />
        <span className={styles.subKeyText}>{backspaceLabel}</span>
      </button>
    </div>
  );
}
