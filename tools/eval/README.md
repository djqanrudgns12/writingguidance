# AI 품질 평가 도구 (`tools/eval/`)

> PRD 6장(6.3·6.5·6.7) 및 `docs/PLAN.md` §8.2~§8.7에 따른 가상 초등 글 24편 평가 실행기·비교 판정·지표·보고서 도구다.
> Node 24 기본 타입 제거와 `@geulbang/source` 조건으로 새 의존성 없이 바로 실행한다.

## 1. 파일 구성

| 파일 | 역할 |
|---|---|
| `dataset/*.json` | 초등 3~6학년 수준 가상 글 24편(이야기·시·노래 가사·기사·생활글·기타 문구 각 4편, 주의 주제 4편, 심은 오류 50개, 고치면 안 되는 표현 87개) |
| `candidates.json` | 평가 후보 3개(`haiku-off`, `haiku-low`, `sonnet-low`), 대체 모델(`claude-sonnet-5-5`), 비교 판정 모델(`claude-opus-5-5`) 및 MTok 단가 |
| `estimate.ts` | 원문 글자 수와 프롬프트 길이로 후보별·전체 입력·출력 토큰과 비용(USD)을 어림 계산 |
| `run.ts` | 24편 × 4버튼 × 3후보 × 반복 횟수를 서버 `runStructured`/`runPolish`로 직접 실행해 `.local/eval/<날짜>/raw.jsonl` 기록 |
| `judge.ts` | 판정 기준표·익명 요청/대응표 생성, Message Batches 전송·폴링·재개·결과 수집 |
| `metrics.ts` | 맞춤법 정밀도·재현율·오지적(`locate.ts` 위치 겹침), 형식 위반, 다듬은 글 길이 비율(0.7~1.3), 구조 머리말 보존, 거절률(전체·주의 주제 4편), 지연 p50·p95, 토큰·비용 집계 |
| `report.ts` | 후보별 지표와 PRD 6.7 PASS 기준 비교 마크다운 보고서 생성 (`fake`는 `.local/eval/`에만, `anthropic`은 `docs/eval/YYYYMMDD.md`에도 저장) |
| `judge.test.ts` | 가짜 배치 클라이언트로 익명화·전송·중단/재개·실패 집계·보고서 반영을 확인하는 `node --test` 시험 |
| `tsconfig.json` | 평가 도구 타입 검사 설정 (`npx tsc -p tools/eval/tsconfig.json`) |

## 2. 평가 진행 순서 (P4-19 → P4-20)

### 1단계 · 비용 어림 확인 (`--estimate`)

실제 API를 부르기 전에 글자 수 기반 입력·출력 토큰과 후보별·판정 비용을 표로 확인한다.

```bash
node --conditions=@geulbang/source tools/eval/run.ts --estimate
# 또는 1회전 기준 어림:
node --conditions=@geulbang/source tools/eval/run.ts --estimate --repeat 1
```

### 2단계 · 사용자 비용 승인 (`U-11`)

어림표의 생성 + 비교 판정 합계 비용(현재 3회 반복 평균 어림 $3.7216)을 사용자에게 보고하고 **U-11 승인**을 받는다.
승인 전에는 `--provider fake`(비용 $0)로만 파이프라인을 검증한다.

```bash
# 가짜 AI(fake)로 전체 파이프라인 시험 실행 (비용 $0)
node --conditions=@geulbang/source tools/eval/run.ts --provider fake --repeat 1
```

### 3단계 · 실제 평가 실행 (`--provider anthropic`, U-11 승인 후)

`--provider anthropic`은 환경 변수 `ANTHROPIC_API_KEY`와 `--yes-i-approved-cost` 인자가 **둘 다** 있을 때만 실행된다. 하나라도 빠지면 API를 호출하지 않고 비용 어림표만 출력한 뒤 종료한다.

```bash
# U-11 승인 뒤 개발·평가용 키로 실행 (P4-20)
node --env-file=.local/dev.env --conditions=@geulbang/source tools/eval/run.ts \
  --provider anthropic --repeat 3 --date YYYY-MM-DD --yes-i-approved-cost
```

