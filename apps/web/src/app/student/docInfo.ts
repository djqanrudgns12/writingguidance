import { isGenreId, type GenreId } from '@geulbang/core';
import type { MyDoc } from '@geulbang/core/protocol';
import { z } from 'zod';
import type { KvStorePort } from '../../ports/localStore.ts';

/**
 * 글 종류는 글 문서에 없고 서버만 안다(PLAN §4.2). 연결 없이 쓰기 화면을 다시 열어도 도움 질문·구조 버튼이 맞게,
 * 마지막으로 안 글 종류를 기기 `kv`에 둔다(학생 글은 넣지 않는다: 종류·하위 종류·용도 ID만).
 */
export interface DocKind {
  readonly genre: GenreId;
  readonly subtype: string | null;
  readonly purpose: string | null;
}

const schema = z.object({
  genre: z.string().refine(isGenreId),
  subtype: z.string().nullable(),
  purpose: z.string().nullable(),
});

const keyOf = (docId: string) => `student.docKind.${docId}`;

export async function readDocKind(kv: KvStorePort, docId: string): Promise<DocKind | null> {
  try {
    const parsed = schema.safeParse(await kv.get(keyOf(docId)));
    return parsed.success ? (parsed.data as DocKind) : null;
  } catch {
    return null;
  }
}

export async function writeDocKind(kv: KvStorePort, docId: string, kind: DocKind): Promise<void> {
  try {
    await kv.set(keyOf(docId), { genre: kind.genre, subtype: kind.subtype, purpose: kind.purpose });
  } catch {
    // 기기 저장소가 막혀도 쓰기는 계속한다(다음 연결의 hello가 다시 알려 준다).
  }
}

export function docKindOf(doc: MyDoc): DocKind | null {
  if (!isGenreId(doc.genre)) return null;
  return { genre: doc.genre, subtype: doc.subtype, purpose: doc.purpose };
}
