import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { E2E_DESKTOP_VIEWPORT, E2E_PHONE_VIEWPORT } from './constants.ts';
import {
  agreeOnRoomCard,
  closeAll,
  createRoomRest,
  enterNickname,
  genreTile,
  ko,
  newDevice,
  nick,
  openDrawer,
  openNoticePanel,
  openTeacherByLink,
  screen,
  studentMenu,
  teacherMenu,
  typeAtEnd,
  waitSaved,
  waitWriteReady,
  warmServiceWorker,
} from './flows.ts';

/**
 * 디자인 규칙(PRD 16.1·16.7, 7.1·8.4·8.5·8.8·8.10, PLAN §10.5 `design.spec.ts`). 프로젝트 폭(360·1280)에서 돈다.
 * 화면 하나하나(열린 메뉴·시트·대화상자 포함)에서 다음을 잰다:
 * - 채운 주요 버튼 수(PRD 7.1 표: 화면마다 하나, 대시보드·기다림 화면은 없음)
 * - 모서리(PRD 8.4): 큰 패널·시트·팝오버 22px 이상, 작은 요소 12px 이상, 알약형은 통과
 * - 브라우저 기본 `select` 없음(PRD 8.4·8.10)
 * - 8.10 자동 검사 가능한 것: 이모지, 순검정, 유리 효과(`backdrop-filter`), 공책 줄 밖 그라데이션
 * - 글꼴 토큰(PRD 8.5): `--font-sans` 하나를 바꾸면 화면 글자가 모두 그 글꼴이 된다
 * 첫 화면 그림 무게(PRD 8.8)는 새 컨텍스트로 360·1280에서 따로 잰다.
 */

/** PRD 8.8: 첫 화면 그림·질감 합계 상한 */
const FIRST_SCREEN_ART_BUDGET_BYTES = 80 * 1024;
/** 큰 패널 판정(이보다 크면 큰 카드·패널) */
const LARGE_MIN_W = 240;
const LARGE_MIN_H = 160;
/** 이보다 작은 표시(점·체크 표시 안쪽 등)는 모서리 규칙 밖 */
const TINY_PX = 24;

interface DesignScan {
  readonly primaryNames: readonly string[];
  /** 열린 대화상자·시트(주요 버튼을 셀 범위를 정한 근거) */
  readonly layers: readonly string[];
  readonly radiusViolations: readonly string[];
  readonly selects: number;
  readonly forbidden: readonly string[];
}

/**
 * 지금 화면을 훑는다. 모달 대화상자가 열려 있으면 주요 버튼은 맨 위 대화상자 안에서만 센다(뒤 화면은 가려져 누를 수 없다).
 */
