import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { E2E_DESKTOP_VIEWPORT, E2E_START_CODE } from './constants.ts';
import {
  agreeOnRoomCard,
  bodyField,
  closeAll,
  createRoomRest,
  enterNickname,
  genreTile,
  joinAsStudent,
  ko,
  newDevice,
  nick,
  openDrawer,
  openNoticePanel,
  openTeacherByLink,
  randomPin,
  screen,
  studentTile,
  teacherMenu,
  typeAtEnd,
  waitDashboardReady,
  waitSaved,
  waitWriteReady,
} from './flows.ts';
import { readZip } from './zip.ts';

/**
 * 교사(PRD 16.4, F-14~F-22, PLAN §10.5 `teacher.spec.ts`). 교사 기기는 1280 폭, 학생 기기는 프로젝트 폭.
 * 타이머 알림은 분 단위 설정(`TIMER_ALERTS_MIN`)이라 실제 1분을 기다린다(1280 프로젝트에서만).
 */

type Device = Awaited<ReturnType<typeof newDevice>>;

const pinInput = (page: Page): Locator => page.getByLabel(ko.common.pinInputLabel, { exact: true });

/** 학생 화면 위에서 내려오는 교사 알림(종이 띠) */
const studentNotice = (page: Page, text: string): Locator =>
  page.locator('[data-notice-slot] [role="status"]').filter({ hasText: text });

/** T5 PIN 화면에서 PIN을 넣고 `들어가기` */
async function submitPin(page: Page, pin: string): Promise<void> {
  await pinInput(page).fill(pin);
  await page.getByRole('button', { name: ko.teacher.pinEnterAction }).click();
}

