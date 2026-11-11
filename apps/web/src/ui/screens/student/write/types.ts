import type { AiButton, ErrorCode, SnapshotReason, SongMoodId, SongTempoId } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';

/** 900px 기준(PRD 7.3): `wide`는 결과 패널이 옆 패널, `narrow`는 바텀시트. */
export type WriteLayout = 'wide' | 'narrow';

/** 저장 상태 3가지(PRD F-09). 제출 상태는 `WriteSubmission`이 따로 맡는다. */
export type WriteSaveState = 'saved' | 'sending' | 'local';

/** `pending`: 오프라인에서 제출해 서버 확인을 기다림(PRD F-11 '제출 대기'), `submitted`: 잠김('제출 완료'). */
export type WriteSubmission = 'none' | 'pending' | 'submitted';

/**
 * AI 칩 상태 기계의 모든 상태(PLAN §6.7). `hidden`은 교사가 끈 버튼(그리지 않음).
 * `guide`는 최소 글자 미만, `fresh`·`stale`은 결과 있음(신선 / 글이 바뀜).
 */
export type AiChipViewState =
  'hidden' | 'idle' | 'offline' | 'guide' | 'cooldown' | 'limit' | 'loading' | 'fresh' | 'stale';

export interface AiChipView {
  readonly button: AiButton;
  readonly state: AiChipViewState;
  /** `cooldown`일 때 남은 초. */
  readonly cooldownSeconds?: number | undefined;
}

/** 맞춤법 항목 종류. 서버는 한국어 글자(`맞춤법` 등)로 주므로 `spellKindFromLabel`로 바꾼다. */
export type SpellKindView = 'spelling' | 'spacing' | 'punctuation';

export function spellKindFromLabel(kind: string): SpellKindView {
  if (kind === ko.student.aiSpellKindSpacing) return 'spacing';
  if (kind === ko.student.aiSpellKindPunctuation) return 'punctuation';
  return 'spelling';
}

export interface SpellItemView {
  /** 화면 안에서 항목을 구별하는 값(목록 순번 등). */
  readonly id: string;
  readonly original: string;
  readonly suggestion: string;
  readonly reason: string;
  readonly kind: SpellKindView;
  /** 위치를 찾았는가(PRD 6.3: 못 찾은 항목은 목록에는 보이되 누를 수 없다). */
  readonly locatable: boolean;
}

export interface FeedbackView {
  readonly praise: string;
  readonly improve: readonly string[];
  readonly factCheck?: string | undefined;
  readonly eraNote?: string | undefined;
  readonly softenNote?: string | undefined;
}

export interface DirectionIdeaView {
  readonly text: string;
  readonly label?: string | undefined;
}

export type ResultContent =
  | {
      readonly kind: 'SPELL';
      readonly items: readonly SpellItemView[];
      /** 방금 눌러 쓰기 칸에서 선택·형광 중인 항목. */
      readonly activeItemId?: string | null | undefined;
    }
  | { readonly kind: 'FEEDBACK'; readonly result: FeedbackView }
  | { readonly kind: 'DIRECTION'; readonly ideas: readonly DirectionIdeaView[] }
  | {
      readonly kind: 'POLISH';
      /** 지금까지 받은 글자(스트리밍 중이면 늘어난다). */
      readonly text: string;
      readonly done: boolean;
      /** 길이 비율이 0.5 미만·1.6 초과(PRD 6.3 "많이 달라졌어요"). */
      readonly lengthWarning?: boolean | undefined;
      /** 길이 한도로 일부만 다듬음(`done.stop === 'limit'`). */
      readonly truncated?: boolean | undefined;
    };

/**
 * 결과 패널 하나(PRD F-08: 한 번에 하나만 열린다).
 * - `loading`: "글벗이 글을 읽고 있어요"(다듬은 글은 첫 글자 전까지)
 * - `ready`: `content`를 그린다(다듬은 글 스트리밍도 `ready` + `done: false`)
 * - `error`: `ko.errors[errorCode]` 한 줄 + `다시 받기`
 * - `limit`: 쉬는 글벗 + 한도 문구(F-26)
 */
export interface ResultPanelView {
  readonly button: AiButton;
  readonly status: 'loading' | 'ready' | 'error' | 'limit';
  readonly content?: ResultContent | undefined;
  readonly errorCode?: ErrorCode | undefined;
  /** 받은 뒤 글이 바뀜("글이 바뀌었어요 · 다시 받기"). */
  readonly stale?: boolean | undefined;
  readonly receivedAt?: number | undefined;
  /** 글이 길어 뒷부분만 보냄(F-26 "글이 길어서 마지막 부분만 볼게요"). */
  readonly tailOnly?: boolean | undefined;
  /** `다시 받기` 쿨다운 남은 초(F-26 `AI_COOLDOWN_SEC`). */
  readonly refreshCooldownSeconds?: number | undefined;
}

export interface HelpQuestionView {
  readonly id: string;
  readonly prompt: string;
}

/** 노래 가사 분위기·빠르기 칩(PRD F-07, 질문 카드의 첫 장). */
export interface SongChipsView {
  readonly mood: SongMoodId | null;
  readonly moodCustom: string;
  readonly tempo: SongTempoId | null;
}

export interface RewindSnapshotView {
  readonly id: string;
  readonly at: number;
  readonly reason: SnapshotReason;
  readonly title: string;
  readonly body: string;
}

/** 시간 되감기 시트(PRD F-10). `offline`이면 "인터넷이 돌아오면 볼 수 있어요". */
export interface RewindView {
  readonly status: 'loading' | 'ready' | 'offline' | 'empty';
  /** 오래된 것 → 최근 것 순서. */
  readonly snapshots: readonly RewindSnapshotView[];
  readonly selectedIndex: number;
  readonly restoring?: boolean | undefined;
}

/** 하단 토스트 한 줄(한 번에 하나). 되살리기는 6초(F-06), 선생님 함께 고침은 그 글에서 처음 1번. */
export type WriteToast =
  | { readonly kind: 'restore' }
  | { readonly kind: 'teacherEditing' }
  | { readonly kind: 'copied' }
  | { readonly kind: 'error'; readonly message: string; readonly retry?: boolean | undefined };

export interface WriteTimerView {
  readonly remainingSeconds: number;
  readonly paused?: boolean | undefined;
}
