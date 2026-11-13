import { expect, test, type Page } from '@playwright/test';
import { E2E_LAYOUT_WIDTHS } from './constants.ts';
import {
  agreeOnRoomCard,
  bodyField,
  closeAll,
  createRoomRest,
  enterNickname,
  joinAsStudent,
  ko,
  newDevice,
  nick,
  openDrawer,
  openTeacherByLink,
  screen,
  typeAtEnd,
  waitDashboardReady,
  waitSaved,
  warmServiceWorker,
} from './flows.ts';

/**
 * 배치(PRD 16.5, PLAN §10.5 `layout.spec.ts`). 폭 360·768·1024·1280에서 주요 화면이 가로로 넘치지 않는지,
 * 화면 키보드가 올라왔을 때(visualViewport 흉내) 쓰기 화면 하단 바와 쓰던 줄이 키보드 위에 있는지 본다.
 * 스스로 여러 폭을 돌므로 엔진마다 한 번 돈다(`playwright.config.ts`에서 Chromium 360만 제외).
 */

const HEIGHT_FOR: Record<number, number> = { 360: 740, 768: 1024, 1024: 768, 1280: 800 };

interface Overflow {
  readonly viewport: number;
  readonly scrollWidth: number;
  /** 화면 밖으로 삐져나간 요소(넘침을 잘라 주는 조상 안에 든 것은 뺀다) */
  readonly offenders: readonly string[];
}

