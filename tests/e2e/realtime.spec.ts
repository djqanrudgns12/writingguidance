import { expect, test, type Page } from '@playwright/test';
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
  placeCaret,
  typeInto,
  typeAtEnd,
  waitSaved,
} from './flows.ts';

/**
 * 실시간(PRD 16.2, PLAN §10.5 `realtime.spec.ts`): 교사 서랍 1초, 같은 문단 동시 편집, 학생 `↶`가 교사 수정을 안 건드림.
 * 학생 기기는 프로젝트 폭(360·1280), 교사 기기는 늘 1280 폭의 다른 브라우저 컨텍스트다.
 */

/** 본문 칸의 지금 값 */
const valueOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate(el => (el as HTMLTextAreaElement).value);

test.describe('실시간 (PRD 16.2)', () => {
  test('학생이 쓴 글이 교사 서랍에 1초 안에 보인다', async ({ browser, request }) => {
    const room = await createRoomRest(request);
    const nickname = nick('별빛');
    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      await joinAsStudent(student.page, room, nickname);
      await typeAtEnd(student.page, '시작');
      await waitSaved(student.page);
      teacher = await openTeacherByLink(browser, room);
      const drawer = await openDrawer(teacher.page, nickname);
      await expect(drawer).toHaveValue('시작');

      // 10번 재서 95%(10개 중 9개 이상)가 1초 안이어야 한다. 하나도 3초를 넘지 않는다.
      const samples: number[] = [];
      let expected = '시작';
      for (let i = 0; i < 10; i += 1) {
        const piece = ` 문장${i}`;
        expected += piece;
        await placeCaret(bodyField(student.page), 'end');
        const started = Date.now();
        await student.page.keyboard.insertText(piece);
        await expect(drawer).toHaveValue(expected, { timeout: 3000 });
        samples.push(Date.now() - started);
      }
      const within = samples.filter(ms => ms <= 1000).length;
      test.info().annotations.push({ type: '서랍 반영(ms)', description: samples.join(', ') });
      expect(within, `반영 시간(ms): ${samples.join(', ')}`).toBeGreaterThanOrEqual(9);
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });

  test('학생과 교사가 같은 문단을 동시에 고쳐도 글이 깨지지 않고 양쪽이 같아진다', async ({
    browser,
    request,
  }) => {
    const room = await createRoomRest(request);
    const nickname = nick('바다');
    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      await joinAsStudent(student.page, room, nickname);
      await typeAtEnd(student.page, '우리 반 텃밭에 상추가 자랐다.');
      await waitSaved(student.page);
      teacher = await openTeacherByLink(browser, room);
      const drawer = await openDrawer(teacher.page, nickname);
      await expect(drawer).toHaveValue('우리 반 텃밭에 상추가 자랐다.');

      // 같은 문단(한 줄)에서 학생은 끝에, 교사는 맨 앞에 번갈아·동시에 넣는다.
      const studentPieces = ['ㄱ하나', 'ㄱ둘', 'ㄱ셋', 'ㄱ넷', 'ㄱ다섯'];
      const teacherPieces = ['ㅅ일', 'ㅅ이', 'ㅅ삼', 'ㅅ사', 'ㅅ오'];
      for (let i = 0; i < studentPieces.length; i += 1) {
        await Promise.all([
          typeInto(bodyField(student.page), 'end', studentPieces[i] ?? ''),
          typeInto(drawer, 'start', teacherPieces[i] ?? ''),
        ]);
      }

      // 두 쪽 입력칸 값이 같아질 때까지(반영 문 500ms·저장 묶음 뒤)
      await expect
        .poll(
          async () => {
            const [s, t] = await Promise.all([
              valueOf(student.page, `textarea[aria-label="${ko.student.bodyAriaLabel}"]`),
              valueOf(teacher!.page, '[data-testid="drawer-body-input"]'),
            ]);
            return s === t ? s : null;
          },
          { timeout: 10_000 },
        )
        .not.toBeNull();
      const final = await valueOf(student.page, `textarea[aria-label="${ko.student.bodyAriaLabel}"]`);
      // 원래 문장이 그대로 있고, 넣은 조각이 하나도 빠지거나 겹치지 않았다.
      expect(final).toContain('우리 반 텃밭에 상추가 자랐다.');
      for (const piece of [...studentPieces, ...teacherPieces]) {
        expect(final.split(piece).length - 1, `${piece} in ${final}`).toBe(1);
      }
      // 학생 조각은 학생이 넣은 순서대로 원문 뒤에, 교사 조각은 원문 앞에 있다.
      const tail = final.slice(final.indexOf('자랐다.') + '자랐다.'.length);
      expect(tail).toBe(studentPieces.join(''));
      expect(final.indexOf('ㅅ')).toBeLessThan(final.indexOf('우리'));
      await expect(drawer).toHaveValue(final);
      await waitSaved(student.page);
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });

  test('학생의 `이전으로`는 교사가 고친 내용을 되돌리지 않는다', async ({ browser, request }) => {
    const room = await createRoomRest(request);
    const nickname = nick('초코');
    const student = await newDevice(browser);
    let teacher: Awaited<ReturnType<typeof openTeacherByLink>> | undefined;
    try {
      await joinAsStudent(student.page, room, nickname);
      await typeAtEnd(student.page, '가을 운동장');
      await waitSaved(student.page);
      teacher = await openTeacherByLink(browser, room);
      const drawer = await openDrawer(teacher.page, nickname);
      await expect(drawer).toHaveValue('가을 운동장');

      // 학생: 되돌리기 묶음(보통 800ms)이 끊긴 뒤 새로 한 번 더 쓴다.
      await expect(student.page.getByRole('button', { name: ko.common.undo })).toBeEnabled();
      await student.page.waitForTimeout(1200); // 되돌리기 묶음 경계를 만들기 위한 정해진 쉼(UNDO_GROUP_MS normal 800ms)
      await typeAtEnd(student.page, '에서 놀았다');
      await expect(drawer).toHaveValue('가을 운동장에서 놀았다');

      // 교사: 맨 앞에 끼워 넣기
      await typeInto(drawer, 'start', '[선생님] ');
      const studentBody = bodyField(student.page);
      await expect(studentBody).toHaveValue('[선생님] 가을 운동장에서 놀았다', { timeout: 5000 });

      // 학생 `이전으로` 한 번: 학생이 마지막에 쓴 것만 사라지고 교사 글은 남는다.
      await student.page.getByRole('button', { name: ko.common.undo }).click();
      await expect(studentBody).toHaveValue('[선생님] 가을 운동장');
      await expect(drawer).toHaveValue('[선생님] 가을 운동장', { timeout: 5000 });

      // 한 번 더: 학생의 처음 글까지 되돌려도 교사 글은 그대로다.
      await student.page.getByRole('button', { name: ko.common.undo }).click();
      await expect(studentBody).toHaveValue('[선생님] ');
      await expect(drawer).toHaveValue('[선생님] ', { timeout: 5000 });

      // 학생 것을 다 되돌린 뒤 더 눌러도(눌린다면) 교사 글은 남는다.
      const undo = student.page.getByRole('button', { name: ko.common.undo });
      if (await undo.isEnabled()) {
        await undo.click();
        await expect(studentBody).toHaveValue('[선생님] ');
      }
      await expect(drawer).toHaveValue('[선생님] ');
    } finally {
      await closeAll(student.context, teacher?.context);
    }
  });
});
