#!/bin/sh
# 쌤유 글방 AWS 앞단(CloudFront·WAF 남은 항목) 및 감시(IAM·SNS·CloudWatch) 설정 스크립트 — 기본값은 --dry-run(미리보기)이다.
#
# 왜 필요한가:
#   - 이미 생성된 세 번째 무료 배포(E3TFCRGRU1HG1Q, PLAN §15.6-1)에 아직 빠진 설정(viewer-request 함수, 원본 비밀 머리
#     x-we-origin-auth, /assets/* · /art/* 캐시 동작, HTTP/3·IPv6, WAF 본문 크기 예외·IP당 5분 20,000건 한도)과
#     최소 권한 감시(IAM we-macmini, SNS we-alerts, 알람 we-heartbeat-missing · we-cloudfront-5xx)를 AWS CLI로 맞춘다.
#   - PRD F-24 무백업 원칙에 따라 S3 백업 버킷·백업 암호화 키·백업 알람은 만들지 않는다(PLAN §15.1).
# 안전장치:
#   - 실수로 운영 설정을 바꾸지 않도록 기본 모드를 --dry-run으로 두고, --apply를 명시했을 때만 변경 API를 호출한다.
#   - 쌤유니버스(E1VKUXOJAO8KBE, cl-*)·rollingthunder(E3DFFMH3173961, rt-*) 배포와 자원은 절대 건드리지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법:
  sh ops/aws/setup-ops.sh <알림이메일> [CloudFront배포ID] [--dry-run | --apply] [옵션]

기본 동작은 --dry-run 이며, 변경 예정 항목만 검증·출력하고 AWS 자원은 수정하지 않습니다.
실제 반영하려면 확인 뒤 --apply 를 붙여 다시 실행하세요.

인자:
  알림이메일          SNS 장애 알림 구독 메일 주소
  CloudFront배포ID    대상 배포 ID (기본: E3TFCRGRU1HG1Q, 타 서비스 배포 ID는 거부)

모드 옵션:
  --dry-run           조회·검증만 수행하고 변경 API는 호출하지 않습니다 (기본값).
  --apply             검증한 CloudFront·WAF·SNS·IAM·CloudWatch 설정을 실제로 반영합니다.
  --skip-cloudfront   CloudFront 함수·배포 수정 단계를 건너뜁니다(콘솔에서 수동 반영한 경우).
  --skip-waf          WAF 웹 ACL 수정 단계를 건너뜁니다(콘솔에서 수동 반영한 경우).
  -h, --help          이 도움말을 보여 줍니다.
EOF
}

mode="dry-run"
skip_cf=0
skip_waf=0
email=""
dist_id=""

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
    --dry-run)
      mode="dry-run"
      shift
      ;;
    --apply)
      mode="apply"
      shift
      ;;
    --skip-cloudfront)
      skip_cf=1
      shift
      ;;
    --skip-waf)
      skip_waf=1
      shift
      ;;
    --*)
      echo "ERROR: 알 수 없는 옵션: $1 (--help 참고)" >&2
      exit 1
      ;;
    *)
      if [ -z "$email" ]; then
        email="$1"
      elif [ -z "$dist_id" ]; then
        dist_id="$1"
      else
        echo "ERROR: 인자가 너무 많습니다: $1 (--help 참고)" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

[ -n "$email" ] || { usage >&2; exit 1; }
case "$email" in
  *@*.*) ;;
  *) echo "ERROR: 이메일 형식이 올바르지 않습니다: $email" >&2; exit 1 ;;
esac

dist_id="${dist_id:-E3TFCRGRU1HG1Q}"
# 쌤유니버스·rollingthunder 운영 배포 ID 보호(PLAN §15.6-1)
case "$dist_id" in
  E1VKUXOJAO8KBE|E3DFFMH3173961)
    echo "ERROR: 다른 서비스(쌤유니버스·rollingthunder)의 CloudFront 배포($dist_id)는 수정할 수 없습니다" >&2
    exit 1
    ;;
esac

here="$(cd "$(dirname "$0")" && pwd -P)"
ops_root="$(cd "$here/.." && pwd -P)"
fn_file="$ops_root/cloudfront/viewer-request.js"
overrides_file="$ops_root/cloudfront/common-rule-overrides.json"
[ -f "$fn_file" ] || { echo "ERROR: 함수 파일이 없습니다: $fn_file" >&2; exit 1; }
[ -f "$overrides_file" ] || { echo "ERROR: WAF 예외 파일이 없습니다: $overrides_file" >&2; exit 1; }

