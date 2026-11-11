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
| `judge.ts` | 판정 기준표(`JUDGE_RUBRIC`)와 세 후보 응답 비교 판정용 Anthropic Message Batches JSONL(`judge-requests.jsonl`, 72건) 생성 |
| `metrics.ts` | 맞춤법 정밀도·재현율·오지적(`locate.ts` 위치 겹침), 형식 위반, 다듬은 글 길이 비율(0.7~1.3), 구조 머리말 보존, 거절률(전체·주의 주제 4편), 지연 p50·p95, 토큰·비용 집계 |
| `report.ts` | 후보별 지표와 PRD 6.7 PASS 기준 비교 마크다운 보고서 생성 (`fake`는 `.local/eval/`에만, `anthropic`은 `docs/eval/YYYYMMDD.md`에도 저장) |
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

어림표의 생성 + 비교 판정 합계 비용(3회 반복 기준 약 2~3달러)을 사용자에게 보고하고 **U-11 승인**을 받는다.
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
  --provider anthropic --repeat 3 --yes-i-approved-cost
```

실행이 끝나면 `.local/eval/<YYYY-MM-DD>/` 아래에 다음 파일이 만들어진다.
- `raw.jsonl`: 호출별 지연(첫 글자·전체), 토큰 사용량, 재시도·대체 기록, 응답 원문
- `judge-requests.jsonl`: `FEEDBACK`·`DIRECTION`·`POLISH` 비교 판정용 Message Batches 요청 72건

### 4단계 · 비교 판정 (`judge.ts`)

`judge.ts`는 기본적으로 Message Batches 형식 JSONL 파일(`judge-requests.jsonl`)을 **생성만** 하고 외부로 전송하지 않는다.

```bash
node --conditions=@geulbang/source tools/eval/judge.ts \
  --input .local/eval/YYYY-MM-DD/raw.jsonl
```

### 5단계 · 지표 집계 및 보고서 생성 (`metrics.ts` · `report.ts`)

`run.ts` 실행 시 자동으로 호출되며, 기존 `raw.jsonl`에서 다시 계산할 수도 있다.
- `fake` 실행 보고서는 `.local/eval/<YYYY-MM-DD>/report.md` 및 `.local/eval/YYYYMMDD.md`에만 저장된다.
- `anthropic` 실제 실행 보고서는 `docs/eval/YYYYMMDD.md`에도 함께 저장된다.

```bash
node --conditions=@geulbang/source tools/eval/metrics.ts \
  --input .local/eval/YYYY-MM-DD/raw.jsonl

node --conditions=@geulbang/source tools/eval/report.ts \
  --input .local/eval/YYYY-MM-DD/raw.jsonl
```

### 6단계 · 사용자 모델 최종 승인 (`U-01`)

`docs/eval/YYYYMMDD.md`의 PRD 6.7 PASS 기준 달성 표(맞춤법 정밀도 ≥ 0.90, 재현율 ≥ 0.60, `mustNotFlag` 오지적 0건, 형식 위반 0건, 다듬은 글 길이 비율 0.7~1.3 ≥ 95%, 구조 머리말 보존 100%, 주의 주제 거절률 0%)와 지연·비용을 보고 사용자가 버튼별 최종 모델 조합(**U-01**)을 승인한다.
- 판정 모델 단가: Claude Opus 5.5 $4 / $20 per MTok(Message Batches 50% 할인 전), claude-api 스킬 `shared/models.md` 기준, Claude 확인 2026-11-11.
