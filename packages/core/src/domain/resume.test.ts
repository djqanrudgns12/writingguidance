import { describe, expect, it } from 'vitest';
import { MS_PER_MINUTE, MS_PER_SECOND } from './clock.ts';
import {
  canTransitionResumeStatus,
  clampResumeLongPollMs,
  clampResumeLongPollSec,
  computeResumeWaitHintAt,
  findReusablePendingResume,
  isResumePending,
  isResumeTerminal,
  resolveResumeDecisionStatus,
  shouldReusePendingResume,
  shouldShowApproveAll,
  shouldShowResumeWaitHint,
  transitionResumeRequest,
  transitionResumeStatus,
} from './resume.ts';
import { RESUME_STATUSES, type ResumeStatus } from './status.ts';

describe('resume 이어 쓰기 상태 전이·대기 요청 재사용·긴 조회 시간·기다림 안내', () => {
  const now = Date.UTC(2026, 10, 11, 4, 0, 0, 0);

  it('상태 전이 표(4 × 4): PENDING → APPROVED·REJECTED·CANCELLED만 바뀌고 끝난 상태는 그대로 유지된다', () => {
    const expectedNext: Readonly<Record<ResumeStatus, Readonly<Record<ResumeStatus, ResumeStatus>>>> = {
      PENDING: {
        PENDING: 'PENDING',
        APPROVED: 'APPROVED',
        REJECTED: 'REJECTED',
        CANCELLED: 'CANCELLED',
      },
      APPROVED: {
        PENDING: 'APPROVED',
        APPROVED: 'APPROVED',
        REJECTED: 'APPROVED',
        CANCELLED: 'APPROVED',
      },
      REJECTED: {
        PENDING: 'REJECTED',
        APPROVED: 'REJECTED',
        REJECTED: 'REJECTED',
        CANCELLED: 'REJECTED',
      },
      CANCELLED: {
        PENDING: 'CANCELLED',
        APPROVED: 'CANCELLED',
        REJECTED: 'CANCELLED',
        CANCELLED: 'CANCELLED',
      },
    };

    for (const from of RESUME_STATUSES) {
      expect(isResumePending(from)).toBe(from === 'PENDING');
      expect(isResumeTerminal(from)).toBe(from !== 'PENDING');

      for (const to of RESUME_STATUSES) {
        const expected = expectedNext[from][to];
        const canChange = from === 'PENDING' && to !== 'PENDING';

        expect(canTransitionResumeStatus(from, to)).toBe(canChange);
        expect(transitionResumeStatus(from, to)).toBe(expected);

        const initialDecidedAt = from === 'PENDING' ? null : now - 5000;
        const result = transitionResumeRequest(
          { id: 'req-1', status: from, decidedAt: initialDecidedAt },
          to,
          now,
        );
        expect(result.changed).toBe(canChange);
        expect(result.request.status).toBe(expected);
        expect(result.request.decidedAt).toBe(canChange ? now : initialDecidedAt);
      }
    }

    expect(resolveResumeDecisionStatus(true)).toBe('APPROVED');
    expect(resolveResumeDecisionStatus(false)).toBe('REJECTED');
  });

  it('같은 수업방·같은 기기·같은 별명(NFKC·대소문자·공백 정규화)의 PENDING 요청만 재사용한다', () => {
    const pendingReq = {
      id: 'req-pending',
      roomId: 'room-1',
      participantId: 'part-1',
      deviceId: 'dev-1',
      nickname: '하늘 고래 Blue',
      status: 'PENDING' as const,
    };

    // 같은 기기 + 정규화 뒤 같은 별명 → 재사용
    expect(
      shouldReusePendingResume(pendingReq, {
        roomId: 'room-1',
        deviceId: 'dev-1',
        nickname: '  하늘   고래 blue ',
      }),
    ).toBe(true);

    // 같은 기기 + 같은 participantId → 재사용
    expect(
      shouldReusePendingResume(pendingReq, {
        roomId: 'room-1',
        deviceId: 'dev-1',
        participantId: 'part-1',
      }),
    ).toBe(true);

    // 다른 기기면 재사용하지 않음
    expect(
      shouldReusePendingResume(pendingReq, {
        roomId: 'room-1',
        deviceId: 'dev-2',
        nickname: '하늘 고래 Blue',
      }),
    ).toBe(false);

    // 다른 별명이면 재사용하지 않음
    expect(
      shouldReusePendingResume(pendingReq, {
        roomId: 'room-1',
        deviceId: 'dev-1',
        nickname: '바다고래',
      }),
    ).toBe(false);

    // 다른 수업방이면 재사용하지 않음
    expect(
      shouldReusePendingResume(pendingReq, {
        roomId: 'room-2',
        deviceId: 'dev-1',
        nickname: '하늘 고래 Blue',
      }),
    ).toBe(false);

    // 이미 끝난(APPROVED·REJECTED·CANCELLED) 요청은 같은 기기·별명이어도 재사용하지 않음
    for (const status of ['APPROVED', 'REJECTED', 'CANCELLED'] as const) {
      expect(
        shouldReusePendingResume(
          { ...pendingReq, status },
          { roomId: 'room-1', deviceId: 'dev-1', nickname: '하늘 고래 Blue' },
        ),
      ).toBe(false);
    }

    const list = [{ ...pendingReq, id: 'req-old', status: 'REJECTED' as const }, pendingReq];
    expect(
      findReusablePendingResume(list, {
        roomId: 'room-1',
        deviceId: 'dev-1',
        nickname: '하늘 고래 blue',
      }),
    )?.toEqual(pendingReq);
    expect(
      findReusablePendingResume(list, {
        roomId: 'room-1',
        deviceId: 'dev-other',
        nickname: '하늘 고래 blue',
      }),
    ).toBeNull();
  });

  it('긴 조회 대기 시간(RESUME_LONGPOLL_SEC = 20초)을 0~20초 범위로 자른다', () => {
    const cfg = { RESUME_LONGPOLL_SEC: 20 };

    expect(clampResumeLongPollSec(undefined, cfg)).toBe(20);
    expect(clampResumeLongPollSec(null, cfg)).toBe(20);
    expect(clampResumeLongPollSec(-5, cfg)).toBe(0);
    expect(clampResumeLongPollSec(0, cfg)).toBe(0);
    expect(clampResumeLongPollSec(Number.NaN, cfg)).toBe(0);
    expect(clampResumeLongPollSec(12.9, cfg)).toBe(12);
    expect(clampResumeLongPollSec(20, cfg)).toBe(20);
    expect(clampResumeLongPollSec(60, cfg)).toBe(20);
    expect(clampResumeLongPollMs(25, cfg)).toBe(20 * MS_PER_SECOND);
  });

  it('RESUME_WAIT_HINT_MIN(30분) 경계에서 기다림 추가 안내 표시 여부와 모두 허용 단추 노출을 판단한다', () => {
    const cfg = { RESUME_WAIT_HINT_MIN: 30 };
    const createdAt = now;
    const hintAt = computeResumeWaitHintAt(createdAt, cfg);

    expect(hintAt).toBe(createdAt + 30 * MS_PER_MINUTE);
    expect(shouldShowResumeWaitHint(createdAt, hintAt - 1, cfg, 'PENDING')).toBe(false);
    expect(shouldShowResumeWaitHint(createdAt, hintAt, cfg, 'PENDING')).toBe(true);
    expect(shouldShowResumeWaitHint(createdAt, hintAt + 60_000, cfg, 'PENDING')).toBe(true);

    // 이미 결정된 요청은 30분이 지나도 대기 안내를 보이지 않는다
    expect(shouldShowResumeWaitHint(createdAt, hintAt + 60_000, cfg, 'APPROVED')).toBe(false);
    expect(shouldShowResumeWaitHint(createdAt, hintAt + 60_000, cfg, 'REJECTED')).toBe(false);
    expect(shouldShowResumeWaitHint(createdAt, hintAt + 60_000, cfg, 'CANCELLED')).toBe(false);

    // 대기 요청이 2개 이상일 때만 '모두 허용' 표시(PRD F-14)
    expect(shouldShowApproveAll(0)).toBe(false);
    expect(shouldShowApproveAll(1)).toBe(false);
    expect(shouldShowApproveAll(2)).toBe(true);
    expect(shouldShowApproveAll(5)).toBe(true);
  });
});
