import { useId, type ReactNode } from 'react';
import { CodeInput } from '../../components/CodeInput.tsx';
import { Keypad } from '../../components/Keypad.tsx';
import styles from './CodeKeypadField.module.css';

export interface CodeKeypadFieldProps {
  /** 보이는 이름(예: 선생님 PIN). 숨은 입력칸의 읽기 이름으로도 쓴다. */
  readonly label: string;
  /** 화면 제목이 이미 같은 말을 하면 보이는 이름은 숨긴다(읽기 이름은 남는다). */
  readonly labelHidden?: boolean | undefined;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly value: string;
  /** 칸 수(가변 길이면 최대 칸 수). */
  readonly length: number;
  /** 있으면 가변 길이: 친 글자 수에 따라 `minLength`에서 `length`까지 칸이 늘어난다(PIN 6~8자리). */
  readonly minLength?: number | undefined;
  readonly masked?: boolean | undefined;
  readonly onChange: (next: string) => void;
  readonly onComplete?: ((value: string) => void) | undefined;
  /** 화면 숫자판을 이 칸 아래에 펼칠지(여러 칸 가운데 지금 고른 칸 하나만). */
  readonly showKeypad?: boolean | undefined;
  /** 칸을 누르거나 초점이 오면 부른다(어느 칸에 숫자판을 붙일지 바꾸려고). */
  readonly onActivate?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  /** 칸 아래·숫자판 위에 덧붙일 것(잠김 안내 등). */
  readonly children?: ReactNode | undefined;
}

/** 기본 칸(48px)으로 360px 폭에 들어가는 최대 칸 수. 더 많으면 작은 칸을 쓴다. */
const BASE_SLOT_MAX = 6;

/**
 * 숫자 칸 + 화면 숫자판 묶음(PRD F-15 시작 코드·PIN, F-20 PIN 입력).
 * 8칸은 기본 칸으로 360px 폭에서 넘치므로 작은 칸(`size="sm"`)을 쓴다. 칸 묶음을 `zoom`으로 줄이면
 * 투명한 실제 입력칸까지 작아져 터치 48px에 못 미치므로(P3-11 디자인 판정 4) 줄이지 않는다.
 * 오류 글자는 줄이지 않으려고 `CodeInput`의 `error` 대신 칸 밖에 따로 그리고, 보이는 이름은 `<label>`,
 * 오류·안내는 `aria-describedby`·`aria-invalid`로 숨은 입력칸에 잇는다(P5-1 [중-6]).
 */
export function CodeKeypadField({
  label,
  labelHidden = false,
  hint,
  error,
  value,
  length,
  minLength,
  masked = false,
  onChange,
  onComplete,
  showKeypad = false,
  onActivate,
  disabled = false,
  children,
}: CodeKeypadFieldProps) {
  const inputId = useId();
  const messageId = `${inputId}-message`;
  const append = (digit: string) => {
    if (value.length >= length) return;
    const next = value + digit;
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  return (
    <div className={styles.field} onFocus={onActivate} onClick={onActivate} data-active={showKeypad}>
      {labelHidden ? null : (
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className={styles.slots}>
        <CodeInput
          className={styles.code}
          value={value}
          length={length}
          {...(minLength !== undefined ? { minLength, maxLength: length } : {})}
          // 7칸 이상은 360px에 들어가는 작은 칸. 보이는 칸만 작고, 실제 입력 대상 높이는 CSS가 48px 이상으로 둔다.
          size={length > BASE_SLOT_MAX ? 'sm' : 'md'}
          // 화면 숫자판이 붙는 칸이라 기기 키보드는 띄우지 않는다(물리 키보드·붙여넣기는 그대로 된다).
          inputMode="none"
          masked={masked}
          label={label}
          id={inputId}
          invalid={Boolean(error)}
          describedBy={error || hint ? messageId : undefined}
          disabled={disabled}
          onChange={onChange}
          onComplete={onComplete}
        />
      </div>
      {error ? (
        <p id={messageId} className={styles.error} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {children}
      {showKeypad ? (
        <Keypad
          className={styles.keypad}
          disabled={disabled}
          onDigit={append}
          onBackspace={() => onChange(value.slice(0, -1))}
          onClear={() => onChange('')}
        />
      ) : null}
    </div>
  );
}
