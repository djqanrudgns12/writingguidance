import type { Config } from '@geulbang/core/config';
import type { KvStorePort } from '../../../ports/localStore.ts';

/**
 * 선생님 시작 코드(PRD F-15)는 기기 `kv`에만 둔다. 서버에는 수업방을 만들 때 머리(`X-Start-Code`)로만 간다.
 */
export const START_CODE_KEY = 'teacher.startCode';

export async function readStartCode(kv: KvStorePort): Promise<string | null> {
  const value = await kv.get(START_CODE_KEY);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function writeStartCode(kv: KvStorePort, code: string): Promise<void> {
  return kv.set(START_CODE_KEY, code);
}

export function forgetStartCode(kv: KvStorePort): Promise<void> {
  return kv.delete(START_CODE_KEY);
}

/** 숫자만, 설정 길이(`TEACHER_START_CODE_LENGTH`)와 같아야 한다. */
export function isStartCodeShape(code: string, config: Pick<Config, 'TEACHER_START_CODE_LENGTH'>): boolean {
  return code.length === config.TEACHER_START_CODE_LENGTH && /^\d+$/.test(code);
}