export AWS_PROFILE="${AWS_PROFILE:-we}"
R_GLOBAL="us-east-1"
svc="${WE_SERVICE_USER:-wesvc}"
case "$svc" in
  clsvc|rtsvc|root|"") echo "ERROR: 허용되지 않는 서비스 계정: $svc" >&2; exit 1 ;;
esac
we_home="/Users/$svc/writeessay-server"
secrets_dir="$we_home/secrets"
origin_secret_file="$HOME/.writeessay-admin/cloudfront-origin-secret"

umask 077

if [ "$skip_cf" = "0" ]; then
  [ -s "$origin_secret_file" ] || {
    echo "ERROR: 원본 잠금 비밀값($origin_secret_file)이 없습니다 — 먼저 sh ops/we.sh origin-secret 을 실행하세요" >&2
    exit 1
  }
fi

if [ "$mode" = "apply" ]; then
  id "$svc" >/dev/null 2>&1 || { echo "ERROR: 서비스 계정 $svc 가 없습니다 — 먼저 sh ops/we.sh setup-host" >&2; exit 1; }
fi

svc_write() {
  (cd / && sudo -u "$svc" -H sh -c "umask 077; mkdir -p '$(dirname "$1")'; cat > '$1.tmp' && chmod 600 '$1.tmp' && mv '$1.tmp' '$1'")
}
svc_has() {
  (cd / && sudo -u "$svc" -H test -s "$1")
}

echo "모드: $mode (AWS_PROFILE=$AWS_PROFILE, 배포=$dist_id, 알림=$email)"
[ "$mode" = "dry-run" ] && echo "안내: 기본 --dry-run 모드이므로 변경 API는 부르지 않습니다. 실제 반영은 --apply 를 붙이세요."

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  if [ "$mode" = "dry-run" ]; then
    echo
    echo "[오프라인 dry-run 요약 — AWS 로그인 전이라 원격 조회 없이 예정 작업만 표시합니다]"
    [ "$skip_cf" = "0" ] && echo "  1. CloudFront 함수 we-viewer-request (cloudfront-js-2.0) 생성/갱신 및 LIVE 게시"
    [ "$skip_cf" = "0" ] && echo "  2. 배포 $dist_id 갱신: x-we-origin-auth 머리, HTTP/2+3, IPv6, /assets/* · /art/* 캐시 동작, viewer-request 연결"
    [ "$skip_waf" = "0" ] && echo "  3. WAF WebACL(배포 연결 WebACL 또는 we-edge): CommonRuleSet 4개 예외(SizeRestrictions_BODY 등) + IP당 5분 20,000건"
    echo "  4. SNS 주제 we-alerts + 이메일($email) 구독"
    echo "  5. 최소 권한 IAM 사용자 we-macmini (Writeessay 지표 + we-alerts 발송만, S3 백업 없음)"
    echo "  6. CloudWatch 알람 we-heartbeat-missing(15분) · we-cloudfront-5xx(10% 초과 10분)"
    echo "원격 상태까지 대조하려면 먼저 로그인하세요: aws login --profile $AWS_PROFILE"
    exit 0
  fi
  echo "ERROR: 먼저 AWS에 로그인하세요: aws login --profile $AWS_PROFILE" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ── 1 & 2. CloudFront 함수 및 배포 설정
