import {
  AI_BUTTONS,
  cooldownLeftSec as domainCooldownLeftSec,
  dayKey,
  getMinCharsForAi,
  type AiButton,
  type GenreSelection,
  type StudentCopyKey,
} from '@geulbang/core';
import type { Config } from '@geulbang/core/config';
import type { ConnectionState } from '../ports/realtime.ts';

/**
 * AI 칩 상태 기계(PLAN §6.7, PRD F-08·F-26·6.5). 순수 함수: 같은 입력이면 같은 출력, 시계·저장소를 직접 보지 않는다.
 * 앞에 있는 것이 이긴다:
 * 1. `hidden`   교사가 끈 버튼(바로 사라짐)
 * 2. `pending`  요청 중("글벗이 글을 읽고 있어요"). 연결이 흔들려도 받는 중인 결과는 기다린다
 * 3. `offline`  연결 없음(흐림, "인터넷이 돌아오면 쓸 수 있어요")
 * 4. `tooShort` 글 종류별 최소 글자 미만("조금 더 써 볼까요?")
 * 5. `limit`    오늘 한도에 닿음(그날 한국 시각 0시까지, "오늘은 글벗이 쉬어요…")
 * 6. `cooldown` 같은 버튼 쿨다운(남은 초)
 * 7. `stale` / `fresh` 저장된 결과가 있음(글이 바뀜 / 그대로) · `ready` 결과 없음
 * 저장된 결과는 요청을 못 보내는 동안에도 열어 볼 수 있다(`canOpen`, "패널을 다시 열면 바로 보인다").
 */
export type AiChipState =
  'hidden' | 'pending' | 'offline' | 'tooShort' | 'limit' | 'cooldown' | 'stale' | 'fresh' | 'ready';

export type AiChipConfig = Pick<Config, 'AI_COOLDOWN_SEC' | 'AI_MIN_CHARS' | 'TIMEZONE'>;

export interface AiChipInput {
  readonly button: AiButton;
  /** 교사가 켠 버튼(hello·`room.settings`의 `aiButtons`) */
  readonly enabledButtons: readonly AiButton[];
  readonly connection: ConnectionState;
  /** 최소 글자 기준(`getMinCharsForAi`) */
  readonly genre: GenreSelection;
  /** 본문 글자 수(`countChars`, 줄바꿈 뺌) */
  readonly chars: number;
  readonly now: number;
  /** 이 버튼을 마지막으로 보낸 시각(서버 쿨다운은 참가자·버튼마다) */
  readonly lastRequestAt: number | null;
  /** 하루 한도(`E_AI_LIMIT`)를 받은 시각. 참가자·방·전체 한도라 버튼 구분이 없다 */
  readonly limitHitAt: number | null;
  readonly pending: boolean;
  /** 이 글·버튼의 저장된 결과 */
  readonly record: { readonly textHash: string } | null;
  /** 지금 본문 전체의 해시(`aiTextHash`). 아직 못 셌으면 null(그동안은 `fresh`로 본다) */
  readonly currentTextHash: string | null;
}

export interface AiChipView {
  readonly state: AiChipState;
  readonly labelKey: StudentCopyKey;
  /** 폰 너비용 짧은 이름 */
  readonly shortLabelKey: StudentCopyKey;
  /** 칩·패널 아래 안내. `cooldown`이면 `${cooldownLeftSec}` 뒤에 붙인다 */
  readonly hintKey: StudentCopyKey | null;
  readonly cooldownLeftSec: number;
  readonly minChars: number;
  readonly result: 'none' | 'fresh' | 'stale';
  /** 눌러서 새로 요청할 수 있다(`다시 받기`도 같음) */
  readonly canRequest: boolean;
  /** 패널을 열 수 있다(저장된 결과 보기·기다리는 중 보기·새 요청) */
  readonly canOpen: boolean;
}

export const AI_BUTTON_LABEL_KEYS: Readonly<
  Record<AiButton, { readonly label: StudentCopyKey; readonly short: StudentCopyKey }>
> = {
  SPELL: { label: 'aiSpellLabel', short: 'aiSpellShortLabel' },
  FEEDBACK: { label: 'aiFeedbackLabel', short: 'aiFeedbackShortLabel' },
  DIRECTION: { label: 'aiDirectionLabel', short: 'aiDirectionShortLabel' },
  POLISH: { label: 'aiPolishLabel', short: 'aiPolishShortLabel' },
};

const HINT_KEYS: Readonly<Record<AiChipState, StudentCopyKey | null>> = {
  hidden: null,
  pending: 'aiReadingStatus',
  offline: 'aiOfflineGuide',
  tooShort: 'aiMoreCharsGuide',
  limit: 'aiDailyLimitGuide',
  cooldown: 'aiCooldownSuffix',
  stale: 'aiStaleBadge',
  fresh: null,
  ready: null,
};

