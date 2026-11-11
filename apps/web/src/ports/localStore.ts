import type { AiButtonId, AiResultOf } from './api.ts';

/**
 * 기기 저장 포트(PLAN §2.5·§5.4, ADR-032). 글은 통신용 문서의 업데이트를 차례로 쌓고, 가끔 합친다.
 * 실시간 연결이 없어도 글이 사라지지 않게 하는 바닥이다(PRD F-09 `[고정]`).
 * 글 업데이트(P2) + 명령 대기열·작은 값(P3-4) + AI 결과(P4-21).
 */
export interface DocMeta {
  readonly roomId: string | null;
  /** 이 시각이 지나면 기기 사본을 지운다(수업방 만료와 같음). 모르면 null. */
  readonly expiresAt: number | null;
}

/** 오프라인에서도 의미가 있는 명령 하나(PLAN §5.4 `outbox`). 지금은 `doc.submit`만. */
export interface OutboxEntry {
  readonly commandId: string;
  readonly roomId: string;
  readonly docId: string | null;
  readonly name: 'doc.submit';
  readonly args: unknown;
  readonly createdAt: number;
}

export interface OutboxStorePort {
  put(entry: OutboxEntry): Promise<void>;
  /** 만든 순서대로 */
  list(roomId: string): Promise<OutboxEntry[]>;
  remove(commandId: string): Promise<void>;
}

/** 기기 기억·설정 같은 작은 값(PLAN §5.4 `kv`). 값은 구조화 복제가 되는 것만. */
export interface KvStorePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * 버튼별 마지막 AI 결과(PLAN §5.4 `ai_results`, 키 `${docId}:${button}`). 패널을 다시 열면 바로 보이고(PRD F-08),
 * `textHash`가 지금 글과 다르면 "글이 바뀌었어요". 학생 글이 들어 있어 글 사본과 함께 만료된다(`purgeExpired`).
 */
export interface AiResultRecordBase {
  readonly docId: string;
  /** 요청할 때 본문 전체의 SHA-256 hex. 화면은 지금 본문 해시 하나로 네 버튼을 모두 비교한다. */
  readonly textHash: string;
  /** 결과를 받은 시각(`AppDeps.now`, "방금"·"3분 전") */
  readonly receivedAt: number;
  /** 실제로 보낸 글(길면 뒷부분). 맞춤법 위치를 지금 글로 옮길 때 쓴다. */
  readonly requestText: string;
  /** 글이 길어 뒷부분만 보냈다("글이 길어서 마지막 부분만 볼게요") */
  readonly truncated: boolean;
}

export type AiResultRecordOf<B extends AiButtonId> = AiResultRecordBase & {
  readonly button: B;
  readonly result: AiResultOf<B>;
};

export type AiResultRecord = { [B in AiButtonId]: AiResultRecordOf<B> }[AiButtonId];

export interface AiResultStorePort {
  /** 없거나 모양이 깨졌으면 null */
  get<B extends AiButtonId>(docId: string, button: B): Promise<AiResultRecordOf<B> | null>;
  /** 같은 글·버튼의 앞 결과를 바꾼다 */
  put(record: AiResultRecord): Promise<void>;
  /** 그 글의 버튼별 결과(버튼 순서) */
  list(docId: string): Promise<AiResultRecord[]>;
  removeDoc(docId: string): Promise<void>;
}

export interface LocalStorePort {
  readonly outbox: OutboxStorePort;
  readonly kv: KvStorePort;
  readonly aiResults: AiResultStorePort;
  /** 저장된 상태와 업데이트를 하나로 합쳐 돌려준다. 없으면 null. */
  loadDoc(docId: string): Promise<Uint8Array | null>;
  appendUpdate(docId: string, update: Uint8Array): Promise<void>;
  /** 쌓인 업데이트를 상태 하나로 합친다(여러 탭이 동시에 합치지 않게 글마다 잠금). */
  compact(docId: string): Promise<void>;
  setDocMeta(docId: string, meta: DocMeta): Promise<void>;
  /** 만료 시각이 지난 글 사본(글·업데이트·AI 결과)과 그 글의 대기열 항목을 지운다. 지운 글 수. */
  purgeExpired(now: number): Promise<number>;
  /**
   * 그 수업방의 기기 사본을 지운다(만료·삭제, PRD F-24): 방 ID가 적힌 글 사본, 그 방의 대기열 항목과 그 글들,
   * 그리고 `docIds`(상태 행이 없어 방을 모르는 사본, 예: 기기 기억의 마지막 글). 지운 글 수.
   */
  purgeRoom(roomId: string, docIds?: readonly string[]): Promise<number>;
  /** IndexedDB를 쓸 수 없어 메모리에만 두는 중인가(E_STORAGE_BLOCKED 띠). */
  readonly volatile: boolean;
}
