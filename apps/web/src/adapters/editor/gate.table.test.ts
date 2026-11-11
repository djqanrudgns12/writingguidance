import { defaultConfig } from '@geulbang/core/config';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../testing/fakeClock.ts';
import { decide, Gate, type FieldState, type GateReason } from './gate.ts';

/**
 * 한글 반영 문(PRD 9.3 3~7번, PLAN §6.3·§10.3) 전체 조건 표 시험.
 * 모든 시간 기준값(500ms, 2000ms, 10000ms, 300ms, 5000ms, 3000ms)은
 * 경계값 앞뒤 1ms(-1ms, 정각, +1ms)를 함께 시험한다.
 */

const T = defaultConfig;
const IDLE = T.IME_IDLE_MS; // 500
const LONG = T.IME_LONG_IDLE_MS; // 2000
const MAX_HOLD = T.IME_MAX_HOLD_MS; // 10000
const RELAXED = T.IME_RELAXED_IDLE_MS; // 300
const STUCK = T.IME_STUCK_MS; // 5000
const NOTICE = T.IME_HOLD_NOTICE_MS; // 3000

const HAN = '한'.codePointAt(0)!;
const GA = '가'.codePointAt(0)!;
const HIH = '힣'.codePointAt(0)!;
const COMPAT_JAMO = 'ㄱ'.codePointAt(0)!;
const CHOSEONG_JAMO = 0x1100; // ᄀ
const JUNGSEONG_JAMO = 0x1161; // ᅡ
const JONGSEONG_JAMO = 0x11a8; // ᆨ
const EXT_A_JAMO = 0xa960; // ꥠ
const EXT_B_JAMO = 0xd7b0; // ힰ

const SPACE = ' '.codePointAt(0)!;
const DOT = '.'.codePointAt(0)!;
const QUESTION = '?'.codePointAt(0)!;
const NEWLINE = '\n'.codePointAt(0)!;
const LATIN = 'a'.codePointAt(0)!;
const DIGIT = '7'.codePointAt(0)!;

function field(p: Partial<Omit<FieldState, 'charBeforeCaret'>> & { before?: number }): FieldState {
  return {
    composing: p.composing ?? false,
    lastActivityAt: p.lastActivityAt ?? 0,
    caretMovedByUser: p.caretMovedByUser ?? false,
    focused: p.focused ?? true,
    charBeforeCaret: () => p.before,
  };
}

interface DecideRow {
  readonly name: string;
  readonly fields: readonly FieldState[];
  readonly holdSince: number | null;
  readonly now: number;
  readonly open: boolean;
  readonly reason: GateReason;
  readonly recheckAt: number | null;
}

