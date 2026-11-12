import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const distributionId = 'E3TFCRGRU1HG1Q';
const aclName = 'CreatedByCloudFront-write-ssamuniverse';
const aclId = '11111111-2222-3333-4444-555555555555';
const aclArn = `arn:aws:wafv2:us-east-1:111111111111:global/webacl/${aclName}/${aclId}`;
// 2026-11-13부터 배포는 갤러리와 함께 쓰는 공용 입구다(ADR-060). 세 동작 모두 ssam-viewer-request가 연결돼 있다.
const functionArn = 'arn:aws:cloudfront::111111111111:function/ssam-viewer-request';
const writeOnlyFunctionArn = 'arn:aws:cloudfront::111111111111:function/we-viewer-request';
const viewerRequest = arn => ({ Quantity: 1, Items: [{ EventType: 'viewer-request', FunctionARN: arn }] });
const visibility = { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: 'fixture' };

function rateRule() {
  return {
    Name: 'rate',
    Priority: 1,
    Action: { Block: {} },
    VisibilityConfig: visibility,
    Statement: {
      RateBasedStatement: {
        Limit: 42,
        AggregateKeyType: 'FORWARDED_IP',
        EvaluationWindowSec: 60,
        ForwardedIPConfig: { HeaderName: 'x-forwarded-for', FallbackBehavior: 'NO_MATCH' },
        ScopeDownStatement: { GeoMatchStatement: { CountryCodes: ['US'] } },
      },
    },
  };
}

