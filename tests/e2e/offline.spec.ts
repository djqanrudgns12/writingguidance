import { chromium, expect, test, type Page } from '@playwright/test';
import { configDefaults } from '../../packages/core/src/config.ts';
import { E2E_BASE_URL } from './constants.ts';
import {
  bodyField,
  closeAll,
  createRoomRest,
  joinAsStudent,
  ko,
  newDevice,
  nick,
  openDrawer,
  openTeacherByLink,
  saveState,
  studentTile,
  typeAtEnd,
  typeInto,
  waitSaved,
  waitWriteReady,
} from './flows.ts';

/**
 * 오프라인·저장(PRD 16.2, F-09·F-11, PLAN §10.5 `offline.spec.ts`). 오프라인은 `context.setOffline`으로 흉내 낸다.
 * 기기는 하트비트(`HEARTBEAT_SEC`)가 `CLIENT_STALE_SEC` 동안 없으면 소켓을 다시 열고, 그동안 연결이 안 되면
 * 오프라인 띠를 보인다(앱 동작). 그래서 띠·재연결 기다림은 설정값에서 계산한 시간만큼 조건으로 기다린다.
 * 서버 재시작 중 계속 쓰기는 시험 서버가 하나(webServer)라 여기서 다루지 않는다.
 */

const SEC = 1000;
/** 끊긴 뒤 오프라인 띠가 뜰 때까지의 상한: 끊김 감지(CLIENT_STALE_SEC) + 오프라인 판정(OFFLINE_AFTER_SEC) + 여유 */
const OFFLINE_DETECT_MS =
  (configDefaults.CLIENT_STALE_SEC + configDefaults.OFFLINE_AFTER_SEC) * SEC + 5 * SEC;
/** 인터넷이 돌아온 뒤 다시 이어져 저장될 때까지의 상한: 가장 긴 재연결 간격 + 끊김 감지 + 여유 */
const RECONNECT_MS =
  Math.max(...configDefaults.RECONNECT_BACKOFF_MS) + configDefaults.CLIENT_STALE_SEC * SEC + 5 * SEC;

const offlineBanner = (page: Page) => page.getByText(ko.student.offlineBanner);

