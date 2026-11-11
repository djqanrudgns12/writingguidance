import type { Config } from '@geulbang/core/config';
import { DOC_KEYS, DOC_ROOT_KEYS, MEMO_KEY_PATTERN } from '@geulbang/core';
import { parseDocumentName } from '@geulbang/core/protocol';
import type { beforeHandleMessagePayload, Document } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { Logger } from '../log.ts';
import type { RealtimeContext } from './context.ts';
import { sendDocEvent } from './docChannel.ts';
import { isValidMetaEntry } from './docMeta.ts';

/**
 * 적용 전 검사(PLAN §4.7 대응 9). 글 편집 메시지를 서버 문서에 적용하기 전에 "그림자 사본"에 먼저 적용해
 * 길이·키·타입을 본다. 넘으면 **던지지 않고** 그 연결을 읽기 전용으로 바꾼다.
 * Hocuspocus 4.8은 이 훅을 기다린 뒤 메시지를 적용하면서 `connection.readOnly`를 보므로(소스 확인·시험),
 * 바로 그 메시지부터 거부된다(기기 사본에는 남는다). 던지면 연결이 닫히고 재연결 때 같은 메시지가 되풀이된다.
 *
 * 그림자 사본은 글마다 하나다. 서버 문서의 모든 변경을 따라 받으므로 평소 비용은 메시지를 한 번 더 적용하는 정도다.
 * 위반이 나면 그림자를 서버 문서에서 다시 만든다(위반한 내용이 남지 않게).
 */

// Hocuspocus 메시지 머리(4.8.0): 문서 이름(varString) → 종류(varUint). Sync=0, SyncReply=4.
const MESSAGE_SYNC = 0;
const MESSAGE_SYNC_REPLY = 4;
// y-protocols/sync 하위 종류: step1=0(상태 벡터만, 내용 없음), step2=1, update=2
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

export type Violation = 'body' | 'title' | 'memo' | 'shape';

export interface PrecheckDeps {
  readonly config: Readonly<Config>;
  readonly log: Logger;
  readonly now: () => number;
  /** 글 종류(하위 종류 검사용). 모르면 undefined(카탈로그 전체로 검사). */
  readonly genreOf?: (docId: string) => string | undefined;
}

export function createPrecheck(deps: PrecheckDeps) {
  const { config, log, now } = deps;
  const shadows = new WeakMap<Document, Y.Doc>();
  // 글 종류는 바뀌지 않으므로 문서마다 한 번만 읽는다.
  const genres = new WeakMap<Document, string | undefined>();
  const genreFor = (document: Document, docId: string | undefined): string | undefined => {
    if (genres.has(document)) return genres.get(document);
    const genre = docId !== undefined ? deps.genreOf?.(docId) : undefined;
    genres.set(document, genre);
    return genre;
  };

  const buildShadow = (document: Document): Y.Doc => {
    const shadow = new Y.Doc();
    Y.applyUpdate(shadow, Y.encodeStateAsUpdate(document));
    const follow = (update: Uint8Array) => Y.applyUpdate(shadow, update);
    document.on('update', follow);
    shadow.on('destroy', () => document.off('update', follow));
    document.on('destroy', () => shadow.destroy());
    shadows.set(document, shadow);
    return shadow;
  };

  const rebuild = (document: Document) => {
    shadows.get(document)?.destroy();
    shadows.delete(document);
    buildShadow(document);
  };

  return async function beforeHandleMessage(
    payload: beforeHandleMessagePayload<RealtimeContext>,
  ): Promise<void> {
    const { connection, document, update, documentName } = payload;
    if (connection.readOnly) return; // Hocuspocus가 어차피 적용하지 않는다
    if (parseDocumentName(documentName)?.kind !== 'doc') return;

    const content = readSyncContent(update);
    if (!content) return;

    const shadow = shadows.get(document) ?? buildShadow(document);
    const genre = genreFor(document, connection.context.doc?.id);
    let violation: Violation | null;
    try {
      const memoBefore = mapValues(shadow, DOC_KEYS.memo);
      const metaBefore = mapValues(shadow, DOC_KEYS.meta);
      Y.applyUpdate(shadow, content);
      violation = inspect(shadow, config, genre, metaBefore) ?? memoReplaced(shadow, memoBefore);
    } catch {
      violation = 'shape';
    }
    if (!violation) return;

    connection.readOnly = true;
    rebuild(document);
    log.warn('doc_rejected', { code: 'E_DOC_TOO_LARGE', detail: violation });
    sendDocEvent(connection, 'doc.error', { code: 'E_DOC_TOO_LARGE' }, now());
  };
}