function fixture(t, change = () => {}) {
  const local = join(root, '.local');
  mkdirSync(local, { recursive: true });
  const dir = mkdtempSync(join(local, 'aws-ops-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'owner');
  const serviceHome = join(dir, 'service home');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(home, '.writeessay-admin'), { recursive: true });
  // 실제 비밀값과 AWS 자격 증명에 접근하지 않는 격리된 시험 데이터다.
  writeFileSync(
    join(home, '.writeessay-admin/cloudfront-origin-secret'),
    'synthetic-origin-header-for-ops-fixture-only',
  );
  const cfg = {
    Aliases: { Quantity: 2, Items: ['write.ssamuniverse.com', 'gallery.ssamuniverse.com'] },
    ViewerCertificate: {
      ACMCertificateArn:
        'arn:aws:acm:us-east-1:111111111111:certificate/0786fe27-9015-418e-9a3f-18521a1c288b',
      SSLSupportMethod: 'sni-only',
      MinimumProtocolVersion: 'TLSv1.2_2021',
    },
    WebACLId: aclArn,
    HttpVersion: 'http2and3',
    IsIPV6Enabled: true,
    Origins: {
      Quantity: 3,
      Items: [
        { Id: 'unrelated', DomainName: 'unrelated.example.invalid' },
        { Id: 'write', DomainName: 'origin-write.ssamuniverse.com' },
        {
          Id: 'origin-gallery',
          DomainName: 'origin-gallery.ssamuniverse.com',
          CustomHeaders: {
            Quantity: 1,
            Items: [
              {
                HeaderName: 'x-gw-origin-auth',
                HeaderValue: 'synthetic-gallery-header-for-ops-fixture-only',
              },
            ],
          },
        },
      ],
    },
    DefaultCacheBehavior: {
      TargetOriginId: 'write',
      FunctionAssociations: viewerRequest(functionArn),
    },
    CacheBehaviors: {
      Quantity: 2,
      Items: ['/assets/*', '/art/*'].map(PathPattern => ({
        PathPattern,
        ResponseHeadersPolicyId: 'keep-response-policy',
        OriginRequestPolicyId: 'keep-origin-policy',
        FunctionAssociations: viewerRequest(functionArn),
      })),
    },
  };
  const acl = {
    Name: aclName,
    Id: aclId,
    ARN: aclArn,
    Description: 'keep description',
    DefaultAction: { Block: { CustomResponse: { ResponseCode: 403, CustomResponseBodyKey: 'blocked' } } },
    CustomResponseBodies: { blocked: { ContentType: 'TEXT_PLAIN', Content: 'blocked fixture' } },
    CaptchaConfig: { ImmunityTimeProperty: { ImmunityTime: 600 } },
    ChallengeConfig: { ImmunityTimeProperty: { ImmunityTime: 600 } },
    TokenDomains: ['write.ssamuniverse.com'],
    AssociationConfig: { RequestBody: { CLOUDFRONT: { DefaultSizeInspectionLimit: 'KB_32' } } },
    DataProtectionConfig: { DataProtections: [] },
    OnSourceDDoSProtectionConfig: { ALBLowReputationMode: 'ACTIVE_UNDER_DDOS' },
    Capacity: 123,
    LabelNamespace: 'read-only',
    ManagedByFirewallManager: false,
    VisibilityConfig: visibility,
    Rules: [
      {
        Name: 'common',
        Priority: 0,
        OverrideAction: { None: {} },
        VisibilityConfig: visibility,
        Statement: {
          ManagedRuleGroupStatement: {
            VendorName: 'AWS',
            Name: 'AWSManagedRulesCommonRuleSet',
            RuleActionOverrides: [
              { Name: 'ExistingOverride', ActionToUse: { Count: {} } },
              { Name: 'SizeRestrictions_BODY', ActionToUse: { Block: {} } },
            ],
          },
        },
      },
      rateRule(),
      {
        Name: 'bytes',
        Priority: 2,
        Action: { Block: {} },
        VisibilityConfig: visibility,
        Statement: {
          ByteMatchStatement: {
            SearchString: 'aGVsbG8=',
            PositionalConstraint: 'CONTAINS',
            FieldToMatch: { UriPath: {} },
            TextTransformations: [{ Priority: 0, Type: 'NONE' }],
          },
        },
      },
    ],
  };
  const state = {
    cfg,
    acl,
    associatedIds: [distributionId],
    keys: [],
    subscriptions: [],
    functionExists: true,
    userExists: true,
    topicExists: true,
  };
  change(state);
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  const fake = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.OPS_FIXTURE;
const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
const command = args.slice(0, 2).join(' ');
const entry = { command, args };
for (const flag of ['--cli-input-json', '--distribution-config', '--rules']) {
  if (args.includes(flag) && value(flag).startsWith('file://')) entry[flag] = JSON.parse(fs.readFileSync(value(flag).slice(7)));
}
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify(entry) + '\\n');
const output = data => console.log(typeof data === 'string' ? data : JSON.stringify(data));
if (state.fail === command) { console.error('fixture network failure'); process.exit(1); }
switch (command) {
  case 'sts get-caller-identity': output({ Account: '111111111111' }); break;
  case 'cloudfront describe-function':
    if (!state.functionExists) { console.error('An error occurred (NoSuchFunctionExists) when calling the DescribeFunction operation'); process.exit(254); }
    output({ ETag: 'fn-etag', FunctionSummary: { Name: value('--name'), FunctionMetadata: {
      FunctionARN: 'arn:aws:cloudfront::111111111111:function/' + value('--name'), Stage: value('--stage') } } }); break;
  case 'cloudfront get-distribution-config': output({ ETag: 'dist-etag', DistributionConfig: state.cfg }); break;
  case 'cloudfront get-distribution': output(args.includes('--query') ? state.cfg.WebACLId || 'None' : { Distribution: { DistributionConfig: state.cfg } }); break;
  case 'cloudfront list-distributions-by-web-acl-id': output({ DistributionList: {
    Quantity: state.associatedIds.length, Items: state.associatedIds.map(Id => ({ Id })), IsTruncated: state.truncated || false,
  } }); break;
  case 'wafv2 list-web-acls': output({ Name: '${aclName}', Id: '${aclId}', ARN: '${aclArn}' }); break;
  case 'wafv2 get-web-acl': output({ WebACL: state.acl, LockToken: 'lock' }); break;
  case 'wafv2 update-web-acl':
    state.acl = { ...state.acl, ...entry['--cli-input-json'] };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state)); break;
  case 'iam get-user':
    if (!state.userExists) { console.error('NoSuchEntity'); process.exit(1); }
    output({ User: { UserName: 'we-macmini' } }); break;
  case 'iam list-access-keys': output({ AccessKeyMetadata: state.keys }); break;
  case 'iam create-access-key': output({ AccessKey: { AccessKeyId: 'FIXTUREKEY00000000000',
    SecretAccessKey: state.invalidKey ? '' : 'synthetic-credential-for-fixture-only', Status: 'Active' } }); break;
  case 'sns list-topics': output({ Topics: state.topicExists ? [{ TopicArn: 'arn:aws:sns:us-east-1:111111111111:we-alerts' }] : [] }); break;
  case 'sns create-topic': output('arn:aws:sns:us-east-1:111111111111:we-alerts'); break;
  case 'sns list-subscriptions-by-topic': output({ Subscriptions: state.subscriptions }); break;
  case 'cloudfront update-distribution':
  case 'iam create-user': case 'iam put-user-policy': case 'iam delete-access-key':
  case 'sns subscribe': case 'cloudwatch put-metric-alarm': break;
  default: console.error('Unexpected fixture command ' + command); process.exit(99);
}
`;
  writeFileSync(join(bin, 'aws'), fake);
  writeFileSync(join(bin, 'id'), '#!/bin/sh\nexit 0\n');
  writeFileSync(
    join(bin, 'sudo'),
    `#!/bin/sh
