/**
 * 기기 기억 포트(PRD F-23, PLAN §5.4). 이 기기로 들어간 수업방과 교사 세션, 기기 ID.
 * 토큰 원문은 기기에만 있다(서버에는 해시만, PLAN §7.4).
 */
export interface StudentRoomMemory {
  readonly roomId: string;
  readonly entryCode: string;
  readonly className: string;
  readonly title: string;
  readonly nickname: string;
  readonly participantId: string;
  readonly deviceToken: string;
  readonly lastDocId: string | null;
  readonly lastUsedAt: number;
  readonly expiresAt: number;
}

export interface TeacherRoomMemory {
  readonly roomId: string;
  readonly displayName: string;
  readonly teacherToken: string;
  readonly tokenKind: 'LINK' | 'PIN';
  readonly lastUsedAt: number;
  readonly expiresAt: number;
}

/** localStorage 사본(토큰 없음, 첫 화면용) */
export type RecentRoomCard = Omit<StudentRoomMemory, 'deviceToken'>;

export interface DeviceMemory {
  deviceId(): Promise<string>;
  students(now: number): Promise<StudentRoomMemory[]>;
  student(roomId: string, now: number): Promise<StudentRoomMemory | null>;
  rememberStudent(entry: StudentRoomMemory, maxRooms: number): Promise<void>;
  touchStudent(
    roomId: string,
    patch: Partial<Pick<StudentRoomMemory, 'lastDocId' | 'lastUsedAt' | 'nickname'>>,
  ): Promise<void>;
  forgetStudent(roomId: string): Promise<void>;
  teachers(now: number): Promise<TeacherRoomMemory[]>;
  rememberTeacher(entry: TeacherRoomMemory): Promise<void>;
  forgetTeacher(roomId: string): Promise<void>;
  /** 만료된 항목을 지우고 지운 수업방 ID를 돌려준다(그 방의 글 사본도 지우게). */
  purgeExpired(now: number): Promise<string[]>;
  /** localStorage 사본(동기). 없거나 깨졌으면 빈 배열. */
  recentCardsSync(now: number): RecentRoomCard[];
}
