import type { ApiOutput, PolishLine } from '@geulbang/core/api';
import type { ErrorCode } from '@geulbang/core/errors';
import { z } from 'zod';

/**
 * REST 포트(PLAN §2.5·§7.2). 엔드포인트마다 타입 있는 함수. 실패는 `ApiError`로 던진다.
 * 수업방 안의 바뀜(제출·알림·타이머 등)은 REST가 아니라 수업방 채널 명령이다(§4.4).
 */
export interface ApiError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly fields?: Readonly<Record<string, string>>;
}

export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    'retryable' in error
  );
}

export interface CreateRoomInput {
  readonly className: string;
  readonly title: string;
  readonly schoolName?: string;
  readonly showSchool: boolean;
  readonly genres: readonly string[];
  readonly aiButtons: readonly ('SPELL' | 'FEEDBACK' | 'DIRECTION' | 'POLISH')[];
  readonly pin: string;
  readonly linkTokenHash: string;
  readonly deviceId: string;
  readonly commandId: string;
}

export interface JoinInput {
  readonly nickname: string;
  readonly consentVersion: string;
  readonly deviceId: string;
  readonly deviceTokenHash: string;
  readonly commandId: string;
}

export interface AiRequestInput {
  readonly docId: string;
  readonly button: 'SPELL' | 'FEEDBACK' | 'DIRECTION' | 'POLISH';
  readonly text: string;
  readonly range: 'ALL' | 'TAIL';
  readonly meta: {
    readonly helpNotes: readonly { readonly questionId: string; readonly note: string }[];
    readonly mood?: string;
    readonly tempo?: string;
  };
  readonly commandId: string;
}

export interface ApiPort {
  createRoom(input: CreateRoomInput, startCode: string | null): Promise<ApiOutput<'createRoomResult'>>;
  /** `deviceId`가 있으면 `X-Device-Id`로 보낸다(기기당 조회 칸을 세려고, ADR-056) */
  roomByCode(code: string, deviceId?: string): Promise<ApiOutput<'roomByCodeResult'>>;
  join(roomId: string, input: JoinInput): Promise<ApiOutput<'joinResult'>>;
  /** 맞춤법·한마디·방향(학생 토큰) */
  aiStructured(
    roomId: string,
    token: string,
    input: AiRequestInput,
  ): Promise<ApiOutput<'aiStructuredResult'>>;
  /** 다듬은 글 스트림. 패널을 닫으면 `signal`로 끊는다. */
  aiPolish(
    roomId: string,
    token: string,
    input: AiRequestInput,
    signal: AbortSignal,
  ): AsyncIterable<PolishLine>;

  // ── 이어 쓰기(PLAN §2.3 ④) ─────────────────────────────
  resumeRequest(roomId: string, input: ResumeRequestInput): Promise<ApiOutput<'resumeRequestResult'>>;
  /** 긴 조회: 결정이 나거나 `waitSec`이 지나면 답한다. 인증은 새 기기 토큰. */
  resumeStatus(
    roomId: string,
    requestId: string,
    newDeviceToken: string,
    waitSec: number,
    signal?: AbortSignal,
  ): Promise<ApiOutput<'resumeStatusResult'>>;
  resumeCancel(
    roomId: string,
    requestId: string,
    newDeviceToken: string,
  ): Promise<ApiOutput<'resumeStatusResult'>>;

  // ── 교사(PLAN §7.2) ──────────────────────────────────────
  teacherPin(input: TeacherPinInput): Promise<ApiOutput<'teacherPinResult'>>;
  /** 선생님 링크 토큰 → 방 ID(다른 기기에서 링크를 열 때) */
  teacherSession(teacherToken: string): Promise<ApiOutput<'teacherSessionResult'>>;
  /** `signal`: 연결 점검이 기한에 끊을 때(PRD 16.4) */
  teacherRoom(
    roomId: string,
    teacherToken: string,
    signal?: AbortSignal,
  ): Promise<ApiOutput<'teacherRoomResult'>>;
  teacherPinView(roomId: string, teacherToken: string): Promise<ApiOutput<'teacherPinViewResult'>>;
  checkAi(roomId: string, teacherToken: string, signal?: AbortSignal): Promise<ApiOutput<'checkAiResult'>>;
  exportRoom(
    roomId: string,
    teacherToken: string,
    scope: 'submitted' | 'all',
  ): Promise<ApiOutput<'exportResult'>>;
}

export interface ResumeRequestInput {
  readonly nickname: string;
  readonly deviceId: string;
  readonly deviceTokenHash: string;
  readonly commandId: string;
}

export interface TeacherPinInput {
  readonly pin: string;
  readonly deviceId: string;
  readonly sessionTokenHash: string;
  readonly commandId: string;
}

