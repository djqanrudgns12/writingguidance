import { createHash, randomUUID } from 'node:crypto';
import {
  aiDayBoundsMs,
  cooldownLeftSec,
  countChars,
  dayKey,
  isGenreId,
  resolveGenreVariant,
  type AiButton,
} from '@geulbang/core';
import type { ApiOutput } from '@geulbang/core/api';
import { AppError, isErrorCode, type ErrorCode } from '@geulbang/core/errors';
import type { Hocuspocus } from '@hocuspocus/server';
import type { DictionaryPort } from '../ai/dictionary.ts';
import type { AiInput, AiPort, GenreLens, Usage } from '../ai/port.ts';
import { runPolish, runStructured, structuredBudgetMs, type PolishLine } from '../ai/run.ts';
import { LIMITS, type SpellResult } from '../ai/schemas.ts';
import type { ServerConfig } from '../config.ts';
import type { Logger } from '../log.ts';
import type { RealtimeContext } from '../realtime/context.ts';
import { currentText, docMeta, metaString } from '../realtime/docText.ts';
import type { RoomGate } from '../realtime/roomGate.ts';
import type { Snapshots } from '../realtime/snapshots.ts';
import { hashArgs, type CommandKey } from '../store/repos/commands.ts';
import type { Repos } from '../store/repos/index.ts';
import { roomStatusAt, type StoredRoom } from '../store/repos/rooms.ts';
import {
  finalizeDirection,
  finalizeFeedback,
  finalizeSpell,
  maskForAi,
  refineSpellWithDictionary,
  unmaskForStudentText,
  userTagOf,
  type Masking,
} from './aiSafety.ts';
import { chunkForSpell, mapLimited } from './spellChunks.ts';

/**
 * AI 요청 한 번(PLAN §8.2, PRD 6장·F-08·F-26).
 * 1. 입력 확인: 방 ACTIVE·동의 판이 지금 정책 판·버튼 켜짐·글이 그 학생 것·글 종류별 최소 글자
 * 2. **한도 예약**(한 SQLite 트랜잭션): 같은 commandId면 앞 결과 → 버튼별 쿨다운 → 참가자 하루 → 방 하루 → 전체 하루
 *    → `ai_usage` RESERVED. 하나라도 넘으면 보내지 않는다.
 * 3. AI 스냅샷(서버 문서 기준) 4. 호출(`ai/run.ts`가 재시도·대체·시간 예산) 5. 정산
 *    OK(성공)·FAILED(거절·형식: 한도에 셈)·REFUNDED(제공사 오류·시간 초과·중단: 우리 쪽 잘못이라 한도에서 뺌).
 * AI 본문은 **기기가 보낸 글**이다(학생이 본 글과 맞춤법 위치가 맞아야 함). 스냅샷만 서버 문서 기준이다.
 * 맞춤법은 문단 경계 조각으로 나눠 동시에 `AI_SPELL_MAX_PARALLEL`개씩 보내고 합친다(버튼 한 번으로 센다).
 * 기록에는 메타데이터만 남긴다(PRD 6.6).
 */
export type AiBody = ApiOutput<'aiRequestBody'>;
export type AiStructuredResult = ApiOutput<'aiStructuredResult'>;

export interface AiRequestDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly log: Logger;
  readonly now: () => number;
  /** 설정이 없으면(`ANTHROPIC_API_KEY` 없음) null: 요청은 `E_AI_PROVIDER`, 서버는 그대로 뜬다. */
  readonly ai: AiPort | null;
  readonly gate: RoomGate;
  readonly snapshots: Snapshots;
  readonly hocuspocus: () => Hocuspocus<RealtimeContext>;
  /** 표준국어대사전 조회기(키가 있을 때만, U-25). 없으면 사전 보정을 하지 않는다. */
  readonly dict?: DictionaryPort | null;
}

export interface AiStudent {
  readonly deviceRowId: string;
  readonly participantId: string;
  /** 참가자가 동의한 처리방침 판. 지금 `POLICY_VERSION`과 다르면 재동의 전이라 AI로 글을 보내지 않는다(PRD F-03). */
  readonly consentVersion: string;
  readonly room: StoredRoom;
}

