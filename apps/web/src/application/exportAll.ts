import { compactDateKey, compareNicknames, dayKey, type DocStatus } from '@geulbang/core';
import type { ApiOutput } from '@geulbang/core/api';
import type { Zippable } from 'fflate';
import type { DownloadPort } from '../ports/download.ts';
import {
  TEXT_FILE_EXT,
  composePlainText,
  encodeTextFile,
  genreLabelOf,
  joinFileName,
  sanitizeFileNamePart,
} from './exportStudent.ts';

/**
 * 교사 모두 내려받기(PRD F-21, PLAN §2.3 ⑩): 서버가 준 `exportResult`를 학생별 txt + `전체모음.md`로 나눠 zip 하나로 묶는다.
 * 묶기는 교사 브라우저에서 하고 `fflate`는 누를 때 불러온다(PLAN §6.7). AI 도움 표시 문구는 넣지 않는다.
 */

export type ExportResult = ApiOutput<'exportResult'>;
export type ExportDoc = ExportResult['docs'][number];
export type ExportScope = 'submitted' | 'all';

export const ZIP_MIME = 'application/zip';
const ZIP_EXT = '.zip';
const SUMMARY_EXT = '.md';

/**
 * `전체모음.md`에 들어가는 문구. 속성 이름을 `ko.teacher` 키와 같게 두어, 키가 생기면 화면이 `ko.teacher`를 그대로 넘긴다.
 * (`exportSummaryFileBase`만 지금 있고 나머지는 추가 요청 중)
 */
export interface ExportSummaryLabels {
  readonly exportSummaryFileBase: string;
  readonly exportSummaryTitleLabel: string;
  readonly exportSummaryGenreLabel: string;
  readonly exportSummaryStatusLabel: string;
  readonly exportSummarySubmittedAtLabel: string;
  readonly exportSummaryUntitled: string;
  readonly exportStatusSubmitted: string;
  readonly exportStatusDraft: string;
  readonly exportStatusReopened: string;
}

export interface ExportAllOptions {
  /** 시트에서 고른 범위. 서버도 같은 범위로 거르지만, 받은 목록을 한 번 더 걸러 범위 밖 글이 섞이지 않게 한다. */
  readonly scope: ExportScope;
  readonly now: number;
  /** 설정 `TIMEZONE`(zip 이름 날짜·제출 시각) */
  readonly timeZone: string;
  readonly labels: ExportSummaryLabels;
}

export interface ExportEntry {
  /** zip 안 파일 이름(정리·충돌 처리 끝난 것) */
  readonly name: string;
  readonly text: string;
}

export interface ExportBundle {
  /** `{수업명}_{학급명}_{YYYYMMDD}.zip` */
  readonly zipName: string;
  /** 첫 항목은 `전체모음.md`, 그 뒤로 학생별 `별명_글종류.txt`(별명 가나다순, 같은 별명은 서버 순서) */
  readonly entries: readonly ExportEntry[];
  /** 범위 안 글 수(0이면 화면이 "내려받을 글이 없어요"를 보일 수 있게) */
  readonly docCount: number;
}

export interface ExportDownloaded {
  readonly fileName: string;
  readonly docCount: number;
}

/** 대소문자만 다른 이름도 같은 파일로 보는 파일 시스템(Windows·macOS 기본)에 맞춘 비교 키. */
function collisionKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** 같은 이름이 이미 있으면 `_2`, `_3`…을 붙인다(PRD F-21). */
function claimFileName(parts: readonly string[], ext: string, used: Set<string>): string {
  let name = joinFileName(parts, ext);
  for (let n = 2; used.has(collisionKey(name)); n++) {
    name = joinFileName([...parts, String(n)], ext);
  }
  used.add(collisionKey(name));
  return name;
}

