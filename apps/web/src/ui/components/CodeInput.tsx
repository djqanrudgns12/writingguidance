import { defaultConfig } from '@geulbang/core/config';
import { ko } from '@geulbang/core/copy';
import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import styles from './CodeInput.module.css';

export type CodeInputSize = 'md' | 'sm';

export interface CodeInputProps {
  readonly value: string;
  /** 고정 칸 수(기본: `ENTRY_CODE_LENGTH` 6칸). `minLength`·`maxLength`가 함께 주어지면 가변 길이로 동작한다. */
  readonly length?: number | undefined;
  /** 가변 길이(예: PIN 6~8자리)의 최소 표시 칸 수. */
  readonly minLength?: number | undefined;
  /** 가변 길이(예: PIN 6~8자리)의 최대 입력 칸 수. 친 글자 수에 따라 `minLength`에서 `maxLength`까지 칸(점)이 늘어난다. */
  readonly maxLength?: number | undefined;
  /** 칸 크기 변형(`md` 기본, `sm`은 360px 화면에서 8칸도 넘치지 않는 작은 칸). */
  readonly size?: CodeInputSize | undefined;
  /** 화면 숫자판과 함께 쓸 때 기기 키보드가 뜨지 않게 `'none'`으로 둘 수 있다(기본 `'numeric'`). */
  readonly inputMode?: 'numeric' | 'none' | undefined;
  /** `true`이면 숫자 대신 둥근 잉크 점(PIN 점)으로 표시한다. */
  readonly masked?: boolean | undefined;
  readonly label?: string | undefined;
  readonly error?: string | undefined;
  /** 오류 문구를 칸 밖에 따로 그리면서도 칸 테두리만 빨갛게(`--rose-ink`) 표시할 때 쓴다. */
  readonly invalid?: boolean | undefined;
  /** 칸 밖에 따로 그린 안내·오류 글의 id(공백으로 여럿). 숨은 입력칸의 `aria-describedby`에 잇는다. */
  readonly describedBy?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly onChange?: ((nextValue: string) => void) | undefined;
  readonly onComplete?: ((completedValue: string) => void) | undefined;
}

function sanitizeDigits(raw: string, maxLen: number): string {
  return raw.replace(/\D+/g, '').slice(0, maxLen);
}

/**
 * 6칸 입장 코드·PIN 점 입력 부품(PRD F-01, F-15, F-20, PLAN §6.7, §9.2).
 * 화면 키패드와 물리 키보드 숫자·Backspace·붙여넣기를 함께 지원한다.
 */
export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(function CodeInput(
  {
    value,
    length = defaultConfig.ENTRY_CODE_LENGTH,
    minLength,
    maxLength,
    size = 'md',
    inputMode = 'numeric',
    masked = false,
    label,
    error,
    invalid = false,
    describedBy,
    disabled = false,
    autoFocus = false,
    id,
    className,
    onChange,
    onComplete,
  },
  forwardedRef,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedByIds = [errorId, describedBy].filter(Boolean).join(' ') || undefined;
  const internalRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);

  const resolvedMaxLength = Math.max(1, maxLength ?? length);
  const resolvedMinLength = Math.max(1, Math.min(resolvedMaxLength, minLength ?? resolvedMaxLength));
  const digits = sanitizeDigits(value, resolvedMaxLength);
  const visibleSlotCount = Math.min(resolvedMaxLength, Math.max(resolvedMinLength, digits.length));
  const activeIndex = Math.min(digits.length, visibleSlotCount - 1);
  const hasError = Boolean(error) || invalid;

  const setInputRef = (node: HTMLInputElement | null) => {
    internalRef.current = node;
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
    } else if (forwardedRef) {
      forwardedRef.current = node;
    }
  };

  const applyValue = (nextRaw: string) => {
    if (disabled) return;
    const next = sanitizeDigits(nextRaw, resolvedMaxLength);
    if (next !== digits) {
      onChange?.(next);
      if (next.length === resolvedMaxLength) {
        onComplete?.(next);
      }
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    applyValue(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === 'Backspace' && digits.length > 0) {
      event.preventDefault();
      applyValue(digits.slice(0, -1));
      return;
    }
    if (/^[0-9]$/.test(event.key) && digits.length < resolvedMaxLength) {
      event.preventDefault();
      applyValue(digits + event.key);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const pasted = event.clipboardData.getData('text');
    if (pasted) {
      event.preventDefault();
      applyValue(pasted);
    }
  };

  const resolvedLabel = label ?? (masked ? ko.common.pinInputLabel : ko.common.codeInputLabel);
  const rootClasses = [styles.wrapper, className ?? ''].filter(Boolean).join(' ');
  const slotsClasses = [styles.slots, size === 'sm' ? styles.slotsSm : ''].filter(Boolean).join(' ');

  return (
    <div
      className={rootClasses}
      data-size={size}
      data-error={hasError ? 'true' : 'false'}
      data-min-length={resolvedMinLength}
      data-max-length={resolvedMaxLength}
    >
      <div
        className={styles.slotsArea}
        onClick={() => {
          if (!disabled) internalRef.current?.focus();
        }}
      >
        <input
          ref={setInputRef}
          id={inputId}
          type={masked ? 'password' : 'text'}
          inputMode={inputMode}
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={resolvedMaxLength}
          disabled={disabled}
          autoFocus={autoFocus}
          value={digits}
          aria-label={resolvedLabel}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={describedByIds}
          className={styles.hiddenInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className={slotsClasses} aria-hidden="true">
          {Array.from({ length: visibleSlotCount }, (_, index) => {
            const ch = digits[index];
            const isFilled = ch !== undefined;
            const isActive = focused && index === activeIndex && !disabled;
            const slotClasses = [
              styles.slot,
              size === 'sm' ? styles.slotSm : '',
              isFilled ? styles.filled : '',
              isActive ? styles.active : '',
              hasError ? styles.slotError : '',
              disabled ? styles.slotDisabled : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <span
                key={index}
                data-slot-index={index}
                data-size={size}
                data-filled={isFilled ? 'true' : 'false'}
                data-masked={masked ? 'true' : 'false'}
                data-error={hasError ? 'true' : 'false'}
                className={slotClasses}
              >
                {isFilled ? (
                  masked ? (
                    <span className={styles.dot} data-testid="code-pin-dot" />
                  ) : (
                    <span className={styles.digit}>{ch}</span>
                  )
                ) : null}
              </span>
            );
          })}
        </div>
      </div>
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
});
