import { describe, expect, it } from 'vitest';
import type { DownloadFile, DownloadPort } from '../ports/download.ts';
import {
  buildStudentExport,
  encodeTextFile,
  joinFileName,
  sanitizeFileNamePart,
  saveStudentTextFile,
  textFileBlob,
  type StudentExportInput,
} from './exportStudent.ts';

// 2026-11-10T15:30Z = 한국 시각 2026-11-11 00:30(하루 경계를 설정 시간대로 세는지 본다)
const NOW = Date.UTC(2026, 10, 10, 15, 30);
const OPTIONS = { now: NOW, timeZone: 'Asia/Seoul' } as const;

function input(over: Partial<StudentExportInput>): StudentExportInput {
  return { genre: 'story', title: '', body: '', ...over };
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('buildStudentExport: 일반 글 (PRD F-12)', () => {
  it('글 복사·txt 내용은 제목 한 줄 + 빈 줄 + 본문, 파일 이름은 {제목}_{YYYYMMDD}.txt', () => {
    const out = buildStudentExport(
      input({ title: '  바다 이야기 ', body: '첫 줄\r\n둘째 줄\n\n셋째 문단' }),
      OPTIONS,
    );
    expect(out.text).toBe('바다 이야기\n\n첫 줄\n둘째 줄\n\n셋째 문단');
    expect(out.fileName).toBe('바다 이야기_20261111.txt');
    expect(out.suno).toBeNull();
  });

  it('제목이 비면 본문만 담고 파일 이름은 글 종류로 짓는다', () => {
    const out = buildStudentExport(
      input({ genre: 'news', title: '   ', body: '오늘 운동회가 열렸다.' }),
      OPTIONS,
    );
    expect(out.text).toBe('오늘 운동회가 열렸다.');
    expect(out.fileName).toBe('기사_20261111.txt');
  });

  it('정리하면 빈 제목(점만 있는 제목)도 글 종류로 짓는다', () => {
    const out = buildStudentExport(input({ genre: 'poem', title: '...', body: '가을' }), OPTIONS);
    expect(out.fileName).toBe('시_20261111.txt');
  });

  it('기타 글의 직접 입력 용도는 쓴 이름을 글 종류로 쓴다', () => {
    const out = buildStudentExport(
      input({ genre: 'other', purpose: 'custom', purposeCustom: '학급 장터 광고', body: '사세요' }),
      OPTIONS,
    );
    expect(out.fileName).toBe('학급 장터 광고_20261111.txt');
  });

  it('날짜는 설정 시간대의 하루 경계로 센다', () => {
    const utc = buildStudentExport(input({ title: '일기' }), { now: NOW, timeZone: 'UTC' });
    expect(utc.fileName).toBe('일기_20261110.txt');
  });

  it('파일 이름에 쓸 수 없는 글자가 든 제목을 정리한다', () => {
    const out = buildStudentExport(input({ title: '우리 반/1등?: "최고"' }), OPTIONS);
    expect(out.fileName).toBe('우리 반_1등__ _최고__20261111.txt');
  });
});

describe('buildStudentExport: 노래 가사 Suno 내보내기 (PRD F-12)', () => {
  const lyricsBody = [
    '[전주]',
    '[1절]',
    '파도가 부르는 노래',
    '[후렴]',
    '랄라 바다야',
    '[2절]',
    '모래 위 발자국',
    '[간주]',
    '[브릿지]',
    '바람이 불어와',
    '[마무리]',
  ].join('\n');

  it('머리말을 Suno 태그로 바꾸고, 글 복사·txt는 원래 머리말 그대로 둔다', () => {
    const out = buildStudentExport(
      input({
        genre: 'lyrics',
        title: '바다의 노래',
        body: lyricsBody,
        mood: 'lyrical-gugak',
        tempo: 'slow',
      }),
      OPTIONS,
    );
    expect(out.suno?.lyrics).toBe(
      [
        '[Intro]',
        '[Verse 1]',
        '파도가 부르는 노래',
        '[Chorus]',
        '랄라 바다야',
        '[Verse 2]',
        '모래 위 발자국',
        '[Interlude]',
        '[Bridge]',
        '바람이 불어와',
        '[Outro]',
      ].join('\n'),
    );
    expect(out.suno?.style).toBe('Korean traditional, gugak, lyrical, slow tempo');
    expect(out.text).toBe(`바다의 노래\n\n${lyricsBody}`);
    expect(out.fileName).toBe('바다의 노래_20261111.txt');
  });

  it('직접 입력 분위기는 쓴 글자 그대로 스타일 문구에 넣는다', () => {
    const out = buildStudentExport(
      input({
        genre: 'lyrics',
        body: '[1절]\n가',
        mood: 'custom',
        moodCustom: ' 캠프파이어 노래 ',
        tempo: 'fast',
      }),
      OPTIONS,
    );
    expect(out.suno?.style).toBe('캠프파이어 노래, fast tempo');
  });

  it('칩을 고르지 않았으면 스타일 문구는 빈 문자열', () => {
    const out = buildStudentExport(input({ genre: 'lyrics', body: '[후렴]\n랄라' }), OPTIONS);
    expect(out.suno).toEqual({ lyrics: '[Chorus]\n랄라', style: '' });
    expect(out.fileName).toBe('노래 가사_20261111.txt');
  });

  it('노래 가사가 아닌 글은 머리말 모양이 있어도 Suno 내보내기가 없다', () => {
    const out = buildStudentExport(input({ genre: 'poem', body: '[1절]\n가' }), OPTIONS);
    expect(out.suno).toBeNull();
  });
});

describe('sanitizeFileNamePart', () => {
  it('Windows·macOS에서 쓸 수 없는 글자는 밑줄로 바꾼다', () => {
    expect(sanitizeFileNamePart('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('제어·서식 문자(방향 바꾸기 포함)는 지운다', () => {
    expect(sanitizeFileNamePart('글\u202Etxt.exe')).toBe('글txt.exe');
    expect(sanitizeFileNamePart('가\u0007나\u200B다')).toBe('가나다');
  });

  it('줄바꿈·탭·겹친 공백은 한 칸으로 줄이고 앞뒤 공백·점을 지운다', () => {
    expect(sanitizeFileNamePart('  우리\n반\t\t이야기  ')).toBe('우리 반 이야기');
    expect(sanitizeFileNamePart('. .숨김 글. . ')).toBe('숨김 글');
    expect(sanitizeFileNamePart('...')).toBe('');
  });

  it('NFC로 맞춘다(풀어 쓴 자모도 같은 이름)', () => {
    expect(sanitizeFileNamePart('\u1100\u1161\u1102\u1161')).toBe('가나');
  });

  it('조각 하나를 120바이트로 자르되 글자를 반으로 자르지 않는다', () => {
    expect(sanitizeFileNamePart('가'.repeat(100))).toBe('가'.repeat(40));
    const wide = '\u{20000}'.repeat(40); // 4바이트 글자(서로게이트 쌍)
    expect(sanitizeFileNamePart(wide)).toBe('\u{20000}'.repeat(30));
  });

  it('자른 끝에 남은 공백은 지운다', () => {
    expect(sanitizeFileNamePart(`${'가'.repeat(39)} 나다`)).toBe('가'.repeat(39));
  });
});

describe('joinFileName', () => {
  it('빈 조각은 빼고 밑줄로 잇는다', () => {
    expect(joinFileName(['', '기사', '20261111'], '.txt')).toBe('기사_20261111.txt');
  });

  it('첫 점 앞이 Windows 예약 이름이면 앞에 밑줄을 붙인다', () => {
    expect(joinFileName(['CON'], '.txt')).toBe('_CON.txt');
    expect(joinFileName(['com1.abc', '20261111'], '.txt')).toBe('_com1.abc_20261111.txt');
    expect(joinFileName(['CONTENT'], '.txt')).toBe('CONTENT.txt');
  });
});

describe('텍스트 파일 바이트: UTF-8 + BOM (PLAN §6.7)', () => {
  it('BOM(EF BB BF) 뒤에 UTF-8 본문', () => {
    expect([...encodeTextFile('가')]).toEqual([0xef, 0xbb, 0xbf, 0xea, 0xb0, 0x80]);
  });

  it('이미 BOM으로 시작하는 글에도 BOM은 하나만', () => {
    expect([...encodeTextFile('\uFEFF가')]).toEqual([0xef, 0xbb, 0xbf, 0xea, 0xb0, 0x80]);
  });

  it('Blob은 text/plain UTF-8', async () => {
    const blob = textFileBlob('나');
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect([...(await blobBytes(blob))]).toEqual([0xef, 0xbb, 0xbf, 0xeb, 0x82, 0x98]);
  });
});

describe('saveStudentTextFile', () => {
  it('정한 파일 이름과 BOM 붙은 txt를 내려받기 포트로 넘긴다', async () => {
    const saved: DownloadFile[] = [];
    const port: DownloadPort = { save: file => void saved.push(file) };
    const out = buildStudentExport(input({ title: '가을', body: '낙엽' }), OPTIONS);

    saveStudentTextFile(port, out);

    expect(saved).toHaveLength(1);
    const file = saved[0];
    expect(file?.name).toBe('가을_20261111.txt');
    expect(file?.blob.type).toBe('text/plain;charset=utf-8');
    const bytes = await blobBytes(file?.blob ?? new Blob());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.subarray(3))).toBe('가을\n\n낙엽');
  });
});
