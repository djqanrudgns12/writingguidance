import type { AiButton } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { Chip, type AiChipState } from '../../../components/index.ts';
import { Icon, type IconName } from '../../../icons/Icon.tsx';
import { cx } from '../../common/cx.ts';
import styles from './AiChipBar.module.css';
import type { AiChipView, WriteLayout } from './types.ts';

/** 버튼 이름(긴 것·짧은 것, PRD F-06 "하단 버튼은 아이콘 + 짧은 글자"). */
export const AI_BUTTON_LABEL: Record<AiButton, { readonly full: string; readonly short: string }> = {
  SPELL: { full: ko.student.aiSpellLabel, short: ko.student.aiSpellShortLabel },
  FEEDBACK: { full: ko.student.aiFeedbackLabel, short: ko.student.aiFeedbackShortLabel },
  DIRECTION: { full: ko.student.aiDirectionLabel, short: ko.student.aiDirectionShortLabel },
  POLISH: { full: ko.student.aiPolishLabel, short: ko.student.aiPolishShortLabel },
};

/** 글벗 버튼별 아이콘(P3-7c) */
export const AI_BUTTON_ICON: Record<AiButton, IconName> = {
  SPELL: 'aiSpell',
  FEEDBACK: 'aiFeedback',
  DIRECTION: 'aiDirection',
  POLISH: 'aiPolish',
};

/**
 * 칩 옆 작은 글자. 한 줄 안내가 있으면 칩마다 같은 말을 붙이지 않는다.
 * 좁은 화면은 한 줄을 지키려고 "글이 바뀌었어요"를 모양으로만 보이고, 쿨다운은 "7초"처럼 줄인다.
 */
function chipStatusText(chip: AiChipView, short: boolean, hasGroupNote: boolean): string | undefined {
  if (hasGroupNote) return '';
  if (!short) return undefined;
  if (chip.state === 'cooldown' && chip.cooldownSeconds !== undefined && chip.cooldownSeconds > 0) {
    return `${chip.cooldownSeconds}${ko.common.delaySecondsSuffix}`;
  }
  if (chip.state === 'stale' || chip.state === 'guide' || chip.state === 'offline') return '';
  return undefined;
}

/**
 * 좁은 화면에서 칩의 읽기 이름에 붙일 상태(P5-1 [중-1]). `aria-label`을 주면 칩 안 글자는 이름 계산에서 빠지므로,
 * 화면에서는 줄이거나 모양으로만 보이는 상태(쿨다운 초·글이 바뀜·안내)를 넓은 화면 글자 그대로 이름에 넣는다.
 */
function chipSpokenStatus(chip: AiChipView): string | undefined {
  switch (chip.state) {
    case 'cooldown':
      return chip.cooldownSeconds !== undefined && chip.cooldownSeconds > 0
        ? `${chip.cooldownSeconds}${ko.student.aiCooldownSuffix}`
        : undefined;
    case 'stale':
      return ko.student.aiStaleBadge;
    case 'fresh':
      return ko.student.aiFreshBadge;
    case 'guide':
      return ko.student.aiMoreCharsGuide;
    case 'offline':
      return ko.student.aiOfflineGuide;
    default:
      return undefined;
  }
}

export interface AiChipBarProps {
  readonly chips: readonly AiChipView[];
  readonly layout: WriteLayout;
  /**
   * 넓은 배치인데 옆 패널이 쓰기 칸을 좁힘(`isWriteCompact`): 좁은 화면처럼 짧은 이름으로 한 줄을 지킨다
   * (P5-4 시각 검토 1번: 900~1100px에서 `다듬은 글`이 둘째 줄로 내려갔다).
   */
  readonly compact?: boolean | undefined;
  /** 닫힌 수업방(읽기만, PRD F-02): 칩을 흐리게 두고 누를 수 없게 한다. 안내는 위 닫힘 띠가 맡는다. */
  readonly disabled?: boolean | undefined;
  /** 지금 열린 결과 패널의 버튼. */
  readonly activeButton?: AiButton | null | undefined;
  readonly onChip: (button: AiButton) => void;
}

/**
 * AI 칩 4개 줄(PRD F-08, PLAN §6.7 칩 상태 기계).
 * - 보이는 칩이 모두 `guide`(최소 글자 미만)면 칩 줄 대신 "조금 더 써 볼까요?" 한 줄
 * - 모두 `offline`이면 칩을 흐리게 두고 "인터넷이 돌아오면 쓸 수 있어요" 한 줄(칩마다 같은 말을 되풀이하지 않는다)
 * - 모두 `limit`이면 칩을 흐리게 두고 F-26 한도 문구 한 줄
 */
export function AiChipBar({
  chips,
  layout,
  compact = false,
  disabled = false,
  activeButton,
  onChip,
}: AiChipBarProps) {
  const visible = chips.filter(chip => chip.state !== 'hidden');
  if (visible.length === 0) return null;

  const every = (state: AiChipView['state']) => visible.every(chip => chip.state === state);

  if (every('guide')) {
    return (
      <p className={styles.guide} role="status" aria-live="polite" data-ai-bar="guide">
        <Icon name="write" size={20} />
        <span>{ko.student.aiMoreCharsGuide}</span>
      </p>
    );
  }

  const groupNote = every('offline')
    ? ko.student.aiOfflineGuide
    : every('limit')
      ? ko.student.aiDailyLimitGuide
      : undefined;
  const short = layout === 'narrow' || compact;

  return (
    <div className={styles.wrap} data-ai-bar="chips" data-disabled={disabled ? 'true' : undefined}>
      {groupNote ? (
        <p className={styles.note} role="status" aria-live="polite">
          <Icon name={every('offline') ? 'offline' : 'pause'} size={16} />
          <span>{groupNote}</span>
        </p>
      ) : null}
      <div
        className={cx(styles.chips, short && styles.chipsNarrow)}
        role="group"
        aria-label={ko.student.aiChipGroupLabel}
        // 결과 패널을 닫을 때 그 칩이 꺼져 있으면(쿨다운 등) 초점을 돌려줄 자리(P5-1 [중-3]).
        tabIndex={-1}
        data-ai-chip-group=""
      >
        {visible.map(chip => {
          const label = AI_BUTTON_LABEL[chip.button];
          const aiState: AiChipState = chip.state === 'hidden' ? 'idle' : chip.state;
          const spoken = groupNote === undefined ? chipSpokenStatus(chip) : undefined;
          return (
            <Chip
              key={chip.button}
              aiState={aiState}
              icon={AI_BUTTON_ICON[chip.button]}
              cooldownSeconds={chip.cooldownSeconds}
              statusText={chipStatusText(chip, short, groupNote !== undefined)}
              aria-label={short ? (spoken ? `${label.full}, ${spoken}` : label.full) : undefined}
              aria-expanded={activeButton === chip.button}
              data-ai-button={chip.button}
              disabled={disabled}
              className={cx(styles.chip, activeButton === chip.button && styles.chipActive)}
              onClick={() => onChip(chip.button)}
            >
              {short ? label.short : label.full}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}