function statusLabel(status: DocStatus, labels: ExportSummaryLabels): string {
  switch (status) {
    case 'SUBMITTED':
      return labels.exportStatusSubmitted;
    case 'REOPENED':
      return labels.exportStatusReopened;
    case 'DRAFT':
      return labels.exportStatusDraft;
  }
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD HH:mm`(설정 시간대 기준) */
function formatDateTime(ms: number, timeZone: string): string {
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormatters.set(timeZone, f);
  }
  return `${dayKey(ms, timeZone)} ${f.format(ms)}`;
}

/** 줄 첫머리의 `# `·`>`는 제목·인용으로, `---`·`===`·`***` 줄은 가로줄·제목 밑줄로 읽히므로 `\`를 붙인다. */
const MD_BLOCK_MARKER = /^(\s{0,3})(?=#{1,6}(?:\s|$)|>)/u;
const MD_RULE_LINE = /^(\s{0,3})(?==+\s*$|-+\s*$|(?:[-*_]\s*){3,}$)/u;

function escapeMarkdownLine(line: string): string {
  if (MD_RULE_LINE.test(line)) return line.replace(MD_RULE_LINE, '$1\\');
  if (MD_BLOCK_MARKER.test(line)) return line.replace(MD_BLOCK_MARKER, '$1\\');
  return line;
}

/**
 * 전체 모음 안 본문. 마크다운 보기에서도 시·가사의 줄이 합쳐지지 않게, 다음 줄이 이어지는 줄 끝에 공백 두 칸(줄바꿈 표시)을 붙인다.
 * 메모장으로 열면 보이지 않는다.
 */
function markdownBody(body: string): string {
  const lines = body.replaceAll('\r\n', '\n').split('\n').map(escapeMarkdownLine);
  return lines
    .map((line, i) => {
      const next = lines[i + 1];
      return line.trim().length > 0 && next !== undefined && next.trim().length > 0 ? `${line}  ` : line;
    })
    .join('\n');
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function summarySection(doc: ExportDoc, options: ExportAllOptions): string {
  const { labels } = options;
  const title = oneLine(doc.title);
  const lines = [
    `## ${oneLine(doc.nickname)}`,
    '',
    `- ${labels.exportSummaryTitleLabel}: ${title.length > 0 ? title : labels.exportSummaryUntitled}`,
    `- ${labels.exportSummaryGenreLabel}: ${genreLabelOf(doc)}`,
    `- ${labels.exportSummaryStatusLabel}: ${statusLabel(doc.status, labels)}`,
  ];
  if (doc.submittedAt !== null) {
    lines.push(
      `- ${labels.exportSummarySubmittedAtLabel}: ${formatDateTime(doc.submittedAt, options.timeZone)}`,
    );
  }
  const body = doc.body.replaceAll('\r\n', '\n').trimEnd();
  if (body.trim().length > 0) lines.push('', markdownBody(body));
  return lines.join('\n');
}

function buildSummary(
  room: ExportResult['room'],
  docs: readonly ExportDoc[],
  options: ExportAllOptions,
): string {
  const heading = [room.title, room.className]
    .map(oneLine)
    .filter(part => part.length > 0)
    .join(' · ');
  const head = `# ${heading}\n\n${dayKey(options.now, options.timeZone)}`;
  return `${[head, ...docs.map(doc => summarySection(doc, options))].join('\n\n---\n\n')}\n`;
}

/** 범위 거르기 → 별명 가나다순(대시보드와 같은 순서, 같은 별명은 서버 순서 유지) → 파일 이름 정하기. fflate 없이 계산만 한다. */
export function buildExportBundle(result: ExportResult, options: ExportAllOptions): ExportBundle {
  const inScope =
    options.scope === 'submitted' ? result.docs.filter(doc => doc.status === 'SUBMITTED') : result.docs;
  // 빌드 대상이 ES2022라 `toSorted` 대신 복사 뒤 정렬(정렬은 안정적이라 같은 별명은 서버 순서 유지).
  const docs = [...inScope].sort((a, b) => compareNicknames(a.nickname, b.nickname));

  const zipName = joinFileName(
    [
      sanitizeFileNamePart(result.room.title),
      sanitizeFileNamePart(result.room.className),
      compactDateKey(options.now, options.timeZone),
    ],
    ZIP_EXT,
  );

  const used = new Set<string>();
  const summaryName = claimFileName(
    [sanitizeFileNamePart(options.labels.exportSummaryFileBase)],
    SUMMARY_EXT,
    used,
  );
  const fallbackPart = sanitizeFileNamePart(options.labels.exportSummaryUntitled);

  const studentEntries = docs.map((doc): ExportEntry => {
    const parts = [sanitizeFileNamePart(doc.nickname), sanitizeFileNamePart(genreLabelOf(doc))].filter(
      part => part.length > 0,
    );
    return {
      name: claimFileName(parts.length > 0 ? parts : [fallbackPart], TEXT_FILE_EXT, used),
      text: composePlainText(doc.title, doc.body),
    };
  });

  return {
    zipName,
    entries: [{ name: summaryName, text: buildSummary(result.room, docs, options) }, ...studentEntries],
    docCount: docs.length,
  };
}

/** 묶음을 zip 바이트로. 파일마다 UTF-8 + BOM, 한글 파일 이름은 fflate가 UTF-8 표시를 붙여 넣는다. */
export async function buildExportZip(bundle: ExportBundle, now: number): Promise<Uint8Array<ArrayBuffer>> {
  // 첫 화면 묶음을 가볍게 두려고 누를 때 불러온다(PLAN §6.7).
  const { zipSync } = await import('fflate');
  const files: Zippable = {};
  for (const entry of bundle.entries) {
    // fflate는 `instanceof Uint8Array`로 파일과 폴더를 가른다. 다른 실행 영역의 `TextEncoder`(jsdom 시험 환경 등)가 만든
    // 배열이면 폴더로 읽혀 zip이 깨지므로, 이 영역의 배열로 옮겨 넣는다.
    files[entry.name] = new Uint8Array(encodeTextFile(entry.text));
  }
  // fflate 결과를 ArrayBuffer 바탕 배열로 옮겨 Blob에 바로 넣는다.
  return zipSync(files, { mtime: now }).slice();
}

/** `내려받기` 시트의 `제출한 글만`·`모든 글`: zip을 만들어 내려받게 한다. */
export async function downloadAll(
  download: DownloadPort,
  result: ExportResult,
  options: ExportAllOptions,
): Promise<ExportDownloaded> {
  const bundle = buildExportBundle(result, options);
  const zip = await buildExportZip(bundle, options.now);
  download.save({ name: bundle.zipName, blob: new Blob([zip], { type: ZIP_MIME }) });
  return { fileName: bundle.zipName, docCount: bundle.docCount };
}
