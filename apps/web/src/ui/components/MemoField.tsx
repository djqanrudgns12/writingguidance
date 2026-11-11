import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import styles from './MemoField.module.css';

export interface MemoFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label?: string | undefined;
  /** 도움 질문 문구(PRD F-07). */
  readonly question?: string | undefined;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
}

/**
 * 짧은 여러 줄 메모 칸 부품(PRD 8.4, F-07, PLAN §9.2).
 * - 편집기 입력칸이 아니다(편집기 본문·메모 바인딩은 `adapters/editor`가 맡는다).
 * - `ref`를 넘겨 바깥에서 비제어(`ref.current`)로 바로 다룰 수 있다.
 * - 흰 종이 바탕(`--surface`) + 초점 시 잉크 테두리 2px + 버터 바깥 띠 3px(`--focus-ring`).
 */
export const MemoField = forwardRef<HTMLTextAreaElement, MemoFieldProps>(function MemoField(
  { label, question, hint, error, id, rows = 3, readOnly = false, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const questionId = question ? `${textareaId}-question` : undefined;
  const hintId = hint ? `${textareaId}-hint` : undefined;
  const errorId = error ? `${textareaId}-error` : undefined;
  const describedBy = [questionId, errorId, hintId].filter(Boolean).join(' ') || undefined;

  const textareaClasses = [
    styles.textarea,
    readOnly ? styles.readOnly : '',
    error ? styles.hasError : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.field}>
      {label ? (
        <label htmlFor={textareaId} className={styles.label}>
          {label}
        </label>
      ) : null}
      {question ? (
        <p id={questionId} className={styles.question}>
          {question}
        </p>
      ) : null}
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        readOnly={readOnly}
        aria-label={!label && question ? question : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={textareaClasses}
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
