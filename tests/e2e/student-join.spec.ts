import { expect, test } from '@playwright/test';
import { setConsentVersion } from './db.ts';
import {
  agreeOnRoomCard,
  closeAll,
  createRoomRest,
  enterNickname,
  genreTile,
  joinAsStudent,
  ko,
  newDevice,
  nick,
  pickGenre,
  screen,
  typeAtEnd,
  waitSaved,
  waitWriteReady,
} from './flows.ts';

/**
 * 학생 입장(PRD 16.1, F-01·F-02·F-03·F-05·F-09, PLAN §10.5 `student-join.spec.ts`).
 * 각 시험은 수업방을 REST로 새로 만들고 새 브라우저 컨텍스트(새 기기)에서 화면으로 들어온다.
 */

const ALL_GENRES = ['story', 'poem', 'lyrics', 'news', 'essay', 'other'] as const;

const SUBTITLE: Record<(typeof ALL_GENRES)[number], string> = {
  story: ko.student.genreStorySubtitle,
  poem: ko.student.genrePoemSubtitle,
  lyrics: ko.student.genreLyricsSubtitle,
  news: ko.student.genreNewsSubtitle,
  essay: ko.student.genreEssaySubtitle,
  other: ko.student.genreOtherSubtitle,
};

test.describe('학생 입장 (PRD 16.1 · F-01~F-05 · F-09)', () => {
  test('QR 주소로 처음 들어오면 수업 카드+동의 → 별명 → 글 종류, 세 화면 뒤 쓰기 화면이다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request, {
      genres: ALL_GENRES,
      schoolName: '하늘초등학교',
      showSchool: false,
    });
    const { context, page } = await newDevice(browser);
    try {
      const seen: string[] = [];
      const record = async () => {
        const id = await page
          .locator('[data-screen]:not([data-screen="loading"])')
          .first()
          .getAttribute('data-screen');
        if (id && seen.at(-1) !== id) seen.push(id);
      };

      await page.goto(`/${room.entryCode}`);
      await expect(screen(page, 'S1')).toBeVisible();
      await record();
      // 학급명·수업명만 보이고, 학교명은 교사가 켜지 않았으니 보이지 않는다(F-02).
      await expect(page.getByRole('heading', { name: room.className })).toBeVisible();
      await expect(page.getByText(room.title, { exact: true })).toBeVisible();
      await expect(page.getByText('하늘초등학교')).toHaveCount(0);
      // 동의 전에는 시작할 수 없다(F-03).
      await expect(page.getByRole('button', { name: ko.student.consentStartAction })).toBeDisabled();

      await agreeOnRoomCard(page);
      await expect(screen(page, 'S3')).toBeVisible();
      await record();
      await enterNickname(page, nick('하늘'));

      await expect(screen(page, 'S4')).toBeVisible();
      await record();
      // 글 종류 타일마다 하위 종류가 글자로 보인다(16.1).
      for (const genre of ALL_GENRES) {
        await expect(genreTile(page, genre).getByTestId('genre-tile-subtitle')).toHaveText(SUBTITLE[genre]);
      }
      await pickGenre(page, 'poem');
      await waitWriteReady(page);
      await record();

      expect(seen).toEqual(['S1', 'S3', 'S4', 'S5']);
    } finally {
      await closeAll(context);
    }
  });

  test('교사가 학교명 보이기를 켜면 수업 카드에 학교명이 보인다', async ({ browser, request }) => {
    const room = await createRoomRest(request, { schoolName: '바다초등학교', showSchool: true });
    const { context, page } = await newDevice(browser);
    try {
      await page.goto(`/${room.entryCode}`);
      await expect(screen(page, 'S1')).toBeVisible();
      await expect(page.getByText('바다초등학교', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: room.className })).toBeVisible();
    } finally {
      await closeAll(context);
    }
  });

  test('켠 글 종류가 하나면 글 종류 화면을 건너뛴다', async ({ browser, request }) => {
    const room = await createRoomRest(request, { genres: ['news'] });
    const { context, page } = await newDevice(browser);
    try {
      await page.goto(`/${room.entryCode}`);
      await agreeOnRoomCard(page);
      await enterNickname(page, nick('바람'));
      await waitWriteReady(page);
      await expect(screen(page, 'S4')).toHaveCount(0);
    } finally {
      await closeAll(context);
    }
  });

  test('같은 기기로 다시 들어오면 정책 판이 같을 때 동의를 건너뛰고, 바뀌었으면 다시 동의한다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    const nickname = nick('솜사');
    const { context, page } = await newDevice(browser);
    try {
      await joinAsStudent(page, room, nickname);
      await typeAtEnd(page, '첫 줄을 썼어요.');
      await waitSaved(page);

      // 1) 정책 판이 같으면 카드 없이 바로 쓰던 글로(F-03 "같으면 건너뛰기").
      await page.goto('/');
      await expect(screen(page, 'S0')).toBeVisible();
      await page.goto(`/${room.entryCode}`);
      await waitWriteReady(page);
      await expect(page.getByRole('textbox', { name: ko.student.bodyAriaLabel })).toHaveValue(
        '첫 줄을 썼어요.',
      );

      // 2) 정책 판이 올라간 상황(서버의 이 학생 동의 판을 옛 값으로) → 다시 동의(S2 = S1 화면)를 거친다.
      await page.goto('/');
      await expect(screen(page, 'S0')).toBeVisible();
      expect(setConsentVersion(room.roomId, nickname, '2000-01-v0')).toBe(1);
      await page.goto(`/${room.entryCode}`);
      await expect(screen(page, 'S1')).toBeVisible({ timeout: 15_000 });
      await agreeOnRoomCard(page);
      await waitWriteReady(page);
      await expect(page.getByRole('textbox', { name: ko.student.bodyAriaLabel })).toHaveValue(
        '첫 줄을 썼어요.',
      );

      // 3) 다시 동의한 뒤에는 또 건너뛴다.
      await page.goto('/');
      await page.goto(`/${room.entryCode}`);
      await waitWriteReady(page);
      await expect(screen(page, 'S1')).toHaveCount(0);
    } finally {
      await closeAll(context);
    }
  });

  test('홈: 이어 쓰기 카드가 주요 버튼이고, 홈 화면 추가 안내는 한 번만 보인다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    const nickname = nick('구름');
    const { context, page } = await newDevice(browser);
    try {
      // 처음 기기: 이어 쓰기 카드 없음 → `글 쓰러 가기`가 주요 버튼, 안내도 없다.
      await page.goto('/');
      await expect(screen(page, 'S0')).toBeVisible();
      const start = page.getByRole('button', { name: ko.student.homeStartWrite });
      await expect(start).toHaveAttribute('data-variant', 'primary');
      await expect(page.getByRole('button', { name: ko.student.homeResumeAction })).toHaveCount(0);
      await expect(page.getByText(ko.student.addToHomeTitle)).toHaveCount(0);

      const docId = await joinAsStudent(page, room, nickname);
      await typeAtEnd(page, '이어 쓸 글이에요.');
      await waitSaved(page);

      await page.goto('/');
      await expect(screen(page, 'S0')).toBeVisible();
      const resume = page.getByRole('button', { name: ko.student.homeResumeAction, exact: true }).first();
      await expect(resume).toBeVisible();
      await expect(resume).toHaveAttribute('data-variant', 'primary');
      await expect(start).toHaveAttribute('data-variant', 'secondary');
      await expect(page.locator('[data-screen="S0"] button[data-variant="primary"]:visible')).toHaveCount(1);
      await expect(page.getByText(`${room.className} · ${room.title}`)).toBeVisible();
      await expect(page.getByText(nickname)).toBeVisible();
      // 홈 화면 추가 안내: 수업방에 들어간 기기에 한 번(F-09)
      await expect(page.getByText(ko.student.addToHomeTitle)).toBeVisible();

      await page.reload();
      await expect(screen(page, 'S0')).toBeVisible();
      await expect(
        page.getByRole('button', { name: ko.student.homeResumeAction, exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText(ko.student.addToHomeTitle)).toHaveCount(0);

      // 이어 쓰기를 누르면 마지막 글로 바로 간다.
      await page.getByRole('button', { name: ko.student.homeResumeAction, exact: true }).first().click();
      await waitWriteReady(page);
      expect(page.url()).toContain(`/write/${docId}`);
      await expect(page.getByRole('textbox', { name: ko.student.bodyAriaLabel })).toHaveValue(
        '이어 쓸 글이에요.',
      );
    } finally {
      await closeAll(context);
    }
  });

  test('홈의 `글 쓰러 가기`에서 입장 코드 여섯 자리를 누르면 그 수업 카드로 간다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    const { context, page } = await newDevice(browser);
    try {
      await page.goto('/');
      await page.getByRole('button', { name: ko.student.homeStartWrite }).click();
      await expect(page.getByText(ko.student.codeSheetTitle)).toBeVisible();
      for (const digit of room.entryCode) {
        await page.getByRole('button', { name: digit, exact: true }).click();
      }
      await expect(screen(page, 'S1')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/${room.entryCode}$`));
      await expect(page.getByRole('heading', { name: room.className })).toBeVisible();
    } finally {
      await closeAll(context);
    }
  });
});
