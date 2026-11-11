import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createTsSourceFile, getNodeLine } from './lib/ast.mjs';
import { isCliMain, isTestFile, REPO_ROOT, runCheckCli, toPosixRelative, walkFiles } from './lib/common.mjs';

const EMOJI_RE = /\p{Emoji_Presentation}|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const HANGUL_RE = /[가-힣ㄱ-ㅎㅏ-ㅣ\u1100-\u11FF\u3130-\u318F]/;
const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?|css|html|json)$/;
const CSS_HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/;
const CSS_FUNC_COLOR_RE = /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb|color)\s*\(/i;
const CSS_BACKDROP_RE = /\b(?:-webkit-)?backdrop-filter\s*:/i;
const CSS_GRADIENT_RE = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i;
const STUDENT_JARGON_TERMS = ['서버', '동기화', '브라우저', '버전', '오류 코드', '에러'];

/**
 * CSS 블록 주석을 줄바꿈만 남기고 지워 줄 번호를 보존한다.
 */
function stripCssComments(cssText) {
  return cssText.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
}

/**
 * 노드가 `throw new Error(...)` 같은 예외 던지기 문 안쪽인지 확인한다.
 */
function isInsideThrowStatement(node) {
  let cur = node.parent;
  while (cur) {
    if (ts.isThrowStatement(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * 1. 소스·문구 전체의 이모지 검사
 */
function checkEmojis(rootDir, violations) {
  const dirs = [path.join(rootDir, 'packages'), path.join(rootDir, 'apps')];
  for (const baseDir of dirs) {
    const files = walkFiles(baseDir, {
      filter: filePath => SOURCE_FILE_RE.test(filePath) && !isTestFile(filePath),
    });
    for (const filePath of files) {
      const relFile = toPosixRelative(rootDir, filePath);
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]?.match(EMOJI_RE);
        if (m) {
          violations.push({
            file: relFile,
            line: i + 1,
            rule: 'no-emoji',
            message: `이모지를 쓸 수 없습니다 (${m[0]})`,
          });
        }
      }
    }
  }
}

/**
 * 2. `apps/web/src/ui/` 아래 CSS(단 `tokens.css` 제외)의 금지 스타일 검사
 */
function checkUiCss(rootDir, violations) {
  const uiDir = path.join(rootDir, 'apps/web/src/ui');
  const cssFiles = walkFiles(uiDir, {
    filter: filePath => filePath.endsWith('.css') && path.basename(filePath) !== 'tokens.css',
  });

  for (const filePath of cssFiles) {
    const relFile = toPosixRelative(rootDir, filePath);
    const isNotebookLines = path.basename(filePath) === 'notebook-lines.css';
    const raw = fs.readFileSync(filePath, 'utf8');
    const stripped = stripCssComments(raw);
    const lines = stripped.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i] ?? '';
      const lineNo = i + 1;

      const hexMatch = lineText.match(CSS_HEX_COLOR_RE);
      const funcMatch = lineText.match(CSS_FUNC_COLOR_RE);
      if (hexMatch || funcMatch) {
        const found = hexMatch ? hexMatch[0] : funcMatch?.[0];
        violations.push({
          file: relFile,
          line: lineNo,
          rule: 'css-no-raw-color',
          message: `tokens.css 밖에서는 색 코드를 직접 쓸 수 없습니다 (${found})`,
        });
      }

      const shadowRe = /box-shadow\s*:\s*([^;}]+)/gi;
      for (const m of lineText.matchAll(shadowRe)) {
        const val = (m[1] ?? '').trim();
        if (!val.startsWith('var(--')) {
          violations.push({
            file: relFile,
            line: lineNo,
            rule: 'css-no-raw-shadow',
            message: `box-shadow 값은 토큰(var(--...))만 쓸 수 있습니다 (${val})`,
          });
        }
      }

      if (CSS_BACKDROP_RE.test(lineText)) {
        violations.push({
          file: relFile,
          line: lineNo,
          rule: 'css-no-backdrop-filter',
          message: 'backdrop-filter(유리 효과)는 쓸 수 없습니다',
        });
      }

      if (!isNotebookLines && CSS_GRADIENT_RE.test(lineText)) {
        violations.push({
          file: relFile,
          line: lineNo,
          rule: 'css-no-gradient',
          message: 'notebook-lines.css 밖에서는 그라데이션을 쓸 수 없습니다',
        });
      }
    }
  }
}

