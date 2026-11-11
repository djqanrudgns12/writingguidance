#!/bin/sh
# 쌤유 글방 CloudFront WAF(we-edge) 공격 대응 모드 전환 스크립트 — HTTP 홍수 공격 시 해외 접속을 막고 IP 한도를 낮춘다.
#
# 사용법:
#   sh ops/cloudfront/emergency.sh status               현재 WAF 규칙·속도 제한 상태 조회
#   sh ops/cloudfront/emergency.sh on [--dry-run]       한국(KR) 외 차단 + IP당 5분 3,000건으로 강화
#   sh ops/cloudfront/emergency.sh off [--dry-run]      평시 복귀(국가 차단 해제 + IP당 5분 20,000건)
#   sh ops/cloudfront/emergency.sh --help               도움말 출력
#
# 안전장치:
#   - 오직 글방 WAF 웹 ACL(기본 we-edge)만 다루며, 쌤유니버스·rollingthunder(rt-edge 등)의 AWS 자원과 맥미니 로컬 서비스는 건드리지 않는다.
#   - 평시 한도는 학교 공인 IP 공유(교실 30대 동시 사용)를 고려해 IP당 5분 20,000건으로 유지한다(PLAN §15.1, §15.6-1).
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/cloudfront/emergency.sh <status|on|off> [--dry-run] [--acl-name <이름>]

WAF 웹 ACL(기본 we-edge)의 공격 대응 모드를 조회하거나 전환합니다(AWS 로그인 필요).

명령:
  status      현재 공격 대응 모드 여부, IP당 5분 속도 제한 수치, 규칙 수를 조회합니다(기본값).
  on          한국(KR) 외 접속을 차단하고 IP당 5분 요청 한도를 3,000건으로 낮춥니다.
  off         국가 제한 규칙을 빼고 IP당 5분 요청 한도를 평시(20,000건)로 되돌립니다.

옵션:
  --dry-run           변경될 규칙 구성을 확인만 하고 AWS에 반영하지 않습니다.
  --acl-name <이름>   대상 CLOUDFRONT 범위 WebACL 이름을 지정합니다(기본: $WE_WAF_ACL_NAME 또는 we-edge).
  -h, --help          이 도움말을 보여 줍니다.
EOF
}

mode=""
dry_run=0
acl_name="${WE_WAF_ACL_NAME:-we-edge}"

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
      acl_name="$2"
      shift 2
      ;;
    *)
      echo "ERROR: 알 수 없는 인자: $1 (--help 참고)" >&2
      exit 1
      ;;
  esac
done

mode="${mode:-status}"

case "$acl_name" in
  rt-*|cl-*|*rollinthunder*|*classlearning*|*ssamuniverse*)
    echo "ERROR: 다른 서비스의 WebACL($acl_name)은 건드릴 수 없습니다" >&2
    exit 1
    ;;
esac

export AWS_PROFILE="${AWS_PROFILE:-we}"
export AWS_REGION=us-east-1
NORMAL_LIMIT=20000
EMERGENCY_LIMIT=3000

aws sts get-caller-identity >/dev/null 2>&1 || {
  echo "ERROR: 먼저 AWS에 로그인하세요: aws login --profile $AWS_PROFILE" >&2
  exit 1
}

acl=$(aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 \
  --query "WebACLs[?Name=='$acl_name'] | [0]" --output json)
if [ -z "$acl" ] || [ "$acl" = "null" ]; then
  echo "ERROR: CLOUDFRONT 범위에서 WebACL '$acl_name'을 찾지 못했습니다" >&2
  exit 1
fi

id=$(printf '%s' "$acl" | python3 -c 'import json, sys; print(json.load(sys.stdin)["Id"])')
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

aws wafv2 get-web-acl --scope CLOUDFRONT --region us-east-1 \
  --name "$acl_name" --id "$id" --output json > "$tmp/acl.json"

python3 - "$mode" "$tmp" "$NORMAL_LIMIT" "$EMERGENCY_LIMIT" <<'PY'
import json
import sys

mode, tmp, normal, emergency = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
with open(f"{tmp}/acl.json", encoding="utf-8") as fh:
    data = json.load(fh)

acl = data["WebACL"]
rules = [r for r in acl.get("Rules", []) if r.get("Name") != "emergency-korea-only"]
rate_rules = [r for r in rules if "RateBasedStatement" in r.get("Statement", {})]
if not rate_rules:
    sys.exit("ERROR: WebACL에 RateBasedStatement 속도 제한 규칙이 없습니다(aws/setup-ops.sh를 먼저 적용하세요)")

rate = rate_rules[0]
current_limit = rate["Statement"]["RateBasedStatement"]["Limit"]
is_on = any(r.get("Name") == "emergency-korea-only" for r in acl.get("Rules", []))

if mode == "status":
    state = "켜짐" if is_on else "꺼짐"
    print(f"WebACL: {acl['Name']} · 공격 대응 모드: {state} · IP당 5분 {current_limit}건 · 규칙 {len(acl.get('Rules', []))}/5")
    sys.exit(0)

rate["Statement"]["RateBasedStatement"]["Limit"] = emergency if mode == "on" else normal
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

with open(f"{tmp}/rules.json", "w", encoding="utf-8") as fh:
    json.dump(rules, fh)
with open(f"{tmp}/vis.json", "w", encoding="utf-8") as fh:
    json.dump(acl["VisibilityConfig"], fh)
with open(f"{tmp}/lock", "w", encoding="utf-8") as fh:
    fh.write(data["LockToken"])
with open(f"{tmp}/desc", "w", encoding="utf-8") as fh:
    fh.write(acl.get("Description") or "writeessay edge protection")

target_limit = emergency if mode == "on" else normal
print(f"변경 예정: WebACL={acl['Name']} mode={mode} limit={target_limit} rules={len(rules)}/5")
PY

[ "$mode" = "status" ] && exit 0

if [ "$dry_run" = "1" ]; then
  echo "[dry-run] AWS에 반영하지 않았습니다. 실제 적용은 --dry-run을 빼고 실행하세요."
  exit 0
fi

desc=$(cat "$tmp/desc")
aws wafv2 update-web-acl --scope CLOUDFRONT --region us-east-1 \
  --name "$acl_name" --id "$id" --lock-token "$(cat "$tmp/lock")" \
  --default-action Allow={} --description "$desc" --cli-binary-format raw-in-base64-out \
  --rules "file://$tmp/rules.json" --visibility-config "file://$tmp/vis.json" >/dev/null

echo "적용 완료: $mode (엣지 반영까지 약 1분)"
sh "$0" status --acl-name "$acl_name"
