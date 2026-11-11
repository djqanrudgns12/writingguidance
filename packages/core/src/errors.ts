/**
 * 오류 코드 한 곳(PRD 12.4). 코드 목록은 PRD 12.4 표와 같아야 한다(`tools/checks/prd-sync.mjs`).
 * 학생에게는 코드 대신 문구만 보인다. 문구는 `copy/ko.ts`에 있고, 여기는 코드의 성질만 둔다.
 *
 * - `http`: 서버가 이 코드로 답할 때의 HTTP 상태. `null`은 서버가 보내지 않는 기기 쪽 코드.
 * - `retryable`: 같은 요청을 잠시 뒤 다시 보내도 되는지(봉투의 `retryable`).
 * - `silent`: 화면에 문구를 띄우지 않고 기기가 알아서 처리하는 코드.
 */
export const errorCatalog = {
  E_OFFLINE: { http: null, retryable: true, silent: false },
  E_SERVER_DOWN: { http: null, retryable: true, silent: false },
  E_ROOM_NOT_FOUND: { http: 404, retryable: false, silent: false },
  E_ROOM_EXPIRED: { http: 410, retryable: false, silent: false },
  E_ROOM_CLOSED: { http: 409, retryable: false, silent: false },
  E_ROOM_FULL: { http: 409, retryable: false, silent: false },
  E_NICK_TAKEN: { http: 409, retryable: false, silent: false },
  E_NICK_INVALID: { http: 422, retryable: false, silent: false },
  E_RESUME_PENDING: { http: 409, retryable: true, silent: false },
  E_RESUME_REJECTED: { http: 403, retryable: false, silent: false },
  E_DOC_LOCKED: { http: 423, retryable: false, silent: false },
  E_DOC_TOO_LARGE: { http: 413, retryable: false, silent: false },
  E_FORBIDDEN: { http: 403, retryable: false, silent: false },
  E_SYNC_PENDING: { http: 409, retryable: true, silent: true },
  E_STALE: { http: 409, retryable: false, silent: true },
  E_PIN_TAKEN: { http: 409, retryable: false, silent: false },
  E_PIN_INVALID: { http: 401, retryable: false, silent: false },
  E_PIN_LOCKED: { http: 429, retryable: true, silent: false },
  E_START_CODE_INVALID: { http: 401, retryable: false, silent: false },
  E_AUTH: { http: 401, retryable: false, silent: false },
  E_AI_TIMEOUT: { http: 504, retryable: true, silent: false },
  E_AI_FORMAT: { http: 502, retryable: true, silent: false },
  E_AI_PROVIDER: { http: 502, retryable: true, silent: false },
  E_AI_REFUSED: { http: 422, retryable: false, silent: false },
  E_AI_COOLDOWN: { http: 429, retryable: true, silent: false },
  E_AI_LIMIT: { http: 429, retryable: false, silent: false },
  E_STORAGE_BLOCKED: { http: null, retryable: false, silent: false },
  E_RATE_LIMITED: { http: 429, retryable: true, silent: false },
  E_INPUT: { http: 400, retryable: false, silent: false },
  E_VERSION: { http: 426, retryable: false, silent: false },
  // 우리 봉투가 없는 앞단(CloudFront·Cloudflare)의 429·503을 기기가 이 코드로 바꾼다.
  E_QUOTA: { http: null, retryable: true, silent: false },
  E_INTERNAL: { http: 500, retryable: true, silent: false },
} as const satisfies Record<string, ErrorTraits>;

export interface ErrorTraits {
  readonly http: number | null;
  readonly retryable: boolean;
  readonly silent: boolean;
}

export type ErrorCode = keyof typeof errorCatalog;
export const errorCodes = Object.keys(errorCatalog) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(errorCatalog, value);
}

/** 칸마다 붙는 안내(E_INPUT). 값은 문구 키가 아니라 짧은 이유 코드다. */
export type FieldIssues = Readonly<Record<string, string>>;

/** 서버·기기가 함께 던지는 앱 오류. 메시지는 기록용이고, 화면 문구는 코드로 고른다. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields: FieldIssues | undefined;

  constructor(code: ErrorCode, message?: string, fields?: FieldIssues, options?: ErrorOptions) {
    super(message ?? code, options);
    this.name = 'AppError';
    this.code = code;
    this.fields = fields;
  }

  get retryable(): boolean {
    return errorCatalog[this.code].retryable;
  }
}