/**
 * 구조화 결과의 기기 쪽 모양(PRD 6.3). 서버가 길이·개수를 이미 검증하고 다듬어 보내므로(PLAN §8.5) 여기서는 구조만 본다.
 * 모르는 필드는 버린다(서버가 먼저 새 판이 되어도 기기 저장 결과를 읽을 수 있게).
 * 서버 `ai/schemas.ts`와 일부러 따로 둔다: 서버는 모델 출력을 길이·개수까지 엄격히 막고,
 * 기기는 저장해 둔 옛 결과와 새 판 서버 결과를 함께 읽어야 해서 느슨하다. 모양이 바뀌면 둘 다 고친다.
 */
/** 맞춤법 항목 종류. 화면 문구가 아니라 응답 계약 값이다(PRD 6.3, 서버 `SPELL_KINDS`와 같은 글자). */
export const SPELL_KINDS = ['맞춤법', '띄어쓰기', '문장부호'] as const;
export type SpellKind = (typeof SPELL_KINDS)[number];

/** 맞춤법 등급(docs/ai-harness.md 5절 S-06): 고쳐요 / 권장해요 / 그대로 둬도 돼요. 응답 계약 값이다. */
export const SPELL_SEVERITIES = ['fix', 'suggest', 'keep'] as const;
export type SpellSeverity = (typeof SPELL_SEVERITIES)[number];

/** 결과에 붙는 알림(학생 글 속 개인정보 P-01·비속어 S-09). 응답 계약 값이다. */
export const AI_RESULT_NOTICES = ['PII_IN_TEXT', 'PROFANITY_IN_TEXT'] as const;
export type AiResultNotice = (typeof AI_RESULT_NOTICES)[number];

export const isAiResultNotice = (value: unknown): value is AiResultNotice =>
  (AI_RESULT_NOTICES as readonly unknown[]).includes(value);

/**
 * 알림 칸: 아는 값만 남긴다(서버가 먼저 새 알림을 더해도 결과 전체를 버리지 않게).
 * 없거나 배열이 아니거나 남는 것이 없으면 칸을 비운다.
 */
const noticesSchema = z
  .unknown()
  .transform((raw): AiResultNotice[] | undefined => {
    if (!Array.isArray(raw)) return undefined;
    const known = [...new Set(raw.filter(isAiResultNotice))];
    return known.length > 0 ? known : undefined;
  })
  .optional();

/** 근거(S-07): 서버 표에서 붙인 쉬운 이름과 국립국어원 주소. 모양이 틀리면 근거만 버린다. */
const spellRuleSchema = z.object({ id: z.string().min(1), label: z.string().min(1), url: z.string() });

export const spellResultSchema = z.object({
  items: z.array(
    z.object({
      original: z.string().min(1),
      suggestion: z.string(),
      reason: z.string(),
      kind: z.enum(SPELL_KINDS),
      context: z.object({ before: z.string(), after: z.string() }),
      // 없으면 등급 전에 받은(저장된) 결과라 지금처럼 `fix`, 모르는 값은 확신이 없다고 보고 `suggest`(5절 보정 4번).
      severity: z.enum(SPELL_SEVERITIES).default('fix').catch('suggest'),
      rule: spellRuleSchema.optional().catch(undefined),
    }),
  ),
  notices: noticesSchema,
});
export type SpellResult = z.output<typeof spellResultSchema>;
export type SpellItem = SpellResult['items'][number];

export const feedbackResultSchema = z.object({
  praise: z.string().min(1),
  improve: z.array(z.string().min(1)).min(1),
  factCheck: z.string().optional(),
  eraNote: z.string().optional(),
  softenNote: z.string().optional(),
  notices: noticesSchema,
});
export type FeedbackResult = z.output<typeof feedbackResultSchema>;

export const directionResultSchema = z.object({
  ideas: z.array(z.object({ text: z.string().min(1), label: z.string().optional() })).min(1),
  notices: noticesSchema,
});
export type DirectionResult = z.output<typeof directionResultSchema>;

/** 다듬은 글은 스트림을 다 받은 뒤 기기가 만든다(머리말을 뗀 글, 끝난 까닭, 길이 안내 여부). */
export const polishResultSchema = z.object({
  text: z.string(),
  stop: z.enum(['end', 'limit']),
  lengthWarning: z.boolean(),
  notices: noticesSchema,
});
export type PolishResult = z.output<typeof polishResultSchema>;

export const aiResultSchemas = {
  SPELL: spellResultSchema,
  FEEDBACK: feedbackResultSchema,
  DIRECTION: directionResultSchema,
  POLISH: polishResultSchema,
} as const;

export type AiButtonId = AiRequestInput['button'];
export type StructuredAiButton = Exclude<AiButtonId, 'POLISH'>;
export type AiResultOf<B extends AiButtonId> = z.output<(typeof aiResultSchemas)[B]>;