/**
 * 글 문서가 지켜야 할 모양과 길이(PLAN §4.2, PRD 9.3-10·12.3). `genre`는 하위 종류 검사에 쓴다.
 * `metaBefore`를 주면 meta는 이번에 바뀐 키만 본다(검사 전에 저장된 틀린 값 때문에 다른 편집까지 막히지 않게).
 */
export function inspect(
  doc: Y.Doc,
  config: Readonly<Config>,
  genre?: string,
  metaBefore?: ReadonlyMap<string, unknown>,
): Violation | null {
  for (const key of doc.share.keys()) if (!DOC_ROOT_KEYS.includes(key)) return 'shape';
  const body = doc.share.get(DOC_KEYS.body);
  const title = doc.share.get(DOC_KEYS.title);
  const meta = doc.share.get(DOC_KEYS.meta);
  const memo = doc.share.get(DOC_KEYS.memo);
  // 최상위 타입은 처음 꺼낼 때 모양이 정해진다. 다른 모양으로 이미 쓰였으면 Yjs가 던지고, 바깥에서 'shape'로 받는다.
  if (body) {
    const bodyText = doc.getText(DOC_KEYS.body).toString();
    if (bodyText.length > config.DOC_MAX_CHARS) return 'body';
    if (bodyText.includes('\r')) return 'shape';
  }
  if (title) {
    const titleText = doc.getText(DOC_KEYS.title).toString();
    if (titleText.length > config.DOC_TITLE_MAX_CHARS) return 'title';
    if (titleText.includes('\n') || titleText.includes('\r')) return 'shape';
  }
  if (meta) {
    // 정해진 키·값만(PLAN §4.2). 틀린 값 하나가 요약·hello 전체를 받는 쪽에서 버려지게 만들 수 있다.
    for (const [key, value] of doc.getMap(DOC_KEYS.meta).entries()) {
      if (metaBefore?.has(key) && Object.is(metaBefore.get(key), value)) continue;
      if (!isValidMetaEntry(key, value, genre, config)) return 'shape';
    }
  }
  if (memo) {
    let total = 0;
    for (const [key, value] of doc.getMap(DOC_KEYS.memo).entries()) {
      if (!MEMO_KEY_PATTERN.test(key) || !(value instanceof Y.Text)) return 'shape';
      if (value.length > config.MEMO_MAX_CHARS) return 'memo';
      if (value.toString().includes('\r')) return 'shape';
      total += value.length;
    }
    if (total > config.DOC_MAX_CHARS) return 'memo';
  }
  return null;
}

/** 지금 그 맵의 값들(키 → 값). 아직 없으면 빈 지도. */
function mapValues(doc: Y.Doc, name: string): ReadonlyMap<string, unknown> {
  if (!doc.share.has(name)) return new Map();
  return new Map(doc.getMap(name).entries());
}

/**
 * 이미 있던 메모 칸을 다른 `Y.Text`로 바꾸거나 지우는 업데이트는 받지 않는다(검토 3번).
 * 같은 키에 다른 객체를 넣으면 Yjs는 한쪽만 남기므로, 서버가 미리 만든 칸 밖의 덮어쓰기는 다른 기기의 메모를 지운다.
 */
function memoReplaced(doc: Y.Doc, before: ReadonlyMap<string, unknown>): Violation | null {
  if (before.size === 0) return null;
  const memo = doc.getMap(DOC_KEYS.memo);
  for (const [key, value] of before) if (memo.get(key) !== value) return 'shape';
  return null;
}

/** 메시지가 내용을 바꾸는 동기화(step2·update)면 그 업데이트 바이트, 아니면 null. */
export function readSyncContent(message: Uint8Array): Uint8Array | null {
  const r = new Reader(message);
  r.skipVarBytes(); // 문서 이름
  const type = r.varUint();
  if (type !== MESSAGE_SYNC && type !== MESSAGE_SYNC_REPLY) return null;
  const syncType = r.varUint();
  if (syncType !== SYNC_STEP2 && syncType !== SYNC_UPDATE) return null;
  return r.varBytes();
}

/** lib0 인코딩(varUint, 길이 붙은 바이트)을 읽는 최소 읽개. */
class Reader {
  private pos = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  varUint(): number {
    let num = 0;
    let mult = 1;
    for (;;) {
      const byte = this.bytes[this.pos++];
      if (byte === undefined) throw new RangeError('unexpected end');
      num += (byte & 0x7f) * mult;
      if (byte < 0x80) return num;
      mult *= 128;
      if (mult > 2 ** 53) throw new RangeError('varUint too large');
    }
  }

  varBytes(): Uint8Array {
    const len = this.varUint();
    if (this.pos + len > this.bytes.length) throw new RangeError('unexpected end');
    const out = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  skipVarBytes(): void {
    this.varBytes();
  }
}
