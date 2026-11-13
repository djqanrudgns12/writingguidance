import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 * 오프라인·저장(PRD 16.2, F-09·F-11, PLAN §10.5 `offline.spec.ts`). 일반 요청은 `context.setOffline`으로 막고,
 * WebKit은 이 설정으로 웹소켓이 끊기지 않으므로 `/ws` 메시지·재접속도 막는다.
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

/** 페이지가 수업방을 열기 전에 설치한다. 앱의 상태·이벤트를 바꾸지 않고 통신만 막는다. */
async function installOfflineControl(context: BrowserContext, browserName: string) {
  let offline = false;
  if (browserName === 'webkit') {
    await context.routeWebSocket(/\/ws$/, async route => {
      // 이미 열린 연결은 하트비트도 양방향으로 잃게 하고, 끊긴 뒤의 새 연결은 성공하지 않게 한다.
      if (offline) {
        await route.close();
        return;
      }
      const server = route.connectToServer();
      route.onMessage(message => {
        if (!offline) server.send(message);
      });
      server.onMessage(message => {
        if (!offline) route.send(message);
      });
    });
  }
  return async (value: boolean): Promise<void> => {
    offline = value;
    await context.setOffline(value);
  };
}

test.describe('오프라인과 저장 (PRD 16.2)', () => {
  test('오프라인에서 쓴 글이 다시 이어지면 교사가 그동안 고친 것과 합쳐져 교사 화면에도 보인다', async ({
    browser,
    browserName,
    request,
  }) => {
    test.setTimeout(OFFLINE_DETECT_MS + RECONNECT_MS + 60 * SEC);
    const room = await createRoomRest(request);
    const nickname = nick('비행');
    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      const setOffline = await installOfflineControl(student.context, browserName);
      await joinAsStudent(student.page, room, nickname);
      await typeAtEnd(student.page, '처음 문장.');
      await waitSaved(student.page);
      teacher = await openTeacherByLink(browser, room);
      const drawer = await openDrawer(teacher.page, nickname);
      await expect(drawer).toHaveValue('처음 문장.');

      await setOffline(true);
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

      await setOffline(false);
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
    browserName,
    request,
  }) => {
    test.setTimeout(OFFLINE_DETECT_MS + RECONNECT_MS + 60 * SEC);
    const room = await createRoomRest(request);
    const nickname = nick('편지');
    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      const setOffline = await installOfflineControl(student.context, browserName);
      await joinAsStudent(student.page, room, nickname);
      await typeAtEnd(student.page, '오프라인에서 제출할 글이에요.');
      await waitSaved(student.page);

      await setOffline(true);
      await expect(offlineBanner(student.page)).toBeVisible({ timeout: OFFLINE_DETECT_MS });
      await student.page.getByRole('button', { name: ko.student.submitButton, exact: true }).click();
      await student.page.getByRole('button', { name: ko.student.submitConfirmAction }).click();
      await expect(saveState(student.page)).toHaveAttribute('data-save-state', 'sending');
      await expect(saveState(student.page)).toContainText(ko.student.submitPendingStatus);

      await setOffline(false);
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
    browserName,
    request,
  }, info) => {
    test.skip(info.project.name === 'chromium-360', '브라우저 재시작은 엔진마다 대표 폭에서 한 번 돈다');
    test.setTimeout(OFFLINE_DETECT_MS + RECONNECT_MS + 60 * SEC);
    const room = await createRoomRest(request);
    const nickname = nick('재시');
    // 한글 시험 이름이 들어간 outputPath는 Linux WebKit의 프로필 인자 해석을 깨뜨린다.
    const profile = await mkdtemp(join(tmpdir(), 'geulbang-offline-profile-'));
    const launch = () =>
      browser.browserType().launchPersistentContext(profile, {
        baseURL: E2E_BASE_URL,
        viewport: info.project.use.viewport ?? null,
      });
    let first: BrowserContext | undefined;
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      first = await launch();
      const setOffline = await installOfflineControl(first, browserName);
      const page = first.pages()[0] ?? (await first.newPage());
      await joinAsStudent(page, room, nickname);
      const writeUrl = page.url();
      await typeAtEnd(page, '켜 둔 동안 쓴 글.');
      await waitSaved(page);

      await setOffline(true);
      await typeAtEnd(page, ' 끊긴 뒤 쓴 글');
      await expect(saveState(page)).toHaveAttribute('data-save-state', 'local', {
        timeout: OFFLINE_DETECT_MS,
      });
      // 기기 저장은 입력 직후 이루어진다(서버로 가지 못한 상태에서 브라우저를 끈다).
      await first.close();
      first = undefined;

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
      await rm(profile, { recursive: true, force: true });
    }
  });

  test('앱을 한 번 연 기기는 인터넷 없이 새로고침해도 쓰던 글이 열린다(PWA)', async ({
    browser,
    browserName,
    request,
  }, info) => {
    test.skip(info.project.name === 'chromium-360', '서비스 워커 동작은 엔진마다 대표 폭에서 한 번 돈다');
    test.setTimeout(OFFLINE_DETECT_MS + 60 * SEC);
    const room = await createRoomRest(request);
    const student = await newDevice(browser);
    try {
      const setOffline = await installOfflineControl(student.context, browserName);
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

      await setOffline(true);
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
