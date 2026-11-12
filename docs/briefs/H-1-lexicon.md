# H-1 · 비속어·위험 표현 사전과 정규화 검사기 (맡는 이: Codex)

> 작업 폴더 `/Users/bodyking/Desktop/Architecture/writeessay`. 먼저 `AGENTS.md`, 그다음 `docs/ai-harness.md` 0절·2절 G-01/G-09·4절을 읽는다. 이 작업은 4절을 구현한다.

## 목표

AI 출력과 학생 원문에서 비속어·혐오·성적 표현·자해/위험 정보를 찾는 **의존성 없는** 검사기. 원문은 바꾸지 않고, 걸린 구간을 원문 위치(UTF-16 인덱스)로 돌려준다.

## 계약 (Claude가 이 모양으로 결합 코드를 짠다 — 바꾸지 말 것)

```ts
// apps/server/src/ai/guard/lexicon.ts
export type LexGrade = 'A' | 'B' | 'C';
export type LexCategory = 'profanity' | 'sexual' | 'hate' | 'selfharm' | 'danger' | 'risk_signal';
export interface LexHit {
  readonly start: number; // 원문 기준, 포함
  readonly end: number;   // 원문 기준, 제외
  readonly grade: LexGrade;
  readonly category: LexCategory;
}
/** 원문 전체 검사. 같은 구간 중복은 합친다. 허용 목록(구간 포함 방식) 적용 뒤 결과. */
export function scanText(text: string): LexHit[];
/** 학생 원문의 A·C 등급 구간을 ⟦가림N⟧으로 바꾼다(N은 1부터). 대응은 요청 안에서만 쓴다. */
export function maskStudentProfanity(text: string): { masked: string; spans: { token: string; start: number; end: number }[] };
```

- `risk_signal`은 docs/ai-harness.md L0 R-01의 1인칭 위험 신호(예: "죽고 싶", "자해하고", "나를 때려", "아무한테도 말하지 마"…) — 등급은 `B`. 이야기·역사 속 "죽음", "전쟁"은 넣지 않는다.
- `selfharm`·`danger`(A): 자해·자살 **방법/조장**, 위험한 행동 따라 하기, 무기·폭발물·약물 만드는 법 표현. 공개 목록이 없으니 자체 작성(보수적으로, 일상어 오탐 피함).

## 할 일

1. **목록 가져오기·정리**: 아래 공개 목록을 GitHub raw에서 받아(텍스트 데이터만, 실행 코드는 가져오지 않음) `apps/server/src/ai/guard/lexicon-data/`에 넣는다. 파일 머리나 같은 폴더 `NOTICE.md`에 출처 URL·커밋·라이선스 원문·우리가 바꾼 점을 적는다.
   - korcen (https://github.com/Tanat05/korcen, MIT — 2026-05-27 커밋 eecd976 이후): 금지어·오탐 예외·닮은 글자 표. `politics` 분류는 넣지 않는다.
   - lisuugi/korean-profanity-filter (https://github.com/lisuugi/korean-profanity-filter, Apache-2.0): `profanity`·`sexuality`·`harmful`(level 1~3). `politics`는 넣지 않는다. LICENSE·NOTICE 보존.
   - LDNOOBW `ko` (CC BY 4.0): 성적 표현·멸칭. 유모·야사·망가처럼 일상어와 겹치는 것은 뺀다.
   - 받은 목록에서 정치인 이름·정치 성향 표현·특정 지역 이름 같은 것은 빼고, 등급(A/B/C)·분류로 다시 나눈다. 판단 기준을 NOTICE에 적는다.
   - 실제 댓글 문장 데이터셋(2runo, K-HATERS 등)은 저장소에 넣지 않는다.
2. **정규화**(`guard/normalize.ts`): docs/ai-harness.md 4절의 보기 6가지 + 원문 위치 대응표. 자모 조립기는 직접 구현(es-hangul MIT를 참고하면 MIT 문구를 남긴다). 두벌식 영타 변환. NFKC 동작은 실제로 실행해 확인한다.
3. **일치**: 다중 패턴(Aho-Corasick 등), 초성 목록은 원문이 초성만인 구간에만, 허용 목록은 구간 포함 방식. 목록 수천 개 × 5,000자 글 한 편을 5ms 안팎으로(서버가 요청마다 여러 번 부른다). 모듈을 불러올 때 한 번만 사전을 만든다.
4. **시험** `apps/server/test/guard/lexicon.test.ts`(vitest, 가상 문장만): 각 회피 수법(초성, 자모 분리, 기호·숫자 끼우기, 영타 `tlqkf`, 닮은 글자, 반복, 보이지 않는 글자)이 잡히는지, 오탐 예(시발점, 시발역, 수박씨발라, 개나리, 개구리, 노무사, 망가지다, 자살 예방 교육, 이야기 속 "할아버지가 돌아가셨다", 전쟁 이야기)가 안 잡히는지, 위치가 원문과 맞는지, `maskStudentProfanity` 왕복. 시험에 쓰는 비속어 예시는 시험 파일 안에서만, 최소한으로.
5. 성능 시험 하나(5,000자, 목록 전체).

## 맡는 파일 (이 밖은 고치지 않음)

- 새로: `apps/server/src/ai/guard/lexicon.ts`, `apps/server/src/ai/guard/normalize.ts`, `apps/server/src/ai/guard/lexicon-data/**`, `apps/server/test/guard/lexicon.test.ts`
- Claude가 동시에 고치는 중(건드리지 않음): `apps/server/src/ai/*.ts`(run·validate·prompts·schemas·anthropic), `apps/server/src/ai/guard/` 아래 다른 파일, `apps/server/src/application/**`, `packages/**`, `apps/web/**`, `docs/**`, `PRD.md`

## 하지 않는 것

새 npm 의존성, 비밀값, git commit·push, 실행 코드 내려받기(텍스트 목록만), 실제 학생 글, 운영 서비스 건드리기.

## 완료 보고

바꾼 파일, 넣은 목록별 항목 수(등급·분류별), 뺀 것과 이유, 시험·성능 실제 출력 마지막 20줄, 남은 오탐·미탐 위험.
