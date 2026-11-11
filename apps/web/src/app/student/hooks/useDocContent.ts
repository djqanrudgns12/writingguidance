import { DOC_KEYS, isSongMoodId, isSongTempoId, type SongMoodId, type SongTempoId } from '@geulbang/core';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

/**
 * 편집용 문서(`binding.viewDoc`)를 화면이 쓰는 값으로 읽는다(글자 수·AI 칩·메타·메모).
 * 입력칸은 바인딩이 그리므로 화면은 다시 그릴 필요가 없다: 본문은 입력이 멈춘 뒤(`idleMs`) 한 번에 읽고,
 * 메타(하위 종류·분위기 등)는 바로 읽는다. 지금 글이 꼭 필요한 동작(AI 요청·복사)은 이 값 대신 문서를 바로 읽는다.
 */
export interface DocMetaView {
  readonly subtype: string | null;
  readonly purposeCustom: string | null;
  readonly mood: SongMoodId | null;
  readonly moodCustom: string;
  readonly tempo: SongTempoId | null;
}

export interface DocContent {
  readonly body: string;
  readonly title: string;
  readonly meta: DocMetaView;
  readonly memos: ReadonlyMap<string, string>;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function readMeta(doc: Y.Doc): DocMetaView {
  const meta = doc.getMap(DOC_KEYS.meta);
  const mood = meta.get('mood');
  const tempo = meta.get('tempo');
  return {
    subtype: str(meta.get('subtype')),
    purposeCustom: str(meta.get('purposeCustom')),
    mood: isSongMoodId(mood) ? mood : null,
    moodCustom: str(meta.get('moodCustom')) ?? '',
    tempo: isSongTempoId(tempo) ? tempo : null,
  };
}

export function readMemos(doc: Y.Doc): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, text] of doc.getMap(DOC_KEYS.memo).entries()) {
    if (text instanceof Y.Text) out.set(id, text.toString());
  }
  return out;
}

export function readContent(doc: Y.Doc): DocContent {
  return {
    body: doc.getText(DOC_KEYS.body).toString(),
    title: doc.getText(DOC_KEYS.title).toString(),
    meta: readMeta(doc),
    memos: readMemos(doc),
  };
}

const EMPTY: DocContent = {
  body: '',
  title: '',
  meta: { subtype: null, purposeCustom: null, mood: null, moodCustom: '', tempo: null },
  memos: new Map(),
};

export function useDocContent(doc: Y.Doc | null, idleMs: number): DocContent {
  const [content, setContent] = useState<DocContent>(() => (doc ? readContent(doc) : EMPTY));

  useEffect(() => {
    if (!doc) return;
    setContent(readContent(doc));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setContent(readContent(doc)), idleMs);
    };
    const now = () => {
      clearTimeout(timer);
      setContent(readContent(doc));
    };
    const meta = doc.getMap(DOC_KEYS.meta);
    doc.on('update', later);
    meta.observe(now);
    return () => {
      clearTimeout(timer);
      doc.off('update', later);
      meta.unobserve(now);
    };
  }, [doc, idleMs]);

  return content;
}
