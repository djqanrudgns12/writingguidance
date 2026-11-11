import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { ko } from '../../packages/core/src/copy/ko.ts';
import { E2E_DESKTOP_VIEWPORT, E2E_START_CODE } from './constants.ts';

/**
 * 화면 시험(P4-15)이 함께 쓰는 흐름 도구. 수업방은 REST로 빨리 만들고(서버 시험 도구 `roomClient.ts`와 같은 모양),
 * 학생·교사는 서로 다른 브라우저 컨텍스트에서 실제 화면으로 움직인다. 화면 요소는 문구(`ko`)·역할·`data-*`로 찾는다.
 */

export { ko };

export type GenreKey = 'story' | 'poem' | 'lyrics' | 'news' | 'essay' | 'other';
export type AiButtonKey = 'SPELL' | 'FEEDBACK' | 'DIRECTION' | 'POLISH';

export interface RestRoom {
  readonly roomId: string;
  readonly entryCode: string;
  /** 선생님 링크 토큰(`/t/<토큰>`). 해시만 서버로 갔다. */
  readonly linkToken: string;
  readonly pin: string;
  readonly className: string;
  readonly title: string;
  readonly expiresAt: number;
}

export interface RoomOptions {
  readonly className?: string;
  readonly title?: string;
  readonly schoolName?: string;
  readonly showSchool?: boolean;
  readonly genres?: readonly GenreKey[];
  readonly aiButtons?: readonly AiButtonKey[];
  readonly pin?: string;
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');
/** 살아 있는 방 사이에서 겹치지 않을 8자리 PIN(첫 자리 1~9) */
export const randomPin = (): string => String(randomInt(10_000_000, 99_999_999));
/** 같은 실행에서 겹치지 않는 짧은 별명(한글 2자 + 숫자, `NICKNAME_MAX_LENGTH` 12 안) */
export const nick = (base: string): string => `${base}${randomInt(100, 999)}`;

export async function createRoomRest(
  request: APIRequestContext,
  options: RoomOptions = {},
): Promise<RestRoom> {
  const linkToken = newToken();
  const pin = options.pin ?? randomPin();
  const className = options.className ?? '5학년 3반';
  const title = options.title ?? `시험 수업 ${randomInt(1000, 9999)}`;
  const body = {
    className,
    title,
    ...(options.schoolName ? { schoolName: options.schoolName } : {}),
    showSchool: options.showSchool ?? false,
    genres: options.genres ?? ['story'],
    aiButtons: options.aiButtons ?? ['SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH'],
    pin,
    linkTokenHash: sha256Hex(linkToken),
    deviceId: randomUUID(),
    commandId: randomUUID(),
  };
  const res = await request.post('/api/rooms', {
    data: body,
    headers: { 'x-start-code': E2E_START_CODE },
  });
  const json = (await res.json()) as { data?: { roomId?: string; entryCode?: string; expiresAt?: number } };
  expect(res.status(), JSON.stringify(json)).toBe(200);
  const roomId = json.data?.roomId ?? '';
  const entryCode = json.data?.entryCode ?? '';
  expect(roomId).not.toBe('');
  expect(entryCode).toMatch(/^\d{6}$/);
  return { roomId, entryCode, linkToken, pin, className, title, expiresAt: json.data?.expiresAt ?? 0 };
}

/** 새 기기 하나(컨텍스트 + 페이지). 폭은 프로젝트 폭, `viewport`를 주면 그 폭. */
export async function newDevice(
  browser: Browser,
  viewport?: { readonly width: number; readonly height: number },
): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
  const context = await browser.newContext(viewport ? { viewport: { ...viewport } } : {});
  const page = await context.newPage();
  return { context, page };
}

// ───────────────────────────── 학생 ─────────────────────────────

export const screen = (page: Page, id: string): Locator => page.locator(`[data-screen="${id}"]`);
export const bodyField = (page: Page): Locator =>
  page.getByRole('textbox', { name: ko.student.bodyAriaLabel, exact: true });
export const titleField = (page: Page): Locator =>
  page.locator('[data-screen="S5"] input[data-editor-field="title"]');
export const saveState = (page: Page): Locator => page.locator('[data-screen="S5"] [data-save-state]');