/** 학생 쓰기 화면의 시계 알약 남은 초 */
async function studentTimerSeconds(page: Page): Promise<number> {
  const text = (await page.locator('[data-screen="S5"] [role="timer"]').innerText()).trim();
  const m = /(\d+):(\d{2})/.exec(text);
  if (!m) throw new Error(`시계 글자 모양이 다름: ${text}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 대시보드 알림 팝오버에서 타이머를 `직접` n분으로 시작한다. */
async function startTimer(page: Page, minutes: number): Promise<void> {
  await openNoticePanel(page);
  await page.getByRole('button', { name: ko.teacher.timerPresetCustom, exact: true }).click();
  await page.getByLabel(ko.teacher.timerCustomMinutesLabel).fill(String(minutes));
  await page.getByRole('button', { name: ko.teacher.timerStartAction, exact: true }).click();
}

test.describe('교사 (PRD 16.4)', () => {
  test('선생님 링크를 다른 브라우저 컨텍스트에서 열면 바로 대시보드이고, 주소창에서 토큰이 지워진다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    let teacher: Device | undefined;
    try {
      // 앱을 한 번도 연 적 없는 새 기기(새 브라우저 컨텍스트)에서 링크를 바로 연다.
      teacher = await openTeacherByLink(browser, room, E2E_DESKTOP_VIEWPORT, { fresh: true });
      expect(teacher.page.url()).not.toContain(room.linkToken);
      await expect(teacher.page.getByRole('heading', { level: 1 })).toContainText(room.title);
      // 학생이 아직 없으면 빈 화면 안내 + QR 단추(F-17)
      await expect(teacher.page.getByText(ko.teacher.emptyRoomTitle)).toBeVisible();
      // 이 기기가 기억해 최근 수업방에서 한 번에 들어간다(F-20 2번).
      await teacher.page.goto('/t');
      await expect(teacher.page.getByText(ko.teacher.homeHeading)).toBeVisible();
      await teacher.page.getByRole('button', { name: new RegExp(room.title) }).click();
      await expect(teacher.page).toHaveURL(new RegExp(`/t/room/${room.roomId}`));
      await waitDashboardReady(teacher.page);
    } finally {
      await closeAll(teacher?.context);
    }
  });

  test('등록 링크(#코드)는 시작 코드를 기기에 저장하고 주소창에서 지우며, 다음 수업방 만들기에 쓴다', async ({
    browser,
  }) => {
    const { context, page } = await newDevice(browser, E2E_DESKTOP_VIEWPORT);
    try {
      await page.goto(`/t/register#${E2E_START_CODE}`);
      await expect(page).toHaveURL(/\/t$/);
      expect(page.url()).not.toContain('#');
      expect(page.url()).not.toContain(E2E_START_CODE);
      await expect(page.getByText(ko.teacher.registerLinkSavedToast)).toBeVisible();

      // T1: 기기에 시작 코드가 있으니 시작 코드 칸이 없다. 화면으로 수업방을 연다.
      await page.getByRole('button', { name: ko.teacher.createNewRoomAction }).click();
      await expect(page.getByRole('heading', { name: ko.teacher.createRoomHeading })).toBeVisible();
      await expect(page.getByLabel(ko.teacher.startCodeLabel, { exact: true })).toHaveCount(0);
      const pin = randomPin();
      await page.getByLabel(ko.teacher.classNameLabel, { exact: true }).fill('4학년 2반');
      await page.getByLabel(ko.teacher.roomTitleLabel, { exact: true }).fill('화면 수업방');
      await page.getByLabel(ko.teacher.pinCreateLabel, { exact: true }).fill(pin);
      await page.getByLabel(ko.teacher.pinConfirmLabel, { exact: true }).fill(pin);
      await page.getByRole('button', { name: ko.teacher.openRoomAction }).click();
      await expect(page.getByRole('heading', { name: ko.teacher.prepHeading })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId('prep-entry-code')).toHaveText(/^\d{3}\s?\d{3}$/);
    } finally {
      await closeAll(context);
    }
  });

  test('시작 코드가 없는 기기는 T1 맨 위 칸으로 받고, 이미 쓰이는 PIN은 만들 때 바로 알린다', async ({
    browser,
    request,
  }) => {
    const taken = await createRoomRest(request);
    const { context, page } = await newDevice(browser, E2E_DESKTOP_VIEWPORT);
    try {
      await page.goto('/t/new');
      await expect(page.getByRole('heading', { name: ko.teacher.createRoomHeading })).toBeVisible();
      await page.getByLabel(ko.teacher.startCodeLabel, { exact: true }).fill(E2E_START_CODE);
      await page.getByLabel(ko.teacher.classNameLabel, { exact: true }).fill('6학년 1반');
      await page.getByLabel(ko.teacher.roomTitleLabel, { exact: true }).fill('겹친 PIN 시험');
      await page.getByLabel(ko.teacher.pinCreateLabel, { exact: true }).fill(taken.pin);
      await page.getByLabel(ko.teacher.pinConfirmLabel, { exact: true }).fill(taken.pin);
      await page.getByRole('button', { name: ko.teacher.openRoomAction }).click();
      await expect(page.getByText(ko.errors.E_PIN_TAKEN)).toBeVisible();
      await expect(page).toHaveURL(/\/t\/new$/);

      // 다른 PIN으로 바꾸면 열린다.
      const pin = randomPin();
      await page.getByLabel(ko.teacher.pinCreateLabel, { exact: true }).fill(pin);
      await page.getByLabel(ko.teacher.pinConfirmLabel, { exact: true }).fill(pin);
      await page.getByRole('button', { name: ko.teacher.openRoomAction }).click();
      await expect(page.getByRole('heading', { name: ko.teacher.prepHeading })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await closeAll(context);
    }
  });

  test('PIN만으로 들어가고, 같은 기기에서 5번 틀리면 잠기지만 다른 기기는 막히지 않는다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    const a = await newDevice(browser, E2E_DESKTOP_VIEWPORT);
    const b = await newDevice(browser, E2E_DESKTOP_VIEWPORT);
    try {
      await a.page.goto('/t/pin');
      await expect(a.page.getByRole('heading', { name: ko.teacher.pinEnterHeading })).toBeVisible();
      let wrong = randomPin();
      while (wrong === room.pin) wrong = randomPin();
      for (let i = 0; i < 4; i += 1) {
        await submitPin(a.page, wrong);
        await expect(a.page.getByText(ko.errors.E_PIN_INVALID)).toBeVisible();
        await expect(pinInput(a.page)).toHaveValue('');
      }
      // 다섯 번째로 틀리면 잠긴다(그 응답에서 바로, 또는 다음 시도에서). 잠긴 뒤에는 맞는 PIN도 막힌다.
      await submitPin(a.page, wrong);
      // 잠기면 남은 분과 함께 "n분 뒤에 다시 입력해 주세요."(일반 E_PIN_LOCKED 문구 대신, PinEntry 문구 검토)
      const locked = a.page
        .getByText(new RegExp(`\\d+${ko.teacher.pinLockedRemainingSuffix}`))
        .or(a.page.getByText(ko.errors.E_PIN_LOCKED));
      await expect(a.page.getByText(ko.errors.E_PIN_INVALID).or(locked)).toBeVisible();
      if (await pinInput(a.page).isEnabled()) await submitPin(a.page, room.pin);
      await expect(locked).toBeVisible();
      await expect(pinInput(a.page)).toBeDisabled();
      await expect(a.page).toHaveURL(/\/t\/pin$/);

      // 다른 기기: 맞는 PIN으로 바로 들어간다.
      await b.page.goto('/t/pin');
      await submitPin(b.page, room.pin);
      await expect(b.page).toHaveURL(new RegExp(`/t/room/${room.roomId}`), { timeout: 15_000 });
      await waitDashboardReady(b.page);
    } finally {
      await closeAll(a.context, b.context);
    }
  });

  test('다른 기기 이어 쓰기: 교사가 나중에 들어와도 요청이 보이고, 응답을 놓친 기기도 허용 뒤 글이 열린다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    const nickname = nick('하늘');
    const first = await newDevice(browser);
    const second = await newDevice(browser);
    let teacher: Device | undefined;
    try {
      await joinAsStudent(first.page, room, nickname);
      await typeAtEnd(first.page, '첫 기기에서 쓴 글');
      await waitSaved(first.page);

      // 둘째 기기: 같은 별명 → `내가 쓰던 거예요` → 기다리는 화면(S6)
      await second.page.goto(`/${room.entryCode}`);
      await agreeOnRoomCard(second.page);
      await second.page.getByLabel(ko.student.nicknameLabel).fill(nickname);
      await second.page.getByRole('button', { name: ko.common.next, exact: true }).click();
      await expect(second.page.getByText(ko.student.nicknameTakenGuide)).toBeVisible();
      await second.page.getByRole('button', { name: ko.student.nicknameMineAction }).click();
      await expect(screen(second.page, 'S6')).toHaveAttribute('data-status', 'waiting');
      await expect(second.page.getByText(ko.student.resumeWaitTitle)).toBeVisible();
      // 새로고침해도 기다리는 화면으로 돌아온다.
      await second.page.reload();
      await expect(screen(second.page, 'S6')).toHaveAttribute('data-status', 'waiting');

      // 허용 응답을 받는 조회를 잠시 끊어 둔다(응답 유실 흉내).
      await second.page.route('**/api/rooms/*/resume-requests/*', route => route.abort('connectionreset'));

      // 교사는 요청 뒤에 들어온다 → 띠에 요청이 보인다.
      teacher = await openTeacherByLink(browser, room);
      const band = teacher.page.locator('li').filter({ hasText: nickname });
      await expect(teacher.page.getByText(ko.teacher.resumeBannerLabel)).toBeVisible();
      await band
        .getByRole('button', { name: `${nickname} ${ko.teacher.resumeApproveAction}`, exact: true })
        .click();
      await expect(teacher.page.getByText(ko.teacher.resumeBannerLabel)).toHaveCount(0);

      // 조회가 다시 되면(응답을 놓친 뒤) 허용된 것을 알아채고 글이 그대로 열린다.
      await second.page.unroute('**/api/rooms/*/resume-requests/*');
      await second.page.reload();
      await waitWriteReady(second.page);
      await expect(bodyField(second.page)).toHaveValue('첫 기기에서 쓴 글');

      // 두 기기 모두 쓸 수 있다(병합).
      await typeAtEnd(second.page, ' 둘째 기기');
      await expect(bodyField(first.page)).toHaveValue('첫 기기에서 쓴 글 둘째 기기', { timeout: 10_000 });
    } finally {
      await closeAll(first.context, second.context, teacher?.context);
    }
  });

  test('이어 쓰기 요청이 둘이면 `모두 허용`으로 한 번에 연다', async ({ browser, request }) => {
    const room = await createRoomRest(request);
    const names = [nick('나래'), nick('새봄')];
    const owners: Device[] = [];
    const movers: Device[] = [];
    let teacher: Device | undefined;
    try {
      for (const name of names) {
        const owner = await newDevice(browser);
        owners.push(owner);
        await joinAsStudent(owner.page, room, name);
        await typeAtEnd(owner.page, `${name}의 글`);
        await waitSaved(owner.page);
      }
      teacher = await openTeacherByLink(browser, room);
      for (const name of names) {
        const mover = await newDevice(browser);
        movers.push(mover);
        await mover.page.goto(`/${room.entryCode}`);
        await agreeOnRoomCard(mover.page);
        await mover.page.getByLabel(ko.student.nicknameLabel).fill(name);
        await mover.page.getByRole('button', { name: ko.common.next, exact: true }).click();
        await mover.page.getByRole('button', { name: ko.student.nicknameMineAction }).click();
        await expect(screen(mover.page, 'S6')).toHaveAttribute('data-status', 'waiting');
      }
      const approveAll = teacher.page.getByRole('button', { name: ko.teacher.resumeApproveAllAction });
      await expect(approveAll).toBeVisible({ timeout: 10_000 });
      await approveAll.click();
      for (const [i, mover] of movers.entries()) {
        await waitWriteReady(mover.page);
        await expect(bodyField(mover.page)).toHaveValue(`${names[i] ?? ''}의 글`);
      }
    } finally {
      await closeAll(...owners.map(d => d.context), ...movers.map(d => d.context), teacher?.context);
    }
  });

  test('필터·삭제 예정 띠: 제출한 학생만 골라 보고, 보관 기간 끝 무렵 띠가 보인다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    const writer = nick('여름');
    const submitter = nick('가을');
    const a = await newDevice(browser);
    const b = await newDevice(browser);
    let teacher: Device | undefined;
    try {
      await joinAsStudent(a.page, room, writer);
      await typeAtEnd(a.page, '아직 쓰는 중이에요');
      await joinAsStudent(b.page, room, submitter);
      await typeAtEnd(b.page, '다 썼어요');
      await waitSaved(b.page);
      await b.page.getByRole('button', { name: ko.student.submitButton, exact: true }).click();
      await b.page.getByRole('button', { name: ko.student.submitConfirmAction }).click();
      await expect(b.page.locator('[data-screen="S5"] [data-save-state]')).toHaveAttribute(
        'data-save-state',
        'locked',
        { timeout: 10_000 },
      );

      teacher = await openTeacherByLink(browser, room);
      const t = teacher.page;
      await expect(studentTile(t, writer)).toBeVisible();
      await expect(studentTile(t, submitter)).toHaveAttribute('data-status', 'submitted');
      await expect(t.locator('header').first()).toContainText(
        new RegExp(`${ko.teacher.submittedCountPrefix}\\s*1\\s*/\\s*2`),
      );

      const filters = t.getByRole('group', { name: ko.teacher.filterGroupLabel });
      await filters.getByRole('button', { name: new RegExp(`^${ko.teacher.statusSubmitted}`) }).click();
      await expect(studentTile(t, submitter)).toBeVisible();
      await expect(studentTile(t, writer)).toHaveCount(0);
      await filters.getByRole('button', { name: new RegExp(`^${ko.teacher.filterAll}`) }).click();
      await expect(studentTile(t, writer)).toBeVisible();

      // 시험 서버는 보관 기간이 2분이라 늘 "삭제 3일 전" 창 안이다(F-17·F-24 띠).
      await expect(t.getByText(ko.teacher.expiryWarningSuffix, { exact: false })).toBeVisible();
    } finally {
      await closeAll(a.context, b.context, teacher?.context);
    }
  });

  test('바로 보내기 알림이 학생에게 바로 보이고, 늦게 연결한 학생은 60초 안의 알림을 다시 본다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    const online = await newDevice(browser);
    const late = await newDevice(browser);
    let teacher: Device | undefined;
    try {
      await joinAsStudent(online.page, room, nick('이슬'));
      await joinAsStudent(late.page, room, nick('햇살'));
      teacher = await openTeacherByLink(browser, room);

      // 늦은 학생은 수업방 화면을 떠나 있다(홈으로 나가면 연결을 닫는다).
      await late.page.goto('/');
      await expect(screen(late.page, 'S0')).toBeVisible();

      await openNoticePanel(teacher.page);
      await teacher.page.getByRole('button', { name: ko.teacher.noticePresetPraise }).click();
      await expect(teacher.page.getByText(ko.teacher.noticeSentToast)).toBeVisible();
      await expect(studentNotice(online.page, ko.teacher.noticePresetPraise)).toBeVisible({ timeout: 5000 });

      // 60초 안에 다시 연결하면 최근 알림을 다시 본다(F-19 `NOTICE_REPLAY_SEC`).
      await late.page.goto(`/${room.entryCode}`);
      await waitWriteReady(late.page);
      await expect(studentNotice(late.page, ko.teacher.noticePresetPraise)).toBeVisible({ timeout: 5000 });
    } finally {
      await closeAll(online.context, late.context, teacher?.context);
    }
  });

  test('타이머: 학생 화면 시계가 새로고침해도 맞고, 1분 전 자동 알림이 온다', async ({
    browser,
    request,
  }, info) => {
    test.skip(info.project.name === 'chromium-360', '타이머는 엔진마다 대표 폭에서 한 번 돈다');
    test.setTimeout(150_000);
    const room = await createRoomRest(request);
    const student = await newDevice(browser);
    let teacher: Device | undefined;
    try {
      await joinAsStudent(student.page, room, nick('토끼'));
      teacher = await openTeacherByLink(browser, room);
      const started = Date.now();
      await startTimer(teacher.page, 2);
      await expect(student.page.locator('[data-screen="S5"] [role="timer"]')).toBeVisible({ timeout: 5000 });
      const before = await studentTimerSeconds(student.page);
      expect(before).toBeLessThanOrEqual(120);
      expect(before).toBeGreaterThanOrEqual(110);

      // 새로고침: 남은 시간이 서버 '끝나는 시각' 기준으로 그대로 이어진다.
      await student.page.reload();
      await waitWriteReady(student.page);
      await expect(student.page.locator('[data-screen="S5"] [role="timer"]')).toBeVisible();
      const elapsed = Math.round((Date.now() - started) / 1000);
      const after = await studentTimerSeconds(student.page);
      expect(Math.abs(after - (120 - elapsed))).toBeLessThanOrEqual(3);
      // 교사 화면도 새로고침 뒤 같은 시각
      await teacher.page.reload();
      await waitDashboardReady(teacher.page);

      // 끝나기 1분 전 알림(설정 TIMER_ALERTS_MIN 5·1 중 2분 타이머에 맞는 것은 1분 전)
      const oneMin = ko.teacher.noticePreset5Min.replace('5', '1');
      await expect(studentNotice(student.page, oneMin)).toBeVisible({ timeout: 75_000 });
      const at = Math.round((Date.now() - started) / 1000);
      expect(at).toBeGreaterThanOrEqual(55);
      expect(at).toBeLessThanOrEqual(70);
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });

  test('타이머가 끝나면 끝났을 때 문구가 자동으로 간다', async ({ browser, request }, info) => {
    test.skip(info.project.name === 'chromium-360', '타이머는 엔진마다 대표 폭에서 한 번 돈다');
    test.setTimeout(120_000);
    const room = await createRoomRest(request);
    const student = await newDevice(browser);
    let teacher: Device | undefined;
    try {
      await joinAsStudent(student.page, room, nick('가람'));
      teacher = await openTeacherByLink(browser, room);
      await startTimer(teacher.page, 1);
      await expect(student.page.locator('[data-screen="S5"] [role="timer"]')).toBeVisible({ timeout: 5000 });
      await expect(studentNotice(student.page, ko.teacher.timerEndDefaultText)).toBeVisible({
        timeout: 75_000,
      });
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });

  test('수업 중 글 종류를 끄면 고르는 중인 학생 화면에서 바로 사라진다', async ({ browser, request }) => {
    const room = await createRoomRest(request, { genres: ['story', 'poem', 'news'] });
    const student = await newDevice(browser);
    let teacher: Device | undefined;
    try {
      await student.page.goto(`/${room.entryCode}`);
      await agreeOnRoomCard(student.page);
      await enterNickname(student.page, nick('소라'));
      await expect(screen(student.page, 'S4')).toBeVisible();
      await expect(genreTile(student.page, 'news')).toBeVisible();

      teacher = await openTeacherByLink(browser, room);
      await teacherMenu(teacher.page, ko.teacher.roomSettingsTitle);
      await teacher.page.getByRole('checkbox', { name: ko.student.genreNewsLabel, exact: true }).click();
      await expect(genreTile(student.page, 'news')).toHaveCount(0, { timeout: 5000 });
      await expect(genreTile(student.page, 'poem')).toBeVisible();
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });

  test('모두 내려받기 zip에 학생별 파일과 전체모음이 들어 있다', async ({
    browser,
    browserName,
    request,
  }) => {
    const room = await createRoomRest(request, { title: '내려받기 수업' });
    const names = [nick('누리'), nick('두레')];
    const students: Device[] = [];
    let teacher: Device | undefined;
    try {
      for (const name of names) {
        const s = await newDevice(browser);
        students.push(s);
        await joinAsStudent(s.page, room, name);
        await typeAtEnd(s.page, `${name}가 쓴 본문입니다.`);
        await waitSaved(s.page);
      }
      teacher = await openTeacherByLink(browser, room);
      for (const name of names) await expect(studentTile(teacher.page, name)).toBeVisible();
      await teacher.page
        .getByRole('button', { name: ko.teacher.downloadButton, exact: true })
        .first()
        .click();
      await expect(teacher.page.getByText(ko.teacher.exportSheetTitle)).toBeVisible();
      const downloadPromise = teacher.page.waitForEvent('download');
      await teacher.page
        .getByRole('button', { name: new RegExp(`^${ko.teacher.exportAllDocsAction}`) })
        .click();
      const download = await downloadPromise;
      // Linux WebKit은 download 속성의 공백을 밑줄로 바꾼다. 이름·구분자·날짜·확장자는 그대로 검사한다.
      const filenamePattern =
        browserName === 'webkit'
          ? /^내려받기[ _]수업_5학년[ _]3반_\d{8}\.zip$/
          : /^내려받기 수업_5학년 3반_\d{8}\.zip$/;
      expect(download.suggestedFilename()).toMatch(filenamePattern);
      const path = await download.path();
      const entries = readZip(await readFile(path));
      const fileNames = entries.map(e => e.name);
      for (const name of names) {
        const file = entries.find(e => e.name.startsWith(`${name}_`) && e.name.endsWith('.txt'));
        expect(file, fileNames.join(', ')).toBeTruthy();
        expect(file?.text).toContain(`${name}가 쓴 본문입니다.`);
      }
      const summary = entries.find(e => e.name === `${ko.teacher.exportSummaryFileBase}.md`);
      expect(summary, fileNames.join(', ')).toBeTruthy();
      for (const name of names) {
        expect(summary?.text).toContain(name);
        expect(summary?.text).toContain(`${name}가 쓴 본문입니다.`);
      }
    } finally {
      await closeAll(...students.map(s => s.context), teacher?.context);
    }
  });

  test('수업 준비 화면의 연결 점검이 10초 안에 결과를 보여 준다', async ({ browser, request }) => {
    const room = await createRoomRest(request);
    let teacher: Device | undefined;
    try {
      teacher = await openTeacherByLink(browser, room);
      await teacher.page.goto(`/t/room/${room.roomId}/prep`);
      await expect(teacher.page.getByRole('heading', { name: ko.teacher.prepHeading })).toBeVisible();
      const started = Date.now();
      await teacher.page.getByRole('button', { name: ko.teacher.connectionCheckAction }).click();
      await expect(teacher.page.getByTestId('check-all-good')).toBeVisible({ timeout: 10_000 });
      expect(Date.now() - started).toBeLessThanOrEqual(10_000);
      await expect(teacher.page.locator('li[data-state="ok"]')).toHaveCount(3);
    } finally {
      await closeAll(teacher?.context);
    }
  });

  test('교사가 서랍에서 고친 글이 학생 화면에 보인다', async ({ browser, request }) => {
    const room = await createRoomRest(request);
    const nickname = nick('마루');
    const student = await newDevice(browser);
    let teacher: Device | undefined;
    try {
      await joinAsStudent(student.page, room, nickname);
      await typeAtEnd(student.page, '학생 글');
      await waitSaved(student.page);
      teacher = await openTeacherByLink(browser, room);
      const drawer = await openDrawer(teacher.page, nickname);
      await expect(drawer).toHaveValue('학생 글');
      await drawer.click();
      await drawer.evaluate(el => {
        const t = el as HTMLTextAreaElement;
        t.setSelectionRange(t.value.length, t.value.length);
      });
      await teacher.page.keyboard.insertText(' 선생님 한마디');
      await expect(bodyField(student.page)).toHaveValue('학생 글 선생님 한마디', { timeout: 5000 });
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });
});
