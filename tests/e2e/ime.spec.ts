import { expect, test } from '@playwright/test';
import { assertConvergedAndProtected, openImeDualRig, ZERO_WRITES, type ImeDualRig } from './imeHarness.ts';

/**
 * P2-6 Chromium 한글 조합 보호 화면 시험(PRD 9.3, PLAN §6.3·§10.3·§10.5).
 *
 * 실제 Chromium에서 CDP `Input.imeSetComposition` + `Input.insertText`로 한글 조합을 재현하는 도중
 * 교사 페이지(`role=teacher`)가 같은 문단의 커서 앞·뒤·같은 낱말 안·커서 포함 범위를 고쳐도:
 * 1) 최종 글이 학생·교사 두 쪽 `textarea`에서 같고,
 * 2) 학생 커서 바로 앞 글자가 학생이 마지막에 친 글자이며,
 * 3) `compositionstart`·`compositionend` 횟수가 친 음절 수와 일치하고,
 * 4) 반영 문이 닫혀 있는 동안 앱에 의한 입력칸 DOM 쓰기(`value`·`setRangeText`·`setSelectionRange` 등)가 0회인지 검증한다.
 */
test.describe('한글 조합 보호 (PRD 9.3 · PLAN §10.3)', () => {
  let rig: ImeDualRig | null = null;

  test.afterEach(async () => {
    if (rig) {
      await rig.close();
      rig = null;
    }
  });

  test('1. ㅎ→하→한 조합 도중 교사가 커서 바로 앞에 끼워 넣어도 조합이 끊기지 않고 합쳐진다', async ({
    browser,
  }) => {
    rig = await openImeDualRig(browser, 'c1-before');
    await rig.seedInitialBody('오늘 아침 운동장에서 ');

    // 학생: ㅎ → 하 조합 진행 (아직 확정 전)
    await rig.ime.setComposition('ㅎ');
    await rig.ime.setComposition('하');
    await expect(rig.studentBody).toHaveValue('오늘 아침 운동장에서 하');
    await expect(rig.teacherBody).toHaveValue('오늘 아침 운동장에서 하');

    // 교사: 조합 중인 '하'(index 12) 바로 왼쪽(커서 앞)에 '[앞]' 끼워 넣기
    await rig.teacherEditAndAwaitArrival({
      start: 12,
      end: 12,
      insertText: '[앞]',
    });

    // 원격 변경이 도착했지만 조합 중이므로 반영 문이 닫혀 있어야 한다(앱 쓰기 0회, 화면 그대로).
    const midProbe = await rig.readProbe();
    expect(midProbe.composing).toBe(true);
    expect(midProbe.compositionStarts).toBe(1);
    expect(midProbe.compositionEnds).toBe(0);
    expect(midProbe.value).toBe('오늘 아침 운동장에서 하');
    expect(midProbe.windowWrites).toEqual(ZERO_WRITES);

    // 학생: 받침 ㄴ을 이어 쳐 '한'으로 바꾸고 확정
    await rig.ime.setComposition('한');
    await rig.ime.commit('한');

    // 확정 직후에도 IME_IDLE_MS 전이므로 반영 문이 아직 닫혀 있고 앱 쓰기는 0회여야 한다.
    const postCommitProbe = await rig.readProbe();
    expect(postCommitProbe.composing).toBe(false);
    expect(postCommitProbe.value).toBe('오늘 아침 운동장에서 한');
    expect(postCommitProbe.windowWrites).toEqual(ZERO_WRITES);

    await assertConvergedAndProtected(rig, {
      allowedTexts: ['오늘 아침 운동장에서 [앞]한'],
      lastStudentChar: '한',
      syllablesTyped: 1,
    });
  });

  test('2. ㅎ→하→한 조합 도중 교사가 커서 바로 뒤에 끼워 넣어도 조합이 끊기지 않고 합쳐진다', async ({
    browser,
  }) => {
    rig = await openImeDualRig(browser, 'c2-after');
    // 문장 한가운데('학교 |운동장', index 3)에 학생 커서를 두고 시작
    await rig.seedInitialBody('학교 운동장', 3);

    await rig.ime.setComposition('ㅎ');
    await rig.ime.setComposition('하');
    await expect(rig.studentBody).toHaveValue('학교 하운동장');
    await expect(rig.teacherBody).toHaveValue('학교 하운동장');

    // 교사: 학생 커서 바로 뒤('하' 오른쪽, index 4)에 '[뒤]' 끼워 넣기
    await rig.teacherEditAndAwaitArrival({
      start: 4,
      end: 4,
      insertText: '[뒤]',
    });

    const midProbe = await rig.readProbe();
    expect(midProbe.composing).toBe(true);
    expect(midProbe.compositionStarts).toBe(1);
    expect(midProbe.compositionEnds).toBe(0);
    expect(midProbe.value).toBe('학교 하운동장');
    expect(midProbe.windowWrites).toEqual(ZERO_WRITES);

    await rig.ime.setComposition('한');
    await rig.ime.commit('한');

    const postCommitProbe = await rig.readProbe();
    expect(postCommitProbe.windowWrites).toEqual(ZERO_WRITES);

    // 같은 자리 동시 삽입은 두 클라이언트 Yjs clientID 대소에 따라 두 순서 중 하나로 결정론적 수렴한다.
    await assertConvergedAndProtected(rig, {
      allowedTexts: ['학교 한[뒤]운동장', '학교 [뒤]한운동장'],
      lastStudentChar: '한',
      syllablesTyped: 1,
    });
  });

  test('3. ㅎ→하→한 조합 도중 교사가 같은 낱말 안쪽에 끼워 넣어도 조합이 끊기지 않고 합쳐진다', async ({
    browser,
  }) => {
    rig = await openImeDualRig(browser, 'c3-word');
    // '우리 달리| 운동장'(index 5)에서 같은 어절 끝에 이어 조합 시작
    await rig.seedInitialBody('우리 달리 운동장', 5);

    await rig.ime.setComposition('ㅎ');
    await rig.ime.setComposition('하');
    await expect(rig.studentBody).toHaveValue('우리 달리하 운동장');
    await expect(rig.teacherBody).toHaveValue('우리 달리하 운동장');

    // 교사: 같은 낱말 '달리하' 안쪽('달'과 '리' 사이, index 4)에 '빛' 끼워 넣기
    await rig.teacherEditAndAwaitArrival({
      start: 4,
      end: 4,
      insertText: '빛',
    });

    const midProbe = await rig.readProbe();
    expect(midProbe.composing).toBe(true);
    expect(midProbe.compositionStarts).toBe(1);
    expect(midProbe.compositionEnds).toBe(0);
    expect(midProbe.value).toBe('우리 달리하 운동장');
    expect(midProbe.windowWrites).toEqual(ZERO_WRITES);

    await rig.ime.setComposition('한');
    await rig.ime.commit('한');

    const postCommitProbe = await rig.readProbe();
    expect(postCommitProbe.windowWrites).toEqual(ZERO_WRITES);

    await assertConvergedAndProtected(rig, {
      allowedTexts: ['우리 달빛리한 운동장'],
      lastStudentChar: '한',
      syllablesTyped: 1,
    });
  });

  test('4. ㅎ→하→한 조합 도중 교사가 학생 커서를 포함한 범위를 지워도 조합 중인 음절이 온전히 남는다', async ({
    browser,
  }) => {
    rig = await openImeDualRig(browser, 'c4-delete');
    // '문단 가나다|라마바사'(index 6)에 커서를 두고 시작
    await rig.seedInitialBody('문단 가나다라마바사', 6);

    await rig.ime.setComposition('ㅎ');
    await rig.ime.setComposition('하');
    await expect(rig.studentBody).toHaveValue('문단 가나다하라마바사');
    await expect(rig.teacherBody).toHaveValue('문단 가나다하라마바사');

    // 교사: 학생 커서와 조합 글자를 가로지르는 '다하라마'(index 5..9) 범위 삭제
    await rig.teacherEditAndAwaitArrival({
      start: 5,
      end: 9,
      insertText: '',
    });

    const midProbe = await rig.readProbe();
    expect(midProbe.composing).toBe(true);
    expect(midProbe.compositionStarts).toBe(1);
    expect(midProbe.compositionEnds).toBe(0);
    expect(midProbe.value).toBe('문단 가나다하라마바사');
    expect(midProbe.windowWrites).toEqual(ZERO_WRITES);

    await rig.ime.setComposition('한');
    await rig.ime.commit('한');

    const postCommitProbe = await rig.readProbe();
    expect(postCommitProbe.windowWrites).toEqual(ZERO_WRITES);

    await assertConvergedAndProtected(rig, {
      allowedTexts: ['문단 가나한바사'],
      lastStudentChar: '한',
      syllablesTyped: 1,
    });
  });

  test('5. "한" 다음 ㅏ로 "하나"가 되는 연음 분리 직전에 원격 변경이 와도 두 음절 모두 깨지지 않는다', async ({
    browser,
  }) => {
    rig = await openImeDualRig(browser, 'c5-hana-pre');
    await rig.seedInitialBody('오늘 아침 ');

    // 첫 음절: ㅎ → 하 → 한 (아직 조합 중)
    await rig.ime.setComposition('ㅎ');
    await rig.ime.setComposition('하');
    await rig.ime.setComposition('한');
    await expect(rig.studentBody).toHaveValue('오늘 아침 한');
    await expect(rig.teacherBody).toHaveValue('오늘 아침 한');

    // 'ㅏ'를 쳐서 '하나'로 갈라지기 바로 직전에 교사가 커서 앞(index 6)에 '[직전]' 끼워 넣기
    await rig.teacherEditAndAwaitArrival({
      start: 6,
      end: 6,
      insertText: '[직전]',
    });

    const beforeSplitProbe = await rig.readProbe();
    expect(beforeSplitProbe.composing).toBe(true);
    expect(beforeSplitProbe.compositionStarts).toBe(1);
    expect(beforeSplitProbe.compositionEnds).toBe(0);
    expect(beforeSplitProbe.windowWrites).toEqual(ZERO_WRITES);

    // 학생이 'ㅏ'를 침: 앞 음절 '한'이 '하'로 확정되고 곧바로 둘째 음절 '나' 조합이 열림
    await rig.ime.commit('하');
    await rig.ime.setComposition('나');

    const duringSecondProbe = await rig.readProbe();
    expect(duringSecondProbe.composing).toBe(true);
    expect(duringSecondProbe.compositionStarts).toBe(2);
    expect(duringSecondProbe.compositionEnds).toBe(1);
    expect(duringSecondProbe.value).toBe('오늘 아침 하나');
    expect(duringSecondProbe.windowWrites).toEqual(ZERO_WRITES);

    await rig.ime.commit('나');

    const afterSecondProbe = await rig.readProbe();
    expect(afterSecondProbe.windowWrites).toEqual(ZERO_WRITES);

    await assertConvergedAndProtected(rig, {
      allowedTexts: ['오늘 아침 [직전]하나'],
      lastStudentChar: '나',
      syllablesTyped: 2,
    });
  });

  test('6. "한" 다음 ㅏ로 "하나"가 된 직후 원격 변경이 와도 조합이 보호되고 끝난 뒤 합쳐진다', async ({
    browser,
  }) => {
    rig = await openImeDualRig(browser, 'c6-hana-post');
    await rig.seedInitialBody('맑은 하늘 ');

    await rig.ime.setComposition('ㅎ');
    await rig.ime.setComposition('하');
    await rig.ime.setComposition('한');

    // '한' + 'ㅏ' → '하' 확정 + '나' 조합 시작 직후
    await rig.ime.commit('하');
    await rig.ime.setComposition('나');
    await expect(rig.studentBody).toHaveValue('맑은 하늘 하나');
    await expect(rig.teacherBody).toHaveValue('맑은 하늘 하나');

    // 연음 분리가 일어난 바로 직후 교사가 같은 문단 앞쪽('하늘 ' 뒤, index 6)에 '[직후]' 끼워 넣기
    await rig.teacherEditAndAwaitArrival({
      start: 6,
      end: 6,
      insertText: '[직후]',
    });

    const midProbe = await rig.readProbe();
    expect(midProbe.composing).toBe(true);
    expect(midProbe.compositionStarts).toBe(2);
    expect(midProbe.compositionEnds).toBe(1);
    expect(midProbe.value).toBe('맑은 하늘 하나');
    expect(midProbe.windowWrites).toEqual(ZERO_WRITES);

    await rig.ime.commit('나');

    const postCommitProbe = await rig.readProbe();
    expect(postCommitProbe.windowWrites).toEqual(ZERO_WRITES);

    await assertConvergedAndProtected(rig, {
      allowedTexts: ['맑은 하늘 [직후]하나'],
      lastStudentChar: '나',
      syllablesTyped: 2,
    });
  });

  test('7. 조합 중 원격 변경이 길게 보류되면 보류 알림이 뜨고 조합이 끝난 뒤 온전히 합쳐진다', async ({
    browser,
  }) => {
    rig = await openImeDualRig(browser, 'c7-hold');
    await rig.seedInitialBody('둘째 줄 공책 ');

    // 학생이 조합을 시작한 상태에서 교사가 같은 문단 맨 앞에 '[보류] ' 삽입
    await rig.ime.setComposition('ㅎ');
    await rig.ime.setComposition('하');
    await expect(rig.teacherBody).toHaveValue('둘째 줄 공책 하');

    await rig.teacherEditAndAwaitArrival({
      start: 0,
      end: 0,
      insertText: '[보류] ',
    });

    // 보류가 IME_HOLD_NOTICE_MS(3초)를 넘으면 하단 보류 알약이 나타나야 한다.
    const holdNotice = rig.studentPage.getByTestId('dev-hold-notice');
    await expect(holdNotice).toContainText('선생님이 고친 곳은 잠시 뒤 보여요', { timeout: 5_000 });

    // 보류 알림이 떠 있는 동안에도 학생 입력칸 값과 선택은 앱 때문에 바뀌지 않아야 한다(쓰기 0회).
    const holdingProbe = await rig.readProbe();
    expect(holdingProbe.composing).toBe(true);
    expect(holdingProbe.value).toBe('둘째 줄 공책 하');
    expect(holdingProbe.windowWrites).toEqual(ZERO_WRITES);

    // 학생이 조합을 이어 나가 '한' → '하나'까지 완성
    await rig.ime.setComposition('한');
    await rig.ime.commit('하');
    await rig.ime.setComposition('나');
    await rig.ime.commit('나');

    const postCommitProbe = await rig.readProbe();
    expect(postCommitProbe.windowWrites).toEqual(ZERO_WRITES);

    // 조합이 끝난 뒤 반영 문이 열리면 보류 알림이 사라지고 두 쪽 글이 합쳐진다.
    await assertConvergedAndProtected(rig, {
      allowedTexts: ['[보류] 둘째 줄 공책 하나'],
      lastStudentChar: '나',
      syllablesTyped: 2,
    });
    await expect(holdNotice).toHaveCount(0);
  });
});
