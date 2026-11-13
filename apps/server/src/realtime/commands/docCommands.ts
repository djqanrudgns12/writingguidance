import { randomUUID } from 'node:crypto';
import {
  base64UrlToBytes,
  countChars,
  DOC_KEYS,
  GENRE_CATALOG,
  GENRE_LENSES,
  isGenreId,
  isValidGenreSelection,
} from '@geulbang/core';
import { AppError } from '@geulbang/core/errors';
import { docDocumentName, snapshotCovers, type CommandName } from '@geulbang/core/protocol';
import * as Y from 'yjs';
import { assertConsentCurrent } from '../../application/consent.ts';
import {
  command,
  docFor,
  requireCurrentConsent,
  requireStudent,
  requireTeacher,
  roomFor,
  type CommandDeps,
  type CommandSpec,
  type Handler,
} from './types.ts';

/**
 * 글 명령(PLAN §4.4): 새 글, 제출(§2.3 ⑥), 다시 쓰게 하기, 동의 갱신.
 * 학생의 새 글·제출은 동의 판이 지금 판일 때만 받는다(`requireCurrentConsent`, P6-consent-block).
 *
 * 제출 판단 순서:
 * ① 기기가 보낸 세대가 지금보다 낮으면 `E_STALE`(다시 열린 뒤 늦게 도착한 옛 제출 → 기기는 outbox에서 지움)
 * ② 서버 문서가 기기 스냅숏(상태 벡터 + 삭제 집합, `coverage.ts`)을 다 덮지 않으면 `E_SYNC_PENDING`(기기가 잠시 뒤 다시 보냄).
 *    스냅숏이 없는 판 N-1 기기는 상태 벡터만 본다.
 * ③ 다 포함하면 한 트랜잭션: 지금 문서 상태·캐시 저장 + SUBMIT 스냅샷 + SUBMITTED + 명령 기록
 *    → 그 학생 연결 읽기 전용 → `doc.status` → `ack`. 교사는 제출된 글도 계속 고친다(ADR-048).
 * 다시 쓰게 하기는 세대를 1 올린다(그래서 늦게 온 옛 제출이 다시 잠그지 못한다).
 */
export function docCommands(deps: CommandDeps): Array<[CommandName, CommandSpec]> {
  const { repos, snapshots, access, roomState } = deps;
  const p = deps.config.product;

  const create: Handler<'doc.create'> = (actor, args, now) => {
    requireStudent(actor);
    const room = roomFor(deps, actor, now, { active: true });
    // 동의 판이 지난 학생은 다시 동의하기 전에 새 글을 만들지 못한다(P6-consent-block).
    requireCurrentConsent(deps, actor);
    const selection = {
      genre: args.genre,
      subtype: args.subtype,
      purpose: args.purpose,
      purposeCustom: args.purposeCustom,
    };
    if (!isValidGenreSelection(selection)) {
      throw new AppError('E_INPUT', 'genre selection is not in the catalog', { genre: 'invalid' });
    }
    if (!room.settings.genres.includes(args.genre)) {
      throw new AppError('E_INPUT', 'genre is not enabled in this room', { genre: 'not_enabled' });
    }
    const docId = randomUUID();
    repos.documents.create({
      id: docId,
      roomId: actor.roomId,
      participantId: actor.participantId,
      genre: args.genre,
      subtype: args.subtype ?? null,
      purpose: args.purpose ?? null,
      state: initialDocState(args.genre, args.subtype, args.purposeCustom),
      createdAt: now,
    });
    return {
      result: { docId },
      after: () => {
        const info = repos.documents.findInfo(docId);
        if (info) roomState.addDocument(info);
      },
    };
  };

  const submit: Handler<'doc.submit'> = (actor, args, now) => {
    requireStudent(actor);
    roomFor(deps, actor, now, { active: true });
    // 동의 판이 지난 학생의 제출도 막는다. 기기 대기열은 이 거절을 지우지 않고 재동의 뒤 다시 보낸다(P6-consent-block).
    requireCurrentConsent(deps, actor);
    const info = docFor(deps, actor, args.docId);
    if (args.generation < info.generation) throw new AppError('E_STALE');
    if (args.generation > info.generation) {
      throw new AppError('E_INPUT', 'generation from the future', { generation: 'unknown' });
    }
    if (info.status === 'SUBMITTED') {
      // 같은 세대가 이미 제출됨(다른 commandId로 다시 보낸 경우): 그대로 답한다.
      return { result: { status: 'SUBMITTED', submittedAt: info.submittedAt ?? now } };
    }

    const deviceVector = decodeVector(args.stateVector);
    const deviceSnapshot = args.snapshot !== undefined ? decodeSnapshotArg(args.snapshot) : null;
    const live = deps.hocuspocus().documents.get(docDocumentName(info.id));
    const doc = live ?? loadStored(deps, info.id);
    try {
      // 스냅숏이 오면 지우기까지 본다(지우기만 남았어도 E_SYNC_PENDING). 판 N-1 기기는 상태 벡터만 보낸다.
      if (deviceSnapshot) {
        if (!snapshotCovers(Y.snapshot(doc), deviceSnapshot)) throw new AppError('E_SYNC_PENDING');
      } else {
        const serverVector = Y.decodeStateVector(Y.encodeStateVector(doc));
        for (const [client, clock] of deviceVector) {
          if ((serverVector.get(client) ?? 0) < clock) throw new AppError('E_SYNC_PENDING');
        }
      }
      const body = doc.getText(DOC_KEYS.body).toString();
      const title = doc.getText(DOC_KEYS.title).toString();
      const subtype = doc.getMap(DOC_KEYS.meta).get('subtype');
      const input = roomState.lastInput(info.id);
      const charCount = countChars(body);
      repos.documents.saveContent(info.id, {
        state: Y.encodeStateAsUpdate(doc),
        titleText: title,
        plainText: body,
        charCount,
        subtype: typeof subtype === 'string' ? subtype : info.subtype,
        updatedAt: now,
        lastInputAt: input?.at ?? null,
        lastInputBy: input?.by ?? null,
      });
      snapshots.record(info.id, 'SUBMIT', 'STUDENT', { titleText: title, bodyText: body, charCount });
      repos.documents.markSubmitted(info.id, now);
    } finally {
      if (!live) doc.destroy();
    }
    return {
      result: { status: 'SUBMITTED', submittedAt: now },
      after: () => access.documentChanged(info.id),
    };
  };

  const reopen: Handler<'doc.reopen'> = (actor, args, now) => {
    requireTeacher(actor);
    roomFor(deps, actor, now);
    const info = docFor(deps, actor, args.docId);
    if (info.status !== 'SUBMITTED') return { result: { status: info.status, generation: info.generation } };
    repos.documents.markReopened(info.id, now);
    return {
      result: { status: 'REOPENED', generation: info.generation + 1 },
      after: () => access.documentChanged(info.id),
    };
  };

  const consent: Handler<'consent.update'> = (actor, args, now) => {
    requireStudent(actor);
    assertConsentCurrent(args.consentVersion, p.POLICY_VERSION);
    repos.participants.updateConsent(actor.participantId, args.consentVersion, now);
    // 동의 판이 지나 읽기로 열렸던 자기 글 연결을 쓰기로 바꾼다(`doc.status {locked:false}` → 기기가 다시 보냄).
    return {
      result: { consentAt: now },
      after: () => access.participantChanged(actor.roomId, actor.participantId),
    };
  };

  return [
    command('doc.create', create),
    command('doc.submit', submit),
    command('doc.reopen', reopen),
    command('consent.update', consent),
  ];
}

