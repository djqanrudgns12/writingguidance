#!/bin/sh
# 쌤유 글방 CloudFront 연결 WAF 공격 대응 모드 전환 스크립트 — HTTP 홍수 공격 시 해외 접속을 막고 IP 한도를 낮춘다.
#
# 사용법:
#   sh ops/cloudfront/emergency.sh status               현재 WAF 규칙·속도 제한 상태 조회
#   sh ops/cloudfront/emergency.sh on [--dry-run]       한국(KR) 외 차단 + IP당 5분 3,000건으로 강화
#   sh ops/cloudfront/emergency.sh off [--dry-run]      평시 복귀(국가 차단 해제 + IP당 5분 20,000건)
#   sh ops/cloudfront/emergency.sh --help               도움말 출력
#
# 안전장치:
#   - 대상 배포에 연결되고 그 배포만 사용하는 WAF 웹 ACL만 다룬다.
#   - 평시 한도는 학교 공인 IP 공유(교실 30대 동시 사용)를 고려해 IP당 5분 20,000건으로 유지한다(PLAN §15.1, §15.6-1).
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/cloudfront/emergency.sh <status|on|off> [--dry-run] [--acl-name <이름>]

글방 배포의 WebACLId(ARN)로 연결된 WAF 웹 ACL을 찾아 조회하거나 전환합니다(AWS 로그인 필요).

명령:
  status      현재 공격 대응 모드 여부, IP당 5분 속도 제한 수치, 규칙 수를 조회합니다(기본값).
  on          한국(KR) 외 접속을 차단하고 IP당 5분 요청 한도를 3,000건으로 낮춥니다.
  off         국가 제한 규칙을 빼고 IP당 5분 요청 한도를 평시(20,000건)로 되돌립니다.

옵션:
  --dry-run           변경될 규칙 구성을 확인만 하고 AWS에 반영하지 않습니다.
  --acl-name <이름>   연결된 WebACL 이름이 이 값과 같은지 추가 확인합니다($WE_WAF_ACL_NAME도 동일).
  -h, --help          이 도움말을 보여 줍니다.

대상 배포는 $WE_CF_DIST_ID 또는 E3TFCRGRU1HG1Q입니다.
EOF
}

mode=""
dry_run=0
expected_acl_name="${WE_WAF_ACL_NAME:-}"
dist_id="${WE_CF_DIST_ID:-E3TFCRGRU1HG1Q}"

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
    status|on|off)
      mode="$1"
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --acl-name)
      [ $# -ge 2 ] || { echo "ERROR: --acl-name 뒤에 이름이 필요합니다" >&2; exit 1; }
      expected_acl_name="$2"
      shift 2
      ;;
    *)
      echo "ERROR: 알 수 없는 인자: $1 (--help 참고)" >&2
      exit 1
      ;;
  esac
done

mode="${mode:-status}"

case "$dist_id" in
  E1VKUXOJAO8KBE|E3DFFMH3173961)
    echo "ERROR: 다른 서비스의 배포($dist_id)는 건드릴 수 없습니다" >&2
    exit 1
    ;;
esac

export AWS_PROFILE="${AWS_PROFILE:-we}"
export AWS_REGION=us-east-1
NORMAL_LIMIT=20000
EMERGENCY_LIMIT=3000

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' HUP INT TERM

if ! aws sts get-caller-identity >/dev/null 2> "$tmp/identity-error"; then
  cat "$tmp/identity-error" >&2
  echo "ERROR: AWS 인증·연결 확인에 실패했습니다. 로그인 확인: aws login --profile $AWS_PROFILE" >&2
  exit 2
fi

aws cloudfront get-distribution --id "$dist_id" --output json > "$tmp/distribution.json"
python3 - "$tmp" "$expected_acl_name" <<'PY'
import json
import re
import sys

tmp, expected_name = sys.argv[1:3]
with open(f"{tmp}/distribution.json", encoding="utf-8") as fh:
    cfg = json.load(fh)["Distribution"]["DistributionConfig"]
if "write.ssamuniverse.com" not in cfg.get("Aliases", {}).get("Items", []):
    sys.exit("ERROR: 대상 배포의 Aliases에 write.ssamuniverse.com이 없습니다")
origins = [o for o in cfg.get("Origins", {}).get("Items", [])
           if o.get("DomainName") == "origin-write.ssamuniverse.com"]
if len(origins) != 1:
    sys.exit("ERROR: origin-write.ssamuniverse.com 원본이 정확히 하나여야 합니다")
arn = cfg.get("WebACLId") or ""
match = re.fullmatch(r"arn:aws:wafv2:us-east-1:\d{12}:global/webacl/([\w-]+)/([\w-]+)", arn)
if not match:
    sys.exit("ERROR: 배포에 연결된 WAFv2 WebACL ARN이 없습니다")
name, acl_id = match.groups()
if expected_name and name != expected_name:
    sys.exit("ERROR: 지정한 WebACL 이름이 배포에 연결된 ACL과 다릅니다")
for key, value in (("acl-name", name), ("acl-id", acl_id), ("acl-arn", arn)):
    with open(f"{tmp}/{key}", "w", encoding="utf-8") as fh:
        fh.write(value)