printf 'sudo\\n' >> "$OPS_FIXTURE/local-calls"
shift 3
exec "$@"
`,
  );
  writeFileSync(
    join(bin, 'mv'),
    `#!/bin/sh
case "$*" in
  *aws-macmini-credentials*) [ "$OPS_FAIL_MOVE" != 1 ] || exit 1 ;;
esac
exec /bin/mv "$@"
`,
  );
  for (const name of ['aws', 'id', 'sudo', 'mv']) chmodSync(join(bin, name), 0o755);
  function run(script, args = [], extraEnv = {}) {
    const result = spawnSync('/bin/sh', [join(root, script), ...args], {
      env: {
        ...process.env,
        HOME: home,
        WE_HOME: serviceHome,
        WE_SERVICE_USER: 'wesvc',
        WE_CF_DIST_ID: distributionId,
        WE_WAF_ACL_NAME: '',
        AWS_PROFILE: 'fixture',
        PATH: `${bin}:${process.env.PATH}`,
        OPS_FIXTURE: dir,
        OPS_FAIL_MOVE: '0',
        ...extraEnv,
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    return result;
  }
  const calls = () =>
    existsSync(join(dir, 'calls.jsonl'))
      ? readFileSync(join(dir, 'calls.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line))
      : [];
  const mutations = () =>
    calls().filter(x => / (create-|update-|publish-|put-|subscribe|delete-)/.test(x.command));
  return { dir, serviceHome, state, run, calls, mutations };
}

const setup = 'ops/aws/setup-ops.sh';
const emergency = 'ops/cloudfront/emergency.sh';
const ok = result => assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

/**
 * 변경을 시작한 뒤에는 조회하지 않는다. 예외 하나: 연결된 함수를 게시하면 배포 ETag가 바뀌므로
 * 배포 갱신 바로 앞에서 배포 설정을 다시 읽는 것(실제 AWS, 2026-11-12)만 허용한다.
 */
function assertNoReadsAfterMutation(commands) {
  const firstMutation = commands.findIndex(x => / (create-|update-|publish-|put-|subscribe)/.test(x));
  const after = commands.slice(firstMutation);
  after.forEach((x, i) => {
    if (!/ (get-|list-|describe-)/.test(x)) return;
    const refresh =
      /cloudfront get-distribution-config/.test(x) &&
      /cloudfront update-distribution/.test(after[i + 1] ?? '');
    assert.equal(refresh, true, `변경 뒤 조회: ${x}`);
  });
}

test('setup dry-run은 기존 실제 함수 ARN으로 비교하고 변경 호출과 로컬 저장을 하지 않는다', t => {
  const f = fixture(t);
  const result = f.run(setup, ['ops@example.invalid']);
  ok(result);
  assert.doesNotMatch(result.stdout, /DefaultCacheBehavior\(\*\) viewer-request 함수 연결/);
  assert.deepEqual(f.mutations(), []);
  assert.equal(existsSync(f.serviceHome), false);
  assert.equal(existsSync(join(f.dir, 'local-calls')), false);
});

test('인증·네트워크 실패는 dry-run에서도 종료 코드 2로 이유를 알린다', t => {
  const f = fixture(t, s => {
    s.fail = 'sts get-caller-identity';
  });
  const result = f.run(setup, ['ops@example.invalid', '--skip-cloudfront']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /fixture network failure/);
  assert.deepEqual(f.mutations(), []);
});

test('emergency는 배포 연결 ARN으로 ACL을 찾아 선택 설정과 blob을 보존한다', t => {
  const f = fixture(t);
  ok(f.run(emergency, ['on']));
  const update = f.calls().find(x => x.command === 'wafv2 update-web-acl');
  assert.ok(update);
  const payload = update['--cli-input-json'];
  for (const field of [
    'DefaultAction',
    'Description',
    'CustomResponseBodies',
    'CaptchaConfig',
    'ChallengeConfig',
    'TokenDomains',
    'AssociationConfig',
    'DataProtectionConfig',
    'OnSourceDDoSProtectionConfig',
    'VisibilityConfig',
  ]) {
    assert.deepEqual(payload[field], f.state.acl[field], field);
  }
  assert.equal(payload.Scope, 'CLOUDFRONT');
  assert.equal(payload.LockToken, 'lock');
  assert.equal(payload.ARN, undefined);
  assert.equal(payload.Capacity, undefined);
  assert.equal(payload.ManagedByFirewallManager, undefined);
  assert.equal(update.args[update.args.indexOf('--cli-binary-format') + 1], 'base64');
  assert.equal(
    payload.Rules.find(r => r.Name === 'bytes').Statement.ByteMatchStatement.SearchString,
    'aGVsbG8=',
  );
  assert.deepEqual(payload.Rules.find(r => r.Name === 'rate').Statement.RateBasedStatement, {
    Limit: 3000,
    AggregateKeyType: 'IP',
    EvaluationWindowSec: 300,
  });
  assert.equal(
    f.calls().some(x => x.command === 'wafv2 list-web-acls'),
    false,
  );
});

test('setup은 선택 ACL 설정·기존 override·정적 파일 정책을 보존하고 올바른 원본을 고른다', t => {
  const f = fixture(t);
  ok(f.run(setup, ['ops@example.invalid', '--apply']));
  const update = f.calls().find(x => x.command === 'wafv2 update-web-acl');
  const payload = update['--cli-input-json'];
  for (const field of [
    'DefaultAction',
    'CustomResponseBodies',
    'CaptchaConfig',
    'ChallengeConfig',
    'TokenDomains',
    'AssociationConfig',
    'DataProtectionConfig',
    'OnSourceDDoSProtectionConfig',
  ])
    assert.deepEqual(payload[field], f.state.acl[field]);
  assert.equal(update.args[update.args.indexOf('--cli-binary-format') + 1], 'base64');
  const overrides = payload.Rules[0].Statement.ManagedRuleGroupStatement.RuleActionOverrides;
  assert.deepEqual(
    overrides.find(x => x.Name === 'ExistingOverride'),
    { Name: 'ExistingOverride', ActionToUse: { Count: {} } },
  );
  assert.deepEqual(overrides.find(x => x.Name === 'SizeRestrictions_BODY').ActionToUse, { Count: {} });
  assert.equal(overrides.filter(x => x.Name === 'SizeRestrictions_BODY').length, 1);
  assert.deepEqual(payload.Rules.find(r => r.Name === 'rate').Statement.RateBasedStatement, {
    Limit: 20000,
    AggregateKeyType: 'IP',
    EvaluationWindowSec: 300,
  });
  const cfg = f.calls().find(x => x.command === 'cloudfront update-distribution')['--distribution-config'];
  assert.equal(cfg.Origins.Items[0].CustomHeaders, undefined);
  assert.equal(cfg.Origins.Items[1].CustomHeaders.Items[0].HeaderName, 'x-we-origin-auth');
  for (const behavior of cfg.CacheBehaviors.Items) {
    assert.equal(behavior.TargetOriginId, 'write');
    assert.equal(behavior.ResponseHeadersPolicyId, 'keep-response-policy');
    assert.equal(behavior.OriginRequestPolicyId, 'keep-origin-policy');
  }
  const credentials = join(f.serviceHome, 'secrets/aws-macmini-credentials');
  assert.equal(existsSync(credentials), true);
  assert.match(
    readFileSync(credentials, 'utf8'),
    /^\[default\]\naws_access_key_id = FIXTUREKEY00000000000\n/,
  );
  const commands = f.calls().map(x => x.command);
  assertNoReadsAfterMutation(commands);
});

test('setup --apply는 공용 입구(ssam-viewer-request·gallery 원본·대체 도메인·인증서)를 그대로 두고 함수 코드를 게시하지 않는다', t => {
  const f = fixture(t);
  const before = structuredClone(f.state.cfg);
  ok(f.run(setup, ['ops@example.invalid', '--apply', '--skip-waf']));
  const calls = f.calls();
  // 함수 코드는 gallerywalk 저장소가 게시한다 — 글방 스크립트는 LIVE 판을 이름으로 조회만 한다.
  assert.deepEqual(
    calls.filter(x => /^cloudfront (create|update|publish|delete)-function$/.test(x.command)),
    [],
  );
  const lookup = calls.filter(x => x.command === 'cloudfront describe-function');
  assert.equal(lookup.length, 1);
  assert.equal(lookup[0].args[lookup[0].args.indexOf('--name') + 1], 'ssam-viewer-request');
  assert.equal(lookup[0].args[lookup[0].args.indexOf('--stage') + 1], 'LIVE');
  const update = calls.find(x => x.command === 'cloudfront update-distribution');
  assert.equal(update.args[update.args.indexOf('--if-match') + 1], 'dist-etag');
  const cfg = update['--distribution-config'];
  assert.deepEqual(cfg.DefaultCacheBehavior.FunctionAssociations, viewerRequest(functionArn));
  assert.deepEqual(
    cfg.CacheBehaviors.Items.map(b => [b.PathPattern, b.FunctionAssociations]),
    [
      ['/assets/*', viewerRequest(functionArn)],
      ['/art/*', viewerRequest(functionArn)],
    ],
  );
  assert.deepEqual(cfg.Aliases, before.Aliases);
  assert.deepEqual(cfg.ViewerCertificate, before.ViewerCertificate);
  assert.deepEqual(
    cfg.Origins.Items.find(o => o.Id === 'origin-gallery'),
    before.Origins.Items.find(o => o.Id === 'origin-gallery'),
  );
  assert.equal(cfg.Origins.Items.length, 3);
  // 원본 비밀값 회전(runbook 3)에서 바뀌는 것은 글방 원본 머리뿐이다.
  assert.deepEqual(
    cfg.Origins.Items.find(o => o.Id === 'write').CustomHeaders.Items.map(h => h.HeaderName),
    ['x-we-origin-auth'],
  );
});

for (const [label, change] of [
  [
    '기본 동작에 we-viewer-request(되돌린 상태)',
    s => {
      s.cfg.DefaultCacheBehavior.FunctionAssociations = viewerRequest(writeOnlyFunctionArn);
    },
  ],
  [
    '/art/* 동작에 다른 함수',
    s => {
      s.cfg.CacheBehaviors.Items[1].FunctionAssociations = viewerRequest(writeOnlyFunctionArn);
    },
  ],
  [
    'LIVE 공용 함수 없음',
    s => {
      s.functionExists = false;
    },
  ],
]) {
  for (const mode of ['--dry-run', '--apply']) {
    test(`setup ${mode}: ${label}이면 함수를 바꾸지 않고 변경 전에 중단한다`, t => {
      const f = fixture(t, change);
      const result = f.run(setup, ['ops@example.invalid', mode]);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /공용 입구/);
      assert.deepEqual(f.mutations(), []);
    });
  }
}

for (const script of [setup, emergency]) {
  for (const [label, change] of [
    [
      '다른 배포와 공유',
      s => {
        s.associatedIds.push('E1VKUXOJAO8KBE');
      },
    ],
    [
      '연결된 배포 없음',
      s => {
        s.associatedIds = [];
      },
    ],
    [
      '연결 목록 다음 페이지',
      s => {
        s.truncated = true;
      },
    ],
    [
      '대상 도메인 누락',
      s => {
        s.cfg.Aliases.Items = ['wrong.example.invalid'];
      },
    ],
    [
      '대상 원본 누락',
      s => {
        s.cfg.Origins.Items = [s.cfg.Origins.Items[0]];
      },
    ],
    [
      'ACL 연결 없음',
      s => {
        s.cfg.WebACLId = '';
      },
    ],
  ]) {
    test(`${script} ${label}이면 변경 전에 중단한다`, t => {
      const f = fixture(t, change);
      const result = f.run(script, script === setup ? ['ops@example.invalid', '--apply'] : ['on']);
      assert.notEqual(result.status, 0, result.stdout);
      assert.deepEqual(f.mutations(), []);
    });
  }
}

test('CommonRuleSet을 추가한 뒤 5개를 넘으면 CloudFront 변경 전 중단한다', t => {
  const f = fixture(t, s => {
    s.acl.Rules = [
      rateRule(),
      ...Array.from({ length: 4 }, (_, i) => ({
        Name: `other-${i}`,
        Priority: i + 2,
        Statement: { GeoMatchStatement: { CountryCodes: ['US'] } },
        Action: { Count: {} },
        VisibilityConfig: visibility,
      })),
    ];
  });
  const result = f.run(setup, ['ops@example.invalid', '--apply']);
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /5/);
  assert.deepEqual(f.mutations(), []);
});

test('새 속도 제한 규칙에도 IP와 300초를 명시한다', t => {
  const f = fixture(t, s => {
    s.acl.Rules = [s.acl.Rules[0]];
  });
  ok(f.run(setup, ['ops@example.invalid', '--apply']));
  const payload = f.calls().find(x => x.command === 'wafv2 update-web-acl')['--cli-input-json'];
  assert.deepEqual(payload.Rules.find(r => r.Statement.RateBasedStatement).Statement.RateBasedStatement, {
    Limit: 20000,
    AggregateKeyType: 'IP',
    EvaluationWindowSec: 300,
  });
});

test('기존 키와 로컬 자격 파일 누락 조합은 새 키 생성과 모든 변경 전에 중단한다', t => {
  const f = fixture(t, s => {
    s.keys = [{ AccessKeyId: 'EXISTINGFIXTUREKEY' }];
  });
  const result = f.run(setup, ['ops@example.invalid', '--apply']);
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /키/);
  assert.deepEqual(f.mutations(), []);
});

for (const [label, change, env] of [
  [
    '생성 실패',
    s => {
      s.fail = 'iam create-access-key';
    },
    {},
  ],
  [
    '잘못된 자격 응답',
    s => {
      s.invalidKey = true;
    },
    {},
  ],
  ['자격 파일 이동 실패', () => {}, { OPS_FAIL_MOVE: '1' }],
]) {
  test(`${label}는 빈 자격 파일과 저장 완료 메시지를 남기지 않는다`, t => {
    const f = fixture(t, change);
    const result = f.run(setup, ['ops@example.invalid', '--apply'], env);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(f.serviceHome, 'secrets/aws-macmini-credentials')), false);
    assert.doesNotMatch(result.stdout, /액세스 키 저장 완료/);
    const deletions = f.calls().filter(x => x.command === 'iam delete-access-key');
    assert.equal(deletions.length, label === '생성 실패' ? 0 : 1);
    if (deletions.length) assert.equal(deletions[0].args.at(-1), 'FIXTUREKEY00000000000');
  });
}

test('SNS는 이메일 부분 일치를 구독으로 인정하지 않는다', t => {
  const f = fixture(t, s => {
    s.subscriptions = [
      { Protocol: 'email', Endpoint: 'prefix-ops@example.invalid', SubscriptionArn: 'confirmed' },
    ];
  });
  ok(f.run(setup, ['ops@example.invalid', '--apply']));
  assert.equal(f.calls().filter(x => x.command === 'sns subscribe').length, 1);
});

test('SNS PendingConfirmation 정확 일치는 재구독 없이 확인 안내를 출력한다', t => {
  const f = fixture(t, s => {
    s.subscriptions = [
      { Protocol: 'email', Endpoint: 'ops@example.invalid', SubscriptionArn: 'PendingConfirmation' },
    ];
  });
  const result = f.run(setup, ['ops@example.invalid', '--apply']);
  ok(result);
  assert.match(result.stdout, /PendingConfirmation/);
  assert.equal(f.calls().filter(x => x.command === 'sns subscribe').length, 0);
});

test('마지막 조회 실패도 CloudFront와 WAF 변경 전에 전파한다', t => {
  const f = fixture(t, s => {
    s.fail = 'sns list-subscriptions-by-topic';
  });
  assert.notEqual(f.run(setup, ['ops@example.invalid', '--apply']).status, 0);
  assert.deepEqual(f.mutations(), []);
});

test('emergency dry-run은 변경 호출을 하지 않고 명시 ACL 불일치는 중단한다', t => {
  const f = fixture(t);
  ok(f.run(emergency, ['on', '--dry-run']));
  assert.deepEqual(f.mutations(), []);
  assert.notEqual(f.run(emergency, ['on', '--acl-name', 'we-edge']).status, 0);
  assert.deepEqual(f.mutations(), []);
});

test('함수가 빠진 동작에는 공용 함수를 연결하고, 처음 만드는 IAM 사용자·SNS도 사전 조회 후 실제 계정 ARN을 쓴다', t => {
  const f = fixture(t, s => {
    delete s.cfg.DefaultCacheBehavior.FunctionAssociations;
    s.cfg.CacheBehaviors = { Quantity: 0, Items: [] };
    s.userExists = false;
    s.topicExists = false;
    s.acl.Rules = [];
  });
  ok(f.run(setup, ['ops@example.invalid', '--apply']));
  const commands = f.calls().map(x => x.command);
  for (const command of ['iam create-user', 'iam create-access-key', 'sns create-topic', 'sns subscribe']) {
    assert.equal(commands.filter(x => x === command).length, 1, command);
  }
  assertNoReadsAfterMutation(commands);
  const cfg = f.calls().find(x => x.command === 'cloudfront update-distribution')['--distribution-config'];
  assert.deepEqual(cfg.DefaultCacheBehavior.FunctionAssociations, viewerRequest(functionArn));
  for (const behavior of cfg.CacheBehaviors.Items)
    assert.deepEqual(behavior.FunctionAssociations, viewerRequest(functionArn), behavior.PathPattern);
  const payload = f.calls().find(x => x.command === 'wafv2 update-web-acl')['--cli-input-json'];
  assert.equal(payload.Rules.length, 2);
});

test('기존 자격 파일이 있으면 기존 키와 파일을 유지한다', t => {
  const f = fixture(t, s => {
    s.keys = [{ AccessKeyId: 'EXISTINGFIXTUREKEY' }];
  });
  mkdirSync(join(f.serviceHome, 'secrets'), { recursive: true });
  const path = join(f.serviceHome, 'secrets/aws-macmini-credentials');
  writeFileSync(path, 'existing synthetic fixture');
  ok(f.run(setup, ['ops@example.invalid', '--apply']));
  assert.equal(readFileSync(path, 'utf8'), 'existing synthetic fixture');
  assert.equal(
    f.calls().some(x => x.command === 'iam create-access-key'),
    false,
  );
});

for (const command of ['iam get-user', 'iam list-access-keys', 'sns list-topics']) {
  test(`${command} 실패를 자원 부재로 처리하지 않고 변경 전에 중단한다`, t => {
    const f = fixture(t, s => {
      s.fail = command;
    });
    const result = f.run(setup, ['ops@example.invalid', '--apply']);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(f.mutations(), []);
  });
}

test('emergency off는 국가 차단을 해제하고 나머지 ACL 설정을 보존한다', t => {
  const f = fixture(t, s => {
    s.acl.Rules.push({
      Name: 'emergency-korea-only',
      Priority: 4,
      Statement: { GeoMatchStatement: { CountryCodes: ['KR'] } },
      Action: { Block: {} },
      VisibilityConfig: visibility,
    });
  });
  ok(f.run(emergency, ['off']));
  const payload = f.calls().find(x => x.command === 'wafv2 update-web-acl')['--cli-input-json'];
  assert.equal(
    payload.Rules.some(r => r.Name === 'emergency-korea-only'),
    false,
  );
  assert.deepEqual(payload.DefaultAction, f.state.acl.DefaultAction);
  assert.deepEqual(payload.Rules.find(r => r.Name === 'rate').Statement.RateBasedStatement, {
    Limit: 20000,
    AggregateKeyType: 'IP',
    EvaluationWindowSec: 300,
  });
});

test('emergency on이 5개 한도를 넘기면 변경하지 않는다', t => {
  const f = fixture(t, s => {
    s.acl.Rules.push(
      ...[3, 4].map(Priority => ({
        Name: `other-${Priority}`,
        Priority,
        Statement: { GeoMatchStatement: { CountryCodes: ['US'] } },
        Action: { Count: {} },
        VisibilityConfig: visibility,
      })),
    );
  });
  assert.notEqual(f.run(emergency, ['on']).status, 0);
  assert.deepEqual(f.mutations(), []);
});

for (const script of [setup, emergency]) {
  test(`${script} 보호 대상 배포 ID는 조회도 하지 않고 거부한다`, t => {
    const f = fixture(t);
    const result = f.run(script, script === setup ? ['ops@example.invalid', '--apply'] : ['on'], {
      WE_CF_DIST_ID: 'E3DFFMH3173961',
    });
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.calls(), []);
  });
}

test('emergency 인증 실패도 이유와 종료 코드 2를 반환한다', t => {
  const f = fixture(t, s => {
    s.fail = 'sts get-caller-identity';
  });
  const result = f.run(emergency, ['status']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /fixture network failure/);
  assert.deepEqual(f.mutations(), []);
});

for (const flags of [['--skip-cloudfront'], ['--skip-waf'], ['--skip-cloudfront', '--skip-waf']]) {
  test(`setup ${flags.join(' ')}는 해당 변경을 생략하고 감시 설정을 적용한다`, t => {
    const f = fixture(t);
    if (flags.includes('--skip-cloudfront')) {
      rmSync(join(f.dir, 'owner/.writeessay-admin/cloudfront-origin-secret'));
    }
    ok(f.run(setup, ['ops@example.invalid', '--apply', ...flags]));
    const commands = f.calls().map(x => x.command);
    assert.equal(commands.includes('cloudfront update-distribution'), !flags.includes('--skip-cloudfront'));
    assert.equal(commands.includes('wafv2 update-web-acl'), !flags.includes('--skip-waf'));
    assert.equal(commands.filter(x => x === 'cloudwatch put-metric-alarm').length, 2);
  });
}