실행이 끝나면 `.local/eval/<YYYY-MM-DD>/` 아래에 다음 파일이 만들어진다.
- `raw.jsonl`: 호출별 지연(첫 글자·전체), 토큰 사용량, 재시도·대체 기록, 응답 원문
- `judge-requests.jsonl`: `FEEDBACK`·`DIRECTION`·`POLISH` 비교 판정용 Message Batches 요청 72건
- `judge-mapping.json`: `custom_id`별 A/B/C → 실제 후보 대응표와 요청 파일 SHA-256(외부 전송하지 않음)

### 4단계 · 비교 판정 (`judge.ts`)

기본 실행은 익명 요청 파일과 대응표만 만든다. `run.ts`가 이미 생성했다면 다시 만들 필요가 없다. 판정에는 후보별 첫 성공 응답(없으면 첫 응답)을 대표로 사용한다. 매 요청마다 세 후보를 무작위로 A/B/C에 배치하고 모델 이름·후보 ID·라벨을 프롬프트에 넣지 않는다.

```bash
# 선택: 원시 기록에서 요청만 다시 생성 (전송하지 않음)
node --conditions=@geulbang/source tools/eval/judge.ts \
  --input .local/eval/YYYY-MM-DD/raw.jsonl

# U-11 승인 후: 기존 요청 전송 → 최대 60분 폴링 → 결과 수집
node --env-file=.local/dev.env --conditions=@geulbang/source tools/eval/judge.ts \
  --requests .local/eval/YYYY-MM-DD/judge-requests.jsonl \
  --submit --yes-i-approved-cost --max-wait-minutes 60
```

`--input <raw.jsonl> --submit --yes-i-approved-cost`도 지원한다. 요청과 대응표가 이미 있으면 그대로 전송하고, 없으면 먼저 만든다. 경로를 생략하면 한국 시각 오늘의 `.local/eval/YYYY-MM-DD/raw.jsonl`을 기준으로 한다.

- 전송 전 익명화·스키마·`custom_id`·대응표 해시를 확인한다. `ANTHROPIC_API_KEY`와 `--yes-i-approved-cost` 중 하나라도 없으면 API를 호출하지 않고 종료 코드 1로 끝난다.
- `client.messages.batches.create({ requests })` 결과의 ID를 같은 폴더의 `judge-batch.json`에 저장한다. 이후 `processing_status`가 `ended`가 될 때까지 30초 간격으로 조회한다. `--max-wait-minutes`는 이번 실행의 최대 대기 시간(기본 60분)이며, 한도에 도달하면 배치를 취소하지 않고 종료 코드 2로 끝난다.
- 조회·다운로드 중 중단되거나 한도에 도달하면 다음 명령으로 이어 받는다. 재개는 배치를 새로 만들지 않는다. 키와 승인 표식은 재개에도 필요하다.

```bash
node --env-file=.local/dev.env --conditions=@geulbang/source tools/eval/judge.ts \
  --resume .local/eval/YYYY-MM-DD/judge-batch.json \
  --yes-i-approved-cost --max-wait-minutes 60
```

- 끝난 결과는 순차 수집하여 `judge-results.jsonl.partial`에 쓰고, 스트림이 끝났을 때 `judge-results.jsonl`로 바꾼다. 끊긴 다운로드는 재개 시 전체를 다시 받는다. 결과 순서와 무관하게 `custom_id`로 대응한다.
- `errored`·`canceled`·`expired`, `stop_reason`이 `refusal`·`max_tokens`인 응답, JSON/스키마 위반, 잘못된 A/B/C·중복·누락은 실패로 센다. 거절·잘림은 JSON을 파싱하지 않는다. 성공 메시지의 text 블록만 합쳐 zod로 검증한다.
- 수집을 마쳤어도 실패 또는 예상 밖 결과가 있으면 종료 코드 1이다. 결과 파일은 남으므로 보고서를 생성해 실패를 확인한다. 실패 건을 자동 유료 재시도하지 않는다.
- `judge-batch.json`이 있으면 요청·대응표를 재생성하거나 `--submit`으로 다시 보내지 않는다. 배치 생성 POST 자동 재시도도 껐다. ID 응답을 받기 전 연결이 끊기면 기록의 `batchId`는 `null`이다. 이 경우 콘솔에서 전송 여부와 ID를 확인해야 하며, 파일을 지우고 다시 전송하면 중복 과금될 수 있다.
- 배치 처리·수집 뒤까지 요청·대응표·배치 기록을 보존한다. 재개 시 해시가 다르면 중단한다. 같은 날짜에 다른 평가를 돌릴 때도 기존 결과를 보존해야 하므로 통합 담당이 별도 실행 폴더를 준비해야 한다(`run.ts`는 날짜별 기록을 덮어쓴다).

