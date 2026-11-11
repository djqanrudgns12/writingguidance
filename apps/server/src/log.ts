/**
 * 기록(PLAN §7.6): 표준 출력에 JSON 한 줄. launchd가 파일로 받고 7일 뒤 지운다.
 * 본문·별명·IP 원문·토큰은 넣지 않는다. 넣을 수 있는 칸을 타입으로 좁혀 실수를 막는다.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  /** 오류 코드(PRD 12.4) */
  readonly code?: string;
  readonly route?: string;
  readonly status?: number;
  /** 수업방 ID의 짧은 HMAC. 수업방 ID 원문은 넣지 않는다. */
  readonly roomHash?: string;
  readonly ms?: number;
  readonly requestId?: string;
  readonly hook?: string;
  readonly count?: number;
  readonly detail?: string;
  readonly error?: unknown;
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createLogger(
  level: LogLevel,
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
): Logger {
  const emit = (lv: LogLevel, event: string, fields?: LogFields) => {
    if (order[lv] < order[level]) return;
    const { error, ...rest } = fields ?? {};
    const record: Record<string, unknown> = { t: new Date().toISOString(), level: lv, event, ...rest };
    if (error !== undefined) record['error'] = describeError(error);
    write(JSON.stringify(record));
  };
  return {
    debug: (e, f) => emit('debug', e, f),
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
  };
}

/** 오류는 이름·메시지·위치만 남긴다. 메시지에 학생 글이 섞이지 않도록 길이를 자른다. */
function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      message: error.message.slice(0, 300),
      ...(typeof code === 'string' ? { code } : {}),
      stack: error.stack
        ?.split('\n')
        .slice(1, 6)
        .map(s => s.trim()),
    };
  }
  return { value: String(error).slice(0, 300) };
}

/** 시험용: 기록을 배열에 모은다. */
export function createMemoryLogger(): Logger & { readonly lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger('debug', line => lines.push(JSON.parse(line) as Record<string, unknown>));
  return Object.assign(logger, { lines });
}
