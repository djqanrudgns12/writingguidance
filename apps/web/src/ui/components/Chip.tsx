import { ko } from '@geulbang/core/copy';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './Chip.module.css';

export type AiChipState = 'idle' | 'fresh' | 'stale' | 'loading' | 'cooldown' | 'guide' | 'offline' | 'limit';
export type AiChipButton = 'SPELL' | 'FEEDBACK' | 'DIRECTION' | 'POLISH';

export const AI_CHIP_ICONS: Record<AiChipButton, IconName> = {
  SPELL: 'aiSpell',
  FEEDBACK: 'aiFeedback',
  DIRECTION: 'aiDirection',
  POLISH: 'aiPolish',
};

function inferAiChipIcon(children: ReactNode, dataButton: unknown): IconName | undefined {
  if (
    dataButton === 'SPELL' ||
    dataButton === 'FEEDBACK' ||
    dataButton === 'DIRECTION' ||
    dataButton === 'POLISH'
  ) {
    return AI_CHIP_ICONS[dataButton];
  }
  if (typeof children !== 'string') return undefined;
  if (children === ko.student.aiSpellLabel || children === ko.student.aiSpellShortLabel) {
    return 'aiSpell';
  }
  if (children === ko.student.aiFeedbackLabel || children === ko.student.aiFeedbackShortLabel) {
    return 'aiFeedback';
  }
  if (children === ko.student.aiDirectionLabel || children === ko.student.aiDirectionShortLabel) {
    return 'aiDirection';
  }
  if (children === ko.student.aiPolishLabel || children === ko.student.aiPolishShortLabel) {
    return 'aiPolish';
  }
  return undefined;
}

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * 선택형·켜기형 칩의 선택 상태(버터 바탕 + 체크 아이콘, PRD 8.4). 넘길 때만 `aria-pressed`를 단다:
   * 누르면 바로 실행하는 칩(구조 넣기·알림 문구)·AI 칩은 켜기 단추가 아니라서 넘기지 않는다(P5-1 [중-2]).
   */
  readonly selected?: boolean | undefined;
  /** 대시보드 필터 칩 등에 함께 보이는 개수(고정폭 숫자). */
  readonly count?: number | undefined;
  readonly icon?: IconName | undefined;
  /** AI 버튼 종류를 넘기면 해당 전용 아이콘(`aiSpell`·`aiFeedback`·`aiDirection`·`aiPolish`)을 기본으로 쓴다. */
  readonly aiButton?: AiChipButton | undefined;
  /** AI 버튼 칩 상태 기계(PLAN §6.7, §9.2). */
  readonly aiState?: AiChipState | undefined;
  /** AI 칩 쿨다운 남은 초. */
  readonly cooldownSeconds?: number | undefined;
  /** 안내·상태 보조 문구(예: 조금 더 써 볼까요?, 글이 바뀌었어요). */
  readonly statusText?: string | undefined;
  readonly children?: ReactNode | undefined;
}

/**
 * 선택형·켜기형 칩 및 AI 버튼 칩(PRD 8.4, F-08, PLAN §6.7, §9.2).
 * - 선택되면(`selected`) `--butter` 바탕과 체크 아이콘으로 색·모양을 함께 바꾼다.
 * - AI `fresh`(결과 신선) 상태는 `selected`와 겹치지 않도록 쑥색 테두리·신선 점(`freshDot`)과 고유 AI 아이콘으로 구분한다.
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    selected,
    count,
    icon,
    aiButton,
    aiState,
    cooldownSeconds,
    statusText,
    disabled = false,
    type = 'button',
    className,
    children,
    ...rest
  },
  ref,
) {
  const isAiInactive =
    aiState === 'offline' || aiState === 'limit' || aiState === 'cooldown' || aiState === 'loading';
  const isDisabled = Boolean(disabled || isAiInactive);
  const isSelected = Boolean(selected);
  const isFresh = aiState === 'fresh';
  // 펼침 칩(`aria-expanded`)은 열림 상태를 그쪽으로 알린다. 눌림까지 같이 달면 두 번 읽힌다.
  const isDisclosure = (rest as Record<string, unknown>)['aria-expanded'] !== undefined;
  const ariaPressed = selected === undefined || isDisclosure ? undefined : selected;

  const dataAiButton = (rest as Record<string, unknown>)['data-ai-button'];
  const defaultAiIcon = aiButton
    ? AI_CHIP_ICONS[aiButton]
    : aiState !== undefined
      ? inferAiChipIcon(children, dataAiButton)
      : undefined;
  const baseIcon = icon ?? defaultAiIcon;

  const leadingIcon: IconName | undefined =
    aiState === 'loading'
      ? 'sending'
      : aiState === 'offline'
        ? 'offline'
        : aiState === 'cooldown'
          ? 'clock'
          : aiState === undefined && isSelected
            ? 'check'
            : (baseIcon ?? (isSelected ? 'check' : undefined));

  const badgeText =
    statusText ??
    (aiState === 'cooldown' && cooldownSeconds !== undefined && cooldownSeconds > 0
      ? `${cooldownSeconds}${ko.student.aiCooldownSuffix}`
      : aiState === 'guide'
        ? ko.student.aiMoreCharsGuide
        : aiState === 'offline'
          ? ko.student.aiOfflineGuide
          : aiState === 'stale'
            ? ko.student.aiStaleBadge
            : undefined);

  const classes = [
    styles.chip,
    isSelected ? styles.selected : '',
    aiState ? (styles[`ai_${aiState}`] ?? '') : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-pressed={ariaPressed}
      aria-busy={aiState === 'loading' || undefined}
      data-selected={isSelected ? 'true' : 'false'}
      data-ai-state={aiState}
      className={classes}
      {...rest}
    >
      {leadingIcon ? <Icon name={leadingIcon} size={16} className={styles.icon ?? ''} /> : null}
      <span className={styles.label}>{children}</span>
      {isFresh ? <span className={styles.freshDot} data-testid="chip-fresh-dot" aria-hidden="true" /> : null}
      {count !== undefined ? <span className={styles.count}>{count}</span> : null}
      {badgeText ? <span className={styles.statusText}>{badgeText}</span> : null}
    </button>
  );
});
