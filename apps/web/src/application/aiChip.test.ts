import { AI_BUTTONS, type AiButton } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import { describe, expect, it } from 'vitest';
import {
  aiChipRow,
  aiChipView,
  cooldownLeftSec,
  isLimitActive,
  type AiChipInput,
  type AiChipState,
} from './aiChip.ts';

// 2026-11-11 12:00 한국 시각(UTC 03:00). 한국 0시는 UTC 전날 15:00.
const NOW = Date.UTC(2026, 10, 11, 3, 0, 0);
const KST_MIDNIGHT = Date.UTC(2026, 10, 10, 15, 0, 0);
const SEC = 1000;

const base: AiChipInput = {
  button: 'FEEDBACK',
  enabledButtons: AI_BUTTONS,
  connection: 'online',
  genre: { genre: 'story' },
  chars: 30,
  now: NOW,
  lastRequestAt: null,
  limitHitAt: null,
  pending: false,
  record: null,
  currentTextHash: 'h1',
};

const view = (patch: Partial<AiChipInput>) => aiChipView({ ...base, ...patch }, defaultConfig);

describe('AI 칩 상태 기계(PLAN §6.7)', () => {
  it.each<[string, Partial<AiChipInput>, AiChipState, string | null, boolean, boolean]>([
    // 이름, 입력, 상태, 안내 문구 키, 요청 가능, 열기 가능
    ['교사가 끈 버튼은 숨김', { enabledButtons: ['SPELL'] }, 'hidden', null, false, false],
    [
      '숨김은 요청 중·결과보다 앞',
      { enabledButtons: [], pending: true, record: { textHash: 'h1' } },
      'hidden',
      null,
      false,
      false,
    ],
    ['요청 중', { pending: true }, 'pending', 'aiReadingStatus', false, true],
    [
      '요청 중은 오프라인·쿨다운보다 앞',
      { pending: true, connection: 'offline', lastRequestAt: NOW },
      'pending',
      'aiReadingStatus',
      false,
      true,
    ],
    ['오프라인이면 흐림', { connection: 'offline' }, 'offline', 'aiOfflineGuide', false, false],
    ['서버에 닿지 않아도 흐림', { connection: 'server-down' }, 'offline', 'aiOfflineGuide', false, false],
    ['연결을 닫은 뒤도 흐림', { connection: 'closed' }, 'offline', 'aiOfflineGuide', false, false],
    ['처음 붙는 중은 막지 않음', { connection: 'connecting' }, 'ready', null, true, true],
    [
      '오프라인이어도 저장된 결과는 열어 볼 수 있음',
      { connection: 'offline', record: { textHash: 'h1' } },
      'offline',
      'aiOfflineGuide',
      false,
      true,
    ],
    [
      '오프라인은 짧은 글 안내보다 앞',
      { connection: 'offline', chars: 3 },
      'offline',
      'aiOfflineGuide',
      false,
      false,
    ],
    ['이야기 19자는 안내', { chars: 19 }, 'tooShort', 'aiMoreCharsGuide', false, false],
    ['이야기 20자는 쓸 수 있음', { chars: 20 }, 'ready', null, true, true],
    ['시 9자는 안내', { genre: { genre: 'poem' }, chars: 9 }, 'tooShort', 'aiMoreCharsGuide', false, false],
    ['시 10자는 쓸 수 있음', { genre: { genre: 'poem' }, chars: 10 }, 'ready', null, true, true],
    [
      '포스터·표어 3자는 안내',
      { genre: { genre: 'other', purpose: 'poster' }, chars: 3 },
      'tooShort',
      'aiMoreCharsGuide',
      false,
      false,
    ],
    [
      '포스터·표어 4자는 쓸 수 있음',
      { genre: { genre: 'other', purpose: 'poster' }, chars: 4 },
      'ready',
      null,
      true,
      true,
    ],
    [
      '짧은 글은 한도보다 앞',
      { chars: 1, limitHitAt: NOW - SEC },
      'tooShort',
      'aiMoreCharsGuide',
      false,
      false,
    ],
    ['오늘 한도', { limitHitAt: NOW - 3600 * SEC }, 'limit', 'aiDailyLimitGuide', false, false],
    [
      '한도는 쿨다운보다 앞',
      { limitHitAt: NOW - SEC, lastRequestAt: NOW - SEC },
      'limit',
      'aiDailyLimitGuide',
      false,
      false,
    ],
    [
      '한도여도 저장된 결과는 열기',
      { limitHitAt: NOW, record: { textHash: 'h1' } },
      'limit',
      'aiDailyLimitGuide',
      false,
      true,
    ],
    ['어제(한국 시각) 한도는 풀림', { limitHitAt: KST_MIDNIGHT - 1 }, 'ready', null, true, true],
    ['쿨다운', { lastRequestAt: NOW - 3 * SEC }, 'cooldown', 'aiCooldownSuffix', false, false],
    [
      '쿨다운이어도 저장된 결과는 열기',
      { lastRequestAt: NOW - 3 * SEC, record: { textHash: 'h1' } },
      'cooldown',
      'aiCooldownSuffix',
      false,
      true,
    ],
    ['쿨다운이 끝나면 쓸 수 있음', { lastRequestAt: NOW - 10 * SEC }, 'ready', null, true, true],
    ['결과가 있고 글이 그대로', { record: { textHash: 'h1' } }, 'fresh', null, true, true],
    ['결과가 있고 글이 바뀜', { record: { textHash: 'h0' } }, 'stale', 'aiStaleBadge', true, true],
    [
      '지금 해시를 아직 못 셌으면 그대로로 봄',
      { record: { textHash: 'h0' }, currentTextHash: null },
      'fresh',
      null,
      true,
      true,
    ],
    ['결과 없음', {}, 'ready', null, true, true],
  ])('%s', (_name, patch, state, hintKey, canRequest, canOpen) => {
    const v = view(patch);
    expect(v.state).toBe(state);
    expect(v.hintKey).toBe(hintKey);
    expect(v.canRequest).toBe(canRequest);
    expect(v.canOpen).toBe(canOpen);
  });

  it('결과의 신선함은 요청을 못 보내는 동안에도 알려 준다', () => {
    expect(view({ connection: 'offline', record: { textHash: 'h0' } }).result).toBe('stale');
    expect(view({ lastRequestAt: NOW, record: { textHash: 'h1' } }).result).toBe('fresh');
    expect(view({}).result).toBe('none');
  });

  it('쿨다운 남은 초는 올림이고, 쿨다운 상태가 아니면 0', () => {
    expect(view({ lastRequestAt: NOW }).cooldownLeftSec).toBe(10);
    expect(view({ lastRequestAt: NOW - 3 * SEC }).cooldownLeftSec).toBe(7);
    expect(view({ lastRequestAt: NOW - 9 * SEC - 1 }).cooldownLeftSec).toBe(1);
    expect(view({ lastRequestAt: NOW - 10 * SEC }).cooldownLeftSec).toBe(0);
    expect(view({ lastRequestAt: NOW, connection: 'offline' }).cooldownLeftSec).toBe(0);
    expect(cooldownLeftSec(null, NOW, 10)).toBe(0);
    expect(cooldownLeftSec(NOW, NOW, defaultConfig.AI_COOLDOWN_SEC)).toBe(defaultConfig.AI_COOLDOWN_SEC);
  });

  it('하루는 한국 시각 0시에 바뀐다', () => {
    const tz = defaultConfig.TIMEZONE;
    expect(isLimitActive(KST_MIDNIGHT - 1, KST_MIDNIGHT - 1, tz)).toBe(true);
    expect(isLimitActive(KST_MIDNIGHT - 1, KST_MIDNIGHT, tz)).toBe(false);
    expect(isLimitActive(KST_MIDNIGHT, KST_MIDNIGHT + 23 * 3600 * SEC, tz)).toBe(true);
    expect(isLimitActive(null, NOW, tz)).toBe(false);
  });

  it('버튼마다 이름 키와 최소 글자를 준다', () => {
    const keys = AI_BUTTONS.map(button => {
      const v = view({ button });
      return [v.labelKey, v.shortLabelKey];
    });
    expect(keys).toEqual([
      ['aiSpellLabel', 'aiSpellShortLabel'],
      ['aiFeedbackLabel', 'aiFeedbackShortLabel'],
      ['aiDirectionLabel', 'aiDirectionShortLabel'],
      ['aiPolishLabel', 'aiPolishShortLabel'],
    ]);
    expect(view({ genre: { genre: 'poem' } }).minChars).toBe(defaultConfig.AI_MIN_CHARS.poem);
  });
});

