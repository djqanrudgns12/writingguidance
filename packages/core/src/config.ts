import { z } from 'zod';

/**
 * 바뀔 수 있는 값을 모아 둔 한 곳(PRD 0.2-5 `[고정]`, PRD 12.3).
 * 키 이름과 기본값은 PRD 12.3 표와 같아야 한다. `tools/checks/prd-sync.mjs`가 양쪽을 대조한다.
 * 서버는 같은 이름의 환경 변수로 덮어쓴다(`parseConfig`). 기기는 서버가 `hello.config`로 보낸 값을 쓰고,
 * 이 기본값은 연결 전 대비용이다.
 */
export const configDefaults = {
  // 보관
  ROOM_TTL_DAYS: 30,
  PERSONAL_TTL_DAYS: 30,
  EXPIRY_WARNING_DAYS: 3,

  // PIN·입장 코드·시작 코드
  PIN_MIN_LENGTH: 6,
  PIN_MAX_LENGTH: 8,
  PIN_MAX_FAILS: 5,
  PIN_LOCK_MIN: 10,
  PIN_IP_MAX_FAILS: 30,
  PIN_GLOBAL_SLOW_FAILS: 100,
  PIN_GLOBAL_DELAY_MS: 2000,
  ENTRY_CODE_LENGTH: 6,
  CODE_LOOKUP_PER_DEVICE_PER_MIN: 30,
  CODE_LOOKUP_PER_IP_PER_MIN: 600,
  TEACHER_START_CODE_REQUIRED: true,
  TEACHER_START_CODE_LENGTH: 8,
  PERSONAL_MODE_ENABLED: false,
  ROOM_CREATE_PER_DEVICE_PER_DAY: 10,
  ROOM_CREATE_PER_IP_PER_DAY: 30,

  // 크기
  ROOM_MAX_PARTICIPANTS: 40,
  DOC_MAX_CHARS: 50_000,
  NICKNAME_MAX_LENGTH: 12,
  CLASS_NAME_MAX_CHARS: 30,
  ROOM_TITLE_MAX_CHARS: 40,
  SCHOOL_NAME_MAX_CHARS: 40,
  DOC_TITLE_MAX_CHARS: 40,
  MEMO_MAX_CHARS: 300,
  WS_MAX_PAYLOAD_BYTES: 1024 * 1024,
  AI_REQUEST_MAX_BYTES: 96 * 1024,

  // 명령·기록
  COMMAND_ACK_TIMEOUT_MS: 10_000,
  COMMAND_RETENTION_DAYS: 7,
  LOG_RETENTION_DAYS: 7,

  // 되돌리기·스냅샷·저장
  UNDO_GROUP_MS: { fine: 400, normal: 800, coarse: 1600 },
  SNAPSHOT_INTERVAL_SEC: 30,
  SNAPSHOT_MAX: 300,
  SERVER_PERSIST_DEBOUNCE_MS: 2000,
  SERVER_PERSIST_MAX_WAIT_MS: 10_000,
  SUMMARY_INTERVAL_MS: 1000,

  // 한글 반영 문 (PRD 9.3)
  IME_IDLE_MS: 500,
  IME_LONG_IDLE_MS: 2000,
  IME_MAX_HOLD_MS: 10_000,
  IME_RELAXED_IDLE_MS: 300,
  IME_STUCK_MS: 5000,
  IME_HOLD_NOTICE_MS: 3000,

  // 연결·접속 판정
  HEARTBEAT_SEC: 5,
  CLIENT_STALE_SEC: 12,
  ACTIVE_WINDOW_SEC: 30,
  IDLE_AFTER_SEC: 180,
  OFFLINE_AFTER_SEC: 10,
  RECONNECT_BACKOFF_MS: [1000, 2000, 4000, 8000, 15_000],

  // 알림·타이머·이어 쓰기
  NOTICE_SHOW_SEC: 6,
  NOTICE_REPLAY_SEC: 60,
  NOTICE_MAX_CHARS: 60,
  TIMER_PRESETS_MIN: [5, 10, 15, 20],
  TIMER_MAX_MIN: 120,
  /** 타이머 기본 알림: 끝나기 n분 전(PRD F-19 "5분 전·1분 전") */
  TIMER_ALERTS_MIN: [5, 1],
  /** 지금 삭제 확인 시트의 버튼이 눌리기까지(PRD F-22 "3초 뒤에 눌리는 버튼") */
  DELETE_CONFIRM_DELAY_SEC: 3,
  RESUME_WAIT_HINT_MIN: 30,
  RESUME_LONGPOLL_SEC: 20,

  // AI 한도·크기·시간 (PRD 6장, F-26)
  AI_COOLDOWN_SEC: 10,
  AI_DAILY_PER_PARTICIPANT: 60,
  AI_DAILY_PER_ROOM: 1500,
  AI_DAILY_GLOBAL: 3000,
  AI_DAILY_PERSONAL_GLOBAL: 500,
  AI_MAX_INPUT_CHARS: 6000,
  AI_SPELL_CHUNK_CHARS: 1500,
  AI_SPELL_MAX_CHARS: 18_000,
  AI_SPELL_MAX_PARALLEL: 4,
  CHECK_AI_PER_DAY: 20,
  /** 글 종류별 최소 글자. 어느 종류가 어느 단계를 쓰는지는 `genres.ts`가 정한다. */
  AI_MIN_CHARS: { default: 20, poem: 10, posterSlogan: 4 },
  AI_TIMEOUT_SEC: 20,
  AI_POLISH_FIRST_BYTE_SEC: 20,
  AI_POLISH_TIMEOUT_SEC: 40,
  /** 버튼별 최대 출력 토큰(PLAN §8.3). 다듬은 글은 원문 토큰 × 1.6, 이 값이 상한. */
  AI_MAX_OUTPUT_TOKENS: { spell: 2000, feedback: 800, direction: 600, polishMax: 6000 },
  /**
   * 생각 깊이별로 출력 한도에 더하는 여유 토큰. 생각 토큰도 max_tokens 안에 들어가서, 보통·높음은 이게 없으면
   * 답이 잘린다(2026-11-12 생각 깊이 평가). 끔·낮음은 0이라 기존 동작 그대로.
   */
  AI_THINKING_HEADROOM_TOKENS: { off: 0, low: 0, medium: 2000, high: 6000 },

  // AI 제공사·모델·생각 깊이 (PRD 6.4.1)
  AI_PROVIDER: 'anthropic',
  MODEL_SPELL: 'claude-haiku-5-5',
  MODEL_FEEDBACK: 'claude-haiku-5-5',
  MODEL_DIRECTION: 'claude-haiku-5-5',
  MODEL_POLISH: 'claude-haiku-5-5',
  MODEL_FALLBACK: 'claude-sonnet-5-5',
  AI_EFFORT_SPELL: 'low',
  AI_EFFORT_FEEDBACK: 'off',
  AI_EFFORT_DIRECTION: 'off',
  AI_EFFORT_POLISH: 'off',
  AI_EFFORT_FALLBACK: 'low',

  // 화면
  LARGE_DELETE_CHARS: 30,
  RECENT_ROOMS_MAX: 5,
  FONT_SIZES: [16, 18, 21, 24],

  // 정책·주소·시간대
  POLICY_VERSION: '2026-11-v1',
  PUBLIC_ORIGIN: 'https://write.ssamuniverse.com',
  TIMEZONE: 'Asia/Seoul',
} as const;

