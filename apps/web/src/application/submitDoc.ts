import { bytesToBase64Url } from '@geulbang/core';
import type { MyDoc } from '@geulbang/core/protocol';
import * as Y from 'yjs';
import type { RoomChannel, SyncedDoc } from '../ports/realtime.ts';

/**
 * 학생: 제출(PLAN §2.3 ⑥, PRD F-11). 화면은 이 함수를 부르기 전에 편집기의 쓰던 입력을 기록하고(반영 문이 연 뒤)
 * 편집 잠금을 건다. 여기서는 기기 저장소 기록이 끝나기를 기다린 뒤 대기열에 넣는다.
 * 기기 저장소에 못 쓴 편집이 남아 있으면 `flushLocal`의 거부(`E_STORAGE_BLOCKED`)를 그대로 올린다(대기열에 넣지 않음):
 * 기기에 없는 글로 제출이 넘어가지 않게 화면이 띠로 알린다(검토 4번).
 * 대기열은 연결되고 그 글의 동기화가 끝난 뒤 보내며, 같은 commandId로 다시 보내 한 번만 실행된다.
 * 서버는 `snapshot`(상태 벡터 + 삭제 집합)으로 기기 변경이 다 들어왔는지 본다(지우기만 한 변경 포함, 검토 5번).
 * `generation`은 그 글의 제출 세대: 교사의 `다시 쓰게 하기`가 올린 세대보다 낮은 옛 제출은 서버가 `E_STALE`로 버린다.
 */
export async function submitDoc(channel: RoomChannel, doc: SyncedDoc, generation: number): Promise<string> {
  await doc.flushLocal();
  const stateVector = bytesToBase64Url(Y.encodeStateVector(doc.netDoc));
  const snapshot = bytesToBase64Url(Y.encodeSnapshot(Y.snapshot(doc.netDoc)));
  return channel.queue.enqueue({
    docId: doc.docId,
    name: 'doc.submit',
    args: { docId: doc.docId, stateVector, snapshot, generation },
  });
}

/** hello의 글 목록과 이후 `doc.status` 이벤트로 글별 세대·상태를 따라간다. */
export function trackDocs(channel: RoomChannel): {
  get(docId: string): Pick<MyDoc, 'status' | 'generation'> | undefined;
  close(): void;
} {
  const docs = new Map<string, Pick<MyDoc, 'status' | 'generation'>>();
  const fromHello = () => {
    for (const d of channel.hello.get()?.docs ?? [])
      docs.set(d.docId, { status: d.status, generation: d.generation });
  };
  fromHello();
  const offHello = channel.hello.subscribe(fromHello);
  const offStatus = channel.on('doc.status', d =>
    docs.set(d.docId, { status: d.status, generation: d.generation }),
  );
  return {
    get: docId => docs.get(docId),
    close() {
      offHello();
      offStatus();
    },
  };
}