PY
acl_name="$(cat "$tmp/acl-name")"
id="$(cat "$tmp/acl-id")"
web_acl_arn="$(cat "$tmp/acl-arn")"
aws cloudfront list-distributions-by-web-acl-id --web-acl-id "$web_acl_arn" --output json > "$tmp/acl-distributions.json"
python3 - "$tmp/acl-distributions.json" "$dist_id" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    distributions = json.load(fh)["DistributionList"]
ids = [d["Id"] for d in distributions.get("Items", [])]
if distributions.get("IsTruncated") or distributions.get("Quantity") != 1 or ids != [sys.argv[2]]:
    sys.exit("ERROR: WebACL을 사용하는 배포가 정확히 대상 하나여야 합니다. 공유·미연결 ACL은 변경할 수 없습니다")
PY

aws wafv2 get-web-acl --scope CLOUDFRONT --region us-east-1 \
  --name "$acl_name" --id "$id" --cli-binary-format base64 --output json > "$tmp/acl.json"

python3 - "$mode" "$tmp" "$NORMAL_LIMIT" "$EMERGENCY_LIMIT" "$web_acl_arn" <<'PY'
import json
import sys

mode, tmp, normal, emergency = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
with open(f"{tmp}/acl.json", encoding="utf-8") as fh:
    data = json.load(fh)

acl = data["WebACL"]
if acl["ARN"] != sys.argv[5]:
    sys.exit("ERROR: 조회한 WebACL이 배포 연결 ARN과 다릅니다")
rules = [r for r in acl.get("Rules", []) if r.get("Name") != "emergency-korea-only"]
rate_rules = [r for r in rules if "RateBasedStatement" in r.get("Statement", {})]
if not rate_rules:
    sys.exit("ERROR: WebACL에 RateBasedStatement 속도 제한 규칙이 없습니다(aws/setup-ops.sh를 먼저 적용하세요)")

rate = rate_rules[0]
current_limit = rate["Statement"]["RateBasedStatement"]["Limit"]
is_on = any(r.get("Name") == "emergency-korea-only" for r in acl.get("Rules", []))

if mode == "status":
    state = "켜짐" if is_on else "꺼짐"
    rate_config = rate["Statement"]["RateBasedStatement"]
    print(f"WebACL: {acl['Name']} · 공격 대응 모드: {state} · 집계 {rate_config['AggregateKeyType']} · "
          f"{rate_config.get('EvaluationWindowSec', 300)}초 {current_limit}건 · 규칙 {len(acl.get('Rules', []))}/5")
    sys.exit(0)

rate["Statement"]["RateBasedStatement"] = {
    "Limit": emergency if mode == "on" else normal,
    "AggregateKeyType": "IP",
    "EvaluationWindowSec": 300,
}
rate["Action"] = {"Block": {}}
if mode == "on":
    if len(rules) >= 5:
        sys.exit("ERROR: 무료 요금제 WAF 규칙 한도(5개)가 이미 차 있어 국가 차단 규칙을 더할 수 없습니다")
    max_prio = max((r.get("Priority", 0) for r in rules), default=-1)
    rules.append(
        {
            "Name": "emergency-korea-only",
            "Priority": max_prio + 1,
            "Action": {"Block": {}},
            "Statement": {
                "NotStatement": {
                    "Statement": {"GeoMatchStatement": {"CountryCodes": ["KR"]}}
                }
            },
            "VisibilityConfig": {
                "SampledRequestsEnabled": True,
                "CloudWatchMetricsEnabled": True,
                "MetricName": "we-emergency-korea-only",
            },
        }
    )

if len(rules) > 5:
    sys.exit("ERROR: 무료 요금제 WAF 규칙 5개 한도를 넘습니다")

fields = (
    "Name", "Id", "DefaultAction", "Description", "Rules", "VisibilityConfig",
    "CustomResponseBodies", "CaptchaConfig", "ChallengeConfig", "TokenDomains",
    "AssociationConfig", "DataProtectionConfig", "OnSourceDDoSProtectionConfig",
    "ApplicationConfig", "MonetizationConfig",
)
# get 응답은 빈 설명("")·빈 목록도 돌려주는데 UpdateWebACL은 길이 0을 거부한다(2026-11-12 첫 --apply에서 발견).
payload = {key: acl[key] for key in fields if key in acl and acl[key] not in ("", [], {}, None)}
payload.update(Scope="CLOUDFRONT", LockToken=data["LockToken"], Rules=rules)
with open(f"{tmp}/update.json", "w", encoding="utf-8") as fh:
    json.dump(payload, fh)

target_limit = emergency if mode == "on" else normal
print(f"변경 예정: WebACL={acl['Name']} mode={mode} limit={target_limit} rules={len(rules)}/5")
PY

[ "$mode" = "status" ] && exit 0

if [ "$dry_run" = "1" ]; then
  echo "[dry-run] AWS에 반영하지 않았습니다. 실제 적용은 --dry-run을 빼고 실행하세요."
  exit 0
fi

aws wafv2 update-web-acl --region us-east-1 --cli-binary-format base64 \
  --cli-input-json "file://$tmp/update.json" >/dev/null

echo "적용 완료: $mode (엣지 반영까지 약 1분)"
sh "$0" status --acl-name "$acl_name"