describe('AI 버튼 줄(PRD F-08)', () => {
  const none = () => ({ lastRequestAt: null, pending: false, record: null });
  const row = (patch: Partial<AiChipInput>, perButton: (b: AiButton) => ReturnType<typeof none> = none) => {
    const { button: _b, lastRequestAt: _l, pending: _p, record: _r, ...shared } = { ...base, ...patch };
    return aiChipRow({ ...shared, perButton }, defaultConfig);
  };

  it('켜진 버튼만 정해진 순서로', () => {
    const r = row({ enabledButtons: ['POLISH', 'SPELL'] });
    expect(r.kind).toBe('buttons');
    expect(r.chips.map(c => c.button)).toEqual(['SPELL', 'POLISH']);
  });

  it('켜진 버튼이 없으면 줄을 숨긴다', () => {
    expect(row({ enabledButtons: [] })).toEqual({ kind: 'none', hintKey: null, chips: [] });
  });

  it('짧은 글은 버튼 줄 대신 안내 하나, 오프라인은 흐린 줄 + 안내', () => {
    expect(row({ chars: 2 })).toMatchObject({ kind: 'tooShort', hintKey: 'aiMoreCharsGuide' });
    expect(row({ connection: 'offline' })).toMatchObject({ kind: 'offline', hintKey: 'aiOfflineGuide' });
  });

  it('기다리는 버튼이 있으면 줄 안내로 덮지 않는다', () => {
    const r = row({ chars: 2 }, b => ({ ...none(), pending: b === 'POLISH' }));
    expect(r.kind).toBe('buttons');
    expect(r.chips.find(c => c.button === 'POLISH')?.state).toBe('pending');
    expect(r.chips.find(c => c.button === 'SPELL')?.state).toBe('tooShort');
  });
});
