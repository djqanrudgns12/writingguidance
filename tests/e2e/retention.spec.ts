import { expect, test } from '@playwright/test';
import { E2E_DESKTOP_VIEWPORT, E2E_ROOM_TTL_MINUTES } from './constants.ts';
import { roomRowCounts } from './db.ts';
import {
  closeAll,
  createRoomRest,
  joinAsStudent,
  ko,
  newDevice,
  nick,
  openNoticePanel,
  openTeacherByLink,
  typeAtEnd,
  waitSaved,
} from './flows.ts';

/**
 * 보관(PRD 16.6-1, F-24, PLAN §10.5 `retention.spec.ts`): 만료 시각이 지나면 수업방 데이터·PIN·입장 코드가 모두 사라진다.
 * 시험 서버는 `ROOM_TTL_MINUTES_OVERRIDE=2`(보관 기간을 설정값 하나로 줄임, 16.6-2)라 2분 뒤 만료되고,
 * 정리 작업은 60초마다 돈다(apps/server/src/jobs/retention.ts). 폭과 무관해 1280 프로젝트에서만 돈다.
 */

/** 정리 작업 주기(서버 내부 값 60초)와 여유 */
const SWEEP_MS = 60_000;
const SLACK_MS = 20_000;

test.describe('보관 (PRD 16.6)', () => {
  test('2분 보관이 끝나면 방·글·기록·PIN·입장 코드가 모두 사라지고 같은 코드·PIN으로 다시 찾을 수 없다', async ({
    browser,
    request,
  }) => {
    const ttlMs = E2E_ROOM_TTL_MINUTES * 60_000;
    test.setTimeout(ttlMs + SWEEP_MS + SLACK_MS + 90_000);
    const room = await createRoomRest(request);
    // 보관 기간 설정값 하나(분 단위 덮어쓰기)가 만료 시각에 그대로 반영된다.
    expect(Math.abs(room.expiresAt - Date.now() - ttlMs)).toBeLessThan(15_000);

    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      await joinAsStudent(student.page, room, nick('보관'));
      await typeAtEnd(student.page, '곧 지워질 글이에요.');
      await waitSaved(student.page);
      teacher = await openTeacherByLink(browser, room);
      await openNoticePanel(teacher.page);
      await teacher.page.getByRole('button', { name: ko.teacher.noticePresetPraise }).click();
      await expect(teacher.page.getByText(ko.teacher.noticeSentToast)).toBeVisible();

      const before = roomRowCounts(room.roomId, room.entryCode);
      expect(before.rooms).toBe(1);
      expect(before.participants).toBeGreaterThan(0);
      expect(before.documents).toBeGreaterThan(0);
      expect(before.snapshots).toBeGreaterThan(0);
      expect(before.teacherSessions).toBeGreaterThan(0);
      expect(before.notices).toBeGreaterThan(0);

      // 만료 시각 + 정리 주기 안에 모든 행이 사라진다.
      const waitMs = Math.max(0, room.expiresAt - Date.now()) + SWEEP_MS + SLACK_MS;
      await expect
        .poll(() => roomRowCounts(room.roomId, room.entryCode), { timeout: waitMs, intervals: [5000] })
        .toEqual({ rooms: 0, teacherSessions: 0, participants: 0, documents: 0, snapshots: 0, notices: 0 });

      // 쓰던 학생 화면은 문 닫힌 안내로 바뀐다.
      await expect(student.page.getByText(ko.common.expiredRoomTitle)).toBeVisible({ timeout: 15_000 });

      // 입장 코드: 같은 코드로 찾을 수 없다.
      const byCode = await request.get(`/api/rooms/by-code/${room.entryCode}`);
      expect([404, 410]).toContain(byCode.status());
      const fresh = await newDevice(browser);
      try {
        await fresh.page.goto(`/${room.entryCode}`);
        await expect(fresh.page.locator('[data-screen="S1"]')).toHaveCount(0);
        await expect(
          fresh.page.getByText(ko.common.notFoundTitle).or(fresh.page.getByText(ko.common.expiredRoomTitle)),
        ).toBeVisible({ timeout: 10_000 });

        // PIN: 같은 PIN으로 들어갈 수 없다.
        await fresh.page.setViewportSize(E2E_DESKTOP_VIEWPORT);
        await fresh.page.goto('/t/pin');
        await fresh.page.getByLabel(ko.common.pinInputLabel, { exact: true }).fill(room.pin);
        await fresh.page.getByRole('button', { name: ko.teacher.pinEnterAction }).click();
        await expect(fresh.page.getByText(ko.errors.E_PIN_INVALID)).toBeVisible();
        await expect(fresh.page).toHaveURL(/\/t\/pin$/);

        // 선생님 링크도 더는 대시보드를 열지 않는다.
        await fresh.page.goto(`/t/${room.linkToken}`);
        await expect(
          fresh.page.getByRole('button', { name: ko.teacher.noticeButton, exact: true }),
        ).toHaveCount(0);
        await expect(fresh.page).not.toHaveURL(new RegExp(`/t/room/${room.roomId}`));
      } finally {
        await closeAll(fresh.context);
      }

      // PIN이 정말 풀렸으니 같은 PIN으로 새 수업방을 만들 수 있다(중복 PIN 거절에 걸리지 않음).
      const again = await createRoomRest(request, { pin: room.pin });
      expect(again.roomId).not.toBe(room.roomId);
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });
});
