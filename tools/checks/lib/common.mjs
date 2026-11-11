import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 저장소 기본 루트 경로 */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const DEFAULT_IGNORED_DIRS = new Set(['node_modules', 'dist', 'dist-devices', '.git', '.local']);

/**
 * 기준 폴더로부터 POSIX 슬래시(`/`) 상대 경로를 만든다.
 */
export function toPosixRelative(rootDir, filePath) {
  const rel = path.relative(rootDir, filePath);
  return rel.split(path.sep).join('/');
}

/**
 * 위반 한 건을 `파일:줄  규칙 이름  설명` 모양으로 포맷한다.
 */
export function formatViolation({ file, line, rule, message }) {
  return `${file}:${line}  ${rule}  ${message}`;
}

/**
 * 폴더를 재귀 순회하여 조건에 맞는 파일 경로 목록을 정렬해 돌려준다.
 * 폴더가 아직 없으면 빈 배열을 돌려준다.
 */
export function walkFiles(dirPath, options = {}) {
  if (!fs.existsSync(dirPath)) return [];
  const ignoredDirs = options.ignoredDirs ?? DEFAULT_IGNORED_DIRS;
  const filter = options.filter ?? (() => true);
  const results = [];

  function visit(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        visit(fullPath);
      } else if (entry.isFile()) {
        if (filter(fullPath, entry.name)) results.push(fullPath);
      }
    }
  }

  visit(dirPath);
  results.sort();
  return results;
}

/**
 * 시험 파일(`*.test.*`, `*.spec.*`)인지 판정한다.
 */
export function isTestFile(filePath) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

/**
 * CLI 인자에서 `--root <경로>`를 읽는다. 없으면 기본 저장소 루트를 돌려준다.
 */
export function parseCliRoot(argv = process.argv.slice(2)) {
  const idx = argv.indexOf('--root');
  if (idx !== -1 && argv[idx + 1]) {
    return path.resolve(argv[idx + 1]);
  }
  return REPO_ROOT;
}

/**
 * 현재 모듈이 직접 실행되었는지 확인한다.
 */
export function isCliMain(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(importMetaUrl);
}

/**
 * 검사 함수를 CLI 진입점으로 실행한다.
 */
export function runCheckCli(checkFn, argv = process.argv.slice(2)) {
  const rootDir = parseCliRoot(argv);
  const result = checkFn({ rootDir });
  if (result.skippedMessage) {
    console.log(result.skippedMessage);
    process.exitCode = 0;
    return result;
  }
  for (const v of result.violations) {
    console.log(formatViolation(v));
  }
  process.exitCode = result.violations.length > 0 ? 1 : 0;
  return result;
}
