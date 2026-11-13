import { expect, test, type Page } from '@playwright/test';
import { E2E_AI_DAILY_PER_PARTICIPANT } from './constants.ts';
import {
  bodyField,
  closeAll,
  createRoomRest,
  joinAsStudent,
  ko,
  nick,
  openTeacherByLink,
  teacherMenu,
  typeAtEnd,
  waitSaved,
  type AiButtonKey,
} from './flows.ts';

/**
 * 글벗(AI) 결과 패널(PRD 16.1·16.6, F-08·F-26, PLAN §10.5 `ai-panels.spec.ts`). 시험 서버는 `AI_PROVIDER=fake`라
 * 정해진 답을 준다: 맞춤법은 글 속 흔한 실수(되요·할수 등)를 찾고, 다듬은 글은 그 실수를 고친 글을 흘려보낸다.
 * 시험 하루 한도는 참가자당 `E2E_AI_DAILY_PER_PARTICIPANT`(3)라 서로 다른 버튼 셋 뒤 넷째에서 한도에 닿는다.
 */

/** 맞춤법 실수 둘(되요·할수)이 들어 있고 최소 글자(20자)를 넘는 글 */
const TEXT = '비가 와서 운동장에 나가면 안 되요. 교실에서 할수 있는 놀이를 했다.';
const POLISHED = '비가 와서 운동장에 나가면 안 돼요. 교실에서 할 수 있는 놀이를 했다.';

const chip = (page: Page, button: AiButtonKey) => page.locator(`[data-ai-button="${button}"]`);
const result = (page: Page, button: AiButtonKey) => page.locator(`[data-result="${button}"]`);

/** 결과 패널·시트에 자동 반영 버튼이 없다(PRD 16.1: 자동 적용·모두 고치기·적용 없음). */
async function expectNoApplyButtons(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /적용|모두 고치|고쳐 넣|자동|바꿔 넣/ })).toHaveCount(0);
}

async function closePanel(page: Page, button: AiButtonKey): Promise<void> {
  await page.getByRole('button', { name: ko.common.close, exact: true }).last().click();
  await expect(result(page, button)).toHaveCount(0);
}

