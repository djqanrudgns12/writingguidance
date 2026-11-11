import { defaultConfig, MS_PER_MINUTE } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { type FormEvent } from 'react';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { CodeKeypadField } from './CodeKeypadField.tsx';
import styles from './PinEntry.module.css';
import { TeacherFrame } from './TeacherFrame.tsx';

export interface PinEntryViewProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onSubmit: () => void;
  readonly submitting?: boolean | undefined;
  /** 틀렸을 때 문구(보통 `ko.errors.E_PIN_INVALID`). */
  readonly error?: string | undefined;
  /** 기기에서 5번 틀려 잠긴 동안 풀리는 시각(PRD F-20 `PIN_LOCK_MIN`). */
  readonly lockedUntil?: number | null | undefined;
  readonly nowMs: number;
  readonly onBack?: (() => void) | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
}

/**
 * T5 PIN 입력(PRD F-20). 숫자판으로 6~8자리를 넣고 `들어가기` 하나가 주요 단추다.
 * 잠긴 동안은 숫자판과 단추를 막고 남은 분을 함께 보인다.
 */
export function PinEntryView({
  value,
  onChange,
  onSubmit,
  submitting = false,
  error,
  lockedUntil = null,
  nowMs,
  onBack,
  minLength = defaultConfig.PIN_MIN_LENGTH,
  maxLength = defaultConfig.PIN_MAX_LENGTH,
}: PinEntryViewProps) {
  const lockedMs = lockedUntil === null ? 0 : Math.max(0, lockedUntil - nowMs);
  const locked = lockedMs > 0;
  const canSubmit = !locked && !submitting && value.length >= minLength;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSubmit) onSubmit();
  };

  return (
    <TeacherFrame title={ko.teacher.pinEnterHeading} onBack={onBack}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {locked ? (
          <Banner tone="warning" icon="locked">
            {/* 문구 검토: 잠긴 동안은 남은 분과 함께 "n분 뒤에 다시 입력해 주세요."(`E_PIN_LOCKED` 일반 문구 대신) */}
            <span className={styles.lockText}>
              <span className={styles.lockTime}>{Math.ceil(lockedMs / MS_PER_MINUTE)}</span>
              {ko.teacher.pinLockedRemainingSuffix}
            </span>
          </Banner>
        ) : null}
        <div className={styles.card}>
          <CodeKeypadField
            label={ko.common.pinInputLabel}
            labelHidden
            error={locked ? undefined : error}
            value={value}
            length={maxLength}
            minLength={minLength}
            masked
            disabled={locked || submitting}
            onChange={onChange}
            showKeypad
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!canSubmit && !submitting}
        >
          {ko.teacher.pinEnterAction}
        </Button>
      </form>
    </TeacherFrame>
  );
}
