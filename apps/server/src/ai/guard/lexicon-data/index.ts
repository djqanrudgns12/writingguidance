import { KORCEN } from './korcen.ts';
import { LDNOOBW } from './ldnoobw.ts';
import { LISUUGI } from './lisuugi.ts';
import { OWN } from './own.ts';
import type { LexiconSource } from './types.ts';

/** 사전 출처 목록. 같은 열쇠가 여럿이면 lexicon.ts가 더 무거운 등급을 남긴다. 출처·라이선스는 NOTICE.md. */
export const LEXICON_SOURCES: readonly LexiconSource[] = [KORCEN, LISUUGI, LDNOOBW, OWN];
