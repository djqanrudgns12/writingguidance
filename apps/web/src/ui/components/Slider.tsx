import { Slider as BaseSlider } from '@base-ui/react/slider';
import { ko } from '@geulbang/core/copy';
import { type ReactNode } from 'react';
import styles from './Slider.module.css';

export interface SliderProps {
  readonly value?: number | undefined;
  readonly defaultValue?: number | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly onValueChange?: ((value: number) => void) | undefined;
  readonly onValueCommitted?: ((value: number) => void) | undefined;
  /** 슬라이더 이름표(기본값 `ko.common.rewindSliderLabel`). */
  readonly label?: ReactNode | undefined;
  readonly ariaLabel?: string | undefined;
  /** 오른쪽에 보여 줄 시각·이유 안내(예: "3분 전 · 제출할 때"). 고정폭 숫자로 그린다. */
  readonly valueText?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * 시간 되감기용 슬라이더 부품(PRD F-10, 8.4, PLAN §9.2).
 * - 손잡이(`Thumb`) 지름은 32px(`width: 32px; height: 32px;`)로 고정하고 터치 영역은 48px을 확보한다.
 */
export function Slider({
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  onValueCommitted,
  label = ko.common.rewindSliderLabel,
  ariaLabel,
  valueText,
  disabled = false,
  className,
}: SliderProps) {
  const classes = [styles.root, disabled ? styles.disabled : '', className ?? ''].filter(Boolean).join(' ');

  return (
    <BaseSlider.Root
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : ko.common.rewindSliderLabel)}
      onValueChange={next => {
        if (typeof next === 'number') {
          onValueChange?.(next);
        }
      }}
      onValueCommitted={next => {
        if (typeof next === 'number') {
          onValueCommitted?.(next);
        }
      }}
      className={classes}
    >
      {label || valueText ? (
        <div className={styles.header}>
          {label ? <span className={styles.label}>{label}</span> : null}
          {valueText ? (
            <span className={styles.valueText} data-testid="slider-value-text">
              {valueText}
            </span>
          ) : null}
        </div>
      ) : null}
      <BaseSlider.Control className={styles.control}>
        <BaseSlider.Track className={styles.track}>
          <BaseSlider.Indicator className={styles.indicator} />
          <BaseSlider.Thumb className={styles.thumb} data-testid="slider-thumb" />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