async function scanDesign(page: Page): Promise<DesignScan> {
  return page.evaluate(
    ({ LARGE_MIN_W, LARGE_MIN_H, TINY_PX }) => {
      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        const s = getComputedStyle(el);
        // 화면 아래로 스크롤해야 보이는 것도 그 화면의 요소다(뷰포트 안만 보지 않는다).
        return s.visibility !== 'hidden' && Number(s.opacity) !== 0;
      };
      const describe = (el: Element): string => {
        const cls = typeof el.className === 'string' ? (el.className.split(' ')[0] ?? '') : '';
        const role = el.getAttribute('role');
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 16);
        return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${role ? `[role=${role}]` : ''} "${text}"`;
      };
      // --primary 실제 색(rgb)
      const probe = document.createElement('div');
      probe.style.background = 'var(--primary)';
      document.body.append(probe);
      const primaryRgb = getComputedStyle(probe).backgroundColor;
      probe.remove();

      // ── 주요 버튼 ──
      // 여는 움직임 동안 대화상자 자체는 투명도가 0에서 시작하므로 크기·visibility로만 본다.
      const present = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1 && getComputedStyle(el).visibility !== 'hidden';
      };
      const dialogs = Array.from(
        document.querySelectorAll('[role="dialog"][aria-modal="true"], [data-modal="true"], dialog[open]'),
      ).filter(present);
      const scope: ParentNode = dialogs.at(-1) ?? document;
      const clickables = Array.from(scope.querySelectorAll('button, a[href], [role="button"]')).filter(
        visible,
      );
      const primaries = clickables.filter(
        el =>
          el.getAttribute('data-variant') === 'primary' ||
          (getComputedStyle(el).backgroundColor === primaryRgb && el.getAttribute('aria-pressed') === null),
      );
      const primaryNames = primaries.map(
        el =>
          (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ') || describe(el),
      );

      // ── 모서리·금지 목록 ──
      const radiusViolations: string[] = [];
      const forbidden: string[] = [];
      const px = (v: string): number => {
        const first = v.trim().split(/\s+/)[0] ?? '0';
        return first.endsWith('%') ? Number.POSITIVE_INFINITY : Number.parseFloat(first) || 0;
      };
      const transparent = (c: string) => c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
      const isBlack = (c: string) => /^rgba?\(0,\s*0,\s*0(,\s*1)?\)$/.test(c);
      const panelRoles = new Set(['dialog', 'alertdialog', 'menu', 'listbox']);
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (!visible(el)) continue;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const borderW = ['Top', 'Right', 'Bottom', 'Left'].map(
          side => Number.parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0,
        );
        const hasBorder = borderW.some(w => w > 0) && !transparent(s.borderTopColor);
        const boxed = !transparent(s.backgroundColor) || hasBorder || s.boxShadow !== 'none';
        const radii = [
          px(s.borderTopLeftRadius),
          px(s.borderTopRightRadius),
          px(s.borderBottomRightRadius),
          px(s.borderBottomLeftRadius),
        ];
        const role = el.getAttribute('role') ?? '';
        const isPanel = panelRoles.has(role) || el.tagName === 'DIALOG';
        // 입력칸(쓰기 칸·서랍 본문 칸을 감싼 틀 포함)은 크기와 관계없이 작은 요소 규칙(12px)이다.
        const field =
          el.matches('input, textarea, [contenteditable="true"]') ||
          el.querySelector('textarea, input') !== null;
        const short = Math.min(r.width, r.height);
        const pill = radii.every(v => v === 0 || v >= short / 2 - 1);
        if (isPanel && boxed) {
          const nonZero = radii.filter(v => v > 0);
          if (nonZero.length === 0 || nonZero.some(v => v < 22)) {
            radiusViolations.push(`패널 ${describe(el)} 모서리 ${radii.join('/')}`);
          }
        } else if (boxed && radii.some(v => v > 0) && short >= TINY_PX && !pill) {
          const large = !field && r.width >= LARGE_MIN_W && r.height >= LARGE_MIN_H;
          // 큰 카드는 22px 이상, 그 밖에는 12px 고정 또는 카드 모서리(22px 이상) — 그 사이 값이나 12 미만은 규칙 밖
          const bad = radii.some(v => v > 0 && (large ? v < 22 : v < 12 || (v > 12 && v < 22)));
          if (bad) {
            radiusViolations.push(
              `${large ? '큰' : '작은'} ${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)} 모서리 ${radii.join('/')}`,
            );
          }
        }
        // 8.10: 유리 효과, 공책 줄 밖 그라데이션, 순검정
        if (s.backdropFilter && s.backdropFilter !== 'none') forbidden.push(`유리 효과 ${describe(el)}`);
        if (
          /gradient\(/.test(s.backgroundImage) &&
          !el.closest('[data-notebook], textarea, [class*="notebook" i]')
        ) {
          forbidden.push(`그라데이션 ${describe(el)}`);
        }
        if (isBlack(s.color) && (el.textContent ?? '').trim()) forbidden.push(`순검정 글자 ${describe(el)}`);
        if (isBlack(s.backgroundColor)) forbidden.push(`순검정 바탕 ${describe(el)}`);
        if (hasBorder && isBlack(s.borderTopColor)) forbidden.push(`순검정 테두리 ${describe(el)}`);
      }
      const emoji = /\p{Extended_Pictographic}/u.exec(document.body.innerText);
      if (emoji) forbidden.push(`이모지 "${emoji[0]}"`);

      return {
        primaryNames,
        layers: Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog')).map(
          el =>
            `${el.getAttribute('role') ?? el.tagName.toLowerCase()} modal=${el.getAttribute('aria-modal') ?? el.getAttribute('data-modal') ?? '-'} 보임=${present(el)}`,
        ),
        radiusViolations: radiusViolations.slice(0, 10),
        selects: document.querySelectorAll('select').length,
        forbidden: forbidden.slice(0, 10),
      };
    },
    { LARGE_MIN_W, LARGE_MIN_H, TINY_PX },
  );
}

/**
 * `--font-sans`를 시험 글꼴로 바꾼 기기에서, 보이는 글자가 있는 요소와 입력칸이 모두 그 글꼴을 쓰는지 본다.
 * 그 글꼴을 쓰지 않는 요소 설명을 돌려준다.
 */
const FONT_PROBE = 'E2E Font Probe';

/** 앱이 뜨기 전에 `--font-sans` 하나만 시험 글꼴로 바꿔 둔다(토큰 말고는 아무것도 건드리지 않는다). */
async function overrideFontToken(context: BrowserContext): Promise<void> {
  // 문서가 만들어지기 전에 도는 초기 스크립트라 요소 대신 문서에 붙는 스타일 시트로 토큰 값 하나만 덮는다.
  await context.addInitScript(probe => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`:root { --font-sans: "${probe}", monospace !important; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, FONT_PROBE);
}