web_acl_arn=""
if [ "$skip_cf" = "0" ]; then
  echo
  echo "== 1. CloudFront 함수 we-viewer-request"
  existing_fn="$(aws cloudfront list-functions --query "FunctionList.Items[?Name=='we-viewer-request'] | [0].Name" --output text)"
  fn_arn=""
  if [ "$mode" = "dry-run" ]; then
    if [ "$existing_fn" = "we-viewer-request" ]; then
      echo "[dry-run] 기존 함수 we-viewer-request 갱신 및 LIVE 게시 예정 ($fn_file)"
    else
      echo "[dry-run] 새 함수 we-viewer-request 생성(cloudfront-js-2.0) 및 LIVE 게시 예정 ($fn_file)"
    fi
    fn_arn="arn:aws:cloudfront::000000000000:function/we-viewer-request"
  else
    fn_cfg='{"Comment":"writeessay canonical host + x-we-client-ip","Runtime":"cloudfront-js-2.0"}'
    if [ "$existing_fn" = "we-viewer-request" ]; then
      dev_etag="$(aws cloudfront describe-function --name we-viewer-request --stage DEVELOPMENT --query ETag --output text)"
      aws cloudfront update-function --name we-viewer-request --if-match "$dev_etag" \
        --function-config "$fn_cfg" --function-code "fileb://$fn_file" >/dev/null
    else
      aws cloudfront create-function --name we-viewer-request \
        --function-config "$fn_cfg" --function-code "fileb://$fn_file" >/dev/null
    fi
    pub_etag="$(aws cloudfront describe-function --name we-viewer-request --stage DEVELOPMENT --query ETag --output text)"
    fn_arn="$(aws cloudfront publish-function --name we-viewer-request --if-match "$pub_etag" \
      --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text)"
    echo "함수 LIVE 게시 완료: $fn_arn"
  fi

  echo
  echo "== 2. CloudFront 배포 $dist_id 설정 보강"
  aws cloudfront get-distribution-config --id "$dist_id" --output json > "$tmp/dist-raw.json"
  python3 - "$tmp/dist-raw.json" "$origin_secret_file" "$fn_arn" "$tmp/dist-next.json" "$tmp/dist-etag" "$tmp/web-acl-arn" <<'PY'
import json
import sys

raw_path, secret_path, fn_arn, out_path, etag_path, acl_arn_path = sys.argv[1:7]
with open(raw_path, encoding="utf-8") as fh:
    raw = json.load(fh)
with open(secret_path, encoding="utf-8") as fh:
    secret = fh.read().strip()

if len(secret) < 32:
    sys.exit("ERROR: 원본 비밀값 길이가 너무 짧습니다(origin-secret 다시 확인)")

cfg = raw["DistributionConfig"]
etag = raw["ETag"]

CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
ALL_VIEWER_EXCEPT_HOST = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6"

changes = []
if cfg.get("HttpVersion") != "http2and3":
    changes.append(f"HttpVersion: {cfg.get('HttpVersion')} -> http2and3")
    cfg["HttpVersion"] = "http2and3"
if not cfg.get("IsIPV6Enabled", False):
    changes.append("IsIPV6Enabled: False -> True")
    cfg["IsIPV6Enabled"] = True

origins = cfg.get("Origins", {}).get("Items", [])
if not origins:
    sys.exit("ERROR: 배포에 원본(Origin)이 없습니다")
origin = origins[0]
origin_id = origin["Id"]

ch_items = list(origin.get("CustomHeaders", {}).get("Items", []))
found_hdr = False
for item in ch_items:
    if item.get("HeaderName", "").lower() == "x-we-origin-auth":
        found_hdr = True
        if item.get("HeaderValue") != secret:
            changes.append("Origin CustomHeader x-we-origin-auth 값 갱신")
            item["HeaderValue"] = secret
if not found_hdr:
    changes.append("Origin CustomHeader x-we-origin-auth 추가 (값 비공개)")
    ch_items.append({"HeaderName": "x-we-origin-auth", "HeaderValue": secret})
origin["CustomHeaders"] = {"Quantity": len(ch_items), "Items": ch_items}

fn_assoc = {
    "Quantity": 1,
    "Items": [{"FunctionARN": fn_arn, "EventType": "viewer-request"}],
}

default_cb = cfg["DefaultCacheBehavior"]
default_cb["ViewerProtocolPolicy"] = "redirect-to-https"
default_cb["CachePolicyId"] = default_cb.get("CachePolicyId") or CACHING_DISABLED
default_cb["OriginRequestPolicyId"] = default_cb.get("OriginRequestPolicyId") or ALL_VIEWER_EXCEPT_HOST
cur_fn = default_cb.get("FunctionAssociations", {}).get("Items", [])
if not any(x.get("EventType") == "viewer-request" and x.get("FunctionARN") == fn_arn for x in cur_fn):
    changes.append("DefaultCacheBehavior(*) viewer-request 함수 연결")
default_cb["FunctionAssociations"] = fn_assoc

cb_list = list(cfg.get("CacheBehaviors", {}).get("Items", []))
by_pattern = {b["PathPattern"]: b for b in cb_list}

