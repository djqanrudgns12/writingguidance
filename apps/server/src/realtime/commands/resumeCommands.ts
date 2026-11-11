import { randomUUID } from 'node:crypto';
import { AppError } from '@geulbang/core/errors';
import type { CommandName } from '@geulbang/core/protocol';
import type { Connection } from '@hocuspocus/server';
import type { ResumeWaiters } from '../../application/resumeWaiters.ts';
import { isUniqueViolation } from '../../store/db.ts';
import type { RealtimeContext } from '../context.ts';
import {
  command,
  requireTeacher,
  roomFor,
  type CommandDeps,
  type CommandSpec,
  type Handler,
} from './types.ts';

/**
 * 이어 쓰기 결정과 기기 관리(PRD F-14, PLAN §2.3 ④, §4.4).
 * - 허용: 한 트랜잭션으로 `status = 'APPROVED' WHERE status = 'PENDING'` + 그 토큰 해시를 `devices`에 등록.
 *   서버가 토큰을 건네지 않으므로 응답이 사라져도 새 기기의 다음 조회·실시간 연결로 바로 이어진다.
 *   여러 교사 기기가 동시에 누르면 `PENDING`을 먼저 통과한 결정 하나만 남는다.
 * - `기기 연결 끊기`: `revoked_at`을 찍고 그 기기의 열린 연결을 모두 닫는다(다시 붙으면 `E_AUTH`).
 */
const CLOSE_DEVICE_REVOKED = 4401;

export function resumeCommands(
  deps: CommandDeps & { readonly resumeWaiters: ResumeWaiters },
): Array<[CommandName, CommandSpec]> {
  const { repos, events } = deps;

  const decide: Handler<'resume.decide'> = (actor, args, now) => {
    requireTeacher(actor);
    const room = roomFor(deps, actor, now);
    const ids = 'all' in args ? repos.resumeRequests.listPendingIds(room.id) : [args.requestId];
    const status = args.approve ? 'APPROVED' : 'REJECTED';
    const decided: Array<{ requestId: string; status: 'APPROVED' | 'REJECTED' }> = [];
    for (const id of ids) {
      const request = repos.resumeRequests.findById(id);
      if (!request || request.roomId !== room.id) {
        if ('all' in args) continue;
        throw new AppError('E_FORBIDDEN', 'resume request not in this room');
      }
      if (repos.resumeRequests.decide(id, room.id, status, now) !== 1) continue; // 이미 결정·취소됨
      if (args.approve) {
        try {
          repos.devices.insert({
            id: randomUUID(),
            participantId: request.participantId,
            tokenHash: request.deviceTokenHash,
            deviceId: request.deviceId,
            approvedAt: now,
          });
        } catch (error) {
          if (!isUniqueViolation(error, 'devices.token_hash')) throw error;
          // 같은 토큰이 이미 기기로 있다(같은 기기가 전에 허용됨): 그대로 쓰면 된다.
        }
      }
      decided.push({ requestId: id, status });
    }
    return {
      result: { decided: decided.length },
      after: () => {
        for (const d of decided) {
          deps.resumeWaiters.notify(d.requestId);
          events.toTeachers(room.id, 'resume.decided', d);
        }
      },
    };
  };

  const participantInRoom = (roomId: string, participantId: string) => {
    const participant = repos.participants.findById(participantId);
    if (!participant || participant.roomId !== roomId) throw new AppError('E_FORBIDDEN');
    return participant;
  };

  const list: Handler<'device.list'> = (actor, args, now) => {
    requireTeacher(actor);
    const room = roomFor(deps, actor, now);
    participantInRoom(room.id, args.participantId);
    const online = new Set<string>();
    for (const c of events.connections(room.id)) {
      const a = c.context.actor;
      if (a?.kind === 'student') online.add(a.deviceRowId);
    }
    return {
      result: repos.devices.listActiveByParticipant(args.participantId).map(d => ({
        deviceRowId: d.id,
        approvedAt: d.approvedAt,
        lastSeenAt: d.lastSeenAt,
        connected: online.has(d.id),
      })),
    };
  };

  const revoke: Handler<'device.revoke'> = (actor, args, now) => {
    requireTeacher(actor);
    const room = roomFor(deps, actor, now);
    const device = repos.devices.findById(args.deviceRowId);
    if (!device) throw new AppError('E_FORBIDDEN');
    participantInRoom(room.id, device.participantId);
    const revoked = repos.devices.revoke(device.id, now);
    return {
      result: { revoked },
      after: () => {
        for (const document of deps.hocuspocus().documents.values()) {
          for (const c of document.getConnections() as Array<Connection<RealtimeContext>>) {
            const a = c.context.actor;
            if (a?.kind === 'student' && a.deviceRowId === device.id) {
              c.close({ code: CLOSE_DEVICE_REVOKED, reason: 'E_AUTH' });
            }
          }
        }
      },
    };
  };

  return [command('resume.decide', decide), command('device.list', list), command('device.revoke', revoke)];
}
