import { bytesToBase64Url } from '@geulbang/core';
import { isDevDocId, TOKEN_PATTERN } from '@geulbang/core/protocol';

/**
 * `/dev/editor` 자격·매개변수 도구(PLAN §11.5 P2-4).
 * `#dev=<비밀값>`은 읽자마자 주소창에서 지우고 `sessionStorage`에만 둔다(방문 기록·화면 노출 방지).
 */
export const DEV_SECRET_STORAGE_KEY = 'geulbang.dev.secret';
const MAIN_DEVICE_STORAGE_KEY = 'geulbang.dev.device.main';
const BOT_DEVICE_STORAGE_KEY = 'geulbang.dev.device.bot';
const CHECKLIST_STORAGE_KEY = 'geulbang.dev.checklist';

export const DEFAULT_DEV_DOC_ID = 'dev-ime';

export type DevRole = 'student' | 'teacher';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocationLike {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export interface HistoryLike {
  readonly state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export interface DevEditorParams {
  readonly docId: string;
  readonly validDocId: boolean;
  readonly role: DevRole;
}

/**
 * 주소 전체나 `#dev=...` 조각을 붙여 넣어도 비밀값 본문만 뽑아낸다.
 */
export function extractDevSecretInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const hashIdx = trimmed.indexOf('#');
  const candidate = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : trimmed;
  if (candidate.includes('=')) {
    const params = new URLSearchParams(candidate.startsWith('#') ? candidate.slice(1) : candidate);
    const fromParam = params.get('dev');
    if (fromParam !== null) return fromParam.trim();
  }
  return candidate.trim();
}

/**
 * 주소창 `#dev=<비밀값>`을 소비해 `sessionStorage`에 넣고, 주소창 해시에서는 바로 지운다.
 * 해시에 `dev`가 없으면 `sessionStorage`에 저장돼 있던 값을 돌려준다.
 */
export function consumeDevSecret(
  loc: LocationLike,
  hist: HistoryLike,
  storage: StorageLike | null,
): string | null {
  const rawHash = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash;
  if (rawHash) {
    const hashParams = new URLSearchParams(rawHash);
    const fromHash = hashParams.get('dev');
    if (fromHash !== null) {
      const cleanedSecret = fromHash.trim();
      if (cleanedSecret) {
        safeSet(storage, DEV_SECRET_STORAGE_KEY, cleanedSecret);
      }
      hashParams.delete('dev');
      const restHash = hashParams.toString();
      const nextUrl = `${loc.pathname}${loc.search}${restHash ? `#${restHash}` : ''}`;
      hist.replaceState(hist.state, '', nextUrl);
      if (cleanedSecret) return cleanedSecret;
    }
  }

  const stored = safeGet(storage, DEV_SECRET_STORAGE_KEY);
  return stored && stored.trim() ? stored.trim() : null;
}

export function saveDevSecret(raw: string, storage: StorageLike | null): string | null {
  const cleaned = extractDevSecretInput(raw);
  if (!cleaned) {
    safeRemove(storage, DEV_SECRET_STORAGE_KEY);
    return null;
  }
  safeSet(storage, DEV_SECRET_STORAGE_KEY, cleaned);
  return cleaned;
}

export function clearDevSecret(storage: StorageLike | null): void {
  safeRemove(storage, DEV_SECRET_STORAGE_KEY);
}

export function isPlausibleDevSecret(secret: string | null): secret is string {
  return typeof secret === 'string' && TOKEN_PATTERN.test(secret);
}

/**
 * `?doc=dev-xxx`(기본 `dev-ime`), `?role=student|teacher`(기본 `student`)를 읽는다.
 */
export function parseDevEditorParams(search: string): DevEditorParams {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawDoc = params.get('doc')?.trim();
  const docId = rawDoc && rawDoc.length > 0 ? rawDoc : DEFAULT_DEV_DOC_ID;
  const rawRole = params.get('role')?.trim();
  const role: DevRole = rawRole === 'teacher' ? 'teacher' : 'student';
  return {
    docId,
    validDocId: isDevDocId(docId),
    role,
  };
}

export function buildRoleSwitchSearch(search: string, nextRole: DevRole): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.set('role', nextRole);
  const str = params.toString();
  return str ? `?${str}` : '';
}

export function getOrCreateDevDeviceId(storage: StorageLike | null, slot: 'main' | 'bot'): string {
  const key = slot === 'main' ? MAIN_DEVICE_STORAGE_KEY : BOT_DEVICE_STORAGE_KEY;
  const existing = safeGet(storage, key);
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;

  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  const created = `dev-${slot}-${bytesToBase64Url(bytes)}`;
  safeSet(storage, key, created);
  return created;
}

export function loadCheckedChecklist(storage: StorageLike | null): ReadonlySet<number> {
  const raw = safeGet(storage, CHECKLIST_STORAGE_KEY);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is number => typeof v === 'number' && Number.isInteger(v)));
  } catch {
    return new Set();
  }
}

export function saveCheckedChecklist(storage: StorageLike | null, checked: ReadonlySet<number>): void {
  safeSet(storage, CHECKLIST_STORAGE_KEY, JSON.stringify([...checked].sort((a, b) => a - b)));
}

export function getSessionStorageSafe(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function safeGet(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: StorageLike | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // 사생활 보호 모드 등에서 sessionStorage 쓰기가 막혀도 메모리 동작은 이어간다.
  }
}

function safeRemove(storage: StorageLike | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // 무시
  }
}