/** 가로 넘침 측정. 문서 폭과, 보이는 요소 하나하나의 오른쪽·왼쪽 끝을 함께 본다. */
async function measureOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const clipped = (el: Element): boolean => {
      for (
        let p = el.parentElement;
        p && p !== document.body && p !== document.documentElement;
        p = p.parentElement
      ) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'visible') return true;
      }
      return false;
    };
    const describe = (el: Element): string => {
      const r = el.getBoundingClientRect();
      const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
      const text = (el.textContent ?? '').trim().slice(0, 20);
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}[${Math.round(r.left)}..${Math.round(r.right)}] "${text}"`;
    };
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue; // 화면 낭독기 전용(1px) 요소
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'contents') continue;
      if (r.right > viewport + 1 || r.left < -1) {
        if (clipped(el)) continue;
        offenders.push(describe(el));
      }
    }
    return { viewport, scrollWidth, offenders: offenders.slice(0, 8) };
  });
}

/** 지금 화면을 네 폭에서 재 보고 넘침이 없음을 확인한다. */
async function expectNoOverflowAtAllWidths(page: Page, label: string): Promise<void> {
  for (const width of E2E_LAYOUT_WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT_FOR[width] ?? 800 });
    // 폭이 바뀐 뒤 배치가 다시 잡힐 때까지(문서 폭이 새 폭을 따라올 때까지)
    await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(width);
    const m = await measureOverflow(page);
    expect.soft(m.scrollWidth, `${label} @${width}px 문서 폭`).toBeLessThanOrEqual(m.viewport);
    expect.soft(m.offenders, `${label} @${width}px 화면 밖 요소`).toEqual([]);
  }
}

test.describe('배치 (PRD 16.5)', () => {
  test('학생 화면(홈·수업 카드·별명·글 종류·쓰기)이 360~1280에서 가로로 넘치지 않는다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request, {
      genres: ['story', 'poem', 'lyrics', 'news', 'essay', 'other'],
      className: '5학년 3반 무지개반',
      title: '비 오는 날 이야기 쓰기 아주 긴 수업 이름',
    });
    const { context, page } = await newDevice(browser, { width: 360, height: 740 });
    try {
      // 앱을 한 번 연 기기(처음 열 때 서비스 워커가 화면을 다시 불러오는 일은 teacher.spec이 따로 본다)
      await warmServiceWorker(page);
      await page.goto('/');
      await expect(screen(page, 'S0')).toBeVisible();
      await expectNoOverflowAtAllWidths(page, 'S0 홈');

      await page.goto(`/${room.entryCode}`);
      await expect(screen(page, 'S1')).toBeVisible();
      await expectNoOverflowAtAllWidths(page, 'S1 수업 카드');
      await agreeOnRoomCard(page);

      await expect(screen(page, 'S3')).toBeVisible();
      await expectNoOverflowAtAllWidths(page, 'S3 별명');
      await enterNickname(page, nick('가나다라마바사아자'));

      await expect(screen(page, 'S4')).toBeVisible();
      await expectNoOverflowAtAllWidths(page, 'S4 글 종류');
      await page
        .locator('[data-screen="S4"] button[aria-pressed]')
        .filter({ has: page.getByText(ko.student.genrePoemLabel, { exact: true }) })
        .click();

      await expect(screen(page, 'S5')).toBeVisible({ timeout: 15_000 });
      await waitSaved(page, 15_000);
      // 띄어쓰기 없이 긴 글도 쓰기 칸 안에서 줄을 바꾼다.
      await typeAtEnd(page, '가'.repeat(120));
      await expectNoOverflowAtAllWidths(page, 'S5 쓰기');
    } finally {
      await closeAll(context);
    }
  });

  test('교사 화면(홈·만들기·PIN·준비·대시보드·서랍)이 360~1280에서 가로로 넘치지 않는다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request, { title: '아주 긴 수업방 이름으로 넘침을 시험해요' });
    const nickname = nick('넘침');
    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      await warmServiceWorker(student.page);
      await joinAsStudent(student.page, room, nickname);
      await typeAtEnd(student.page, '선생님 서랍에서 볼 글이에요.');
      await waitSaved(student.page);

      teacher = await openTeacherByLink(browser, room);
      const t = teacher.page;
      await expectNoOverflowAtAllWidths(t, 'T3 대시보드');

      await t.setViewportSize({ width: 1280, height: 800 });
      await openDrawer(t, nickname);
      await expectNoOverflowAtAllWidths(t, 'T4 서랍');

      await t.goto(`/t/room/${room.roomId}/prep`);
      await expect(t.getByRole('heading', { name: ko.teacher.prepHeading })).toBeVisible();
      await expectNoOverflowAtAllWidths(t, 'T2 수업 준비');

      await t.goto('/t');
      await expect(t.getByText(ko.teacher.homeHeading)).toBeVisible();
      await expectNoOverflowAtAllWidths(t, 'T0 선생님 홈');

      await t.goto('/t/new');
      await expect(t.getByRole('heading', { name: ko.teacher.createRoomHeading })).toBeVisible();
      await expectNoOverflowAtAllWidths(t, 'T1 수업방 만들기');

      await t.goto('/t/pin');
      await expect(t.getByRole('heading', { name: ko.teacher.pinEnterHeading })).toBeVisible();
      await expectNoOverflowAtAllWidths(t, 'T5 PIN');

      // 대시보드로 돌아와도(기기가 기억) 문제없다.
      await t.goto(`/t/room/${room.roomId}`);
      await waitDashboardReady(t);
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });

  test('화면 키보드가 올라오면(visualViewport 흉내) 하단 바와 쓰던 줄이 키보드 위에 있다', async ({
    browser,
    request,
  }) => {
    const KEYBOARD = 300;
    const room = await createRoomRest(request);
    const { context, page } = await newDevice(browser, { width: 360, height: 740 });
    // 데스크톱 자동화에는 화면 키보드가 없어 visualViewport를 흉내 낸다(앱은 높이·offsetTop·resize만 쓴다).
    await context.addInitScript(() => {
      const fake = new EventTarget() as EventTarget & Record<string, number>;
      let kb = 0;
      Object.defineProperties(fake, {
        height: { get: () => window.innerHeight - kb },
        width: { get: () => window.innerWidth },
        offsetTop: { get: () => 0 },
        offsetLeft: { get: () => 0 },
        pageTop: { get: () => window.scrollY },
        pageLeft: { get: () => window.scrollX },
        scale: { get: () => 1 },
      });
      Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
      Object.defineProperty(window, '__setKeyboard', {
        value: (px: number) => {
          kb = px;
          fake.dispatchEvent(new Event('resize'));
        },
      });
    });
    try {
      await warmServiceWorker(page);
      await joinAsStudent(page, room, nick('자판'));
      const lines = Array.from({ length: 30 }, (_, i) => `${i + 1}번째 줄을 쓰고 있어요.`).join('\n');
      await typeAtEnd(page, lines);
      await waitSaved(page);

      const dock = page.locator('[data-screen="S5"] footer').last();
      const submit = page.getByRole('button', { name: ko.student.submitButton, exact: true });
      await expect(dock).toBeVisible();
      const innerHeight = await page.evaluate(() => window.innerHeight);
      const dockBox0 = await dock.boundingBox();
      expect(Math.round((dockBox0?.y ?? 0) + (dockBox0?.height ?? 0))).toBeLessThanOrEqual(innerHeight);

      await page.evaluate(
        px => (window as unknown as { __setKeyboard: (n: number) => void }).__setKeyboard(px),
        KEYBOARD,
      );
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--kb-offset').trim(),
          ),
        )
        .toBe(`${KEYBOARD}px`);

      const keyboardTop = innerHeight - KEYBOARD;
      // 하단 바 전체와 제출 단추가 키보드 위에 있다.
      await expect
        .poll(async () => {
          const b = await dock.boundingBox();
          return b ? Math.round(b.y + b.height) : Number.NaN;
        })
        .toBeLessThanOrEqual(keyboardTop);
      const dockBox = await dock.boundingBox();
      expect(dockBox?.y ?? -1).toBeGreaterThanOrEqual(0);
      const submitBox = await submit.boundingBox();
      expect((submitBox?.y ?? 0) + (submitBox?.height ?? 0)).toBeLessThanOrEqual(keyboardTop);

      // 쓰던 줄(본문 끝, 커서 자리): 끝까지 내리면 하단 바 위로 올라온다(쓰기 칸 아래 여백이 키보드만큼 늘어남).
      await bodyField(page).evaluate(el => {
        const t = el as HTMLTextAreaElement;
        t.focus();
        t.setSelectionRange(t.value.length, t.value.length);
      });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect
        .poll(async () => {
          const field = await bodyField(page).boundingBox();
          const d = await dock.boundingBox();
          if (!field || !d) return Number.NaN;
          // 본문 칸의 아래 끝(마지막 줄)과 하단 바 위 끝의 차이: 0 이상이면 가려지지 않는다.
          return Math.round(d.y - (field.y + field.height));
        })
        .toBeGreaterThanOrEqual(0);

      // 키보드가 내려가면 하단 바가 다시 화면 아래로 간다.
      await page.evaluate(() =>
        (window as unknown as { __setKeyboard: (n: number) => void }).__setKeyboard(0),
      );
      await expect
        .poll(async () => {
          const b = await dock.boundingBox();
          return b ? Math.round(b.y + b.height) : Number.NaN;
        })
        .toBe(innerHeight);
    } finally {
      await closeAll(context);
    }
  });
});
