import { AppError, type FieldIssues } from '@geulbang/core/errors';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from './envelope.ts';

/** 요청 본문 JSON. 아니면 `E_INPUT`. */
export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError('E_INPUT', 'body is not JSON', { body: 'json' });
  }
}

/** zod로 확인하고, 틀리면 칸마다 짧은 이유 코드를 붙인 `E_INPUT`(알 수 없는 필드도 거부, PLAN §7.2). */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown, field?: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join('.');
    const name = field ? (path ? `${field}.${path}` : field) : path || 'body';
    fields[name] ??= issue.code;
  }
  throw new AppError('E_INPUT', 'invalid input', fields satisfies FieldIssues);
}