**Opus 설정과 비용:** 요청은 `max_tokens: 4000`, `thinking: {type: "adaptive"}`, `output_config.effort: "low"`를 사용한다. `thinking: disabled`·`budget_tokens`·`temperature`·prefill·강제 `tool_choice`는 넣지 않는다. `estimate.ts`는 판정 출력에 생각을 포함한 **건당 평균 600토큰**을 가정하므로 현재 72건의 판정 $0.7100, 생성까지 $3.7216 어림은 그대로다. 4,000은 실제 사용량이 아닌 잘림 방지 상한이다. 같은 입력 어림을 유지하고 72건 모두 상한까지 출력하면 판정 $3.1580, 생성 포함 $6.1696까지 늘 수 있다. 입력 토큰·재시도·대체 모델 비용 변동도 있어 지출 한도는 아니다. `estimate.ts`는 수정하지 않았다. 실제 판정 토큰과 설정 단가 기준 비용은 보고서에 따로 기록한다.

### 5단계 · 지표 집계 및 보고서 생성 (`metrics.ts` · `report.ts`)

`run.ts` 실행 시 자동으로 호출되며, 기존 `raw.jsonl`에서 다시 계산할 수도 있다.
- `fake` 실행 보고서는 `.local/eval/<YYYY-MM-DD>/report.md` 및 `.local/eval/YYYYMMDD.md`에만 저장된다.
- `anthropic` 실제 실행 보고서는 `docs/eval/YYYYMMDD.md`에도 함께 저장된다.
- 판정 수집 뒤 `report.ts`를 다시 실행하면 같은 폴더의 `judge-results.jsonl`·대응표를 읽어 버튼별 세 후보 순위·승률·기준별 점수를 추가한다. 승률 분모는 유효 판정 수이고 동점은 단독 승리로 세지 않는다. 순위는 승리 수 기준(같으면 같은 순위)이며 실패 수와 사유를 함께 표시한다.
- 기준별 점수는 기존 판정 형식의 전체 기준/초3 말투/대신쓰기 금지 통과율과 장르 관점 평균(1~5점)이다. 세부 기준마다 별도 수치가 있는 것은 아니며, 나머지는 전체 통과 여부와 `issues`를 확인한다.

```bash
node --conditions=@geulbang/source tools/eval/metrics.ts \
  --input .local/eval/YYYY-MM-DD/raw.jsonl

node --conditions=@geulbang/source tools/eval/report.ts \
  --input .local/eval/YYYY-MM-DD/raw.jsonl
```

### 6단계 · 사용자 모델 최종 승인 (`U-01`)

`docs/eval/YYYYMMDD.md`의 PRD 6.7 PASS 기준 달성 표(맞춤법 정밀도 ≥ 0.90, 재현율 ≥ 0.60, `mustNotFlag` 오지적 0건, 형식 위반 0건, 다듬은 글 길이 비율 0.7~1.3 ≥ 95%, 구조 머리말 보존 100%, 주의 주제 거절률 0%)와 지연·비용을 보고 사용자가 버튼별 최종 모델 조합(**U-01**)을 승인한다.
- 판정 모델 단가: Claude Opus 5.5 $4 / $20 per MTok(Message Batches 50% 할인 전), claude-api 스킬 `shared/models.md` 기준, Claude 확인 2026-11-11.

## 3. API 호출 없는 검증

SDK 클라이언트·시계·대기를 주입하므로 시험은 네트워크와 실제 키를 사용하지 않는다.

```bash
node --conditions=@geulbang/source --test --test-concurrency=1 tools/eval/judge.test.ts
npx tsc -p tools/eval/tsconfig.json
```
