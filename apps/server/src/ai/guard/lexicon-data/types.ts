import type { LexCategory, LexGrade } from '../lexicon.ts';

/**
 * 사전 낱말 묶음. 낱말 안에 공백이 있으면 구절로 보고 띄어쓰기와 관계없이 찾는다(압축 보기).
 * `wordStart`면 낱말 첫머리에서만 잡는다(바로 앞 글자가 한글이 아님) — "보지"·"자지"처럼 "가보지"·"남자지" 안에 흔히 드는 말.
 */
export interface TermGroup {
  readonly grade: LexGrade;
  readonly category: LexCategory;
  readonly wordStart?: boolean;
  readonly terms: readonly string[];
}

/** 출처 하나: 낱말 묶음과 허용어(오탐 예외, 구간 포함 방식) */
export interface LexiconSource {
  readonly name: string;
  readonly groups: readonly TermGroup[];
  readonly allow: readonly string[];
}
