import { ko } from '@geulbang/core/copy';
import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'lg' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly loading?: boolean | undefined;
  /** 실수 방지용 늦게 켜짐(초, 예: 지금 삭제 3초). */
  readonly delaySeconds?: number | undefined;
  readonly icon?: IconName | undefined;
  readonly fullWidth?: boolean | undefined;
  readonly children?: ReactNode | undefined;
}

/**
 * 기본 단추 부품(PRD 8.4, PLAN §9.2).
 * - `primary`: 채운 살구 바탕 + 잉크 테두리 1.5px + 눌림 그림자 3px
 * - `secondary`: 흰 종이 바탕 + 잉크 테두리 1.5px + 옅은 그림자 2px
 * - `ghost`: 테두리·그림자 없는 보조 단추
 * - `danger`: 장미 바탕 + 잉크 테두리 + 눌림 그림자
 * - `delaySeconds`: 지정된 초가 지날 때까지 비활성화하고 남은 초를 고정폭 숫자로 표시한다.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    delaySeconds = 0,
    icon,
    fullWidth = false,
    disabled = false,
    type = 'button',
    className,
    onClick,
    children,
    ...rest
  },
  ref,
) {
  const initialDelay = Math.max(0, Math.floor(delaySeconds));
  const [remaining, setRemaining] = useState<number>(initialDelay);

  useEffect(() => {
    const nextDelay = Math.max(0, Math.floor(delaySeconds));
    setRemaining(nextDelay);
    if (nextDelay <= 0 || disabled) return;

    const timer = window.setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [delaySeconds, disabled]);

  const isDelayed = remaining > 0;
  const isDisabled = Boolean(disabled || loading || isDelayed);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (isDisabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : '',
    loading ? styles.loading : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const iconSize = size === 'lg' ? 20 : 16;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
      data-countdown={isDelayed ? remaining : undefined}
      className={classes}
      onClick={handleClick}
      {...rest}
    >
      {loading ? (
        <Icon name="sending" size={iconSize} className={styles.icon ?? ''} />
      ) : icon ? (
        <Icon name={icon} size={iconSize} className={styles.icon ?? ''} />
      ) : null}
      <span className={styles.label}>{children}</span>
      {isDelayed ? (
        <span className={styles.countdown} data-testid="button-countdown">
          ({remaining}
          {ko.common.delaySecondsSuffix})
        </span>
      ) : null}
    </button>
  );
});
