import { MS_PER_SECOND } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import { ko } from '@geulbang/core/copy';
import { describe, expect, it } from 'vitest';
import { helloOf, NOW, uuidOf } from '../testFakes.ts';
import {
  buildDashboardTiles,
  initialTeacherRoomState,
  reduceTeacherRoom,
  toTimerModel,
} from './teacherRoomState.ts';

const P1 = uuidOf(1);
const P2 = uuidOf(2);
const D1 = uuidOf(11);

const hello = helloOf({
  participants: [
    { participantId: P1, nickname: 'b-haneul', presence: 'WRITING', joinedAt: NOW },
    { participantId: P2, nickname: 'a-byeol', presence: 'OFFLINE', joinedAt: NOW },
  ],
  summaries: [
    {
      docId: D1,
      participantId: P1,
      nickname: 'b-haneul',
      genre: 'news',
      subtype: null,
      chars: 12,
      lastInputAt: NOW,
      lastInputBy: 'STUDENT',
      status: 'DRAFT',
      presence: 'WRITING',
    },
  ],
});

describe('교사 수업방 상태 합치기 (P4-13)', () => {
  it('쓰는 중·멈춤은 지금 시각으로 다시 계산하고, 별명 가나다순·접속 수를 낸다', () => {
    const state = reduceTeacherRoom(initialTeacherRoomState, { type: 'hello', hello });
    const at = (sec: number) => buildDashboardTiles(state, NOW + sec * MS_PER_SECOND, defaultConfig);

    expect(at(1).tiles.map(t => t.nickname)).toEqual(['a-byeol', 'b-haneul']);
    expect(at(1).connectedCount).toBe(1);
    expect(at(1).tiles[0]).toMatchObject({
      status: 'offline',
      docId: null,
      genreLabel: ko.teacher.tileNoDocYet,
    });
    expect(at(1).tiles[1]?.status).toBe('writing');
    expect(at(defaultConfig.ACTIVE_WINDOW_SEC + 1).tiles[1]?.status).toBe('writing-flow');
    expect(at(defaultConfig.IDLE_AFTER_SEC + 1).tiles[1]?.status).toBe('idle');
  });

  it('doc.status 제출은 제출 시각을 남기고, 다시 열면 지운다', () => {
    let state = reduceTeacherRoom(initialTeacherRoomState, { type: 'hello', hello });
    state = reduceTeacherRoom(state, {
      type: 'doc.status',
      data: { docId: D1, status: 'SUBMITTED', at: NOW + 5, generation: 0 },
    });
    const submitted = buildDashboardTiles(state, NOW, defaultConfig);
    expect(submitted.submittedCount).toBe(1);
    expect(submitted.tiles.find(t => t.docId === D1)?.submittedAt).toBe(NOW + 5);

    state = reduceTeacherRoom(state, {
      type: 'doc.status',
      data: { docId: D1, status: 'REOPENED', at: NOW + 9, generation: 1 },
    });
    expect(buildDashboardTiles(state, NOW, defaultConfig).submittedCount).toBe(0);
    expect(state.submittedAt.has(D1)).toBe(false);
  });

  it('타이머: 멈춤은 멈춘 남은 초, 도는 중은 서버 시각 기준 남은 초', () => {
    const base = { durationSec: 300, alerts: [], endText: '' };
    expect(toTimerModel(null, NOW)).toEqual({ status: 'IDLE', remainingSec: null });
    expect(
      toTimerModel({ ...base, status: 'RUNNING', endsAt: NOW + 90 * MS_PER_SECOND, remainingMs: null }, NOW),
    ).toEqual({ status: 'RUNNING', remainingSec: 90 });
    expect(
      toTimerModel({ ...base, status: 'PAUSED', endsAt: null, remainingMs: 61 * MS_PER_SECOND }, NOW),
    ).toEqual({ status: 'PAUSED', remainingSec: 61 });
  });
});
