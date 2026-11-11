import path from 'node:path';
import { extractModuleSpecifiers } from './lib/ast.mjs';
import { isCliMain, isTestFile, REPO_ROOT, runCheckCli, toPosixRelative, walkFiles } from './lib/common.mjs';

const CODE_FILE_RE = /\.[cm]?[jt]sx?$/;

/**
 * 경로가 대상 디렉터리 안쪽을 가리키는지 확인한다.
 */
function isInsideDir(targetDir, resolvedPath) {
  const rel = path.relative(targetDir, resolvedPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * `ui/` → `adapters/` 참조와 `core/domain/` → 외부 패키지 참조를 검사한다(PLAN §2.5, §10.1).
 * 예외: `apps/web/src/dev/**`는 개발 전용 화면이라 adapters를 바로 가져와도 된다(ADR-052).
 */
export function checkLayers({ rootDir = REPO_ROOT } = {}) {
  const violations = [];

  // 1. apps/web/src/ui/** 가 apps/web/src/adapters/** 를 가져오는지 검사
  const uiDir = path.join(rootDir, 'apps/web/src/ui');
  const adaptersDir = path.join(rootDir, 'apps/web/src/adapters');
  const uiFiles = walkFiles(uiDir, {
    filter: filePath => CODE_FILE_RE.test(filePath) && !isTestFile(filePath),
  });

  for (const filePath of uiFiles) {
    const relFile = toPosixRelative(rootDir, filePath);
    const specs = extractModuleSpecifiers(filePath);
    for (const { specifier, line } of specs) {
      let importsAdapters = false;
      if (specifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filePath), specifier);
        importsAdapters = isInsideDir(adaptersDir, resolved);
      } else if (/(?:^|\/)adapters(?:\/|$)/.test(specifier)) {
        importsAdapters = true;
      }

      if (importsAdapters) {
        violations.push({
          file: relFile,
          line,
          rule: 'ui-no-adapters',
          message: `ui/에서 adapters/를 직접 가져올 수 없습니다 (${specifier})`,
        });
      }
    }
  }

  // 2. packages/core/src/domain/** 가 상대 경로 밖(외부 패키지·node:)을 가져오는지 검사
  const domainDir = path.join(rootDir, 'packages/core/src/domain');
  const coreSrcDir = path.join(rootDir, 'packages/core/src');
  const domainFiles = walkFiles(domainDir, {
    filter: filePath => CODE_FILE_RE.test(filePath) && !isTestFile(filePath),
  });

  for (const filePath of domainFiles) {
    const relFile = toPosixRelative(rootDir, filePath);
    const specs = extractModuleSpecifiers(filePath);
    for (const { specifier, line } of specs) {
      if (!specifier.startsWith('.')) {
        violations.push({
          file: relFile,
          line,
          rule: 'domain-no-external',
          message: `domain/에서 외부 패키지나 내장 모듈을 가져올 수 없습니다 (${specifier})`,
        });
        continue;
      }

      const resolved = path.resolve(path.dirname(filePath), specifier);
      if (!isInsideDir(coreSrcDir, resolved)) {
        violations.push({
          file: relFile,
          line,
          rule: 'domain-no-external',
          message: `domain/에서 packages/core/src 밖을 가져올 수 없습니다 (${specifier})`,
        });
      }
    }
  }

  return { violations };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkLayers);
}
