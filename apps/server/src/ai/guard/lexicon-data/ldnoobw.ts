import type { LexiconSource } from './types.ts';

/**
 * List of Dirty, Naughty, Obscene, and Otherwise Bad Words의 ko 목록
 * (https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) 커밋 5faf2ba42d7b1c0977169ec3611df25a3c08eb13.
 * CC BY 4.0(https://creativecommons.org/licenses/by/4.0/), 저작자: LDNOOBW 기여자. 라이선스 원문은 같은 폴더 NOTICE.md 5.4.
 * 바꾼 점: 일상어와 겹치는 낱말(유모·야사·망가·노모·고자·호로·에로 등)을 빼고 등급·분류를 매겼다.
 */
export const LDNOOBW: LexiconSource = {
  name: 'ldnoobw',
  groups: [
    {
      grade: 'A',
      category: 'profanity',
      terms: [
        '개새끼',
        '개자식',
        '개좆',
        '계집년',
        '니기미',
        '미친새끼',
        '병신',
        '쌍놈',
        '씨발',
        '씨발놈',
        '씨팔',
        '씹새끼',
        '씹알',
        '씹창',
        '씹팔',
        '엄창',
        '잡년',
        '종간나',
        '좆',
        '좆만',
        '죽일년',
        '쥐좆',
      ],
    },
    {
      grade: 'A',
      category: 'sexual',
      terms: [
        '강간',
        '딸딸이',
        '때씹',
        '빠구리',
        '사까시',
        '섹스',
        '스와핑',
        '씹물',
        '씹빨',
        '은꼴',
        '창녀',
        '화냥년',
        '후장',
      ],
    },
    {
      grade: 'A',
      category: 'sexual',
      wordStart: true,
      terms: ['보지', '자지'],
    },
    {
      grade: 'A',
      category: 'hate',
      terms: ['짱깨', '쪽바리'],
    },
    {
      grade: 'B',
      category: 'profanity',
      wordStart: true,
      terms: ['미친'],
    },
    {
      grade: 'B',
      category: 'sexual',
      terms: ['근친', '몰카', '변태', '암캐'],
    },
    {
      grade: 'B',
      category: 'sexual',
      wordStart: true,
      terms: ['자위'],
    },
    {
      grade: 'C',
      category: 'profanity',
      terms: ['개차반', '뒤질래', '또라이', '염병', '옘병', '육갑', '후레아들', '희쭈그리'],
    },
    {
      grade: 'C',
      category: 'sexual',
      terms: ['로리타', '바바리맨', '불알', '야애니', '직촬', '포르노'],
    },
    {
      grade: 'C',
      category: 'sexual',
      wordStart: true,
      terms: ['야동'],
    },
    {
      grade: 'C',
      category: 'hate',
      terms: ['뙤놈'],
    },
    {
      grade: 'C',
      category: 'hate',
      wordStart: true,
      terms: ['애자'],
    },
  ],
  allow: [],
};
