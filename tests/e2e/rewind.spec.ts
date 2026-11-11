import { expect, test, type Page } from '@playwright/test';
import { backdateSnapshots, snapshotReasons } from './db.ts';
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
  studentMenu,
  typeAtEnd,
  waitSaved,
} from './flows.ts';

/**
 * 시간 되감기(PRD 16.2-8, F-10, PLAN §10.5 `rewind.spec.ts`): 3분 전 글을 미리 보고 복원하며, 복원한 뒤에도 이전 기록이 남는다.
 * 시험 서버는 `SNAPSHOT_INTERVAL_SEC=1`이라 저장마다 자동 기록이 남는다. "3분 전"은 3분을 기다리는 대신
 * 첫 기록을 DB에서 3분 앞으로 옮겨 만든다(시간이 흐른 상황 흉내).
 */

const THREE_MIN_MS = 3 * 60_000;
const OLD = '3분 전에 쓴 첫 글.';
const NOW = `${OLD} 그 뒤에 더 쓴 글.`;

const valueText = (page: Page) => page.getByTestId('slider-value-text');
const preview = (page: Page) => page.getByLabel(ko.common.rewindPreviewLabel);
const slider = (page: Page) => page.getByRole('slider');

/** 슬라이더를 오른쪽 끝(가장 최근)에서 왼쪽으로 한 칸씩 옮기며 `match`가 맞는 기록을 찾는다. */
async function selectSnapshot(
  page: Page,
  docId: string,
  match: (value: string, body: string) => boolean,
): Promise<void> {
  await slider(page).focus();
  await page.keyboard.press('End');
  // 슬라이더 칸 수 = 이 글의 기록 수
  const max = snapshotReasons(docId).length - 1;
  const seen: string[] = [];
  for (let i = 0; i <= max; i += 1) {
    const label = (await valueText(page).innerText()).trim();
    // 고른 기록의 글은 받아 오는 데 잠깐 걸린다.
    await expect(preview(page))
      .not.toHaveText('', { timeout: 5000 })
      .catch(() => undefined);
    const body = (await preview(page).innerText()).trim();
    seen.push(`${label} | ${body}`);
    if (match(label, body)) return;
    await page.keyboard.press('ArrowLeft');
  }
  throw new Error(`맞는 기록을 찾지 못함 (max=${max}): ${seen.join(' / ')}`);
}

test.describe('시간 되감기 (PRD 16.2)', () => {
  test('3분 전 글을 미리 보고 복원할 수 있고, 복원한 뒤에도 이전 기록이 남는다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    const nickname = nick('되감');
    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      const page = student.page;
      const docId = await joinAsStudent(page, room, nickname);
      const before = snapshotReasons(docId).length;
      await typeAtEnd(page, OLD);
      await waitSaved(page);
      await expect.poll(() => snapshotReasons(docId).length, { timeout: 10_000 }).toBeGreaterThan(before);
      expect(backdateSnapshots(docId, THREE_MIN_MS + 5000)).toBeGreaterThan(0);

      const mid = snapshotReasons(docId).length;
      await typeAtEnd(page, ' 그 뒤에 더 쓴 글.');
      await waitSaved(page);
      await expect.poll(() => snapshotReasons(docId).length, { timeout: 10_000 }).toBeGreaterThan(mid);

      // 미리 보기: 3분 전 기록을 고르면 그때 글이 보이고, 쓰기 칸은 아직 그대로다.
      await studentMenu(page, ko.common.rewindTitle);
      await expect(slider(page)).toBeVisible({ timeout: 10_000 });
      const threeMinAgo = `3${ko.common.timeMinutesAgoSuffix}`;
      await selectSnapshot(page, docId, (label, body) => label.startsWith(threeMinAgo) && body === OLD);
      await expect(valueText(page)).toHaveText(`${threeMinAgo} · ${ko.common.rewindReasonAuto}`);
      await expect(preview(page)).toHaveText(OLD);
      // 되감기 시트가 열려 있는 동안 쓰기 칸은 접근성 트리에서 가려지므로 속성으로 찾는다.
      await expect(page.locator(`textarea[aria-label="${ko.student.bodyAriaLabel}"]`)).toHaveValue(NOW);

      // 복원
      const beforeRestore = snapshotReasons(docId).length;
      await page.getByRole('button', { name: ko.common.rewindRestoreAction }).click();
      await expect(bodyField(page)).toHaveValue(OLD);
      await waitSaved(page);
      await expect.poll(() => snapshotReasons(docId), { timeout: 10_000 }).toContain('RESTORE');
      expect(snapshotReasons(docId).length).toBeGreaterThan(beforeRestore);

      // 교사 화면도 복원된 글
      teacher = await openTeacherByLink(browser, room);
      const drawer = await openDrawer(teacher.page, nickname);
      await expect(drawer).toHaveValue(OLD);

      // 다시 열면 복원 직전 글이 `글을 되돌리기 전` 기록으로 남아 있고, 3분 전 기록도 그대로다.
      await studentMenu(page, ko.common.rewindTitle);
      await expect(slider(page)).toBeVisible({ timeout: 10_000 });
      await selectSnapshot(page, docId, label => label.includes(ko.common.rewindReasonRestore));
      await expect(preview(page)).toHaveText(NOW);
      await selectSnapshot(page, docId, (label, body) => label.startsWith(threeMinAgo) && body === OLD);

      // 되돌리기 전 글로 다시 돌릴 수도 있다(기록이 지워지지 않았으니).
      await selectSnapshot(page, docId, label => label.includes(ko.common.rewindReasonRestore));
      await page.getByRole('button', { name: ko.common.rewindRestoreAction }).click();
      await expect(bodyField(page)).toHaveValue(NOW);
      await expect(drawer).toHaveValue(NOW, { timeout: 10_000 });
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });
});