/**
 * 3. `apps/web/src/` 아래 `.tsx`의 `<select`와 직접 쓴 한국어 문자열 검사
 */
function checkWebTsx(rootDir, violations) {
  const webSrcDir = path.join(rootDir, 'apps/web/src');
  const tsxFiles = walkFiles(webSrcDir, {
    filter: filePath =>
      filePath.endsWith('.tsx') &&
      !isTestFile(filePath) &&
      !toPosixRelative(rootDir, filePath).endsWith('apps/web/src/ui/icons/icons.generated.tsx'),
  });

  for (const filePath of tsxFiles) {
    const relFile = toPosixRelative(rootDir, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const sf = createTsSourceFile(filePath, content);
    const selectLines = new Set();

    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (node.tagName.getText(sf) === 'select') {
          const line = getNodeLine(sf, node.tagName);
          selectLines.add(line);
          violations.push({
            file: relFile,
            line,
            rule: 'no-native-select',
            message: '기본 <select> 요소는 쓸 수 없습니다',
          });
        }
      }

      if (
        ts.isJsxText(node) ||
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        if (HANGUL_RE.test(node.text) && !isInsideThrowStatement(node)) {
          violations.push({
            file: relFile,
            line: getNodeLine(sf, node),
            rule: 'no-inline-korean',
            message: `화면 파일에 한국어 문자열을 직접 쓸 수 없습니다 (${JSON.stringify(node.text.trim())})`,
          });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);

    // JSX 파서가 놓칠 수 있는 비정형 `<select`도 함께 확인
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      if (!selectLines.has(lineNo) && /<select(?=[\s>/])/i.test(lines[i] ?? '')) {
        violations.push({
          file: relFile,
          line: lineNo,
          rule: 'no-native-select',
          message: '기본 <select> 요소는 쓸 수 없습니다',
        });
      }
    }
  }
}

/**
 * 4. `packages/core/src/copy/ko.ts`의 학생용 묶음(`ko.student`, `ko.errors`) 기술 용어 검사
 */
function checkStudentCopyJargon(rootDir, violations) {
  const koPath = path.join(rootDir, 'packages/core/src/copy/ko.ts');
  if (!fs.existsSync(koPath)) return;

  const relFile = toPosixRelative(rootDir, koPath);
  const sf = createTsSourceFile(koPath);

  function checkSubtreeStrings(sectionName, rootNode) {
    function walkNode(node) {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        const text = node.text;
        for (const term of STUDENT_JARGON_TERMS) {
          if (text.includes(term)) {
            violations.push({
              file: relFile,
              line: getNodeLine(sf, node),
              rule: 'student-copy-no-jargon',
              message: `ko.${sectionName} 문구에 기술 용어를 쓸 수 없습니다 (${term})`,
            });
          }
        }
      }
      ts.forEachChild(node, walkNode);
    }
    walkNode(rootNode);
  }

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'ko' &&
      node.initializer
    ) {
      let init = node.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) {
        for (const prop of init.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const propName =
              ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
                ? prop.name.text
                : prop.name.getText(sf);
            if (propName === 'student' || propName === 'errors') {
              checkSubtreeStrings(propName, prop.initializer);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
}

/**
 * 금지 목록 정적 검사(PLAN §10.1, PRD 8.10·8.11)를 실행한다.
 */
export function checkForbidden({ rootDir = REPO_ROOT } = {}) {
  const violations = [];
  checkEmojis(rootDir, violations);
  checkUiCss(rootDir, violations);
  checkWebTsx(rootDir, violations);
  checkStudentCopyJargon(rootDir, violations);
  return { violations };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkForbidden);
}
