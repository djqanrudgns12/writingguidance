import { ko } from '@geulbang/core/copy';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { DownloadFile, DownloadPort } from '../ports/download.ts';
import {
  buildExportBundle,
  buildExportZip,
  downloadAll,
  type ExportAllOptions,
  type ExportDoc,
  type ExportResult,
  type ExportSummaryLabels,
} from './exportAll.ts';

// 2026-11-10T15:30Z = 한국 시각 2026-11-11 00:30
const NOW = Date.UTC(2026, 10, 10, 15, 30);
// 한국 시각 2026-11-11 10:05
const SUBMITTED_AT = Date.UTC(2026, 10, 11, 1, 5);

const LABELS: ExportSummaryLabels = {
  exportSummaryFileBase: ko.teacher.exportSummaryFileBase,
  exportSummaryTitleLabel: '제목',
  exportSummaryGenreLabel: '글 종류',
  exportSummaryStatusLabel: '제출 여부',
  exportSummarySubmittedAtLabel: '제출 시각',
  exportSummaryUntitled: '제목 없음',
  exportStatusSubmitted: '제출함',
  exportStatusDraft: '제출 전',
  exportStatusReopened: '다시 쓰는 중',
};

function options(scope: ExportAllOptions['scope']): ExportAllOptions {
  return { scope, now: NOW, timeZone: 'Asia/Seoul', labels: LABELS };
}

function doc(over: Partial<ExportDoc>): ExportDoc {
  return {
    nickname: '하늘별',
    genre: 'poem',
    subtype: null,
    purpose: null,
    title: '',
    body: '',
    status: 'SUBMITTED',
    submittedAt: SUBMITTED_AT,
    charCount: 0,
    ...over,
  };
}

function result(docs: ExportDoc[], room: Partial<ExportResult['room']> = {}): ExportResult {
  return { room: { className: '5학년 3반', title: '역사 글쓰기', schoolName: null, ...room }, docs };
}

// 서버 순서(참가자 들어온 순서 → 글 만든 순서)를 흉내 낸 가상 글
const CLASS_DOCS: ExportDoc[] = [
  doc({ title: '가을 하늘', body: '파란 하늘\n높은 구름' }),
  doc({
    nickname: '구름빵',
    genre: 'lyrics',
    body: '[1절]\n바다로 가요',
    status: 'DRAFT',
    submittedAt: null,
  }),
  doc({ title: '두 번째 시', body: '다시 쓰는 중', status: 'REOPENED' }),
  doc({ title: '세 번째 시', body: '눈' }),
];

