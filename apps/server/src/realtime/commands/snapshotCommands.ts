import { AppError } from '@geulbang/core/errors';
import type { CommandName } from '@geulbang/core/protocol';
import {
  authorOf,
  command,
  currentText,
  docFor,
  roomFor,
  type CommandDeps,
  type CommandSpec,
  type Handler,
} from './types.ts';

/**
 * 시간 되감기(PRD F-10, PLAN §4.4): 목록·한 개 보기·복원. 학생은 자기 글만, 교사는 그 방 글.
 * 복원은 서버가 글을 바꾸지 않는다: 지금 글을 RESTORE 스냅샷으로 먼저 남기고 대상 글(제목·본문)을 돌려주면,
 * 기기가 차이만 편집용 문서에 적용한다(되돌리기 가능). 그래서 학생은 글을 고칠 수 있을 때만 복원한다.
 */
export function snapshotCommands(deps: CommandDeps): Array<[CommandName, CommandSpec]> {
  const { repos, snapshots } = deps;

  const list: Handler<'snapshot.list'> = (actor, args, now) => {
    roomFor(deps, actor, now);
    const info = docFor(deps, actor, args.docId);
    return { result: repos.snapshots.listItems(info.id) };
  };

  const get: Handler<'snapshot.get'> = (actor, args, now) => {
    roomFor(deps, actor, now);
    const info = docFor(deps, actor, args.docId);
    const snap = repos.snapshots.getText(info.id, args.snapshotId);
    if (!snap) throw new AppError('E_FORBIDDEN', 'snapshot not in this document');
    return { result: { title: snap.titleText, body: snap.bodyText } };
  };

  const restore: Handler<'snapshot.restore'> = (actor, args, now) => {
    const room = roomFor(deps, actor, now);
    const info = docFor(deps, actor, args.docId);
    if (actor.kind === 'student') {
      if (room.status === 'CLOSED') throw new AppError('E_ROOM_CLOSED');
      if (info.status === 'SUBMITTED') throw new AppError('E_DOC_LOCKED');
    }
    const target = repos.snapshots.getText(info.id, args.snapshotId);
    if (!target) throw new AppError('E_FORBIDDEN', 'snapshot not in this document');
    snapshots.record(info.id, 'RESTORE', authorOf(actor), currentText(deps, info.id));
    return { result: { title: target.titleText, body: target.bodyText } };
  };

  return [command('snapshot.list', list), command('snapshot.get', get), command('snapshot.restore', restore)];
}
