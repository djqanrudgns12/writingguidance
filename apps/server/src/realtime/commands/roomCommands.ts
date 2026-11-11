import { isGenreId } from '@geulbang/core';
import { AppError } from '@geulbang/core/errors';
import type { CommandName, RoomSettings } from '@geulbang/core/protocol';
import type { DeleteRoom } from '../../application/deleteRoom.ts';
import type { StoredRoomSettings } from '../../store/repos/rooms.ts';
import {
  command,
  requireTeacher,
  roomFor,
  type CommandDeps,
  type CommandSpec,
  type Handler,
} from './types.ts';

/**
 * 수업방 설정·닫기·지금 삭제(PRD F-22, PLAN §4.4).
 * - 설정(AI 버튼·글 종류·알림 소리)을 바꾸면 모두에게 `room.settings`. 꺼진 AI 버튼은 학생 화면에서 바로 사라진다.
 * - 닫기: 새 입장과 학생 편집을 막는다(기록은 남음). 열린 학생 글 연결은 읽기 전용으로 다시 계산하고 `room.status`.
 * - 지금 삭제: §7.7 순서(`deleteRoom`). 기록할 수업방 행이 함께 사라지므로 멱등 기록 없이 `ack`를 먼저 보낸다.
 */
export function roomCommands(
  deps: CommandDeps & { readonly deleteRoom: DeleteRoom },
): Array<[CommandName, CommandSpec]> {
  const { repos, events, access } = deps;

  const publicSettings = (s: StoredRoomSettings): RoomSettings => ({
    genres: s.genres,
    aiButtons: s.aiButtons,
    sound: s.sound,
  });

  const update: Handler<'room.update'> = (actor, args, now) => {
    requireTeacher(actor);
    const room = roomFor(deps, actor, now);
    if (args.genres && !args.genres.every(isGenreId)) {
      throw new AppError('E_INPUT', 'genre is not in the catalog', { genres: 'invalid' });
    }
    const settings: StoredRoomSettings = {
      ...room.settings,
      ...(args.genres ? { genres: [...new Set(args.genres)] } : {}),
      ...(args.aiButtons ? { aiButtons: [...new Set(args.aiButtons)] } : {}),
      ...(args.sound !== undefined ? { sound: args.sound } : {}),
    };
    repos.rooms.updateSettings(room.id, settings);
    const visible = publicSettings(settings);
    return {
      result: { settings: visible },
      after: () => events.toRoom(room.id, 'room.settings', { settings: visible }),
    };
  };

  const setStatus = (target: 'ACTIVE' | 'CLOSED'): Handler<'room.close'> => {
    return (actor, _args, now) => {
      requireTeacher(actor);
      const room = roomFor(deps, actor, now);
      if (room.status === target) return { result: { status: target } };
      repos.rooms.setStatus(room.id, target, now);
      return {
        result: { status: target },
        after: () => {
          events.toRoom(room.id, 'room.status', { status: target });
          access.roomChanged(room.id);
        },
      };
    };
  };

  const remove: Handler<'room.delete'> = (actor, _args, now) => {
    requireTeacher(actor);
    const room = roomFor(deps, actor, now);
    return {
      result: {},
      after: () => {
        deps.deleteRoom(room.id, 'DELETED').catch((error: unknown) => {
          deps.log.error('room_delete_failed', { error });
        });
      },
    };
  };

  return [
    command('room.update', update),
    command('room.close', setStatus('CLOSED')),
    command('room.reopen', setStatus('ACTIVE')),
    command('room.delete', remove, { unrecorded: true }),
  ];
}