describe('buildExportBundle (PRD F-21)', () => {
  it('zip 이름은 {수업명}_{학급명}_{YYYYMMDD}.zip', () => {
    expect(buildExportBundle(result(CLASS_DOCS), options('all')).zipName).toBe(
      '역사 글쓰기_5학년 3반_20261111.zip',
    );
    expect(
      buildExportBundle(result([], { className: '5/3반', title: ' 시:쓰기 ' }), options('all')).zipName,
    ).toBe('시_쓰기_5_3반_20261111.zip');
  });

  it('전체모음.md가 먼저, 학생별 별명_글종류.txt는 별명 가나다순, 같은 이름은 _2, _3', () => {
    const bundle = buildExportBundle(result(CLASS_DOCS), options('all'));
    expect(bundle.entries.map(e => e.name)).toEqual([
      '전체모음.md',
      '구름빵_노래 가사.txt',
      '하늘별_시.txt',
      '하늘별_시_2.txt',
      '하늘별_시_3.txt',
    ]);
    expect(bundle.docCount).toBe(4);
    // 같은 별명 안에서는 서버 순서를 지킨다
    expect(bundle.entries[3]?.text).toBe('두 번째 시\n\n다시 쓰는 중');
  });

  it('제출한 글만: 받은 목록에 섞여 온 쓰는 중·다시 쓰는 글도 빼고 번호를 다시 매긴다', () => {
    const bundle = buildExportBundle(result(CLASS_DOCS), options('submitted'));
    expect(bundle.entries.map(e => e.name)).toEqual(['전체모음.md', '하늘별_시.txt', '하늘별_시_2.txt']);
    expect(bundle.docCount).toBe(2);
    expect(bundle.entries[2]?.text).toBe('세 번째 시\n\n눈');
  });

  it('정리 뒤 같아진 이름·대소문자만 다른 이름도 충돌로 보고 번호를 붙인다', () => {
    const bundle = buildExportBundle(
      result([
        doc({ nickname: '별/빛' }),
        doc({ nickname: '별_빛' }),
        doc({ nickname: 'Sky', genre: 'news' }),
        doc({ nickname: 'sky', genre: 'news' }),
      ]),
      options('all'),
    );
    const names = bundle.entries.map(e => e.name);
    expect(names).toContain('별_빛_시.txt');
    expect(names).toContain('별_빛_시_2.txt');
    // 어느 쪽이 먼저인지는 별명 정렬이 정한다. 대소문자를 빼고 보면 하나는 그대로, 하나는 _2
    expect(
      names
        .filter(n => n.toLowerCase().startsWith('sky_'))
        .map(n => n.toLowerCase())
        .sort(),
    ).toEqual(['sky_기사.txt', 'sky_기사_2.txt']);
    expect(new Set(names.map(n => n.toLowerCase())).size).toBe(names.length);
  });

  it('학생 파일 내용은 제목 + 빈 줄 + 본문(제목이 없으면 본문만)', () => {
    const bundle = buildExportBundle(result(CLASS_DOCS), options('all'));
    expect(bundle.entries[1]?.text).toBe('[1절]\n바다로 가요');
    expect(bundle.entries[2]?.text).toBe('가을 하늘\n\n파란 하늘\n높은 구름');
  });

  it('전체모음.md: 학생별 제목·글 종류·제출 여부·제출 시각·본문', () => {
    const bundle = buildExportBundle(result(CLASS_DOCS), options('all'));
    expect(bundle.entries[0]?.text).toBe(
      [
        '# 역사 글쓰기 · 5학년 3반',
        '',
        '2026-11-11',
        '',
        '---',
        '',
        '## 구름빵',
        '',
        '- 제목: 제목 없음',
        '- 글 종류: 노래 가사',
        '- 제출 여부: 제출 전',
        '',
        '[1절]  ',
        '바다로 가요',
        '',
        '---',
        '',
        '## 하늘별',
        '',
        '- 제목: 가을 하늘',
        '- 글 종류: 시',
        '- 제출 여부: 제출함',
        '- 제출 시각: 2026-11-11 10:05',
        '',
        '파란 하늘  ',
        '높은 구름',
        '',
        '---',
        '',
        '## 하늘별',
        '',
        '- 제목: 두 번째 시',
        '- 글 종류: 시',
        '- 제출 여부: 다시 쓰는 중',
        '- 제출 시각: 2026-11-11 10:05',
        '',
        '다시 쓰는 중',
        '',
        '---',
        '',
        '## 하늘별',
        '',
        '- 제목: 세 번째 시',
        '- 글 종류: 시',
        '- 제출 여부: 제출함',
        '- 제출 시각: 2026-11-11 10:05',
        '',
        '눈',
        '',
      ].join('\n'),
    );
  });

  it('전체모음.md 본문의 마크다운 제목·인용·가로줄 모양 줄은 글자 그대로 보이게 막는다', () => {
    const bundle = buildExportBundle(
      result([doc({ body: '# 큰 소리\n> 화살표\n---\n#우리반\n\n=' })]),
      options('all'),
    );
    expect(bundle.entries[0]?.text).toContain('\\# 큰 소리  \n\\> 화살표  \n\\---  \n#우리반\n\n\\=');
    // 학생 파일은 원래 글 그대로
    expect(bundle.entries[1]?.text).toBe('# 큰 소리\n> 화살표\n---\n#우리반\n\n=');
  });

  it('글이 없으면 전체모음.md만 들고 docCount 0', () => {
    const bundle = buildExportBundle(
      result([doc({ status: 'DRAFT', submittedAt: null })]),
      options('submitted'),
    );
    expect(bundle.entries.map(e => e.name)).toEqual(['전체모음.md']);
    expect(bundle.docCount).toBe(0);
  });
});

describe('buildExportZip', () => {
  it('zip을 다시 풀면 같은 파일 목록과, BOM 붙은 UTF-8 내용이 나온다', async () => {
    const bundle = buildExportBundle(result(CLASS_DOCS), options('all'));
    const files = unzipSync(await buildExportZip(bundle, NOW));

    expect(Object.keys(files)).toEqual(bundle.entries.map(e => e.name));
    for (const entry of bundle.entries) {
      const bytes = files[entry.name];
      expect(bytes).toBeDefined();
      if (bytes === undefined) continue;
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(strFromU8(bytes.subarray(3))).toBe(entry.text);
    }
  });
});

describe('downloadAll', () => {
  it('zip Blob을 내려받기 포트로 넘기고 파일 이름·글 수를 돌려준다', async () => {
    const saved: DownloadFile[] = [];
    const port: DownloadPort = { save: file => void saved.push(file) };

    const done = await downloadAll(port, result(CLASS_DOCS), options('submitted'));

    expect(done).toEqual({ fileName: '역사 글쓰기_5학년 3반_20261111.zip', docCount: 2 });
    expect(saved).toHaveLength(1);
    const file = saved[0];
    expect(file?.name).toBe('역사 글쓰기_5학년 3반_20261111.zip');
    expect(file?.blob.type).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await (file?.blob ?? new Blob()).arrayBuffer()));
    expect(Object.keys(files)).toEqual(['전체모음.md', '하늘별_시.txt', '하늘별_시_2.txt']);
  });
});
