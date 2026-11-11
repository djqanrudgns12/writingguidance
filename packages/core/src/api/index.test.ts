import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig } from '../config.ts';
import { createApiSchemas } from './index.ts';

/** P5-5b 검토 B10: 노래 분위기 직접 입력은 화면·Yjs 검사와 같은 설정 한도(`DOC_TITLE_MAX_CHARS`)를 쓴다. */
describe('aiRequestBody 노래 분위기·빠르기 한도', () => {
  const body = (mood: string, tempo = '보통') => ({
    docId: '00000000-0000-4000-8000-000000000001',
    button: 'FEEDBACK',
    text: '노랫말',
    range: 'ALL',
    meta: { helpNotes: [], mood, tempo },
    commandId: '00000000-0000-4000-8000-000000000002',
  });

  it('화면이 허용한 길이(설정 상한)까지는 받고, 넘으면 거절한다', () => {
    const schemas = createApiSchemas(defaultConfig);
    const max = defaultConfig.DOC_TITLE_MAX_CHARS;
    expect(max).toBeGreaterThan(32); // 예전 상수 32보다 긴 값이 실제로 시험된다
    expect(schemas.aiRequestBody.safeParse(body('가'.repeat(max))).success).toBe(true);
    expect(schemas.aiRequestBody.safeParse(body('가'.repeat(max + 1))).success).toBe(false);
    expect(schemas.aiRequestBody.safeParse(body('가', '가'.repeat(max))).success).toBe(true);
    expect(schemas.aiRequestBody.safeParse(body('가', '가'.repeat(max + 1))).success).toBe(false);
  });

  it('설정을 바꾸면 그 값을 따른다', () => {
    const schemas = createApiSchemas(parseConfig({ DOC_TITLE_MAX_CHARS: '50' }));
    expect(schemas.aiRequestBody.safeParse(body('가'.repeat(50))).success).toBe(true);
    expect(schemas.aiRequestBody.safeParse(body('가'.repeat(51))).success).toBe(false);
  });
});