export interface AiTicket {
  readonly usageId: string;
  readonly day: string;
  readonly roomId: string;
  readonly button: AiButton;
  readonly input: AiInput;
  readonly textHash: string;
  readonly key: CommandKey;
  readonly startedAt: number;
  /** 가리기 전 글(맞춤법 등급·위치를 원문 전체로 매긴다, docs/ai-harness.md S-06) */
  readonly realText: string;
  /** 가림 대응표(요청 안에서만) */
  readonly masking: Masking;
  /** `metadata.user_id`용 불투명 ID */
  readonly userTag: string;
}

export type Prepared =
  | { readonly kind: 'replay'; readonly result: AiStructuredResult }
  | { readonly kind: 'ready'; readonly ticket: AiTicket };

/** 우리 쪽 잘못으로 끝난 것은 한도에서 뺀다(PLAN §5.2). 거절·형식 오류는 센다. */
const REFUNDED_CODES: ReadonlySet<ErrorCode> = new Set(['E_AI_TIMEOUT', 'E_AI_PROVIDER', 'E_INTERNAL']);

export function prepareAiRequest(deps: AiRequestDeps, student: AiStudent, body: AiBody): Prepared {
  const { config, repos } = deps;
  const p = config.product;
  const now = deps.now();
  const room = student.room;

  deps.gate.assertOpen(room.id);
  const status = roomStatusAt(room, now);
  if (status === 'EXPIRED') throw new AppError('E_ROOM_EXPIRED');
  if (status === 'CLOSED') throw new AppError('E_ROOM_CLOSED');
  if (student.consentVersion !== p.POLICY_VERSION) {
    // 재동의(`consent.update`) 전에는 글을 제공사로 보내지 않는다(P5-5b 검토 B03). 예약 전이라 한도에 세지 않는다.
    throw new AppError('E_FORBIDDEN', 'consent is outdated', { consentVersion: 'outdated' });
  }
  if (!deps.ai) throw new AppError('E_AI_PROVIDER', 'ai is not configured');
  if (!room.settings.aiButtons.includes(body.button)) throw new AppError('E_FORBIDDEN', 'button is off');
  const doc = repos.documents.findInfo(body.docId);
  if (!doc || doc.roomId !== room.id || doc.participantId !== student.participantId) {
    throw new AppError('E_FORBIDDEN');
  }
  if (!isGenreId(doc.genre)) throw new AppError('E_INPUT', 'unknown genre', { genre: 'invalid' });

  const meta = docMeta(deps, doc.id);
  const subtype = metaString(meta, 'subtype') ?? doc.subtype ?? undefined;
  const purposeCustom = metaString(meta, 'purposeCustom');
  const variant = resolveGenreVariant({ genre: doc.genre, subtype, purpose: doc.purpose, purposeCustom }, p);
  if (countChars(body.text) < variant.minChars) {
    throw new AppError('E_INPUT', 'text is too short', { text: 'too_short' });
  }

  const textHash = createHash('sha256').update(body.text, 'utf8').digest('hex');
  const key: CommandKey = {
    id: body.commandId,
    actorKind: 'STUDENT',
    actorId: student.deviceRowId,
    name: `ai.${body.button}`,
    argsHash: hashArgs({
      docId: body.docId,
      button: body.button,
      range: body.range,
      meta: body.meta,
      textHash,
    }),
  };
  const day = dayKey(now, p.TIMEZONE);
  const usageId = randomUUID();

  const reserved = repos.db.transaction((): AiStructuredResult | null => {
    const previous = repos.commands.replay<AiStructuredResult>(key);
    if (previous) return previous.result;
    const usage = repos.aiUsage.findByCommand(body.commandId);
    if (usage) {
      if (usage.participantId !== student.participantId || usage.button !== body.button) {
        throw new AppError('E_INPUT', 'commandId reused', { commandId: 'reused' });
      }
      if (usage.status === 'RESERVED') throw new AppError('E_AI_COOLDOWN', 'same request is running');
      if (usage.status === 'OK') throw new AppError('E_INPUT', 'commandId reused', { commandId: 'reused' });
      throw new AppError(isErrorCode(usage.errorCode) ? usage.errorCode : 'E_AI_PROVIDER');
    }
    const last = repos.aiUsage.lastRequestAt(student.participantId, body.button);
    // 쿨다운·하루 경계는 기기 칩과 같은 공용 계산(domain/aiQuota)을 쓴다.
    if (cooldownLeftSec(last, now, p) > 0) throw new AppError('E_AI_COOLDOWN');
    const since = aiDayBoundsMs(now, p).startMs;
    if (repos.aiUsage.countParticipantSince(student.participantId, since) >= p.AI_DAILY_PER_PARTICIPANT) {
      throw new AppError('E_AI_LIMIT', 'participant daily limit');
    }
    if (repos.aiUsage.countRoomSince(room.id, since) >= p.AI_DAILY_PER_ROOM) {
      throw new AppError('E_AI_LIMIT', 'room daily limit');
    }
    if (!repos.aiUsage.reserveDaily(day, 'GLOBAL', p.AI_DAILY_GLOBAL)) {
      throw new AppError('E_AI_LIMIT', 'global daily limit');
    }
    repos.aiUsage.insertReserved({
      id: usageId,
      commandId: body.commandId,
      roomId: room.id,
      participantId: student.participantId,
      documentId: doc.id,
      button: body.button,
      createdAt: now,
    });
    return null;
  })();
  if (reserved) return { kind: 'replay', result: reserved };

  // AI 스냅샷은 서버 문서 기준(PLAN §4.5). 기록이 실패해도 AI 요청은 막지 않는다.
  try {
    deps.snapshots.record(doc.id, 'AI', 'STUDENT', currentText(deps, doc.id));
  } catch (error) {
    deps.log.error('snapshot_failed', { error });
  }

  const lens: GenreLens = {
    feedback: variant.lens.feedbackFocus,
    direction: variant.lens.directionFocus,
    polish: variant.lens.polishFocus,
    factMode: variant.lens.factMode === 'question' ? 'question' : 'none',
  };
  const prompts = new Map(variant.questions.map(q => [q.id as string, q.prompt]));
  const helpNotesRaw = body.meta.helpNotes
    .filter(n => n.note.trim().length > 0 && prompts.has(n.questionId))
    .map(n => ({ question: prompts.get(n.questionId) ?? '', note: n.note }));
  const { text: realText, range } = fitInput(body, p.AI_MAX_INPUT_CHARS, p.AI_SPELL_MAX_CHARS);
  // 보내기 전에 개인정보·학생 글 속 비속어를 가린다(docs/ai-harness.md L0).
  const masked = maskForAi(realText, helpNotesRaw);
  const text = masked.text;
  const helpNotes = masked.helpNotes;
  const input: AiInput = {
    button: body.button,
    genre: doc.genre,
    ...(variant.subtype ? { subtype: variant.subtype } : {}),
    ...(variant.purpose ? { purpose: variant.purpose } : {}),
    ...(purposeCustom ? { purposeCustom } : {}),
    lens,
    helpNotes,
    ...(variant.hasSongChips && body.meta.mood && body.meta.tempo
      ? { song: { mood: body.meta.mood, tempo: body.meta.tempo } }
      : {}),
    range,
    text,
  };
  return {
    kind: 'ready',
    ticket: {
      usageId,
      day,
      roomId: room.id,
      button: body.button,
      input,
      textHash,
      key,
      startedAt: now,
      realText,
      masking: masked.masking,
      userTag: userTagOf(student.participantId),
    },
  };
}