for pattern in ("/assets/*", "/art/*"):
    entry = {
        "PathPattern": pattern,
        "TargetOriginId": origin_id,
        "TrustedSigners": {"Enabled": False, "Quantity": 0},
        "TrustedKeyGroups": {"Enabled": False, "Quantity": 0},
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
            "Quantity": 2,
            "Items": ["HEAD", "GET"],
            "CachedMethods": {"Quantity": 2, "Items": ["HEAD", "GET"]},
        },
        "SmoothStreaming": False,
        "Compress": True,
        "LambdaFunctionAssociations": {"Quantity": 0},
        "FunctionAssociations": fn_assoc,
        "FieldLevelEncryptionId": "",
        "CachePolicyId": CACHING_OPTIMIZED,
    }
    if pattern not in by_pattern:
        changes.append(f"CacheBehavior 추가: {pattern} (Managed-CachingOptimized)")
        cb_list.append(entry)
    else:
        idx = next(i for i, b in enumerate(cb_list) if b["PathPattern"] == pattern)
        if cb_list[idx].get("CachePolicyId") != CACHING_OPTIMIZED:
            changes.append(f"CacheBehavior 갱신: {pattern}")
        cb_list[idx] = entry

cfg["CacheBehaviors"] = {"Quantity": len(cb_list), "Items": cb_list}

with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(cfg, fh)
with open(etag_path, "w", encoding="utf-8") as fh:
    fh.write(etag)
with open(acl_arn_path, "w", encoding="utf-8") as fh:
    fh.write(cfg.get("WebACLId") or "")

print("배포 변경 항목 요약:", ", ".join(changes) if changes else "변경 필요 없음(이미 일치)")
PY

  web_acl_arn="$(cat "$tmp/web-acl-arn")"
  if [ "$mode" = "apply" ]; then
    aws cloudfront update-distribution --id "$dist_id" --if-match "$(cat "$tmp/dist-etag")" \
      --distribution-config "file://$tmp/dist-next.json" >/dev/null
    echo "CloudFront 배포 갱신 요청 완료 ($dist_id)"
  else
    echo "[dry-run] CloudFront update-distribution 호출 생략"
  fi
fi

# ── 3. CloudFront WAF WebACL 설정 (CommonRuleSet 4개 예외 + IP당 5분 20,000건)
if [ "$skip_waf" = "0" ]; then
  echo
  echo "== 3. WAF 웹 ACL(we-edge 또는 배포 연결 WebACL) 규칙 보강"
  if [ -z "$web_acl_arn" ]; then
    web_acl_arn="$(aws cloudfront get-distribution --id "$dist_id" --query 'Distribution.DistributionConfig.WebACLId' --output text 2>/dev/null || true)"
    [ "$web_acl_arn" = "None" ] && web_acl_arn=""
  fi

  acl_name=""
  acl_id=""
  if [ -n "$web_acl_arn" ]; then
    # ARN 형식: arn:aws:wafv2:us-east-1:<account>:global/webacl/<name>/<id>
    acl_name="$(printf '%s' "$web_acl_arn" | awk -F'/' '{print $(NF-1)}')"
    acl_id="$(printf '%s' "$web_acl_arn" | awk -F'/' '{print $NF}')"
  else
    found_acl="$(aws wafv2 list-web-acls --scope CLOUDFRONT --region "$R_GLOBAL" \
      --query "WebACLs[?Name=='we-edge'] | [0]" --output json)"
    if [ -n "$found_acl" ] && [ "$found_acl" != "null" ]; then
      acl_name="we-edge"
      acl_id="$(printf '%s' "$found_acl" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Id"])')"
    fi
  fi

  case "$acl_name" in
    rt-*|cl-*|*rollinthunder*|*classlearning*|*ssamuniverse*)
      echo "ERROR: 다른 서비스의 WebACL($acl_name)이 감지되어 중단합니다" >&2
      exit 1
      ;;
  esac

  if [ -z "$acl_name" ] || [ -z "$acl_id" ]; then
    echo "주의: 배포에 연결된 WebACL을 찾지 못했습니다. 콘솔에서 we-edge 연결 후 다시 실행하거나 --skip-waf 를 쓰세요." >&2
    [ "$mode" = "apply" ] && exit 1
  else
    aws wafv2 get-web-acl --scope CLOUDFRONT --region "$R_GLOBAL" \
      --name "$acl_name" --id "$acl_id" --output json > "$tmp/acl.json"

    python3 - "$tmp/acl.json" "$overrides_file" "$tmp" <<'PY'
import json
import sys

acl_path, ov_path, tmp = sys.argv[1:4]
with open(acl_path, encoding="utf-8") as fh:
    data = json.load(fh)
