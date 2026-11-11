import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkBundle } from './bundle.mjs';
import { checkForbidden } from './forbidden.mjs';
import { checkFreePlan } from './free-plan.mjs';
import { checkLayers } from './layers.mjs';
import { formatViolation, REPO_ROOT } from './lib/common.mjs';
import { checkPrdSync } from './prd-sync.mjs';

const CHECKS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(CHECKS_DIR, 'fixtures');
const LINE_FORMAT_RE = /^[^\s:]+:\d+ {2}[a-z0-9-]+ {2}.+$/;

function runCliScript(scriptName, rootDir) {
  const scriptPath = path.join(CHECKS_DIR, scriptName);
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, '--root', rootDir], {
      encoding: 'utf8',
    });
    return { code: 0, stdout: stdout.trim() };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: String(err.stdout ?? '').trim(),
    };
  }
}

describe('P1-4 정적 검사 도구 다섯 개', () => {
  describe('1. layers.mjs', () => {
    it('일부러 어긴 견본(fixtures/layers/bad)에서 ui→adapters 및 domain→외부 패키지 위반을 모두 잡는다', () => {
      const badRoot = path.join(FIXTURES_DIR, 'layers/bad');
      const { violations } = checkLayers({ rootDir: badRoot });
      const rules = violations.map(v => v.rule);
      assert.equal(violations.length, 4);
      assert.equal(rules.filter(r => r === 'ui-no-adapters').length, 2);
      assert.equal(rules.filter(r => r === 'domain-no-external').length, 2);
      for (const v of violations) {
        assert.match(formatViolation(v), LINE_FORMAT_RE);
      }

      const cli = runCliScript('layers.mjs', badRoot);
      assert.equal(cli.code, 1);
      assert.equal(cli.stdout.split('\n').length, 4);
    });

    it('고친 견본(fixtures/layers/good, dev 예외 포함)에서 통과한다', () => {
      const goodRoot = path.join(FIXTURES_DIR, 'layers/good');
      const { violations } = checkLayers({ rootDir: goodRoot });
      assert.deepEqual(violations, []);
    });

    it('지금 저장소에서 통과한다', () => {
      const { violations } = checkLayers({ rootDir: REPO_ROOT });
      assert.deepEqual(violations, []);
    });
  });

  describe('2. forbidden.mjs', () => {
    it('일부러 어긴 견본(fixtures/forbidden/bad)에서 이모지·CSS·<select·직접 쓴 한글·학생 기술 용어를 모두 잡는다', () => {
      const badRoot = path.join(FIXTURES_DIR, 'forbidden/bad');
      const { violations } = checkForbidden({ rootDir: badRoot });
      const ruleSet = new Set(violations.map(v => v.rule));

      assert.ok(ruleSet.has('no-emoji'));
      assert.ok(ruleSet.has('css-no-raw-color'));
      assert.ok(ruleSet.has('css-no-raw-shadow'));
      assert.ok(ruleSet.has('css-no-backdrop-filter'));
      assert.ok(ruleSet.has('css-no-gradient'));
      assert.ok(ruleSet.has('no-native-select'));
      assert.ok(ruleSet.has('no-inline-korean'));
      assert.ok(ruleSet.has('student-copy-no-jargon'));

      for (const v of violations) {
        assert.match(formatViolation(v), LINE_FORMAT_RE);
      }

      const cli = runCliScript('forbidden.mjs', badRoot);
      assert.equal(cli.code, 1);
    });

    it('고친 견본(fixtures/forbidden/good, tokens.css·notebook-lines.css·teacher 문구 예외 포함)에서 통과한다', () => {
      const goodRoot = path.join(FIXTURES_DIR, 'forbidden/good');
      const { violations } = checkForbidden({ rootDir: goodRoot });
      assert.deepEqual(violations, []);
    });

    it('지금 저장소에서 통과한다', () => {
      const { violations } = checkForbidden({ rootDir: REPO_ROOT });
      assert.deepEqual(violations, []);
    });
  });

  describe('3. bundle.mjs', () => {
    it('일부러 어긴 견본(fixtures/bundle/bad)에서 JS 한도·그림 한도·/dev/ 경로 혼입을 모두 잡는다', () => {
      const badRoot = path.join(FIXTURES_DIR, 'bundle/bad');
      const { violations } = checkBundle({ rootDir: badRoot });
      const ruleSet = new Set(violations.map(v => v.rule));

      assert.ok(ruleSet.has('bundle-js-budget'));
      assert.ok(ruleSet.has('bundle-art-budget'));
      assert.ok(ruleSet.has('bundle-no-dev-route'));

      for (const v of violations) {
        assert.match(formatViolation(v), LINE_FORMAT_RE);
      }

      const cli = runCliScript('bundle.mjs', badRoot);
      assert.equal(cli.code, 1);
    });

    it('고친 견본(fixtures/bundle/good)에서 통과한다', () => {
      const goodRoot = path.join(FIXTURES_DIR, 'bundle/good');
      const { violations } = checkBundle({ rootDir: goodRoot });
      assert.deepEqual(violations, []);
    });

    it('apps/web/dist가 없을 때 "빌드 없음, 건너뜀"과 종료 코드 0을 돌려준다', () => {
      const noDistRoot = path.join(FIXTURES_DIR, 'layers/good');
      const res = checkBundle({ rootDir: noDistRoot });
      assert.equal(res.skippedMessage, '빌드 없음, 건너뜀');
      assert.deepEqual(res.violations, []);

      const cli = runCliScript('bundle.mjs', noDistRoot);
      assert.equal(cli.code, 0);
      assert.equal(cli.stdout, '빌드 없음, 건너뜀');
    });

    it('지금 저장소에서 통과한다', () => {
      const { violations } = checkBundle({ rootDir: REPO_ROOT });
      assert.deepEqual(violations, []);
    });
  });

  describe('4. free-plan.mjs', () => {
    it('일부러 어긴 견본(fixtures/free-plan/bad)에서 유료 SDK와 키 이름을 모두 잡는다', () => {
      const badRoot = path.join(FIXTURES_DIR, 'free-plan/bad');
      const { violations } = checkFreePlan({ rootDir: badRoot });
      const ruleSet = new Set(violations.map(v => v.rule));

      assert.ok(ruleSet.has('free-plan-sdk'));
      assert.ok(ruleSet.has('free-plan-env'));
      assert.equal(violations.length, 7);

      for (const v of violations) {
        assert.match(formatViolation(v), LINE_FORMAT_RE);
      }

      const cli = runCliScript('free-plan.mjs', badRoot);
      assert.equal(cli.code, 1);
    });

    it('고친 견본(fixtures/free-plan/good, @anthropic-ai/sdk·ANTHROPIC_API_KEY 예외 포함)에서 통과한다', () => {
      const goodRoot = path.join(FIXTURES_DIR, 'free-plan/good');
      const { violations } = checkFreePlan({ rootDir: goodRoot });
      assert.deepEqual(violations, []);
    });

    it('지금 저장소에서 통과한다', () => {
      const { violations } = checkFreePlan({ rootDir: REPO_ROOT });
      assert.deepEqual(violations, []);
    });
  });

  describe('5. prd-sync.mjs', () => {
    it('일부러 어긴 견본(fixtures/prd-sync/bad)에서 짝 불일치·빠진 키·남는 키·값 불일치·오류 코드 불일치를 모두 잡는다', () => {
      const badRoot = path.join(FIXTURES_DIR, 'prd-sync/bad');
      const { violations } = checkPrdSync({ rootDir: badRoot });
      const ruleSet = new Set(violations.map(v => v.rule));

      assert.ok(ruleSet.has('prd-sync-row-mismatch'));
      assert.ok(ruleSet.has('prd-sync-missing-config'));
      assert.ok(ruleSet.has('prd-sync-extra-config'));
      assert.ok(ruleSet.has('prd-sync-value-mismatch'));
      assert.ok(ruleSet.has('prd-sync-missing-error'));
      assert.ok(ruleSet.has('prd-sync-extra-error'));

      for (const v of violations) {
        assert.match(formatViolation(v), LINE_FORMAT_RE);
      }

      const cli = runCliScript('prd-sync.mjs', badRoot);
      assert.equal(cli.code, 1);
    });

    it('고친 견본(fixtures/prd-sync/good)에서 통과한다', () => {
      const goodRoot = path.join(FIXTURES_DIR, 'prd-sync/good');
      const { violations } = checkPrdSync({ rootDir: goodRoot });
      assert.deepEqual(violations, []);
    });

    it('지금 저장소(PRD 12.3 설정 87개·12.4 오류 코드 32개)에서 통과한다', () => {
      const { violations } = checkPrdSync({ rootDir: REPO_ROOT });
      assert.deepEqual(violations, []);
    });
  });
});
