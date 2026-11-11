import fs from 'node:fs';
import ts from 'typescript';

/**
 * 파일 확장자에 맞는 TypeScript SourceFile AST를 만든다.
 */
export function createTsSourceFile(filePath, content = fs.readFileSync(filePath, 'utf8')) {
  const kind = filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind);
}

/**
 * AST 노드의 1-기반 줄 번호를 구한다.
 */
export function getNodeLine(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/**
 * 소스 파일에서 정적 `import`, `export ... from`, 동적 `import()`, `import()` 타입의 모듈 경로를 모두 뽑는다.
 */
export function extractModuleSpecifiers(filePath, content = fs.readFileSync(filePath, 'utf8')) {
  const sf = createTsSourceFile(filePath, content);
  const specs = [];

  function addSpec(node, text) {
    specs.push({
      specifier: text,
      line: getNodeLine(sf, node),
    });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addSpec(node.moduleSpecifier, node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      addSpec(node.moduleSpecifier, node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        addSpec(arg, arg.text);
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      addSpec(node.argument.literal, node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return specs;
}

/**
 * AST 리터럴·산술 식 노드를 실제 값으로 계산한다(`configDefaults` 파싱용).
 */
export function evaluateLiteralAst(sf, node) {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return evaluateLiteralAst(sf, node.expression);
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text.replaceAll('_', ''));
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return -Number(evaluateLiteralAst(sf, node.operand));
  }
  if (ts.isBinaryExpression(node)) {
    const left = Number(evaluateLiteralAst(sf, node.left));
    const right = Number(evaluateLiteralAst(sf, node.right));
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.AsteriskToken:
        return left * right;
      case ts.SyntaxKind.PlusToken:
        return left + right;
      case ts.SyntaxKind.MinusToken:
        return left - right;
      case ts.SyntaxKind.SlashToken:
        return left / right;
    }
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(el => evaluateLiteralAst(sf, el));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const obj = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key =
          ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
            ? prop.name.text
            : prop.name.getText(sf);
        obj[key] = evaluateLiteralAst(sf, prop.initializer);
      }
    }
    return obj;
  }
  return undefined;
}

/**
 * `config.ts`에서 `configDefaults`의 키·값·줄 번호를 뽑는다.
 */
export function parseConfigDefaultsFile(filePath) {
  const entries = new Map();
  if (!fs.existsSync(filePath)) return entries;
  const sf = createTsSourceFile(filePath);

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'configDefaults' &&
      node.initializer
    ) {
      let init = node.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) {
        for (const prop of init.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const key =
              ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
                ? prop.name.text
                : prop.name.getText(sf);
            entries.set(key, {
              value: evaluateLiteralAst(sf, prop.initializer),
              line: getNodeLine(sf, prop.name),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return entries;
}

/**
 * `errors.ts`에서 `errorCatalog`의 오류 코드·줄 번호를 뽑는다.
 */
export function parseErrorCatalogFile(filePath) {
  const entries = new Map();
  if (!fs.existsSync(filePath)) return entries;
  const sf = createTsSourceFile(filePath);

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'errorCatalog' &&
      node.initializer
    ) {
      let init = node.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) {
        for (const prop of init.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const key =
              ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
                ? prop.name.text
                : prop.name.getText(sf);
            entries.set(key, {
              line: getNodeLine(sf, prop.name),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return entries;
}
