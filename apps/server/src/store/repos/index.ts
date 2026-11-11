import type { Db } from '../db.ts';
import { createAiUsageRepo, type AiUsageRepo } from './aiUsage.ts';
import { createCommandRepo, type CommandRepo } from './commands.ts';
import { createDeviceRepo, type DeviceRepo } from './devices.ts';
import { createDocumentRepo, type DocumentRepo } from './documents.ts';
import { createNoticeRepo, type NoticeRepo } from './notices.ts';
import { createParticipantRepo, type ParticipantRepo } from './participants.ts';
import { createResumeRequestRepo, type ResumeRequestRepo } from './resumeRequests.ts';
import { createRoomRepo, type RoomRepo } from './rooms.ts';
import { createSnapshotRepo, type SnapshotRepo } from './snapshots.ts';
import { createTeacherSessionRepo, type TeacherSessionRepo } from './teacherSessions.ts';
import { createTimerRepo, type TimerRepo } from './timers.ts';

/** 저장소 묶음(PLAN §2.5 서버 포트). 준비한 문장을 한 번만 만들도록 서버가 시작할 때 하나 만든다. */
export interface Repos {
  readonly db: Db;
  readonly rooms: RoomRepo;
  readonly teacherSessions: TeacherSessionRepo;
  readonly participants: ParticipantRepo;
  readonly devices: DeviceRepo;
  readonly documents: DocumentRepo;
  readonly snapshots: SnapshotRepo;
  readonly commands: CommandRepo;
  readonly notices: NoticeRepo;
  readonly timers: TimerRepo;
  readonly resumeRequests: ResumeRequestRepo;
  readonly aiUsage: AiUsageRepo;
}

export function createRepos(db: Db): Repos {
  return {
    db,
    rooms: createRoomRepo(db),
    teacherSessions: createTeacherSessionRepo(db),
    participants: createParticipantRepo(db),
    devices: createDeviceRepo(db),
    documents: createDocumentRepo(db),
    snapshots: createSnapshotRepo(db),
    commands: createCommandRepo(db),
    notices: createNoticeRepo(db),
    timers: createTimerRepo(db),
    resumeRequests: createResumeRequestRepo(db),
    aiUsage: createAiUsageRepo(db),
  };
}