/** 연결 없음으로 보는 상태. `connecting`은 처음 붙는 중에도 REST는 될 수 있어 막지 않는다(서버가 다시 판단). */
const OFFLINE_STATES: ReadonlySet<ConnectionState> = new Set(['offline', 'server-down', 'closed']);

/** 쿨다운 남은 초(올림). 서버 예약(PLAN §8.2 ②)과 같은 공용 계산(`domain/aiQuota`)을 쓴다. */
export function cooldownLeftSec(lastRequestAt: number | null, now: number, cooldownSec: number): number {
  return domainCooldownLeftSec(lastRequestAt, now, { AI_COOLDOWN_SEC: cooldownSec });
}

/** 한도를 받은 날(설정 시간대, 한국 시각 0시 기준)과 지금이 같은 날인가(PRD F-26) */
export function isLimitActive(limitHitAt: number | null, now: number, timeZone: string): boolean {
  return limitHitAt !== null && limitHitAt <= now && dayKey(limitHitAt, timeZone) === dayKey(now, timeZone);
}

export function aiChipView(input: AiChipInput, config: AiChipConfig): AiChipView {
  const keys = AI_BUTTON_LABEL_KEYS[input.button];
  const minChars = getMinCharsForAi(input.genre, config);
  const cooldown = cooldownLeftSec(input.lastRequestAt, input.now, config.AI_COOLDOWN_SEC);
  const result: AiChipView['result'] =
    input.record === null
      ? 'none'
      : input.currentTextHash !== null && input.currentTextHash !== input.record.textHash
        ? 'stale'
        : 'fresh';

  const state: AiChipState = !input.enabledButtons.includes(input.button)
    ? 'hidden'
    : input.pending
      ? 'pending'
      : OFFLINE_STATES.has(input.connection)
        ? 'offline'
        : input.chars < minChars
          ? 'tooShort'
          : isLimitActive(input.limitHitAt, input.now, config.TIMEZONE)
            ? 'limit'
            : cooldown > 0
              ? 'cooldown'
              : result === 'none'
                ? 'ready'
                : result;

  const canRequest = state === 'ready' || state === 'fresh' || state === 'stale';
  return {
    state,
    labelKey: keys.label,
    shortLabelKey: keys.short,
    hintKey: HINT_KEYS[state],
    cooldownLeftSec: state === 'cooldown' ? cooldown : 0,
    minChars,
    result,
    canRequest,
    canOpen: state !== 'hidden' && (canRequest || state === 'pending' || result !== 'none'),
  };
}

/** 버튼 줄 전체(PRD F-08): 켜진 버튼이 없으면 줄을 숨기고, 짧은 글·연결 없음은 줄 하나의 안내로 보인다. */
export interface AiChipRowView {
  /** `none`: 켜진 버튼 없음 · `tooShort`: 버튼 줄 대신 "조금 더 써 볼까요?" · `offline`: 버튼이 흐림 + 안내 */
  readonly kind: 'none' | 'tooShort' | 'offline' | 'buttons';
  readonly hintKey: StudentCopyKey | null;
  /** 켜진 버튼만, 정해진 순서(맞춤법·한마디·방향·다듬은 글) */
  readonly chips: readonly (AiChipView & { readonly button: AiButton })[];
}

export type AiChipRowInput = Omit<AiChipInput, 'button' | 'lastRequestAt' | 'pending' | 'record'> & {
  readonly perButton: (button: AiButton) => Pick<AiChipInput, 'lastRequestAt' | 'pending' | 'record'>;
};

export function aiChipRow(input: AiChipRowInput, config: AiChipConfig): AiChipRowView {
  const { perButton, ...shared } = input;
  const chips = AI_BUTTONS.filter(b => shared.enabledButtons.includes(b)).map(button => ({
    button,
    ...aiChipView({ ...shared, button, ...perButton(button) }, config),
  }));
  if (chips.length === 0) return { kind: 'none', hintKey: null, chips };
  // 요청 중인 버튼이 있으면 그 칩이 기다림을 보여야 하므로 줄 안내로 덮지 않는다.
  if (chips.some(c => c.state === 'pending')) return { kind: 'buttons', hintKey: null, chips };
  if (chips.every(c => c.state === 'offline')) return { kind: 'offline', hintKey: 'aiOfflineGuide', chips };
  if (chips.every(c => c.state === 'tooShort'))
    return { kind: 'tooShort', hintKey: 'aiMoreCharsGuide', chips };
  return { kind: 'buttons', hintKey: null, chips };
}
