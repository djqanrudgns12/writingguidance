import fs from 'node:fs';
import path from 'node:path';
import { parseConfigDefaultsFile, parseErrorCatalogFile } from './lib/ast.mjs';
import { isCliMain, REPO_ROOT, runCheckCli, toPosixRelative } from './lib/common.mjs';

/**
 * 괄호 설명(`(기기 기준)`, `(10분 창)` 등)을 모두 떼어 낸다.
 */
function stripParentheses(text) {
  return text.replace(/\([^)]*\)/g, '').trim();
}

/**
 * 절 번호 참조(`6.4.1`, `9.3`처럼 숫자와 점만)인지 확인한다.
 */
function isSectionRef(text) {
  return /^\d+(?:\.\d+)+$/.test(text);
}

/**
 * PRD 값 칸 문자열에서 숫자들을 차례로 뽑아 단위(`MiB`, `KB` 등)와 쉼표를 반영한 숫자 목록으로 바꾼다.
 */
export function extractPrdNumbers(rawText) {
  const nums = [];
  const re = /(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(GiB|GB|MiB|MB|KiB|KB)?/gi;
  for (const m of rawText.matchAll(re)) {
    let n = Number((m[1] ?? '').replaceAll(',', ''));
    const unit = m[2]?.toUpperCase();
    if (unit === 'KB' || unit === 'KIB') n *= 1024;
    else if (unit === 'MB' || unit === 'MIB') n *= 1024 * 1024;
    else if (unit === 'GB' || unit === 'GIB') n *= 1024 * 1024 * 1024;
    nums.push(n);
  }
  return nums;
}

/**
 * `PRD.md` 12.3 설정 표·12.4 오류 코드 표와 `config.ts`·`errors.ts`가 양쪽으로 일치하는지 검사한다(PLAN §10.1).
 */
export function checkPrdSync({ rootDir = REPO_ROOT } = {}) {
  const prdPath = path.join(rootDir, 'PRD.md');
  const configPath = path.join(rootDir, 'packages/core/src/config.ts');
  const errorsPath = path.join(rootDir, 'packages/core/src/errors.ts');

  if (!fs.existsSync(prdPath) || !fs.existsSync(configPath) || !fs.existsSync(errorsPath)) {
    return { violations: [] };
  }

  const violations = [];
  const relPrd = toPosixRelative(rootDir, prdPath);
  const relConfig = toPosixRelative(rootDir, configPath);
  const relErrors = toPosixRelative(rootDir, errorsPath);

  const configMap = parseConfigDefaultsFile(configPath);
  const errorMap = parseErrorCatalogFile(errorsPath);

  const seenConfigKeys = new Set();
  const seenErrorCodes = new Set();

  const lines = fs.readFileSync(prdPath, 'utf8').split('\n');
  let section = null;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    const lineNo = i + 1;

    if (line.startsWith('### 12.3')) {
      section = '12.3';
      continue;
    }
    if (line.startsWith('### 12.4')) {
      section = '12.4';
      continue;
    }
    if (line.startsWith('### ') || line.startsWith('## ')) {
      section = null;
      continue;
    }

    if (section === '12.3' && line.startsWith('|')) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map(c => c.trim());
      if (cells.length < 2 || cells[0] === '키' || /^[-:\s]+$/.test(cells[0] ?? '')) continue;

      const keys = stripParentheses(cells[0] ?? '')
        .split(/\s+\/\s+/)
        .map(k => k.trim())
        .filter(Boolean);
      const valClean = stripParentheses(cells[1] ?? '');
      const rawVals = valClean
        .split(/\s+\/\s+/)
        .map(v => v.trim())
        .filter(Boolean);

      // 한 행의 값 칸 전체가 절 번호(예: 6.4.1) 하나이면 모든 키가 그 절을 가리킨다.
      const vals =
        rawVals.length === 1 && isSectionRef(rawVals[0] ?? '') ? keys.map(() => rawVals[0] ?? '') : rawVals;

      if (keys.length !== vals.length) {
        violations.push({
          file: relPrd,
          line: lineNo,
          rule: 'prd-sync-row-mismatch',
          message: `12.3 표 행의 키 수(${keys.length})와 값 수(${vals.length})가 맞지 않습니다`,
        });
        continue;
      }

      for (let k = 0; k < keys.length; k++) {
        const key = keys[k] ?? '';
        const prdVal = vals[k] ?? '';

        if (key.endsWith('*')) {
          const prefix = key.slice(0, -1);
          const matchedKeys = [...configMap.keys()].filter(ck => ck.startsWith(prefix));
          if (matchedKeys.length === 0) {
            violations.push({
              file: relPrd,
              line: lineNo,
              rule: 'prd-sync-missing-config',
              message: `PRD 12.3의 ${key}에 해당하는 키가 config.ts에 없습니다`,
            });
          } else {
            for (const mk of matchedKeys) seenConfigKeys.add(mk);
          }
          continue;
        }

        const cfgEntry = configMap.get(key);
        if (!cfgEntry) {
          violations.push({
            file: relPrd,
            line: lineNo,
            rule: 'prd-sync-missing-config',
            message: `PRD 12.3의 ${key}가 config.ts에 없습니다`,
          });
          continue;
        }

        seenConfigKeys.add(key);
        if (isSectionRef(prdVal)) continue;

        const cfgVal = cfgEntry.value;
        if (typeof cfgVal === 'number') {
          const nums = extractPrdNumbers(prdVal);
          if (nums.length !== 1 || nums[0] !== cfgVal) {
            violations.push({
              file: relConfig,
              line: cfgEntry.line,
              rule: 'prd-sync-value-mismatch',
              message: `${key} 기본값이 다릅니다 (PRD: ${prdVal} -> ${JSON.stringify(nums)}, config.ts: ${cfgVal})`,
            });
          }
        } else if (typeof cfgVal === 'boolean') {
          if (prdVal !== String(cfgVal)) {
            violations.push({
              file: relConfig,
              line: cfgEntry.line,
              rule: 'prd-sync-value-mismatch',
              message: `${key} 기본값이 다릅니다 (PRD: ${prdVal}, config.ts: ${cfgVal})`,
            });
          }
        } else if (typeof cfgVal === 'string') {
          if (prdVal !== cfgVal) {
            violations.push({
              file: relConfig,
              line: cfgEntry.line,
              rule: 'prd-sync-value-mismatch',
              message: `${key} 기본값이 다릅니다 (PRD: ${prdVal}, config.ts: ${cfgVal})`,
            });
          }
        } else if (Array.isArray(cfgVal) || (typeof cfgVal === 'object' && cfgVal !== null)) {
          const expectedNums = Array.isArray(cfgVal) ? cfgVal : Object.values(cfgVal);
          const actualNums = extractPrdNumbers(prdVal);
          const matches =
            actualNums.length === expectedNums.length &&
            actualNums.every((n, idx) => n === expectedNums[idx]);
          if (!matches) {
            violations.push({
              file: relConfig,
              line: cfgEntry.line,
              rule: 'prd-sync-value-mismatch',
              message: `${key} 기본값이 다릅니다 (PRD: ${JSON.stringify(actualNums)}, config.ts: ${JSON.stringify(expectedNums)})`,
            });
          }
        }
      }
    }

    if (section === '12.4' && line.startsWith('|')) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map(c => c.trim());
      if (cells.length < 2 || cells[0] === '코드' || /^[-:\s]+$/.test(cells[0] ?? '')) continue;

      const codes = stripParentheses(cells[0] ?? '')
        .split(/\s+\/\s+/)
        .map(c => c.trim())
        .filter(Boolean);

      for (const code of codes) {
        if (!errorMap.has(code)) {
          violations.push({
            file: relPrd,
            line: lineNo,
            rule: 'prd-sync-missing-error',
            message: `PRD 12.4의 오류 코드 ${code}가 errors.ts에 없습니다`,
          });
        } else {
          seenErrorCodes.add(code);
        }
      }
    }
  }

  for (const [key, entry] of configMap.entries()) {
    if (!seenConfigKeys.has(key)) {
      violations.push({
        file: relConfig,
        line: entry.line,
        rule: 'prd-sync-extra-config',
        message: `config.ts의 ${key}가 PRD 12.3 표에 없습니다`,
      });
    }
  }

  for (const [code, entry] of errorMap.entries()) {
    if (!seenErrorCodes.has(code)) {
      violations.push({
        file: relErrors,
        line: entry.line,
        rule: 'prd-sync-extra-error',
        message: `errors.ts의 오류 코드 ${code}가 PRD 12.4 표에 없습니다`,
      });
    }
  }

  return { violations };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkPrdSync);
}