/**
 * 맞춤법·한마디·방향. 결과를 명령 기록에 남겨, 같은 commandId로 다시 오면 그대로 돌려준다.
 * `signal`은 기기가 끊었을 때와 방을 지울 때 중단한다.
 */
export async function runStructuredRequest(
  deps: AiRequestDeps,
  ticket: AiTicket,
  signal: AbortSignal,
): Promise<AiStructuredResult> {
  const { config } = deps;
  const ai = requireAi(deps);
  const usage: Usage[] = [];
  const untrack = track(deps, ticket, signal);
  try {
    const runDeps = {
      ai,
      config: config.product,
      signal: untrack.signal,
      now: deps.now,
      userTag: ticket.userTag,
      log: attemptLog(deps, ticket),
    };
    let result: unknown;
    if (ticket.button === 'SPELL') {
      const chunks = chunkForSpell(ticket.input.text, config.product.AI_SPELL_CHUNK_CHARS);
      // 버튼 한 번의 시간 예산은 조각 전체가 나눠 쓴다(PLAN §8.2, P5-5b 검토 B09): 마감 시각을 한 번 정해 모든 조각·재시도에
      // 넘기고, 마감이 오면 돌고 있는 호출도 끊는다. 한 조각이 실패해도 나머지 조각 호출을 멈춘다(버튼 한 번은 한 결과다).
      const budgetMs = structuredBudgetMs(config.product);
      const deadline = deps.now() + budgetMs;
      const siblings = new AbortController();
      const spellDeps = {
        ...runDeps,
        deadline,
        signal: AbortSignal.any([runDeps.signal, siblings.signal, AbortSignal.timeout(budgetMs)]),
      };
      let parts: Awaited<ReturnType<typeof runStructured<'SPELL'>>>[];
      try {
        parts = await mapLimited(chunks, config.product.AI_SPELL_MAX_PARALLEL, chunk =>
          runStructured(spellDeps, { ...ticket.input, button: 'SPELL', text: chunk }),
        );
      } catch (error) {
        siblings.abort();
        throw error;
      }
      const items: SpellResult['items'] = [];
      for (const part of parts) {
        usage.push(...part.usage);
        items.push(...part.value.items);
      }
      const spell = finalizeSpell(
        items.slice(0, LIMITS.spellItems),
        ticket.realText,
        ticket.input.genre,
        ticket.masking,
      );
      // 사전 보정(U-25): 비표준어로 확인된 말은 고쳐요. 조회는 맞춤법 시간 예산 안에서만, 실패하면 그대로.
      result = deps.dict
        ? {
            ...spell,
            items: await refineSpellWithDictionary(
              spell.items,
              deps.dict,
              config.product.DICT_MAX_PER_REQUEST,
              spellDeps.signal,
            ),
          }
        : spell;
    } else if (ticket.button === 'FEEDBACK') {
      const reply = await runStructured(runDeps, { ...ticket.input, button: 'FEEDBACK' });
      usage.push(...reply.usage);
      result = finalizeFeedback(reply.value, ticket.masking);
    } else {
      const reply = await runStructured(runDeps, { ...ticket.input, button: 'DIRECTION' });
      usage.push(...reply.usage);
      result = finalizeDirection(reply.value, ticket.masking);
    }
    const response: AiStructuredResult = {
      button: ticket.button,
      result,
      receivedAt: deps.now(),
      textHash: ticket.textHash,
    };
    settle(deps, ticket, 'OK', null, usage);
    try {
      deps.repos.commands.record({ ...ticket.key, roomId: ticket.roomId }, deps.now(), response);
    } catch (error) {
      // 그사이 방이 지워졌으면 남길 곳이 없다. 응답은 그대로 준다.
      deps.log.warn('ai_result_not_recorded', { error });
    }
    return response;
  } catch (error) {
    const code: ErrorCode = error instanceof AppError ? error.code : 'E_AI_PROVIDER';
    settle(deps, ticket, REFUNDED_CODES.has(code) ? 'REFUNDED' : 'FAILED', code, usage);
    if (error instanceof AppError) throw error;
    deps.log.error('ai_failed', { error });
    throw new AppError('E_AI_PROVIDER');
  } finally {
    untrack.done();
  }
}