with open(ov_path, encoding="utf-8") as fh:
    overrides = json.load(fh)

acl = data["WebACL"]
rules = list(acl.get("Rules", []))
notes = []

has_common = False
for r in rules:
    mrs = r.get("Statement", {}).get("ManagedRuleGroupStatement")
    if mrs and mrs.get("Name") == "AWSManagedRulesCommonRuleSet":
        has_common = True
        r["OverrideAction"] = {"None": {}}
        mrs["RuleActionOverrides"] = overrides
        notes.append("AWSManagedRulesCommonRuleSet 4개 예외(SizeRestrictions_BODY 등) 적용")

if not has_common:
    prio = max((r.get("Priority", 0) for r in rules), default=-1) + 1
    rules.append(
        {
            "Name": "AWS-AWSManagedRulesCommonRuleSet",
            "Priority": prio,
            "OverrideAction": {"None": {}},
            "Statement": {
                "ManagedRuleGroupStatement": {
                    "VendorName": "AWS",
                    "Name": "AWSManagedRulesCommonRuleSet",
                    "RuleActionOverrides": overrides,
                }
            },
            "VisibilityConfig": {
                "SampledRequestsEnabled": True,
                "CloudWatchMetricsEnabled": True,
                "MetricName": "we-common-rules",
            },
        }
    )
    notes.append("AWSManagedRulesCommonRuleSet 규칙 추가(4개 예외 포함)")

rate_rule = next((r for r in rules if "RateBasedStatement" in r.get("Statement", {})), None)
if rate_rule:
    rate_rule["Statement"]["RateBasedStatement"]["Limit"] = 20000
    rate_rule["Action"] = {"Block": {}}
    notes.append("기존 RateBasedStatement 한도를 IP당 5분 20,000건으로 설정")
else:
    if len(rules) >= 5:
        sys.exit("ERROR: 무료 요금제 WAF 규칙 5개 한도가 차 있어 속도 제한 규칙을 추가할 수 없습니다")
    prio = max((r.get("Priority", 0) for r in rules), default=-1) + 1
    rules.append(
        {
            "Name": "we-rate-limit-ip-20k",
            "Priority": prio,
            "Action": {"Block": {}},
            "Statement": {"RateBasedStatement": {"Limit": 20000, "AggregateKeyType": "IP"}},
            "VisibilityConfig": {
                "SampledRequestsEnabled": True,
                "CloudWatchMetricsEnabled": True,
                "MetricName": "we-rate-limit-ip-20k",
            },
        }
    )
    notes.append("we-rate-limit-ip-20k (IP당 5분 20,000건) 규칙 추가")

with open(f"{tmp}/waf-rules.json", "w", encoding="utf-8") as fh:
    json.dump(rules, fh)
with open(f"{tmp}/waf-vis.json", "w", encoding="utf-8") as fh:
    json.dump(acl["VisibilityConfig"], fh)
with open(f"{tmp}/waf-lock", "w", encoding="utf-8") as fh:
    fh.write(data["LockToken"])
with open(f"{tmp}/waf-desc", "w", encoding="utf-8") as fh:
    fh.write(acl.get("Description") or "writeessay edge protection")

print(f"WebACL({acl['Name']}): " + ", ".join(notes) + f" (총 {len(rules)}/5 규칙)")
PY

    if [ "$mode" = "apply" ]; then
      aws wafv2 update-web-acl --scope CLOUDFRONT --region "$R_GLOBAL" \
        --name "$acl_name" --id "$acl_id" --lock-token "$(cat "$tmp/waf-lock")" \
        --default-action Allow={} --description "$(cat "$tmp/waf-desc")" \
        --cli-binary-format raw-in-base64-out \
        --rules "file://$tmp/waf-rules.json" --visibility-config "file://$tmp/waf-vis.json" >/dev/null
      printf '%s\n' "$acl_name" | svc_write "$we_home/aws/web-acl-name"
      echo "WAF WebACL 갱신 완료: $acl_name"
    else
      echo "[dry-run] WAF update-web-acl 호출 생략"
    fi
  fi
fi