const count = z.number().int().nonnegative();
const positive = z.number().int().positive();
const effort = z.enum(['off', 'low', 'medium', 'high']);
const model = z.string().min(1);

/** 기본값과 덮어쓴 값이 모두 지켜야 하는 모양. 길이·개수의 상한은 여기서만 검사한다. */
export const configSchema = z
  .object({
    ROOM_TTL_DAYS: positive,
    PERSONAL_TTL_DAYS: positive,
    EXPIRY_WARNING_DAYS: count,

    PIN_MIN_LENGTH: positive,
    PIN_MAX_LENGTH: positive,
    PIN_MAX_FAILS: positive,
    PIN_LOCK_MIN: positive,
    PIN_IP_MAX_FAILS: positive,
    PIN_GLOBAL_SLOW_FAILS: positive,
    PIN_GLOBAL_DELAY_MS: count,
    ENTRY_CODE_LENGTH: positive,
    CODE_LOOKUP_PER_DEVICE_PER_MIN: positive,
    CODE_LOOKUP_PER_IP_PER_MIN: positive,
    TEACHER_START_CODE_REQUIRED: z.boolean(),
    TEACHER_START_CODE_LENGTH: positive,
    PERSONAL_MODE_ENABLED: z.boolean(),
    ROOM_CREATE_PER_DEVICE_PER_DAY: positive,
    ROOM_CREATE_PER_IP_PER_DAY: positive,

    ROOM_MAX_PARTICIPANTS: positive,
    DOC_MAX_CHARS: positive,
    NICKNAME_MAX_LENGTH: positive,
    CLASS_NAME_MAX_CHARS: positive,
    ROOM_TITLE_MAX_CHARS: positive,
    SCHOOL_NAME_MAX_CHARS: positive,
    DOC_TITLE_MAX_CHARS: positive,
    MEMO_MAX_CHARS: positive,
    WS_MAX_PAYLOAD_BYTES: positive,
    AI_REQUEST_MAX_BYTES: positive,

    COMMAND_ACK_TIMEOUT_MS: positive,
    COMMAND_RETENTION_DAYS: positive,
    LOG_RETENTION_DAYS: positive,

    UNDO_GROUP_MS: z.object({ fine: positive, normal: positive, coarse: positive }).strict(),
    SNAPSHOT_INTERVAL_SEC: positive,
    SNAPSHOT_MAX: positive,
    SERVER_PERSIST_DEBOUNCE_MS: positive,
    SERVER_PERSIST_MAX_WAIT_MS: positive,
    SUMMARY_INTERVAL_MS: positive,

    IME_IDLE_MS: positive,
    IME_LONG_IDLE_MS: positive,
    IME_MAX_HOLD_MS: positive,
    IME_RELAXED_IDLE_MS: positive,
    IME_STUCK_MS: positive,
    IME_HOLD_NOTICE_MS: positive,

    HEARTBEAT_SEC: positive,
    CLIENT_STALE_SEC: positive,
    ACTIVE_WINDOW_SEC: positive,
    IDLE_AFTER_SEC: positive,
    OFFLINE_AFTER_SEC: positive,
    RECONNECT_BACKOFF_MS: z.array(positive).min(1),

    NOTICE_SHOW_SEC: positive,
    NOTICE_REPLAY_SEC: count,
    NOTICE_MAX_CHARS: positive,
    TIMER_PRESETS_MIN: z.array(positive).min(1),
    TIMER_MAX_MIN: positive,
    TIMER_ALERTS_MIN: z.array(positive).max(4),
    DELETE_CONFIRM_DELAY_SEC: positive,
    RESUME_WAIT_HINT_MIN: positive,
    RESUME_LONGPOLL_SEC: positive,

    AI_COOLDOWN_SEC: count,
    AI_DAILY_PER_PARTICIPANT: count,
    AI_DAILY_PER_ROOM: count,
    AI_DAILY_GLOBAL: count,
    AI_DAILY_PERSONAL_GLOBAL: count,
    AI_MAX_INPUT_CHARS: positive,
    AI_SPELL_CHUNK_CHARS: positive,
    AI_SPELL_MAX_CHARS: positive,
    AI_SPELL_MAX_PARALLEL: positive,
    CHECK_AI_PER_DAY: count,
    AI_MIN_CHARS: z.object({ default: count, poem: count, posterSlogan: count }).strict(),
    AI_TIMEOUT_SEC: positive,
    AI_POLISH_FIRST_BYTE_SEC: positive,
    AI_POLISH_TIMEOUT_SEC: positive,
    AI_MAX_OUTPUT_TOKENS: z
      .object({ spell: positive, feedback: positive, direction: positive, polishMax: positive })
      .strict(),
    AI_THINKING_HEADROOM_TOKENS: z.object({ off: count, low: count, medium: count, high: count }).strict(),

    // 'fake'는 시험용이다. 운영에서 쓰면 서버가 시작을 거부한다(apps/server/src/config.ts).
    AI_PROVIDER: z.enum(['anthropic', 'fake']),
    MODEL_SPELL: model,
    MODEL_FEEDBACK: model,
    MODEL_DIRECTION: model,
    MODEL_POLISH: model,
    MODEL_FALLBACK: model,
    AI_EFFORT_SPELL: effort,
    AI_EFFORT_FEEDBACK: effort,
    AI_EFFORT_DIRECTION: effort,
    AI_EFFORT_POLISH: effort,
    AI_EFFORT_FALLBACK: effort,

    LARGE_DELETE_CHARS: positive,
    RECENT_ROOMS_MAX: positive,
    FONT_SIZES: z.array(positive).min(1),

    POLICY_VERSION: z.string().min(1),
    PUBLIC_ORIGIN: z.url({ protocol: /^https?$/ }),
    TIMEZONE: z.string().min(1),
  })
  .strict()
  .refine(c => c.PIN_MIN_LENGTH <= c.PIN_MAX_LENGTH, {
    path: ['PIN_MIN_LENGTH'],
    message: 'PIN 최소 길이가 최대보다 큼',
  })
  .refine(c => c.SERVER_PERSIST_DEBOUNCE_MS <= c.SERVER_PERSIST_MAX_WAIT_MS, {
    path: ['SERVER_PERSIST_DEBOUNCE_MS'],
    message: '저장 묶음 시간이 최대 대기보다 큼',
  })
  .refine(c => c.AI_SPELL_CHUNK_CHARS <= c.AI_SPELL_MAX_CHARS, {
    path: ['AI_SPELL_CHUNK_CHARS'],
    message: '맞춤법 조각이 최대 글자보다 큼',
  })
  .refine(c => c.IME_RELAXED_IDLE_MS <= c.IME_IDLE_MS && c.IME_IDLE_MS <= c.IME_LONG_IDLE_MS, {
    path: ['IME_IDLE_MS'],
    message: '반영 문 멈춤 시간 순서가 틀림(완화 ≤ 기본 ≤ 긴 멈춤)',
  })
  .refine(c => c.HEARTBEAT_SEC < c.CLIENT_STALE_SEC, {
    path: ['CLIENT_STALE_SEC'],
    message: '기기 끊김 판정이 하트비트 간격보다 짧음',
  });