/**
 * 다듬은 글: `PolishLine`을 한 줄씩 내보낸다(PLAN §8.3 계약). 기기가 끊거나(신호) 방을 지우면 중단하고 정산한다.
 * 끝까지 받은 것만 OK, 오류 줄이면 그 코드로, 중간에 끊겼으면 REFUNDED.
 */
export async function* runPolishRequest(
  deps: AiRequestDeps,
  ticket: AiTicket,
  signal: AbortSignal,
): AsyncGenerator<PolishLine> {
  const ai = requireAi(deps);
  const usage: Usage[] = [];
  const untrack = track(deps, ticket, signal);
  let finished: { status: 'OK' | 'FAILED' | 'REFUNDED'; code: ErrorCode | null } = {
    status: 'REFUNDED',
    code: 'E_AI_TIMEOUT',
  };
  try {
    const lines = runPolish(
      {
        ai,
        config: deps.config.product,
        signal: untrack.signal,
        now: deps.now,
        userTag: ticket.userTag,
        log: attemptLog(deps, ticket),
      },
      { ...ticket.input, button: 'POLISH' },
      u => usage.push(u),
    );
    // 학생 글에 개인정보·쓰면 안 되는 표현이 있었으면 글보다 먼저 알린다(U-26).
    if (ticket.masking.notices.length > 0) yield { t: 'notice', notices: [...ticket.masking.notices] };
    for await (const raw of lines) {
      // 자리표시자를 되돌린다(개인정보는 학생 자신의 글이라 원래 값, 가린 비속어는 ○○, PO-06).
      const line = raw.t === 'text' ? { ...raw, d: unmaskForStudentText(raw.d, ticket.masking) } : raw;
      if (line.t === 'done') finished = { status: 'OK', code: null };
      if (line.t === 'error') {
        finished = { status: REFUNDED_CODES.has(line.code) ? 'REFUNDED' : 'FAILED', code: line.code };
      }
      yield line;
    }
  } catch (error) {
    deps.log.error('ai_failed', { error });
    finished = { status: 'REFUNDED', code: 'E_AI_PROVIDER' };
    yield { t: 'error', code: 'E_AI_PROVIDER' };
  } finally {
    settle(deps, ticket, finished.status, finished.code, usage);
    untrack.done();
  }
}