async function elementsIgnoringFontToken(page: Page): Promise<string[]> {
  return page.evaluate(PROBE => {
    {
      const misses: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (el.closest('svg')) continue; // 아이콘 그림
        const formField = el.matches('input, textarea, button, select');
        const ownText = Array.from(el.childNodes).some(
          n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
        );
        if (!formField && !ownText) continue;
        const family = getComputedStyle(el).fontFamily;
        if (!family.includes(PROBE)) {
          const cls = typeof el.className === 'string' ? (el.className.split(' ')[0] ?? '') : '';
          misses.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} → ${family.slice(0, 40)}`);
        }
      }
      return misses.slice(0, 10);
    }
  }, FONT_PROBE);
}

/**
 * 한 화면 상태를 검사한다. `primary`: 그 화면에 있어야 할 채운 주요 버튼 이름(PRD 7.1), `null`은 없어야 함,
 * `'atMostOne'`은 하나 이하(표가 조건부로 정한 화면).
 */
async function checkScreen(page: Page, label: string, primary: string | null | 'atMostOne'): Promise<void> {
  const scan = await scanDesign(page);
  if (primary === null) {
    expect.soft(scan.primaryNames, `${label}: 채운 주요 버튼 없음(PRD 7.1)`).toEqual([]);
  } else if (primary === 'atMostOne') {
    expect
      .soft(
        scan.primaryNames.length,
        `${label}: 채운 주요 버튼 하나 이하 ${scan.primaryNames.join(', ')} / 층 ${scan.layers.join('; ')}`,
      )
      .toBeLessThanOrEqual(1);
  } else {
    expect
      .soft(
        scan.primaryNames,
        `${label}: 채운 주요 버튼은 '${primary}' 하나(PRD 7.1) / 층 ${scan.layers.join('; ')}`,
      )
      .toEqual([primary]);
  }
  expect.soft(scan.radiusViolations, `${label}: 모서리(PRD 8.4)`).toEqual([]);
  expect.soft(scan.selects, `${label}: 기본 select 없음`).toBe(0);
  expect.soft(scan.forbidden, `${label}: 8.10 금지 목록`).toEqual([]);
  expect
    .soft(await elementsIgnoringFontToken(page), `${label}: --font-sans 토큰 하나로 글꼴이 바뀜`)
    .toEqual([]);
}

test.describe('디자인 규칙 (PRD 16.1 · 16.7)', () => {
  test('학생 화면마다 채운 주요 버튼 하나, 종이 카드 모서리, 기본 select 없음, 글꼴 토큰 하나', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request, { genres: ['story', 'poem', 'news'] });
    const { context, page } = await newDevice(browser);
    await overrideFontToken(context);
    try {
      // 앱을 한 번 연 기기(처음 열 때 서비스 워커가 화면을 다시 불러오는 것은 teacher.spec이 따로 본다)
      await warmServiceWorker(page);
      await page.goto('/');
      await expect(screen(page, 'S0')).toBeVisible();
      await checkScreen(page, 'S0 홈', ko.student.homeStartWrite);

      // 입장 코드 시트(홈 → 글 쓰러 가기)
      await page.getByRole('button', { name: ko.student.homeStartWrite }).click();
      await expect(page.getByText(ko.student.codeSheetTitle)).toBeVisible();
      await checkScreen(page, 'S0 입장 코드 시트', 'atMostOne');

      await page.goto(`/${room.entryCode}`);
      await expect(screen(page, 'S1')).toBeVisible();
      await checkScreen(page, 'S1 수업 카드', ko.student.consentStartAction);
      await agreeOnRoomCard(page);

      await expect(screen(page, 'S3')).toBeVisible();
      await checkScreen(page, 'S3 별명', ko.common.next);
      await enterNickname(page, nick('모양'));

      await expect(screen(page, 'S4')).toBeVisible();
      await checkScreen(page, 'S4 글 종류(고르기 전)', 'atMostOne');
      await genreTile(page, 'story').click();
      await expect(page.getByRole('button', { name: ko.student.genreStartAction })).toBeVisible();
      await checkScreen(page, 'S4 글 종류(이야기 고름)', ko.student.genreStartAction);
      await page.getByRole('button', { name: ko.student.genreStartAction }).click();

      await waitWriteReady(page);
      await typeAtEnd(page, '비가 와서 운동장에 나가면 안 되요. 교실에서 할수 있는 놀이를 했다.');
      await waitSaved(page);
      await checkScreen(page, 'S5 쓰기', ko.student.submitButton);

      // ··· 메뉴(드롭다운도 종이 카드)
      await page.locator('[data-screen="S5"]').getByRole('button', { name: ko.common.moreMenu }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await checkScreen(page, 'S5 ··· 메뉴', ko.student.submitButton);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);

      // 글벗 결과 패널(360은 시트, 1280은 옆 패널)
      await page.locator('[data-ai-button="FEEDBACK"]').click();
      await expect(page.locator('[data-result="FEEDBACK"]')).toHaveAttribute('data-status', 'ready', {
        timeout: 15_000,
      });
      await checkScreen(page, 'S5 글벗 결과', 'atMostOne');
      await page.getByRole('button', { name: ko.common.close, exact: true }).last().click();
      await expect(page.locator('[data-result="FEEDBACK"]')).toHaveCount(0);

      // 제출 확인 대화상자
      await page.getByRole('button', { name: ko.student.submitButton, exact: true }).click();
      await expect(page.getByRole('button', { name: ko.student.submitConfirmAction })).toBeVisible();
      await checkScreen(page, 'S5 제출 확인', ko.student.submitConfirmAction);
      await page.getByRole('button', { name: ko.student.submitKeepWritingAction, exact: true }).click();
      await expect(page.getByRole('button', { name: ko.student.submitConfirmAction })).toHaveCount(0);

      // 되감기 시트
      await studentMenu(page, ko.common.rewindTitle);
      await expect(page.getByRole('slider')).toBeVisible({ timeout: 10_000 });
      await checkScreen(page, 'S5 시간 되감기', 'atMostOne');
    } finally {
      await closeAll(context);
    }
  });

  test('교사 화면마다 채운 주요 버튼 규칙, 종이 카드 모서리, 기본 select 없음, 글꼴 토큰 하나', async ({
    browser,
    request,
  }, info) => {
    const viewport = info.project.use.viewport ?? E2E_DESKTOP_VIEWPORT;
    const room = await createRoomRest(request);
    const nickname = nick('서랍');
    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      await student.page.goto(`/${room.entryCode}`);
      await agreeOnRoomCard(student.page);
      await enterNickname(student.page, nickname);
      await waitWriteReady(student.page);
      await typeAtEnd(student.page, '선생님이 볼 글이에요.');
      await waitSaved(student.page);

      teacher = await openTeacherByLink(browser, room, viewport, { beforeOpen: overrideFontToken });
      const t = teacher.page;
      await checkScreen(t, 'T3 대시보드', null);

      await openNoticePanel(t);
      await checkScreen(t, 'T3 알림 팝오버', 'atMostOne');
      await t.keyboard.press('Escape');

      await teacherMenu(t, ko.teacher.roomSettingsTitle);
      await expect(t.getByRole('checkbox', { name: ko.student.genreStoryLabel, exact: true })).toBeVisible();
      await checkScreen(t, 'T3 수업방 설정', 'atMostOne');
      await t.keyboard.press('Escape');

      await t.getByRole('button', { name: ko.teacher.downloadButton, exact: true }).first().click();
      await expect(t.getByText(ko.teacher.exportSheetTitle)).toBeVisible();
      await checkScreen(t, 'T3 내려받기 시트', 'atMostOne');
      await t.keyboard.press('Escape');
      await expect(t.getByText(ko.teacher.exportSheetTitle)).toHaveCount(0);

      await openDrawer(t, nickname);
      await checkScreen(t, 'T4 서랍(쓰는 중인 글)', null);

      await t.goto(`/t/room/${room.roomId}/prep`);
      await expect(t.getByRole('heading', { name: ko.teacher.prepHeading })).toBeVisible();
      await checkScreen(t, 'T2 수업 준비', ko.teacher.goDashboardAction);

      await t.goto('/t');
      await expect(t.getByText(ko.teacher.homeHeading)).toBeVisible();
      await checkScreen(t, 'T0 선생님 홈', ko.teacher.createNewRoomAction);

      await t.goto('/t/new');
      await expect(t.getByRole('heading', { name: ko.teacher.createRoomHeading })).toBeVisible();
      await checkScreen(t, 'T1 수업방 만들기', ko.teacher.openRoomAction);

      await t.goto('/t/pin');
      await expect(t.getByRole('heading', { name: ko.teacher.pinEnterHeading })).toBeVisible();
      await checkScreen(t, 'T5 PIN', ko.teacher.pinEnterAction);
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });

  test('첫 화면(홈)의 그림·종이 결 합계가 80KB 이하다(360·1280, 새 기기)', async ({ browser }, info) => {
    test.skip(info.project.name === 'chromium-360', '두 폭을 스스로 재므로 엔진마다 한 번 돈다');
    for (const viewport of [E2E_PHONE_VIEWPORT, E2E_DESKTOP_VIEWPORT]) {
      const context = await browser.newContext({ viewport: { ...viewport } });
      try {
        const page = await context.newPage();
        const images: { url: string; bytes: number }[] = [];
        const pending: Promise<void>[] = [];
        page.on('response', response => {
          const req = response.request();
          const url = response.url();
          const isImage =
            req.resourceType() === 'image' || /\.(webp|png|svg|avif|jpe?g|gif)(\?|$)/i.test(url);
          if (!isImage || url.startsWith('data:')) return;
          pending.push(
            response
              .body()
              .then(b => {
                images.push({ url: new URL(url).pathname, bytes: b.length });
              })
              .catch(() => undefined),
          );
        });
        await page.goto('/');
        await expect(screen(page, 'S0')).toBeVisible();
        await page.waitForLoadState('networkidle');
        await Promise.all(pending);
        // 브라우저 탭 아이콘(파비콘·앱 아이콘)은 화면 그림이 아니다.
        const icons = await page.evaluate(() =>
          Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')).map(
            l => new URL((l as HTMLLinkElement).href).pathname,
          ),
        );
        const art = images.filter(i => !icons.includes(i.url) && i.url !== '/favicon.ico');
        const total = art.reduce((sum, i) => sum + i.bytes, 0);
        expect
          .soft(total, `${viewport.width}px 첫 화면 그림 ${art.map(i => `${i.url}=${i.bytes}`).join(', ')}`)
          .toBeLessThanOrEqual(FIRST_SCREEN_ART_BUDGET_BYTES);
      } finally {
        await context.close();
      }
    }
  });
});