# ── 4, 5, 6. SNS 알림 주제 · 최소 권한 IAM 사용자(we-macmini, 백업 없음) · CloudWatch 알람 2개
echo
echo "== 4~6. SNS(we-alerts) · IAM(we-macmini) · CloudWatch 알람(we-heartbeat-missing, we-cloudfront-5xx)"
if [ "$mode" = "dry-run" ]; then
  echo "[dry-run] 생성·갱신 예정:"
  echo "  - SNS 주제: we-alerts ($R_GLOBAL) + 이메일 구독($email)"
  echo "  - IAM 사용자: we-macmini (Writeessay 지표 PutMetricData + we-alerts Publish 권한만, S3 백업 없음)"
  echo "  - 자격 증명 저장: $secrets_dir/aws-macmini-credentials (권한 600, 이미 있으면 유지)"
  echo "  - 알람 1: we-heartbeat-missing (Namespace=Writeessay, EndToEndOK Sum < 1, 5분 x 3 = 15분)"
  echo "  - 알람 2: we-cloudfront-5xx (DistributionId=$dist_id, 5xxErrorRate > 10%, 5분 x 2 = 10분)"
  echo
  echo "[dry-run 완료] 위 내역을 실제 적용하려면 마지막에 --apply 를 붙여 실행하세요."
  exit 0
fi

topic="$(aws sns create-topic --region "$R_GLOBAL" --name we-alerts --query TopicArn --output text)"
printf '%s\n' "$topic" | svc_write "$we_home/aws/alerts-topic"
printf '%s\n' "$dist_id" | svc_write "$we_home/aws/distribution-id"

aws iam get-user --user-name we-macmini >/dev/null 2>&1 \
  || aws iam create-user --user-name we-macmini --tags Key=project,Value=writeessay >/dev/null

aws iam put-user-policy --user-name we-macmini --policy-name we-macmini-least-privilege --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {
      \"Sid\": \"HeartbeatMetricOnly\",
      \"Effect\": \"Allow\",
      \"Action\": \"cloudwatch:PutMetricData\",
      \"Resource\": \"*\",
      \"Condition\": { \"StringEquals\": { \"cloudwatch:namespace\": \"Writeessay\" } }
    },
    {
      \"Sid\": \"AlertPublishOnly\",
      \"Effect\": \"Allow\",
      \"Action\": \"sns:Publish\",
      \"Resource\": \"$topic\"
    }
  ]
}"

if ! svc_has "$secrets_dir/aws-macmini-credentials"; then
  aws iam create-access-key --user-name we-macmini --output json | python3 -c '
import json, sys
k = json.load(sys.stdin)["AccessKey"]
print("[default]\naws_access_key_id = %s\naws_secret_access_key = %s" % (k["AccessKeyId"], k["SecretAccessKey"]))
' | svc_write "$secrets_dir/aws-macmini-credentials"
  echo "IAM 액세스 키 저장 완료: $secrets_dir/aws-macmini-credentials (600, 화면 출력 없음)"
else
  echo "IAM 액세스 키 유지: $secrets_dir/aws-macmini-credentials (이미 존재)"
fi

if ! aws sns list-subscriptions-by-topic --region "$R_GLOBAL" --topic-arn "$topic" \
  --query 'Subscriptions[].Endpoint' --output text | grep -qF "$email"; then
  aws sns subscribe --region "$R_GLOBAL" --topic-arn "$topic" \
    --protocol email --notification-endpoint "$email" >/dev/null
  echo "SNS 구독 요청 발송 — 메일함에서 'AWS Notification - Subscription Confirmation' 확인 링크를 눌러 주세요."
fi

aws cloudwatch put-metric-alarm --region "$R_GLOBAL" \
  --alarm-name we-heartbeat-missing \
  --alarm-description "쌤유 글방 전체 경로(맥미니->CloudFront->터널->서버·웹소켓·원본잠금) 하트비트 15분 끊김" \
  --namespace Writeessay \
  --metric-name EndToEndOK \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 3 \
  --threshold 1 \
  --comparison-operator LessThanThreshold \
  --treat-missing-data breaching \
  --alarm-actions "$topic" \
  --ok-actions "$topic"

aws cloudwatch put-metric-alarm --region "$R_GLOBAL" \
  --alarm-name we-cloudfront-5xx \
  --alarm-description "쌤유 글방 CloudFront 5xx 오류율 10% 초과(10분) — 원본(맥미니) 장애 의심" \
  --namespace AWS/CloudFront \
  --metric-name 5xxErrorRate \
  --dimensions Name=DistributionId,Value="$dist_id" Name=Region,Value=Global \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$topic"

echo "AWS 앞단 및 감시 설정 완료. 다음 단계: sh ops/we.sh install-daemons watch && aws logout --profile $AWS_PROFILE"