test.describe('오프라인과 저장 (PRD 16.2)', () => {
  test('오프라인에서 쓴 글이 다시 이어지면 교사가 그동안 고친 것과 합쳐져 교사 화면에도 보인다', async ({
    browser,
    request,
  }) => {
    test.setTimeout(OFFLINE_DETECT_MS + RECONNECT_MS + 60 * SEC);
    const room = await createRoomRest(request);
    const nickname = nick('비행');
    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      await joinAsStudent(student.page, room, nickname);
      await typeAtEnd(student.page, '처음 문장.');
      await waitSaved(student.page);
      teacher = await openTeacherByLink(browser, room);
      const drawer = await openDrawer(teacher.page, nickname);
      await expect(drawer).toHaveValue('처음 문장.');

      await student.context.setOffline(true);
      await typeAtEnd(student.page, ' 끊긴 동안 쓴 글');
      await expect(saveState(student.page)).toHaveAttribute('data-save-state', 'local', {
        timeout: OFFLINE_DETECT_MS,
      });
      await expect(offlineBanner(student.page)).toBeVisible({ timeout: OFFLINE_DETECT_MS });
      // 끊긴 동안 쓴 글은 교사에게 가지 않았다.
      await expect(drawer).toHaveValue('처음 문장.');

      // 그동안 교사가 같은 글 맨 앞을 고친다.
      await typeInto(drawer, 'start', '[선생님] ');
      await expect(drawer).toHaveValue('[선생님] 처음 문장.');
      // 학생은 끊긴 채로 더 쓴다.
      await typeAtEnd(student.page, ' 하나 더');
      await expect(bodyField(student.page)).toHaveValue('처음 문장. 끊긴 동안 쓴 글 하나 더');

      await student.context.setOffline(false);
      await waitSaved(student.page, RECONNECT_MS);
      await expect(offlineBanner(student.page)).toHaveCount(0);
      const merged = '[선생님] 처음 문장. 끊긴 동안 쓴 글 하나 더';
      await expect(bodyField(student.page)).toHaveValue(merged, { timeout: 10 * SEC });
      await expect(drawer).toHaveValue(merged, { timeout: 10 * SEC });
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });

  test('오프라인에서 한 제출은 `제출 대기`였다가 다시 이어지면 `제출 완료`가 된다', async ({
    browser,
    request,
  }) => {
    test.setTimeout(OFFLINE_DETECT_MS + RECONNECT_MS + 60 * SEC);
    const room = await createRoomRest(request);
    const nickname = nick('편지');
    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      await joinAsStudent(student.page, room, nickname);
      await typeAtEnd(student.page, '오프라인에서 제출할 글이에요.');
      await waitSaved(student.page);

      await student.context.setOffline(true);
      await expect(offlineBanner(student.page)).toBeVisible({ timeout: OFFLINE_DETECT_MS });
      await student.page.getByRole('button', { name: ko.student.submitButton, exact: true }).click();
      await student.page.getByRole('button', { name: ko.student.submitConfirmAction }).click();
      await expect(saveState(student.page)).toHaveAttribute('data-save-state', 'sending');
      await expect(saveState(student.page)).toContainText(ko.student.submitPendingStatus);

      await student.context.setOffline(false);
      await expect(saveState(student.page)).toHaveAttribute('data-save-state', 'locked', {
        timeout: RECONNECT_MS,
      });
      await expect(saveState(student.page)).toContainText(ko.common.saveLocked);

      teacher = await openTeacherByLink(browser, room);
      await expect(studentTile(teacher.page, nickname)).toHaveAttribute('data-status', 'submitted');
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });

  test('새로고침해도 글이 그대로다', async ({ browser, request }) => {
    const room = await createRoomRest(request);
    const student = await newDevice(browser);
    try {
      await joinAsStudent(student.page, room, nick('보리'));
      await typeAtEnd(student.page, '새로고침 전에 쓴 글');
      await waitSaved(student.page);
      await student.page.reload();
      await waitWriteReady(student.page);
      await expect(bodyField(student.page)).toHaveValue('새로고침 전에 쓴 글');
    } finally {
      await closeAll(student.context);
    }
  });

  test('끊긴 채로 쓰고 브라우저를 껐다 켜도 글이 남고, 다시 이어지면 교사에게 간다', async ({
    browser,
    request,
  }, info) => {
    test.skip(info.project.name !== 'chromium-1280', '브라우저 재시작은 폭과 무관해 1280에서만 돈다');
    test.setTimeout(OFFLINE_DETECT_MS + RECONNECT_MS + 60 * SEC);
    const room = await createRoomRest(request);
    const nickname = nick('재시');
    const profile = info.outputPath('profile');
    const launch = () =>
      chromium.launchPersistentContext(profile, {
        baseURL: E2E_BASE_URL,
        viewport: info.project.use.viewport ?? null,
      });
    let first = await launch();
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      const page = first.pages()[0] ?? (await first.newPage());
      await joinAsStudent(page, room, nickname);
      const writeUrl = page.url();
      await typeAtEnd(page, '켜 둔 동안 쓴 글.');
      await waitSaved(page);

      await first.setOffline(true);
      await typeAtEnd(page, ' 끊긴 뒤 쓴 글');
      await expect(saveState(page)).toHaveAttribute('data-save-state', 'local', {
        timeout: OFFLINE_DETECT_MS,
      });
      // 기기 저장은 입력 직후 이루어진다(서버로 가지 못한 상태에서 브라우저를 끈다).
      await first.close();

      first = await launch();
      const again = first.pages()[0] ?? (await first.newPage());
      await again.goto(writeUrl);
      await waitWriteReady(again);
      const expected = '켜 둔 동안 쓴 글. 끊긴 뒤 쓴 글';
      await expect(bodyField(again)).toHaveValue(expected);

      teacher = await openTeacherByLink(browser, room);
      const drawer = await openDrawer(teacher.page, nickname);
      await expect(drawer).toHaveValue(expected, { timeout: 10 * SEC });
    } finally {
      await closeAll(first, teacher?.context);
    }
  });

  test('앱을 한 번 연 기기는 인터넷 없이 새로고침해도 쓰던 글이 열린다(PWA)', async ({
    browser,
    request,
  }, info) => {
    test.skip(info.project.name !== 'chromium-1280', '서비스 워커 동작은 폭과 무관해 1280에서만 돈다');
    test.setTimeout(OFFLINE_DETECT_MS + 60 * SEC);
    const room = await createRoomRest(request);
    const student = await newDevice(browser);
    try {
      const page = student.page;
      await joinAsStudent(page, room, nick('우산'));
      await typeAtEnd(page, '인터넷 없이도 열려요');
      await waitSaved(page);

      // 서비스 워커가 이 화면을 맡을 때까지(첫 등록 뒤에는 다음 불러오기부터 맡는다)
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
        await page.reload();
        await waitWriteReady(page);
      }
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
      // 서비스 워커를 거쳐 화면 조각을 한 번 받아 둔다(기기 저장 대상).
      await page.reload();
      await waitWriteReady(page);

      await student.context.setOffline(true);
      await page.reload();
      await expect(page.locator('[data-screen="S5"]')).toBeVisible({ timeout: 15 * SEC });
      await expect(bodyField(page)).toHaveValue('인터넷 없이도 열려요');
      expect(await page.evaluate(() => navigator.onLine)).toBe(false);
      await expect(offlineBanner(page)).toBeVisible({ timeout: OFFLINE_DETECT_MS });
    } finally {
      await closeAll(student.context);
    }
  });
});
