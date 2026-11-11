import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './IconButton.module.css';

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type IconButtonSize = 'md' | 'sm';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  readonly icon: IconName;
  /** 아이콘만 있는 단추의 필수 접근성 이름(`aria-label`로 전달, PRD 7.3·8.6). */
  readonly label: string;
  readonly variant?: IconButtonVariant | undefined;
  readonly size?: IconButtonSize | undefined;
  readonly iconSize?: 16 | 20 | 24 | undefined;
  readonly loading?: boolean | undefined;
}

/**
 * 아이콘만 있는 48×48px 단추 부품(PRD 7.3, 8.4, 8.6).
 * - `label`을 필수로 받아 `aria-label`을 보장하고, 안쪽 `<Icon>`은 장식으로 숨겨 중복 읽기를 막는다.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    variant = 'secondary',
    size = 'md',
    iconSize = 20,
    loading = false,
    disabled = false,
    type = 'button',
    className,
    ...rest
  },
  ref,
) {
  const isDisabled = Boolean(disabled || loading);
  const classes = [
    styles.iconButton,
    styles[variant],
    styles[size],
    loading ? styles.loading : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-label={label}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
      className={classes}
      {...rest}
    >
      <Icon name={loading ? 'sending' : icon} size={iconSize} className={styles.icon ?? ''} />
    </button>
  );
});
