import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './TextButton.module.css';

export interface TextButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly tone?: 'sub' | 'ink' | undefined;
  readonly icon?: IconName | undefined;
  readonly underline?: boolean | undefined;
  readonly children?: ReactNode | undefined;
}

/**
 * 작은 글자 단추(PRD F-01 `선생님이세요?`, `개인정보처리방침`, PLAN §9.2).
 * 글자는 작지만 터치 영역은 최소 48×48px을 유지한다.
 */
export const TextButton = forwardRef<HTMLButtonElement, TextButtonProps>(function TextButton(
  { tone = 'sub', icon, underline = false, type = 'button', className, children, ...rest },
  ref,
) {
  const classes = [
    styles.textButton,
    tone === 'ink' ? styles.ink : styles.sub,
    underline ? styles.underline : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {icon ? <Icon name={icon} size={16} className={styles.icon ?? ''} /> : null}
      <span>{children}</span>
    </button>
  );
});
