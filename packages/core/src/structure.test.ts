import { describe, expect, it } from 'vitest';
import {
  extractCurrentChapter,
  getStructureButtonLabel,
  insertStructureBlock,
  isSongMoodId,
  isSongTempoId,
  nextChapterNumber,
  nextCutNumber,
  parseStructureHeading,
  toSunoLyrics,
  toSunoStylePrompt,
} from './structure.ts';

describe('structure 머리말 문법·구조 버튼 삽입·장편 장 추출·Suno 변환', () => {
  it('구조 버튼 표시 문구와 머리말 문법 파서가 PRD 5장 형식을 따른다', () => {
    expect(getStructureButtonLabel('verse1')).toBe('+1절');
    expect(getStructureButtonLabel('chorus')).toBe('+후렴');
    expect(getStructureButtonLabel('cut')).toBe('+컷');
    expect(getStructureButtonLabel('chapter')).toBe('+장');

    expect(parseStructureHeading('[1절]')).toEqual({ kind: 'verse', number: 1, raw: '[1절]' });
    expect(parseStructureHeading('  [12절] ')).toEqual({
      kind: 'verse',
      number: 12,
      raw: '[12절]',
    });
    expect(parseStructureHeading('[후렴]')).toEqual({ kind: 'chorus', raw: '[후렴]' });
    expect(parseStructureHeading('[브릿지]')).toEqual({ kind: 'bridge', raw: '[브릿지]' });
    expect(parseStructureHeading('[전주]')).toEqual({ kind: 'intro', raw: '[전주]' });
    expect(parseStructureHeading('[간주]')).toEqual({ kind: 'interlude', raw: '[간주]' });
    expect(parseStructureHeading('[마무리]')).toEqual({ kind: 'outro', raw: '[마무리]' });
    expect(parseStructureHeading('[3컷]')).toEqual({ kind: 'cut', number: 3, raw: '[3컷]' });
    expect(parseStructureHeading('[2장]')).toEqual({ kind: 'chapter', number: 2, raw: '[2장]' });

    expect(parseStructureHeading('[0절]')).toBeNull();
    expect(parseStructureHeading('[0컷]')).toBeNull();
    expect(parseStructureHeading('[0장]')).toBeNull();
    expect(parseStructureHeading('[가을 산책]')).toBeNull();
    expect(parseStructureHeading('일반 본문 줄')).toBeNull();
    expect(parseStructureHeading('')).toBeNull();
  });

  it('다음 컷·장 번호는 본문에 있는 가장 큰 번호 다음 숫자를 돌려준다', () => {
    expect(nextCutNumber('')).toBe(1);
    expect(nextCutNumber('[1컷]\n장면: 교실\n[3컷]\n장면: 운동장')).toBe(4);

    expect(nextChapterNumber('')).toBe(1);
    expect(nextChapterNumber('[1장]\n시작\n[2장]\n전개')).toBe(3);
  });

  it('빈 줄에는 바로 넣고 글이 있는 줄에서는 줄 끝에서 줄을 바꾼 뒤 머리말 틀을 넣는다', () => {
    const onEmpty = insertStructureBlock('', 0, 'verse1');
    expect(onEmpty).toEqual({
      insertAt: 0,
      insertText: '[1절]\n',
      nextCursor: 5,
      nextText: '[1절]\n',
      heading: '[1절]',
    });

    // 줄 한가운데에 커서가 있어도 기존 줄을 쪼개지 않고 그 줄 끝 다음에 넣는다.
    const body = '첫째 줄 가사\n둘째 줄';
    const midLine = insertStructureBlock(body, 2, 'chorus');
    expect(midLine.nextText).toBe('첫째 줄 가사\n[후렴]\n\n둘째 줄');
    expect(midLine.nextText.slice(0, midLine.nextCursor)).toBe('첫째 줄 가사\n[후렴]\n');

    // 이미 비어 있는 줄에 커서가 있으면 앞 줄바꿈을 중복으로 넣지 않는다.
    const blankLineText = '[1장]\n첫 장 내용\n\n';
    const onBlank = insertStructureBlock(blankLineText, blankLineText.length, 'chapter');
    expect(onBlank.heading).toBe('[2장]');
    expect(onBlank.nextText).toBe('[1장]\n첫 장 내용\n\n[2장]\n');
    expect(onBlank.nextCursor).toBe(onBlank.nextText.length);

    // CRLF 줄바꿈과 범위 밖 오프셋도 안전하게 처리한다.
    const crlf = insertStructureBlock('첫 줄\r\n둘째 줄', 1, 'bridge');
    expect(crlf.nextText).toBe('첫 줄\n[브릿지]\n\r\n둘째 줄');
    const clamped = insertStructureBlock('', Number.NaN, 'verse2');
    expect(clamped.nextText).toBe('[2절]\n');
  });

  it('웹툰 +컷 버튼은 컷 번호를 올리고 커서를 "장면: " 바로 뒤에 놓는다', () => {
    const cut1 = insertStructureBlock('', 0, 'cut');
    expect(cut1.nextText).toBe('[1컷]\n장면: \n대사: ');
    expect(cut1.nextText.slice(0, cut1.nextCursor)).toBe('[1컷]\n장면: ');
    expect(cut1.nextText.slice(cut1.nextCursor)).toBe('\n대사: ');

    const withScene = `${cut1.nextText.slice(0, cut1.nextCursor)}운동장 아침${cut1.nextText.slice(cut1.nextCursor)}안녕!`;
    const cut2 = insertStructureBlock(withScene, withScene.length, 'cut');
    expect(cut2.heading).toBe('[2컷]');
    expect(cut2.nextText.slice(0, cut2.nextCursor).endsWith('[2컷]\n장면: ')).toBe(true);
  });

  it('장편 현재 장 추출은 마지막 [N장]부터 끝까지를 뽑고 머리말이 없으면 전체를 돌려준다', () => {
    const noHeading = '아직 장 표시 없이 쓴 도입부';
    expect(extractCurrentChapter(noHeading)).toEqual({
      chapterNumber: null,
      heading: null,
      headingStart: 0,
      bodyStart: 0,
      end: noHeading.length,
      text: noHeading,
      body: noHeading,
    });

    const multi = '[1장]\n옛날 어느 마을에\n[2장]\n다음 날 아침 해가 떴다.\n새 길을 떠났다.';
    const slice = extractCurrentChapter(multi);
    expect(slice.chapterNumber).toBe(2);
    expect(slice.heading).toBe('[2장]');
    expect(slice.text).toBe('[2장]\n다음 날 아침 해가 떴다.\n새 길을 떠났다.');
    expect(slice.body).toBe('다음 날 아침 해가 떴다.\n새 길을 떠났다.');
  });

  it('Suno 가사 변환은 6종 노래 머리말만 영어 태그로 바꾸고 일반 대괄호는 보존한다', () => {
    const lyrics = [
      '[전주]',
      '[1절]',
      '운동장 바람 불어오면 [작은 새]',
      '[후렴]',
      '우리 함께 달려가자',
      '[간주]',
      '[2절] 햇살 아래 손잡고',
      '[브릿지]',
      '잠시 숨을 고르고',
      '[마무리]',
    ].join('\r\n');

    expect(toSunoLyrics(lyrics)).toBe(
      [
        '[Intro]',
        '[Verse 1]',
        '운동장 바람 불어오면 [작은 새]',
        '[Chorus]',
        '우리 함께 달려가자',
        '[Interlude]',
        '[Verse 2] 햇살 아래 손잡고',
        '[Bridge]',
        '잠시 숨을 고르고',
        '[Outro]',
      ].join('\n'),
    );
  });

  it('Suno 스타일 문구는 분위기·빠르기 칩을 영어로 합치고 직접 입력 분위기를 그대로 쓴다', () => {
    expect(isSongMoodId('lyrical-gugak')).toBe(true);
    expect(isSongMoodId('unknown')).toBe(false);
    expect(isSongTempoId('slow')).toBe(true);
    expect(isSongTempoId('rapid')).toBe(false);

    // PRD F-12 예시 검증
    expect(toSunoStylePrompt({ mood: 'lyrical-gugak', tempo: 'slow' })).toBe(
      'Korean traditional, gugak, lyrical, slow tempo',
    );
    expect(toSunoStylePrompt({ mood: 'energetic-march', tempo: 'fast' })).toBe(
      'energetic march, brass, uplifting, rhythmic, fast tempo',
    );
    expect(
      toSunoStylePrompt({ mood: 'custom', moodCustom: '  dreamy acoustic guitar ', tempo: 'medium' }),
    ).toBe('dreamy acoustic guitar, medium tempo');
    expect(toSunoStylePrompt({ mood: 'custom', moodCustom: '   ', tempo: 'fast' })).toBe('fast tempo');
    expect(toSunoStylePrompt({})).toBe('');
  });
});
