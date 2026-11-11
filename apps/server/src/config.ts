import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { configDefaults, parseConfig, type Config } from '@geulbang/core/config';
import { z } from 'zod';

/**
 * 서버 설정 = 제품 설정(PRD 12.3, `@geulbang/core/config`) + 운영 환경 변수 + 비밀값(PLAN §13).
 * 시작할 때 한 번 읽고, 틀리면 시작을 거부한다.
 */

/** 저장소 뿌리. src/config.ts와 dist/config.js 모두 apps/server 아래 한 칸이라 같은 계산이 맞다. */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export const paths = {
  repoRoot,
  migrationsDir: fileURLToPath(new URL('../migrations/', import.meta.url)),
  webDistDir: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  devDbPath: fileURLToPath(new URL('../../../.local/dev.sqlite', import.meta.url)),
} as const;

const flag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform(v => v === 'true' || v === '1');

const opsSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  /** 운영 4460(launchd가 넣음), 개발 4461 (PLAN §2.1) */
  PORT: z.coerce.number().int().min(0).max(65_535).default(4461),
  DB_PATH: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** 배포가 넣는 릴리스 이름(`releases/<sha>`). 상태 확인에 보인다. */
  RELEASE_ID: z.string().min(1).default('dev'),
  /** 실기기 한글 확인 때만 켠다(PRD 13.2). */
  IME_DIAGNOSTICS_ENABLED: flag,
  /** 개발 전용 `dev` 자격과 `/dev/editor` (PLAN §11.5). 운영에서 켜면 시작 거부. */
  DEV_DOCS_ENABLED: flag,
  /** 시험 전용: `dev` 자격 비밀값을 정해 둔다(화면 시험이 주소를 미리 알아야 해서). 없으면 실행마다 무작위. 운영에서 있으면 시작 거부. */
  DEV_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, { message: 'base64url 43자' })
    .optional(),
  /** 내줄 웹 빌드 폴더. 실기기 시험 빌드(`dist-devices`)를 내줄 때만 바꾼다. */
  WEB_DIST_DIR: z.string().min(1).optional(),
  /** 시험 전용: 보관 기간을 분 단위로 줄인다. 운영에서 있으면 시작 거부. */
  ROOM_TTL_MINUTES_OVERRIDE: z.coerce.number().int().positive().optional(),
});

export type OpsConfig = z.output<typeof opsSchema>;

const base64Key = (bytes: number) =>
  z
    .string()
    .refine(v => Buffer.from(v, 'base64').length === bytes, { message: `base64로 ${bytes}바이트여야 함` })
    .transform(v => Buffer.from(v, 'base64'));

const secretsSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  TEACHER_START_CODE: z.string().regex(/^\d+$/, { message: '숫자만' }).optional(),
  PIN_HMAC_KEY: base64Key(32).optional(),
  PIN_ENC_KEY: base64Key(32).optional(),
  ID_HMAC_KEY: base64Key(32).optional(),
  PERSONAL_HMAC_KEY: base64Key(32).optional(),
});

export interface Secrets {
  readonly anthropicApiKey: string | undefined;
  readonly teacherStartCode: string | undefined;
  readonly pinHmacKey: Buffer;
  readonly pinEncKey: Buffer;
  readonly idHmacKey: Buffer;
  readonly personalHmacKey: Buffer;
}

export interface ServerConfig {
  readonly ops: OpsConfig & { readonly DB_PATH: string };
  readonly product: Readonly<Config>;
  readonly secrets: Secrets;
  /** 개발에서 비어 있던 비밀값을 이번 실행만 쓰는 무작위 값으로 채웠는가(기록용, 값은 남기지 않음) */
  readonly generatedSecrets: readonly string[];
}

export class StartupError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`서버를 시작할 수 없습니다:\n${issues.map(i => `- ${i}`).join('\n')}`);
    this.name = 'StartupError';
    this.issues = issues;
  }
}

export function loadServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const issues: string[] = [];

  const opsResult = opsSchema.safeParse(env);
  if (!opsResult.success) {
    for (const i of opsResult.error.issues) issues.push(`${i.path.join('.')}: ${i.message}`);
  }

  let product: Readonly<Config> | undefined;
  try {
    product = parseConfig(env);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  const secretsResult = secretsSchema.safeParse(env);
  if (!secretsResult.success) {
    for (const i of secretsResult.error.issues) issues.push(`${i.path.join('.')}: ${i.message}`);
  }

  if (!opsResult.success || !product || !secretsResult.success) throw new StartupError(issues);

  const ops = opsResult.data;
  const raw = secretsResult.data;
  const production = ops.NODE_ENV === 'production';

  if (production) {
    if (ops.DEV_DOCS_ENABLED) issues.push('운영에서 DEV_DOCS_ENABLED를 켤 수 없음');
    if (ops.DEV_SECRET !== undefined) issues.push('운영에서 DEV_SECRET을 쓸 수 없음');
    if (ops.ROOM_TTL_MINUTES_OVERRIDE !== undefined)
      issues.push('운영에서 ROOM_TTL_MINUTES_OVERRIDE를 쓸 수 없음');
    if (product.AI_PROVIDER === 'fake') issues.push('운영에서 AI_PROVIDER=fake를 쓸 수 없음');
    if (product.SNAPSHOT_INTERVAL_SEC < configDefaults.SNAPSHOT_INTERVAL_SEC) {
      issues.push('운영에서 SNAPSHOT_INTERVAL_SEC를 기본값보다 줄일 수 없음');
    }
    if (!ops.DB_PATH) issues.push('운영에서는 DB_PATH를 꼭 정해야 함');
    if (!raw.PIN_HMAC_KEY) issues.push('PIN_HMAC_KEY 없음');
    if (!raw.PIN_ENC_KEY) issues.push('PIN_ENC_KEY 없음');
    if (!raw.ID_HMAC_KEY) issues.push('ID_HMAC_KEY 없음');
    if (product.AI_PROVIDER === 'anthropic' && !raw.ANTHROPIC_API_KEY) issues.push('ANTHROPIC_API_KEY 없음');
  }
  if (product.TEACHER_START_CODE_REQUIRED) {
    if (!raw.TEACHER_START_CODE) {
      if (production) issues.push('TEACHER_START_CODE 없음');
    } else if (raw.TEACHER_START_CODE.length !== product.TEACHER_START_CODE_LENGTH) {
      issues.push(`TEACHER_START_CODE는 ${product.TEACHER_START_CODE_LENGTH}자리여야 함`);
    }
  }
  if (issues.length > 0) throw new StartupError(issues);

  const generated: string[] = [];
  const keyOrRandom = (name: string, value: Buffer | undefined): Buffer => {
    if (value) return value;
    generated.push(name);
    return randomBytes(32);
  };

  return {
    ops: { ...ops, DB_PATH: ops.DB_PATH ?? paths.devDbPath },
    product,
    secrets: {
      anthropicApiKey: raw.ANTHROPIC_API_KEY,
      teacherStartCode: raw.TEACHER_START_CODE,
      pinHmacKey: keyOrRandom('PIN_HMAC_KEY', raw.PIN_HMAC_KEY),
      pinEncKey: keyOrRandom('PIN_ENC_KEY', raw.PIN_ENC_KEY),
      idHmacKey: keyOrRandom('ID_HMAC_KEY', raw.ID_HMAC_KEY),
      personalHmacKey: keyOrRandom('PERSONAL_HMAC_KEY', raw.PERSONAL_HMAC_KEY),
    },
    generatedSecrets: generated,
  };
}