/** S1 수업 카드 + 동의 → `시작하기`. */
export async function agreeOnRoomCard(page: Page): Promise<void> {
  await expect(screen(page, 'S1')).toBeVisible();
  await page.getByRole('checkbox', { name: ko.student.consentAgreeCheck }).click();
  await page.getByRole('button', { name: ko.student.consentStartAction }).click();
}

/** S3 별명 → `다음`. */
export async function enterNickname(page: Page, nickname: string): Promise<void> {
  await expect(screen(page, 'S3')).toBeVisible();
  await page.getByLabel(ko.student.nicknameLabel).fill(nickname);
  await page.getByRole('button', { name: ko.common.next, exact: true }).click();
}

export const GENRE_LABEL: Record<GenreKey, string> = {
  story: ko.student.genreStoryLabel,
  poem: ko.student.genrePoemLabel,
  lyrics: ko.student.genreLyricsLabel,
  news: ko.student.genreNewsLabel,
  essay: ko.student.genreEssayLabel,
  other: ko.student.genreOtherLabel,
};

/** S4 글 종류 타일(큰 이름으로 찾음). */
export const genreTile = (page: Page, genre: GenreKey): Locator =>
  page
    .locator('[data-screen="S4"] button[aria-pressed]')
    .filter({ has: page.getByText(GENRE_LABEL[genre], { exact: true }) });

/** S4에서 글 종류 하나를 골라 쓰기 화면으로(이야기·생활글·기타는 `쓰기 시작`까지). */
export async function pickGenre(page: Page, genre: GenreKey): Promise<void> {
  await expect(screen(page, 'S4')).toBeVisible();
  await genreTile(page, genre).click();
  if (genre === 'story' || genre === 'essay' || genre === 'other') {
    await page.getByRole('button', { name: ko.student.genreStartAction }).click();
  }
}

/** 쓰기 화면이 뜨고 편집기가 서버와 이어질 때까지(저장 상태 `저장됨`). */
export async function waitWriteReady(page: Page): Promise<void> {
  await expect(screen(page, 'S5')).toBeVisible({ timeout: 15_000 });
  await expect(bodyField(page)).toBeVisible();
  await expect(saveState(page)).toHaveAttribute('data-save-state', 'saved', { timeout: 15_000 });
}

/**
 * QR 주소(`/<코드>`)로 들어와 쓰기 화면까지. 방에 켠 글 종류가 하나면 S4를 건너뛴다(PRD F-05).
 */
export async function joinAsStudent(
  page: Page,
  room: Pick<RestRoom, 'entryCode'>,
  nickname: string,
  genre?: GenreKey,
): Promise<string> {
  await page.goto(`/${room.entryCode}`);
  await agreeOnRoomCard(page);
  await enterNickname(page, nickname);
  if (genre) await pickGenre(page, genre);
  await waitWriteReady(page);
  const docId = /\/write\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(docId, page.url()).toBeTruthy();
  return docId ?? '';
}

/**
 * 입력칸에 초점을 주고 커서를 옮긴다(사람이 눌러 커서를 놓는 것과 같은 일, 운영체제마다 다른 단축키 대신).
 * `at`: 'start' | 'end' | 글자 위치.
 */
export async function placeCaret(field: Locator, at: 'start' | 'end' | number): Promise<void> {
  await field.click();
  await field.evaluate((el, where) => {
    const input = el as HTMLTextAreaElement | HTMLInputElement;
    const pos = where === 'start' ? 0 : where === 'end' ? input.value.length : where;
    input.focus();
    input.setSelectionRange(pos, pos);
  }, at);
}

/** 입력칸 커서 자리에 글을 넣는다(키보드 입력처럼 `beforeinput`·`input` 한 번). */
export async function typeInto(field: Locator, at: 'start' | 'end' | number, text: string): Promise<void> {
  await placeCaret(field, at);
  await field.page().keyboard.insertText(text);
}

/** 본문 끝에 글을 넣는다. */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  await typeInto(bodyField(page), 'end', text);
}

/** 서버가 받은 뒤(`저장됨`)까지 기다린다. */
export async function waitSaved(page: Page, timeout = 10_000): Promise<void> {
  await expect(saveState(page)).toHaveAttribute('data-save-state', 'saved', { timeout });
}