function decodeVector(text: string): Map<number, number> {
  const bytes = base64UrlToBytes(text);
  if (!bytes) throw new AppError('E_INPUT', 'state vector is not base64url', { stateVector: 'invalid' });
  try {
    return Y.decodeStateVector(bytes);
  } catch {
    throw new AppError('E_INPUT', 'state vector is broken', { stateVector: 'invalid' });
  }
}

function decodeSnapshotArg(text: string): Y.Snapshot {
  const bytes = base64UrlToBytes(text);
  if (!bytes) throw new AppError('E_INPUT', 'snapshot is not base64url', { snapshot: 'invalid' });
  try {
    return Y.decodeSnapshot(bytes);
  } catch {
    throw new AppError('E_INPUT', 'snapshot is broken', { snapshot: 'invalid' });
  }
}

/** 메모리에 없는 글(기기가 글 연결 없이 제출)은 저장된 상태로 판단한다. */
function loadStored(deps: CommandDeps, docId: string): Y.Doc {
  const stored = deps.repos.documents.find(docId);
  if (!stored) throw new AppError('E_FORBIDDEN');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, stored.state);
  return doc;
}

/**
 * 새 글의 첫 상태: 하위 종류·직접 쓴 용도를 `meta`에 넣고, 그 글 종류의 모든 하위 종류·용도에 나오는
 * 도움 질문마다 빈 메모 `Y.Text`를 미리 만들어 둔다(PLAN §4.2, 검토 3번). 기기마다 따로 만들면 같은 키에
 * 다른 객체가 들어가 동시에 처음 쓴 한쪽 메모가 통째로 사라진다. 하위 종류를 바꿔도 같은 칸이 그대로 있다.
 */
export function initialDocState(
  genre: string,
  subtype: string | undefined,
  purposeCustom: string | undefined,
): Uint8Array {
  const doc = new Y.Doc();
  try {
    doc.transact(() => {
      if (subtype !== undefined || purposeCustom !== undefined) {
        const meta = doc.getMap(DOC_KEYS.meta);
        if (subtype !== undefined) meta.set('subtype', subtype);
        if (purposeCustom !== undefined) meta.set('purposeCustom', purposeCustom);
      }
      const memo = doc.getMap<Y.Text>(DOC_KEYS.memo);
      for (const id of memoQuestionIds(genre)) memo.set(id, new Y.Text());
    });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** 그 글 종류에서 나올 수 있는 도움 질문 ID 전부(하위 종류·용도·기본 렌즈의 합). */
export function memoQuestionIds(genre: string): readonly string[] {
  if (!isGenreId(genre)) return [];
  const def = GENRE_CATALOG[genre];
  const lenses = new Set([
    def.defaultLensId,
    ...def.subtypes.map(s => s.lensId),
    ...def.purposes.map(p => p.lensId),
  ]);
  const ids = new Set<string>();
  for (const lens of lenses) for (const id of GENRE_LENSES[lens].questionIds) ids.add(id);
  return [...ids];
}