test.describe('글벗 결과 패널 (PRD 16.1 · 16.6)', () => {
  test('맞춤법: 항목을 누르면 쓰기 칸의 그 자리가 선택되고 형광이 남으며, 어느 패널에도 적용 버튼이 없다. 한도에 닿으면 안내가 뜨고 계속 쓴다', async ({
    browser,
    request,
  }) => {
    expect(E2E_AI_DAILY_PER_PARTICIPANT).toBe(3);
    const room = await createRoomRest(request);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await joinAsStudent(page, room, nick('맞춤'));
      await typeAtEnd(page, TEXT);
      await waitSaved(page);

      // 1) 맞춤법
      await chip(page, 'SPELL').click();
      const spell = result(page, 'SPELL');
      await expect(spell).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
      const item = spell.getByRole('button').filter({ hasText: '되요' });
      await expect(item).toContainText('돼요');
      await expect(spell.getByRole('button').filter({ hasText: '할수' })).toContainText('할 수');
      await expectNoApplyButtons(page);

      await item.click();
      const start = TEXT.indexOf('되요');
      await expect
        .poll(() =>
          bodyField(page).evaluate(el => {
            const t = el as HTMLTextAreaElement;
            return [t.selectionStart, t.selectionEnd];
          }),
        )
        .toEqual([start, start + '되요'.length]);
      await expect(item).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('[data-mirror-mark="highlight"]')).toHaveText('되요');
      // 결과는 보여 주기만 한다: 글은 그대로다.
      await expect(bodyField(page)).toHaveValue(TEXT);
      await closePanel(page, 'SPELL');
      // 패널을 닫아도 형광은 남는다(고칠 때까지)
      await expect(page.locator('[data-mirror-mark="highlight"]')).toHaveText('되요');

      // 2) 글벗 한마디, 3) 다음 방향: 결과 카드만 있고 적용 버튼이 없다.
      await chip(page, 'FEEDBACK').click();
      await expect(result(page, 'FEEDBACK')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
      await expect(result(page, 'FEEDBACK')).toContainText(ko.student.aiFeedbackPraiseHeading);
      await expectNoApplyButtons(page);
      await closePanel(page, 'FEEDBACK');

      await chip(page, 'DIRECTION').click();
      await expect(result(page, 'DIRECTION')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
      await expect(result(page, 'DIRECTION').locator('li')).toHaveCount(3);
      await expectNoApplyButtons(page);
      await closePanel(page, 'DIRECTION');
      await expect(bodyField(page)).toHaveValue(TEXT);

      // 4) 하루 한도(3번)를 다 쓴 뒤 다듬은 글 → 한도 안내(F-26), 글쓰기는 계속된다.
      await chip(page, 'POLISH').click();
      await expect(page.getByText(ko.student.aiDailyLimitGuide).first()).toBeVisible({ timeout: 15_000 });
      await closePanel(page, 'POLISH');
      await typeAtEnd(page, ' 한도 뒤에도 계속 써요.');
      await waitSaved(page);
      await expect(bodyField(page)).toHaveValue(`${TEXT} 한도 뒤에도 계속 써요.`);
    } finally {
      await closeAll(context);
    }
  });

  test('다듬은 글은 복사할 수 있고 적용 버튼은 없다', async ({ browser, browserName, request }) => {
    const room = await createRoomRest(request);
    // WebKit은 clipboard-write 권한 설정이 없고, 실제 복사 버튼의 사용자 동작으로 쓰기를 허용한다.
    const context = await browser.newContext({
      permissions: browserName === 'webkit' ? ['clipboard-read'] : ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    try {
      await joinAsStudent(page, room, nick('다듬'));
      await typeAtEnd(page, TEXT);
      await waitSaved(page);

      await chip(page, 'POLISH').click();
      const polish = result(page, 'POLISH');
      await expect(polish).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
      await expect(polish.locator('[data-streaming]')).toHaveCount(0, { timeout: 15_000 });
      await expect(polish).toContainText(POLISHED);
      await expectNoApplyButtons(page);

      await page.getByRole('button', { name: ko.common.copy, exact: true }).click();
      await expect(page.getByText(ko.common.copiedToast)).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(POLISHED);
      // 쓰기 칸의 글은 그대로다(다듬은 글이 저절로 들어가지 않는다).
      await expect(bodyField(page)).toHaveValue(TEXT);
    } finally {
      await closeAll(context);
    }
  });

  test('교사가 수업 중에 끈 글벗 버튼은 학생 화면에서 바로 사라지고, 다시 켜면 돌아온다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    const context = await browser.newContext();
    const page = await context.newPage();
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      await joinAsStudent(page, room, nick('끄기'));
      await typeAtEnd(page, TEXT);
      await waitSaved(page);
      await expect(chip(page, 'FEEDBACK')).toBeVisible();

      teacher = await openTeacherByLink(browser, room);
      await teacherMenu(teacher.page, ko.teacher.roomSettingsTitle);
      const feedbackSwitch = teacher.page.getByRole('switch', {
        name: ko.student.aiFeedbackLabel,
        exact: true,
      });
      await expect(feedbackSwitch).toBeChecked();
      await feedbackSwitch.click();
      await expect(feedbackSwitch).not.toBeChecked();

      await expect(chip(page, 'FEEDBACK')).toHaveCount(0, { timeout: 3000 });
      await expect(chip(page, 'SPELL')).toBeVisible();

      await feedbackSwitch.click();
      await expect(chip(page, 'FEEDBACK')).toBeVisible({ timeout: 3000 });
    } finally {
      await closeAll(context, teacher?.context);
    }
  });
});
