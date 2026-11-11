import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import styles from './TextField.module.css';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label?: string | undefined;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
}

/**
 * 한 줄 입력칸 부품(별명·학급명·수업명·학교명·알림 문구 등, PRD 8.4, PLAN §9.2).
 * - 편집기 입력칸이 아니다(편집기는 `adapters/editor`가 붙인다).
 * - `ref`를 그대로 전달해 바깥에서 비제어(`defaultValue` + `ref.current.value`)로 쓸 수 있다.
 * - 흰 종이 바탕(`--surface`) + 초점 시 잉크 테두리 2px + 버터 바깥 띠 3px(`--focus-ring`).
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, readOnly = false, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const inputClasses = [
    styles.input,
    readOnly ? styles.readOnly : '',
    error ? styles.hasError : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.field}>
      {label ? (
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClasses}
        {...rest}
      />
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});