export type Config = z.infer<typeof configSchema>;
export type ConfigKey = keyof typeof configDefaults;
export const configKeys = Object.keys(configDefaults) as ConfigKey[];

/** 기본값이 스키마를 지키는지는 시작할 때 한 번 확인한다(어긋나면 바로 알 수 있게). */
export const defaultConfig: Readonly<Config> = Object.freeze(configSchema.parse(configDefaults));

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`설정이 잘못되었습니다:\n${issues.join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * 환경 변수 같은 문자열 묶음으로 기본값을 덮는다. 모르는 값이나 잘못된 값이 있으면 `ConfigError`.
 * 문자열 → 값 규칙은 기본값의 모양을 따른다: 숫자, `true`/`false`, 숫자 목록은 쉼표로, 묶음은 JSON.
 */
export function parseConfig(source: Readonly<Record<string, string | undefined>>): Readonly<Config> {
  const issues: string[] = [];
  const merged: Record<string, unknown> = { ...configDefaults };

  for (const key of configKeys) {
    const raw = source[key];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = parseRaw(configDefaults[key], raw.trim());
    if (parsed.ok) merged[key] = parsed.value;
    else issues.push(`${key}: ${parsed.reason}`);
  }

  const result = configSchema.safeParse(merged);
  if (!result.success) {
    for (const issue of result.error.issues)
      issues.push(`${issue.path.join('.') || '(전체)'}: ${issue.message}`);
  }
  if (issues.length > 0 || !result.success) throw new ConfigError(issues);
  return Object.freeze(result.data);
}

type Parsed = { ok: true; value: unknown } | { ok: false; reason: string };

function parseRaw(sample: unknown, raw: string): Parsed {
  if (typeof sample === 'number') {
    const n = Number(raw.replaceAll('_', ''));
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: `숫자가 아님 (${raw})` };
  }
  if (typeof sample === 'boolean') {
    if (raw === 'true') return { ok: true, value: true };
    if (raw === 'false') return { ok: true, value: false };
    return { ok: false, reason: `true 또는 false여야 함 (${raw})` };
  }
  if (Array.isArray(sample)) {
    const items = raw.split(',').map(s => Number(s.trim()));
    return items.every(Number.isFinite)
      ? { ok: true, value: items }
      : { ok: false, reason: `쉼표로 나눈 숫자 목록이어야 함 (${raw})` };
  }
  if (typeof sample === 'object' && sample !== null) {
    try {
      return { ok: true, value: JSON.parse(raw) as unknown };
    } catch {
      return { ok: false, reason: 'JSON이 아님' };
    }
  }
  return { ok: true, value: raw };
}