/** 실패한 시도만 메타데이터로 남긴다(버튼·모델·생각 깊이·결과·걸린 시간·걸린 규칙 ID, 글 내용 없음, PRD 6.6). */
function attemptLog(deps: AiRequestDeps, ticket: AiTicket) {
  return {
    attempt(
      a: { readonly model: string; readonly effort: string },
      outcome: string,
      ms: number,
      detail?: string,
    ) {
      if (outcome === 'ok') return;
      deps.log.warn('ai_attempt', {
        detail: `${ticket.button} ${a.model} ${a.effort} ${outcome}${detail ? ` ${detail}` : ''}`,
        ms,
      });
    },
  };
}

function requireAi(deps: AiRequestDeps): AiPort {
  if (!deps.ai) throw new AppError('E_AI_PROVIDER', 'ai is not configured');
  return deps.ai;
}

/** 기기의 끊김 + 방 지우기(PLAN §7.7-2)를 한 신호로 묶는다. */
function track(deps: AiRequestDeps, ticket: AiTicket, signal: AbortSignal) {
  const controller = new AbortController();
  const untrack = deps.gate.trackAi(ticket.roomId, controller);
  return { signal: AbortSignal.any([signal, controller.signal]), done: untrack };
}

function settle(
  deps: AiRequestDeps,
  ticket: AiTicket,
  status: 'OK' | 'FAILED' | 'REFUNDED',
  code: ErrorCode | null,
  usage: readonly Usage[],
): void {
  const now = deps.now();
  try {
    const changed = deps.repos.aiUsage.settle(ticket.usageId, {
      status,
      errorCode: code,
      model: usage.at(-1)?.model ?? null,
      latencyMs: now - ticket.startedAt,
      tokensIn: usage.reduce((n, u) => n + u.inputTokens, 0),
      tokensOut: usage.reduce((n, u) => n + u.outputTokens, 0),
      finishedAt: now,
    });
    if (changed === 1 && status === 'REFUNDED') deps.repos.aiUsage.releaseDaily(ticket.day, 'GLOBAL');
  } catch (error) {
    deps.log.error('ai_settle_failed', { error });
  }
  // 내용 없이 메타데이터만(PRD 6.6): 버튼·결과·오류 종류·모델·걸린 시간·토큰 수
  const fields = {
    detail: `${ticket.button} ${status} ${usage.at(-1)?.model ?? '-'} in=${usage.reduce((n, u) => n + u.inputTokens, 0)} out=${usage.reduce((n, u) => n + u.outputTokens, 0)}`,
    ms: now - ticket.startedAt,
    ...(code ? { code } : {}),
  };
  if (status === 'OK') deps.log.info('ai', fields);
  else deps.log.warn('ai', fields);
}

/**
 * 보낼 글 자르기(PRD F-26): 맞춤법은 `AI_SPELL_MAX_CHARS`까지 전체(넘으면 뒤쪽), 나머지는 `AI_MAX_INPUT_CHARS`를 넘으면
 * 뒷부분만 보내고 범위를 `TAIL`로 알린다.
 */
function fitInput(body: AiBody, maxInput: number, maxSpell: number): { text: string; range: 'ALL' | 'TAIL' } {
  const limit = body.button === 'SPELL' ? maxSpell : maxInput;
  const chars = [...body.text];
  if (chars.length <= limit) return { text: body.text, range: body.button === 'SPELL' ? 'ALL' : body.range };
  return { text: chars.slice(-limit).join(''), range: body.button === 'SPELL' ? 'ALL' : 'TAIL' };
}