// ───────────────────────────── 교사 ─────────────────────────────

/**
 * 이 기기에서 앱을 한 번 열어 서비스 워커가 화면을 맡게 해 둔다("앱을 이미 연 적이 있는 기기").
 * 처음 연 기기에서는 서비스 워커가 자리를 잡는 순간 앱이 화면을 한 번 다시 불러온다(`controllerchange`).
 * 그 동작 자체는 `teacher.spec.ts`의 첫 시험이 새 기기로 따로 본다.
 */
export async function warmServiceWorker(page: Page): Promise<void> {
  await page.goto('/t');
  // 자리를 잡는 순간 화면이 다시 불러와지므로(그 사이 실행 문맥이 사라짐) 실패한 물음은 '아직'으로 본다.
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null).catch(() => false), {
      timeout: 15_000,
    })
    .toBe(true);
  await page.waitForLoadState('load');
}

/**
 * 선생님 링크(`/t/<토큰>`)로 들어가 대시보드(T3)까지. 교사 기기는 늘 데스크톱 폭.
 * `fresh: true`면 앱을 처음 여는 새 기기 그대로 링크를 연다(기본은 앱을 한 번 연 기기).
 */
export async function openTeacherByLink(
  browser: Browser,
  room: Pick<RestRoom, 'linkToken' | 'roomId'>,
  viewport: { readonly width: number; readonly height: number } = E2E_DESKTOP_VIEWPORT,
  options: {
    readonly fresh?: boolean;
    /** 페이지를 열기 전에 컨텍스트에 할 일(초기 스크립트 등) */
    readonly beforeOpen?: (context: BrowserContext) => Promise<void>;
  } = {},
): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
  const device = await newDevice(browser, viewport);
  await options.beforeOpen?.(device.context);
  if (!options.fresh) await warmServiceWorker(device.page);
  await device.page.goto(`/t/${room.linkToken}`);
  await expect(device.page).toHaveURL(new RegExp(`/t/room/${room.roomId}`), { timeout: 15_000 });
  await waitDashboardReady(device.page);
  return device;
}

export async function waitDashboardReady(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: ko.teacher.noticeButton, exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.locator('[aria-busy="true"]').filter({ has: page.locator('[class*="skeleton" i]') }),
  ).toHaveCount(0, { timeout: 15_000 });
}

/** 대시보드의 학생 타일(별명으로 찾음). */
export const studentTile = (page: Page, nickname: string): Locator =>
  page.locator('button[data-status]').filter({ hasText: nickname });

export const drawerBody = (page: Page): Locator => page.getByTestId('drawer-body-input');

/** 타일을 눌러 서랍(T4)을 열고 서랍 본문이 학생 글을 받을 때까지. */
export async function openDrawer(page: Page, nickname: string): Promise<Locator> {
  const tile = studentTile(page, nickname);
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await expect(tile).not.toContainText(ko.teacher.tileNoDocYet, { timeout: 15_000 });
  await tile.click();
  await expect(page).toHaveURL(/[?&]doc=/);
  const body = drawerBody(page);
  await expect(body).toBeVisible();
  return body;
}

/** 대시보드 알림 팝오버를 연다. */
export async function openNoticePanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: ko.teacher.noticeButton, exact: true }).click();
  await expect(page.getByRole('heading', { name: ko.teacher.noticeSendTab })).toBeVisible();
}

/** ··· 메뉴(대시보드 머리) 항목 하나를 누른다. */
export async function teacherMenu(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: ko.common.moreMenu }).first().click();
  await page.getByRole('menuitem', { name: label }).click();
}

/** 학생 쓰기 화면 ··· 메뉴 항목 하나. */
export async function studentMenu(page: Page, label: string): Promise<void> {
  await page.locator('[data-screen="S5"]').getByRole('button', { name: ko.common.moreMenu }).click();
  await page.getByRole('menuitem', { name: label }).click();
}

/** 컨텍스트 여럿을 한꺼번에 닫는다(시험 끝 정리). */
export async function closeAll(...contexts: readonly (BrowserContext | undefined)[]): Promise<void> {
  await Promise.all(contexts.map(c => c?.close().catch(() => undefined)));
}
