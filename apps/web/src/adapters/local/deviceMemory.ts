import { z } from 'zod';
import type {
  DeviceMemory,
  RecentRoomCard,
  StudentRoomMemory,
  TeacherRoomMemory,
} from '../../ports/deviceMemory.ts';
import type { KvStorePort } from '../../ports/localStore.ts';

/**
 * 기기 기억(PRD F-23, PLAN §5.4 `kv`). 이 기기로 들어간 수업방과 교사 세션, 기기 ID를 기억한다.
 * - 토큰 원문은 기기에만 있다(서버에는 해시만, §7.4).
 * - 홈을 빨리 그리려고 최근 수업방 목록의 **토큰 없는 사본**만 localStorage에도 둔다(§5.4).
 * - 만료 시각이 지난 항목은 읽을 때 걸러 내고 `purgeExpired`로 지운다.
 */
const studentEntrySchema: z.ZodType<StudentRoomMemory> = z.object({
  roomId: z.uuid(),
  entryCode: z.string(),
  className: z.string(),
  title: z.string(),
  nickname: z.string(),
  participantId: z.uuid(),
  deviceToken: z.string(),
  lastDocId: z.uuid().nullable(),
  lastUsedAt: z.number(),
  expiresAt: z.number(),
});

const teacherEntrySchema: z.ZodType<TeacherRoomMemory> = z.object({
  roomId: z.uuid(),
  displayName: z.string(),
  teacherToken: z.string(),
  tokenKind: z.enum(['LINK', 'PIN']),
  lastUsedAt: z.number(),
  expiresAt: z.number(),
});

const recentCardSchema: z.ZodType<RecentRoomCard> = z.object({
  roomId: z.uuid(),
  entryCode: z.string(),
  className: z.string(),
  title: z.string(),
  nickname: z.string(),
  participantId: z.uuid(),
  lastDocId: z.uuid().nullable(),
  lastUsedAt: z.number(),
  expiresAt: z.number(),
});

const KEYS = {
  deviceId: 'deviceId',
  students: 'rooms.student',
  teachers: 'rooms.teacher',
} as const;
const RECENT_KEY = 'geulbang.recentRooms';

export interface DeviceMemoryDeps {
  readonly kv: KvStorePort;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly newId?: () => string;
}

export function createDeviceMemory(deps: DeviceMemoryDeps): DeviceMemory {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const storage = deps.storage === undefined ? safeLocalStorage() : deps.storage;

  const readList = async <T>(key: string, schema: z.ZodType<T>): Promise<T[]> => {
    const raw = await deps.kv.get(key);
    const parsed = z.array(z.unknown()).safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.flatMap(item => {
      const r = schema.safeParse(item);
      return r.success ? [r.data] : [];
    });
  };

  const writeStudents = async (list: StudentRoomMemory[]) => {
    await deps.kv.set(KEYS.students, list);
    try {
      const cards: RecentRoomCard[] = list.map(({ deviceToken: _omit, ...card }) => card);
      storage?.setItem(RECENT_KEY, JSON.stringify(cards));
    } catch {
      // 사본은 빠른 첫 화면용일 뿐이라 실패해도 된다(개인 정보 보호 모드 등).
    }
  };

  const byRecent = <T extends { lastUsedAt: number }>(a: T, b: T) => b.lastUsedAt - a.lastUsedAt;

  return {
    async deviceId() {
      const existing = await deps.kv.get(KEYS.deviceId);
      if (typeof existing === 'string' && existing.length > 0) return existing;
      const id = newId();
      await deps.kv.set(KEYS.deviceId, id);
      return id;
    },
    async students(now) {
      return (await readList(KEYS.students, studentEntrySchema))
        .filter(e => e.expiresAt > now)
        .sort(byRecent);
    },
    async student(roomId, now) {
      return (await this.students(now)).find(e => e.roomId === roomId) ?? null;
    },
    async rememberStudent(entry, maxRooms) {
      const list = (await readList(KEYS.students, studentEntrySchema)).filter(e => e.roomId !== entry.roomId);
      list.unshift(entry);
      await writeStudents(list.sort(byRecent).slice(0, Math.max(1, maxRooms)));
    },
    async touchStudent(roomId, patch) {
      const list = await readList(KEYS.students, studentEntrySchema);
      const next = list.map(e => (e.roomId === roomId ? { ...e, ...patch } : e));
      await writeStudents(next.sort(byRecent));
    },
    async forgetStudent(roomId) {
      const list = await readList(KEYS.students, studentEntrySchema);
      await writeStudents(list.filter(e => e.roomId !== roomId));
    },
    async teachers(now) {
      return (await readList(KEYS.teachers, teacherEntrySchema))
        .filter(e => e.expiresAt > now)
        .sort(byRecent);
    },
    async rememberTeacher(entry) {
      const list = (await readList(KEYS.teachers, teacherEntrySchema)).filter(e => e.roomId !== entry.roomId);
      list.unshift(entry);
      await deps.kv.set(KEYS.teachers, list);
    },
    async forgetTeacher(roomId) {
      const list = await readList(KEYS.teachers, teacherEntrySchema);
      await deps.kv.set(
        KEYS.teachers,
        list.filter(e => e.roomId !== roomId),
      );
    },
    async purgeExpired(now) {
      const students = await readList(KEYS.students, studentEntrySchema);
      const teachers = await readList(KEYS.teachers, teacherEntrySchema);
      const gone = new Set<string>();
      for (const e of [...students, ...teachers]) if (e.expiresAt <= now) gone.add(e.roomId);
      if (gone.size === 0) return [];
      await writeStudents(students.filter(e => e.expiresAt > now));
      await deps.kv.set(
        KEYS.teachers,
        teachers.filter(e => e.expiresAt > now),
      );
      return [...gone];
    },
    recentCardsSync(now) {
      try {
        const raw = storage?.getItem(RECENT_KEY);
        if (!raw) return [];
        const parsed = z.array(recentCardSchema).safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data.filter(e => e.expiresAt > now) : [];
      } catch {
        return [];
      }
    },
  };
}

function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export type { DeviceMemory, RecentRoomCard, StudentRoomMemory, TeacherRoomMemory };