describe('decide 순수 함수 표 시험 (PRD 9.3 3~7번, 경계 앞뒤 1ms)', () => {
  const baseAt = 1000;

  const rows: readonly DecideRow[] = [
    // ── 3번(조합 열림) & 7번(5초 고착): 공백 앞에서도 조합 중이면 닫힘, 5000ms부터 고착 해제 ──
    {
      name: '3번 조합 열림: 시작 직후(0ms)는 닫힘',
      fields: [field({ composing: true, lastActivityAt: baseAt, before: SPACE })],
      holdSince: baseAt,
      now: baseAt,
      open: false,
      reason: 'composing',
      recheckAt: baseAt + STUCK,
    },
    {
      name: '3번 조합 열림: 500ms가 지나도 조합 중이면 닫힘',
      fields: [field({ composing: true, lastActivityAt: baseAt, before: SPACE })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: false,
      reason: 'composing',
      recheckAt: baseAt + STUCK,
    },
    {
      name: '3번 조합 열림: 2000ms가 지나도 조합 중이면 닫힘',
      fields: [field({ composing: true, lastActivityAt: baseAt, before: SPACE })],
      holdSince: baseAt,
      now: baseAt + LONG,
      open: false,
      reason: 'composing',
      recheckAt: baseAt + STUCK,
    },
    {
      name: '7번 5초 고착 경계 -1ms(4999ms, 공백 뒤): 아직 조합 중으로 보고 닫힘',
      fields: [field({ composing: true, lastActivityAt: baseAt, before: SPACE })],
      holdSince: baseAt,
      now: baseAt + STUCK - 1,
      open: false,
      reason: 'composing',
      recheckAt: baseAt + STUCK,
    },
    {
      name: '7번 5초 고착 경계 정각(5000ms, 공백 뒤): 조합이 끝난 것으로 보아 열림',
      fields: [field({ composing: true, lastActivityAt: baseAt, before: SPACE })],
      holdSince: baseAt,
      now: baseAt + STUCK,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '7번 5초 고착 경계 +1ms(5001ms, 공백 뒤): 열림',
      fields: [field({ composing: true, lastActivityAt: baseAt, before: SPACE })],
      holdSince: baseAt,
      now: baseAt + STUCK + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '7번 5초 고착 경계 -1ms(4999ms, 한글 뒤): 닫힘',
      fields: [field({ composing: true, lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + STUCK - 1,
      open: false,
      reason: 'composing',
      recheckAt: baseAt + STUCK,
    },
    {
      name: '7번 5초 고착 경계 정각(5000ms, 한글 뒤): 2초 멈춤도 넘어 열림',
      fields: [field({ composing: true, lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + STUCK,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '7번 5초 고착 경계 +1ms(5001ms, 한글 뒤): 열림',
      fields: [field({ composing: true, lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + STUCK + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },

    // ── 여러 칸 중 다른 칸 조합(제목·본문·메모 글 단위 반영 문) ──
    {
      name: '여러 칸 중 다른 칸(초점 없음)이 조합 중일 때 5초 고착 -1ms(4999ms): 닫힘',
      fields: [
        field({ focused: true, composing: false, lastActivityAt: 0, before: SPACE }),
        field({ focused: false, composing: true, lastActivityAt: baseAt, before: HAN }),
      ],
      holdSince: 0,
      now: baseAt + STUCK - 1,
      open: false,
      reason: 'composing',
      recheckAt: baseAt + STUCK,
    },
    {
      name: '여러 칸 중 다른 칸(초점 없음)이 조합 중일 때 5초 고착 정각(5000ms): 열림',
      fields: [
        field({ focused: true, composing: false, lastActivityAt: 0, before: SPACE }),
        field({ focused: false, composing: true, lastActivityAt: baseAt, before: HAN }),
      ],
      holdSince: 0,
      now: baseAt + STUCK,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '여러 칸 중 다른 칸(초점 없음)이 조합 중일 때 5초 고착 +1ms(5001ms): 열림',
      fields: [
        field({ focused: true, composing: false, lastActivityAt: 0, before: SPACE }),
        field({ focused: false, composing: true, lastActivityAt: baseAt, before: HAN }),
      ],
      holdSince: 0,
      now: baseAt + STUCK + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '세 칸(본문·제목·메모) 중 두 칸이 조합 중이면 먼저 풀리는 시각을 recheckAt으로 돌려줌',
      fields: [
        field({ focused: true, composing: true, lastActivityAt: baseAt, before: SPACE }),
        field({ focused: false, composing: false, lastActivityAt: 0, before: SPACE }),
        field({ focused: false, composing: true, lastActivityAt: baseAt + 500, before: HAN }),
      ],
      holdSince: baseAt,
      now: baseAt + STUCK - 1,
      open: false,
      reason: 'composing',
      recheckAt: baseAt + STUCK,
    },
    {
      name: '세 칸 중 첫 칸 조합이 5초 고착 해제되어도 셋째 칸 조합이 남아 있으면(-1ms) 닫힘',
      fields: [
        field({ focused: true, composing: true, lastActivityAt: baseAt, before: SPACE }),
        field({ focused: false, composing: false, lastActivityAt: 0, before: SPACE }),
        field({ focused: false, composing: true, lastActivityAt: baseAt + 500, before: HAN }),
      ],
      holdSince: baseAt,
      now: baseAt + 500 + STUCK - 1,
      open: false,
      reason: 'composing',
      recheckAt: baseAt + 500 + STUCK,
    },
    {
      name: '세 칸 중 마지막 조합 칸까지 5초 고착 정각(5000ms)이 되면 열림',
      fields: [
        field({ focused: true, composing: true, lastActivityAt: baseAt, before: SPACE }),
        field({ focused: false, composing: false, lastActivityAt: 0, before: SPACE }),
        field({ focused: false, composing: true, lastActivityAt: baseAt + 500, before: HAN }),
      ],
      holdSince: baseAt,
      now: baseAt + 500 + STUCK,
      open: true,
      reason: 'open',
      recheckAt: null,
    },

    // ── 4번: 마지막 입력·키 누름 뒤 500ms(IME_IDLE_MS) 경계 ──
    {
      name: '4번 500ms 멈춤 경계 -1ms(499ms, 공백 뒤): idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: SPACE })],
      holdSince: baseAt,
      now: baseAt + IDLE - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + IDLE,
    },
    {
      name: '4번 500ms 멈춤 경계 정각(500ms, 공백 뒤): 열림',
      fields: [field({ lastActivityAt: baseAt, before: SPACE })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '4번 500ms 멈춤 경계 +1ms(501ms, 공백 뒤): 열림',
      fields: [field({ lastActivityAt: baseAt, before: SPACE })],
      holdSince: baseAt,
      now: baseAt + IDLE + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '4번 500ms 멈춤 경계 -1ms(499ms, 한글 뒤): idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + IDLE - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + IDLE,
    },
    {
      name: '4번 500ms 멈춤 경계 정각(500ms, 한글 뒤): idle은 지났으나 음절 경계가 아니라 syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },
    {
      name: '4번 500ms 멈춤 경계 +1ms(501ms, 한글 뒤): syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + IDLE + 1,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },

    // ── 5번 음절 경계 ①: 커서 앞 글자가 한글이 아님(맨 앞·띄어쓰기·문장부호·줄바꿈·영문·숫자 vs 한글) ──
    {
      name: '5-① 커서 맨 앞(undefined) 499ms(-1ms): idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt })],
      holdSince: baseAt,
      now: baseAt + IDLE - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + IDLE,
    },
    {
      name: '5-① 커서 맨 앞(undefined) 500ms(정각): 음절 경계로 열림',
      fields: [field({ lastActivityAt: baseAt })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 커서 맨 앞(undefined) 501ms(+1ms): 열림',
      fields: [field({ lastActivityAt: baseAt })],
      holdSince: baseAt,
      now: baseAt + IDLE + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 마침표(.) 뒤 499ms(-1ms): idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: DOT })],
      holdSince: baseAt,
      now: baseAt + IDLE - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + IDLE,
    },
    {
      name: '5-① 마침표(.) 뒤 500ms(정각): 열림',
      fields: [field({ lastActivityAt: baseAt, before: DOT })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 마침표(.) 뒤 501ms(+1ms): 열림',
      fields: [field({ lastActivityAt: baseAt, before: DOT })],
      holdSince: baseAt,
      now: baseAt + IDLE + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 물음표(?) 뒤 499ms(-1ms): idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: QUESTION })],
      holdSince: baseAt,
      now: baseAt + IDLE - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + IDLE,
    },
    {
      name: '5-① 물음표(?) 뒤 500ms(정각): 열림',
      fields: [field({ lastActivityAt: baseAt, before: QUESTION })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 물음표(?) 뒤 501ms(+1ms): 열림',
      fields: [field({ lastActivityAt: baseAt, before: QUESTION })],
      holdSince: baseAt,
      now: baseAt + IDLE + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 줄바꿈(\\n) 뒤 499ms(-1ms): idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: NEWLINE })],
      holdSince: baseAt,
      now: baseAt + IDLE - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + IDLE,
    },
    {
      name: '5-① 줄바꿈(\\n) 뒤 500ms(정각): 열림',
      fields: [field({ lastActivityAt: baseAt, before: NEWLINE })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 줄바꿈(\\n) 뒤 501ms(+1ms): 열림',
      fields: [field({ lastActivityAt: baseAt, before: NEWLINE })],
      holdSince: baseAt,
      now: baseAt + IDLE + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 영문(a) 뒤 499ms(-1ms): idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: LATIN })],
      holdSince: baseAt,
      now: baseAt + IDLE - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + IDLE,
    },
    {
      name: '5-① 영문(a) 뒤 500ms(정각): 열림',
      fields: [field({ lastActivityAt: baseAt, before: LATIN })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 영문(a) 뒤 501ms(+1ms): 열림',
      fields: [field({ lastActivityAt: baseAt, before: LATIN })],
      holdSince: baseAt,
      now: baseAt + IDLE + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 숫자(7) 뒤 499ms(-1ms): idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: DIGIT })],
      holdSince: baseAt,
      now: baseAt + IDLE - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + IDLE,
    },
    {
      name: '5-① 숫자(7) 뒤 500ms(정각): 열림',
      fields: [field({ lastActivityAt: baseAt, before: DIGIT })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 숫자(7) 뒤 501ms(+1ms): 열림',
      fields: [field({ lastActivityAt: baseAt, before: DIGIT })],
      holdSince: baseAt,
      now: baseAt + IDLE + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-① 한글 완성형 첫 글자(가) 뒤 500ms: syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: GA })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },
    {
      name: '5-① 한글 완성형 끝 글자(힣) 뒤 500ms: syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: HIH })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },
    {
      name: '5-① 호환 자모(ㄱ) 뒤 500ms: syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: COMPAT_JAMO })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },
    {
      name: '5-① 첫가끝 초성(U+1100) 뒤 500ms: syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: CHOSEONG_JAMO })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },
    {
      name: '5-① 첫가끝 중성(U+1161) 뒤 500ms: syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: JUNGSEONG_JAMO })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },
    {
      name: '5-① 첫가끝 종성(U+11A8) 뒤 500ms: syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: JONGSEONG_JAMO })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },
    {
      name: '5-① 확장 자모 A(U+A960) 뒤 500ms: syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: EXT_A_JAMO })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },
    {
      name: '5-① 확장 자모 B(U+D7B0) 뒤 500ms: syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: EXT_B_JAMO })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },

    // ── 5번 음절 경계 ②: 학생이 커서를 옮김(caretMovedByUser: true) ──
    {
      name: '5-② 한글 뒤에서 커서 옮김 경계 -1ms(499ms): 아직 500ms 멈춤 전이라 idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: HAN, caretMovedByUser: true })],
      holdSince: baseAt,
      now: baseAt + IDLE - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + IDLE,
    },
    {
      name: '5-② 한글 뒤에서 커서 옮김 경계 정각(500ms): 음절 경계로 열림',
      fields: [field({ lastActivityAt: baseAt, before: HAN, caretMovedByUser: true })],
      holdSince: baseAt,
      now: baseAt + IDLE,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-② 한글 뒤에서 커서 옮김 경계 +1ms(501ms): 열림',
      fields: [field({ lastActivityAt: baseAt, before: HAN, caretMovedByUser: true })],
      holdSince: baseAt,
      now: baseAt + IDLE + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },

    // ── 5번 음절 경계 ③: 쓰기 칸을 벗어남(focused: false) ──
    {
      name: '5-③ 쓰기 칸 초점 빠짐(focused: false): 마지막 활동 직후(0ms)에도 바로 열림',
      fields: [field({ focused: false, lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-③ 쓰기 칸 초점 빠짐(focused: false): 1ms 뒤에도 열림',
      fields: [field({ focused: false, lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-③ 쓰기 칸 초점 빠짐(focused: false): 499ms 뒤에도 열림',
      fields: [field({ focused: false, lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + IDLE - 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-③ 본문 칸을 벗어나 메모 칸으로 초점이 옮겨간 뒤 499ms(-1ms): 메모 칸 기준으로 idle 닫힘',
      fields: [
        field({ focused: false, lastActivityAt: baseAt - 200, before: HAN }),
        field({ focused: true, lastActivityAt: baseAt, before: SPACE }),
      ],
      holdSince: baseAt - 200,
      now: baseAt + IDLE - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + IDLE,
    },
    {
      name: '5-③ 본문 칸을 벗어나 메모 칸으로 초점이 옮겨간 뒤 500ms(정각): 열림',
      fields: [
        field({ focused: false, lastActivityAt: baseAt - 200, before: HAN }),
        field({ focused: true, lastActivityAt: baseAt, before: SPACE }),
      ],
      holdSince: baseAt - 200,
      now: baseAt + IDLE,
      open: true,
      reason: 'open',
      recheckAt: null,
    },

    // ── 5번 음절 경계 ④: 2초(IME_LONG_IDLE_MS: 2000ms) 동안 입력 없음 ──
    {
      name: '5-④ 한글 뒤 2초 멈춤 경계 -1ms(1999ms): syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + LONG - 1,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + LONG,
    },
    {
      name: '5-④ 한글 뒤 2초 멈춤 경계 정각(2000ms): 열림',
      fields: [field({ lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + LONG,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '5-④ 한글 뒤 2초 멈춤 경계 +1ms(2001ms): 열림',
      fields: [field({ lastActivityAt: baseAt, before: HAN })],
      holdSince: baseAt,
      now: baseAt + LONG + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },

    // ── 6번: 10초(IME_MAX_HOLD_MS: 10000ms) 완화와 300ms(IME_RELAXED_IDLE_MS) 멈춤 ──
    {
      name: '6번 보류 10초 경계 -1ms(9999ms 보류, 300ms 멈춤, 한글 뒤): 완화 전이라 idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt + MAX_HOLD - 1 - RELAXED, before: HAN })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD - 1,
      open: false,
      reason: 'idle',
      recheckAt: baseAt + MAX_HOLD,
    },
    {
      name: '6번 보류 10초 경계 -1ms(9999ms 보류, 600ms 멈춤, 한글 뒤): 완화 전이라 syllable로 닫힘',
      fields: [field({ lastActivityAt: baseAt + MAX_HOLD - 1 - 600, before: HAN })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD - 1,
      open: false,
      reason: 'syllable',
      recheckAt: baseAt + MAX_HOLD,
    },
    {
      name: '6번 보류 10초 경계 정각(10000ms 보류, 300ms 멈춤, 한글 뒤): 완화되어 열림',
      fields: [field({ lastActivityAt: baseAt + MAX_HOLD - RELAXED, before: HAN })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '6번 보류 10초 경계 +1ms(10001ms 보류, 300ms 멈춤, 한글 뒤): 열림',
      fields: [field({ lastActivityAt: baseAt + MAX_HOLD + 1 - RELAXED, before: HAN })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '6번 10초 완화 뒤 300ms 멈춤 경계 -1ms(299ms, 한글 뒤): relaxed-idle로 닫힘',
      fields: [field({ lastActivityAt: baseAt + MAX_HOLD, before: HAN })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD + RELAXED - 1,
      open: false,
      reason: 'relaxed-idle',
      recheckAt: baseAt + MAX_HOLD + RELAXED,
    },
    {
      name: '6번 10초 완화 뒤 300ms 멈춤 경계 정각(300ms, 한글 뒤): 열림',
      fields: [field({ lastActivityAt: baseAt + MAX_HOLD, before: HAN })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD + RELAXED,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '6번 10초 완화 뒤 300ms 멈춤 경계 +1ms(301ms, 한글 뒤): 열림',
      fields: [field({ lastActivityAt: baseAt + MAX_HOLD, before: HAN })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD + RELAXED + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '6번 10초 완화 뒤라도 조합 열림(3번)이면 300ms가 지나도 닫힘',
      fields: [field({ composing: true, lastActivityAt: baseAt + MAX_HOLD, before: SPACE })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD + RELAXED,
      open: false,
      reason: 'composing',
      recheckAt: baseAt + MAX_HOLD + STUCK,
    },
    {
      name: '6·7번 10초 완화 뒤 조합 고착 5초 경계 -1ms(4999ms): 닫힘',
      fields: [field({ composing: true, lastActivityAt: baseAt + MAX_HOLD, before: HAN })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD + STUCK - 1,
      open: false,
      reason: 'composing',
      recheckAt: baseAt + MAX_HOLD + STUCK,
    },
    {
      name: '6·7번 10초 완화 뒤 조합 고착 5초 경계 정각(5000ms): 열림',
      fields: [field({ composing: true, lastActivityAt: baseAt + MAX_HOLD, before: HAN })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD + STUCK,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
    {
      name: '6·7번 10초 완화 뒤 조합 고착 5초 경계 +1ms(5001ms): 열림',
      fields: [field({ composing: true, lastActivityAt: baseAt + MAX_HOLD, before: HAN })],
      holdSince: baseAt,
      now: baseAt + MAX_HOLD + STUCK + 1,
      open: true,
      reason: 'open',
      recheckAt: null,
    },
  ];

  it.each(rows)('$name', ({ fields, holdSince, now, open, reason, recheckAt }) => {
    const decision = decide(fields, holdSince, now, T);
    expect(decision).toEqual({ open, reason, recheckAt });
  });
});

interface MutableField {
  composing: boolean;
  lastActivityAt: number;
  caretMovedByUser: boolean;
  focused: boolean;
  before: number | undefined;
  readonly state: FieldState;
}

function createMutableField(initial?: Partial<Omit<MutableField, 'state'>>): MutableField {
  const m: MutableField = {
    composing: initial?.composing ?? false,
    lastActivityAt: initial?.lastActivityAt ?? 0,
    caretMovedByUser: initial?.caretMovedByUser ?? false,
    focused: initial?.focused ?? true,
    before: initial?.before,
    state: {
      get composing() {
        return m.composing;
      },
      get lastActivityAt() {
        return m.lastActivityAt;
      },
      get caretMovedByUser() {
        return m.caretMovedByUser;
      },
      get focused() {
        return m.focused;
      },
      charBeforeCaret: () => m.before,
    },
  };
  return m;
}

interface GateScenarioRow {
  readonly name: string;
  readonly run: (ctx: {
    clock: FakeClock;
    body: MutableField;
    memo: MutableField;
    gate: Gate;
    flushes: number[];
    holds: Array<{ holding: boolean; at: number }>;
  }) => void;
}

describe('Gate 조정자 시계·보류 알림(3초 켜짐·꺼짐) 경계값 표 시험', () => {
  const scenarios: readonly GateScenarioRow[] = [
    {
      name: '조합 열림(3번) → 조합 끝 → 공백 뒤 500ms(4·5번): 499ms 미반영, 500ms 반영, 501ms 추가 반영 없음',
      run: ({ clock, body, gate, flushes, holds }) => {
        body.composing = true;
        body.before = HAN;
        body.lastActivityAt = 0;
        gate.markPending();

        clock.advance(1000);
        expect(flushes).toEqual([]);

        body.composing = false;
        body.before = SPACE;
        body.lastActivityAt = clock.t;
        gate.poke();

        clock.advance(IDLE - 1); // 1499ms
        expect(flushes).toEqual([]);
        clock.advance(1); // 1500ms
        expect(flushes).toEqual([1500]);
        clock.advance(1); // 1501ms
        expect(flushes).toEqual([1500]);
        expect(holds).toEqual([]);
      },
    },
    {
      name: '음절 경계 ①(문장부호 뒤 500ms): 499ms 미반영, 500ms 정각 반영, 501ms 유지',
      run: ({ clock, body, gate, flushes }) => {
        body.before = DOT;
        body.lastActivityAt = 0;
        gate.markPending();

        clock.advance(IDLE - 1);
        expect(flushes).toEqual([]);
        clock.advance(1);
        expect(flushes).toEqual([IDLE]);
        clock.advance(1);
        expect(flushes).toEqual([IDLE]);
      },
    },
    {
      name: '음절 경계 ②(한글 뒤 커서 이동 + 500ms): 이동 후 499ms 미반영, 500ms 정각 반영, 501ms 유지',
      run: ({ clock, body, gate, flushes }) => {
        body.before = HAN;
        body.lastActivityAt = 0;
        gate.markPending();

        clock.advance(200);
        body.caretMovedByUser = true;
        body.lastActivityAt = clock.t;
        gate.poke();

        clock.advance(IDLE - 1); // 699ms
        expect(flushes).toEqual([]);
        clock.advance(1); // 700ms
        expect(flushes).toEqual([200 + IDLE]);
        clock.advance(1); // 701ms
        expect(flushes).toEqual([200 + IDLE]);
      },
    },
    {
      name: '음절 경계 ③(쓰기 칸 초점 빠짐): 한글 뒤 200ms에 초점이 빠지면 즉시 반영',
      run: ({ clock, body, memo, gate, flushes }) => {
        body.before = HAN;
        body.lastActivityAt = 0;
        memo.focused = false;
        gate.markPending();

        clock.advance(199);
        expect(flushes).toEqual([]);
        clock.advance(1);
        body.focused = false;
        gate.poke();
        expect(flushes).toEqual([200]);
      },
    },
    {
      name: '음절 경계 ④(한글 뒤 2초 멈춤): 1999ms 미반영, 2000ms 정각 반영, 2001ms 유지',
      run: ({ clock, body, gate, flushes, holds }) => {
        body.before = HAN;
        body.lastActivityAt = 0;
        gate.markPending();

        clock.advance(LONG - 1); // 1999ms
        expect(flushes).toEqual([]);
        clock.advance(1); // 2000ms
        expect(flushes).toEqual([LONG]);
        clock.advance(1); // 2001ms
        expect(flushes).toEqual([LONG]);
        expect(holds).toEqual([]);
      },
    },
    {
      name: '7번 5초 고착 + 보류 알림 3초 켜짐·꺼짐: 2999ms 알림 없음 → 3000ms 알림 켜짐 → 4999ms 미반영 → 5000ms 반영·알림 꺼짐',
      run: ({ clock, body, gate, flushes, holds }) => {
        body.composing = true;
        body.before = HAN;
        body.lastActivityAt = 0;
        gate.markPending();

        clock.advance(NOTICE - 1); // 2999ms
        expect(holds).toEqual([]);
        expect(flushes).toEqual([]);

        clock.advance(1); // 3000ms
        expect(holds).toEqual([{ holding: true, at: NOTICE }]);

        clock.advance(1); // 3001ms
        expect(holds).toEqual([{ holding: true, at: NOTICE }]);

        clock.advance(STUCK - NOTICE - 2); // 4999ms
        expect(flushes).toEqual([]);
        expect(holds).toEqual([{ holding: true, at: NOTICE }]);

        clock.advance(1); // 5000ms
        expect(flushes).toEqual([STUCK]);
        expect(holds).toEqual([
          { holding: true, at: NOTICE },
          { holding: false, at: STUCK },
        ]);

        clock.advance(1); // 5001ms
        expect(flushes).toEqual([STUCK]);
      },
    },
    {
      name: '여러 칸 중 다른 칸(메모) 조합: 본문이 공백 뒤 멈춰 있어도 메모 조합이 5초 고착될 때까지(4999ms 미반영, 5000ms 반영) 보류',
      run: ({ clock, body, memo, gate, flushes, holds }) => {
        body.focused = true;
        body.composing = false;
        body.before = SPACE;
        body.lastActivityAt = 0;

        memo.focused = false;
        memo.composing = true;
        memo.before = HAN;
        memo.lastActivityAt = 0;

        gate.markPending();

        clock.advance(NOTICE - 1); // 2999ms
        expect(holds).toEqual([]);
        clock.advance(1); // 3000ms
        expect(holds).toEqual([{ holding: true, at: NOTICE }]);

        clock.advance(STUCK - NOTICE - 1); // 4999ms
        expect(flushes).toEqual([]);

        clock.advance(1); // 5000ms
        expect(flushes).toEqual([STUCK]);
        expect(holds).toEqual([
          { holding: true, at: NOTICE },
          { holding: false, at: STUCK },
        ]);
      },
    },
    {
      name: '6번 10초 완화 + 300ms 멈춤 + 보류 알림 3초: 2999ms 알림 전 → 3000ms 켜짐 → 9999ms 미반영 → 10000ms 뒤 299ms 미반영 → 300ms 반영·꺼짐',
      run: ({ clock, body, gate, flushes, holds }) => {
        body.before = HAN;
        body.lastActivityAt = 0;
        gate.markPending();

        // 250ms 간격으로 한글 입력(300ms 미만이라 10초가 지나도 멈추기 전엔 안 열림)
        for (let step = 1; step <= 40; step++) {
          const target = step * 250;
          if (target === NOTICE) {
            clock.advance(249); // 2999ms
            expect(holds).toEqual([]);
            clock.advance(1); // 3000ms
            expect(holds).toEqual([{ holding: true, at: NOTICE }]);
          } else {
            clock.advance(250);
          }
          body.lastActivityAt = clock.t;
          gate.poke();
        }

        // 현재 clock.t === 10000ms, 마지막 입력 시각 === 10000ms
        expect(clock.t).toBe(MAX_HOLD);
        expect(flushes).toEqual([]);

        clock.advance(RELAXED - 1); // 10299ms (멈춤 299ms)
        expect(flushes).toEqual([]);
        expect(holds).toEqual([{ holding: true, at: NOTICE }]);

        clock.advance(1); // 10300ms (멈춤 300ms)
        expect(flushes).toEqual([MAX_HOLD + RELAXED]);
        expect(holds).toEqual([
          { holding: true, at: NOTICE },
          { holding: false, at: MAX_HOLD + RELAXED },
        ]);

        clock.advance(1); // 10301ms
        expect(flushes).toEqual([MAX_HOLD + RELAXED]);
      },
    },
    {
      name: '보류 알림 3초 경계 직전(2999ms)에 반영되면 3000ms·3001ms가 지나도 알림이 켜지지 않음',
      run: ({ clock, body, gate, flushes, holds }) => {
        body.before = HAN;
        body.lastActivityAt = 0;
        gate.markPending();

        // 999ms에 마지막 한글 입력 → 2000ms 멈춤 뒤인 2999ms에 반영
        clock.advance(999);
        body.lastActivityAt = clock.t;
        gate.poke();

        clock.advance(LONG - 1); // 2998ms
        expect(flushes).toEqual([]);
        clock.advance(1); // 2999ms
        expect(flushes).toEqual([NOTICE - 1]);
        expect(holds).toEqual([]);

        clock.advance(1); // 3000ms
        expect(holds).toEqual([]);
        clock.advance(1); // 3001ms
        expect(holds).toEqual([]);
      },
    },
  ];

  it.each(scenarios)('$name', ({ run }) => {
    const clock = new FakeClock();
    const body = createMutableField({ focused: true, before: HAN });
    const memo = createMutableField({ focused: false, before: SPACE });
    const flushes: number[] = [];
    const holds: Array<{ holding: boolean; at: number }> = [];
    const gate = new Gate(
      T,
      {
        onFlush: () => {
          flushes.push(clock.t);
          gate.flushed();
        },
        onHoldChange: holding => {
          holds.push({ holding, at: clock.t });
        },
      },
      clock,
    );
    gate.addField(body.state);
    gate.addField(memo.state);

    run({ clock, body, memo, gate, flushes, holds });
    gate.destroy();
  });
});
