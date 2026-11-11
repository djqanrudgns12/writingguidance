# AI 평가 데이터셋 (`tools/eval/dataset/`)

> PRD 5장·6.7, PLAN §8.4·§8.5·§8.7에 따른 초등 3~6학년 수준 **가상 글 24편** 초안(P4-18).
> 실제 학생 글·실존 인물·실제 학교·실제 지명은 전혀 쓰지 않았으며, 등장하는 학교·마을·별명은 모두 가상 이름이다.

## 1. JSON 구조 (PLAN §8.7)

```json
{
  "id": "01-story-clocktower",
  "genre": "story",
  "subtype": "short",
  "purpose": "poster (genre가 other일 때만)",
  "text": "학생 글 본문",
  "helpNotes": [
    { "question": "도움 질문 문구(ko.student 기준)", "note": "학생이 적은 짧은 메모" }
  ],
  "plantedErrors": [
    { "original": "원문 속 틀린 표현", "suggestion": "올바른 표현", "kind": "spelling | spacing | grammar" }
  ],
  "mustNotFlag": ["사투리·의성어·시적 허용·노랫말 반복·고유 별명·구조 머리말 등"],
  "notes": "평가 주안점 및 주의 주제 여부"
}
```

## 2. 24편 목록 표

> 길이는 `countChars`(줄바꿈 제외 코드 포인트 수) 기준이며, 괄호 안은 줄바꿈 포함 전체 코드 포인트 수다.

| 번호 | 파일 이름 (`id`) | 글 종류 (`genre`) | 하위 종류 / 용도 (`subtype` / `purpose`) | 길이 (줄바꿈 제외 / 전체) | 심은 오류 수 (`plantedErrors`) | 비오지적 수 (`mustNotFlag`) | 주제 주의 여부 | 평가 주안점 |
|---|---|---|---|---|---|---|---|---|
| 01 | `01-story-clocktower.json` | `story` (이야기) | `short` (단편) | 415자 (417자) | 3 | 3 | - | 고유 별명(`솔방울대장`), 의성어(`째깍째깍`, `끼이익`) |
| 02 | `02-story-moon-fox.json` | `story` (이야기) | `fairy-tale` (동화) | 386자 (388자) | 3 | 3 | - | 시대 메모 규칙(`eraNote`: 조선 시대 메모 + 손전등·배터리) |
| 03 | `03-story-shelter-origami.json` | `story` (이야기) | `short` (단편) | 504자 (507자) | 4 | 3 | **주의 (전쟁·죽음)** | 전쟁 피란길 방공호에서 종이배를 접는 남매(안전 거절률 측정) |
| 04 | `04-story-island-train.json` | `story` (이야기) | `long` (장편) | 1,493자 (1,504자) | 4 | 4 | - | `[1장]`·`[2장]` 머리말 보존, 맞춤법 조각 최대 길이(1,500자) 근처 긴 글 |
| 05 | `05-poem-dandelion.json` | `poem` (시) | `children-poem` (동시) | 11자 (12자) | 1 | 2 | - | 최소 글자(`AI_MIN_CHARS.poem = 10`) 근처 10자 안팎 짧은 동시 |
| 06 | `06-poem-rainy-boots.json` | `poem` (시) | `children-poem` (동시) | 103자 (113자) | 2 | 3 | - | 의성어·의태어(`첨벙첨벙`, `톡톡톡`), 시적 표현(`구름솜`) |
| 07 | `07-poem-star-puppy.json` | `poem` (시) | `free-verse` (자유시) | 182자 (195자) | 3 | 4 | **주의 (죽음)** | 숨을 거둔 반려견 '콩이'와의 이별을 다룬 자유시(안전 거절률 측정) |
| 08 | `08-poem-eraser-dust.json` | `poem` (시) | `free-verse` (자유시) | 148자 (161자) | 2 | 3 | - | 비유(`지우개 눈송이`), 의태어(`데구르르`), 연·행 구조 유지 |
| 09 | `09-lyrics-lunchtime-run.json` | `lyrics` (노래 가사) | `-` | 252자 (270자) | 2 | 6 | - | `[1절]`·`[후렴]`·`[2절]` 머리말 보존, 후렴 반복(`랄랄라 랄랄라`) |
| 10 | `10-lyrics-bicycle-wind.json` | `lyrics` (노래 가사) | `-` | 211자 (227자) | 2 | 6 | - | `[1절]`·`[후렴]`·`[브릿지]` 머리말 보존, 반복 구호(`달려라 달려`) |
| 11 | `11-lyrics-grandma-garden.json` | `lyrics` (노래 가사) | `-` | 226자 (242자) | 1 | 6 | - | 후렴 사투리(`와 이리 곱노`)와 국악 추임새(`얼쑤절쑤`) 비오지적 |
| 12 | `12-lyrics-paper-crane.json` | `lyrics` (노래 가사) | `-` | 224자 (240자) | 1 | 6 | - | 친구와 화해하는 발라드 가사, `[1절]`·`[후렴]`·`[2절]` 리듬 유지 |
| 13 | `13-news-library-books.json` | `news` (기사) | `newspaper` (신문) | 282자 (284자) | 2 | 2 | - | 과장된 수치에 대한 `factCheck` 질문 생성, `제목 후보` 라벨 |
| 14 | `14-news-playground-tree.json` | `news` (기사) | `extra` (호외) | 261자 (263자) | 1 | 2 | - | 표준 의태어(`깡충깡충`) 비오지적, `factCheck`('오천 살 은행나무') |
| 15 | `15-news-science-fair.json` | `news` (기사) | `broadcast` (뉴스) | 308자 (310자) | 2 | 2 | - | 방송 뉴스 원고, 이중 피동(`돋보여졌다고`) 검출 및 기사체 다듬기 |
| 16 | `16-news-peace-museum.json` | `news` (기사) | `newspaper` (신문) | 366자 (368자) | 2 | 3 | **주의 (전쟁·죽음)** | 역사 수업 평화기념관 견학 및 전사자 추모 기사(안전 거절률 측정) |
| 17 | `17-essay-persimmon-tree.json` | `essay` (생활글) | `essay` (수필) | 442자 (445자) | 2 | 3 | - | 할머니 대사 속 사투리(`까치밥이데이`, `다 따모 안 된데이`) 비오지적 |
| 18 | `18-essay-dodgeball-diary.json` | `essay` (생활글) | `diary` (일기) | 367자 (369자) | 3 | 3 | - | 체육 시간 피구 일기, 별명(`번개방패`)·의태어(`콩닥콩닥`) |
| 19 | `19-essay-history-review.json` | `essay` (생활글) | `review` (감상문) | 436자 (438자) | 3 | 3 | **주의 (전쟁·죽음)** | 역사 수업 후 전쟁 동화책 독서 감상문(안전 거절률 측정) |
| 20 | `20-essay-mudflat-trip.json` | `essay` (생활글) | `essay` (수필) | 677자 (680자) | 1 | 5 | - | 가족 갯벌 체험 중장문 수필, 의성어·의태어 다수 포함 |
| 21 | `21-other-poster-foodwaste.json` | `other` (기타 문구) | `purpose: poster` (포스터·표어) | 48자 (49자) | 1 | 2 | - | 급식 잔반 줄이기 표어, 대구 리듬·길이 유지 |
| 22 | `22-other-webtoon-capsule.json` | `other` (기타 문구) | `purpose: webtoon` (웹툰·만화 대사) | 349자 (363자) | 1 | 6 | - | `[1컷]`~`[4컷]` 머리말 보존, 대사 구어체(`진짜루`)·별명(`떡볶이탐정`) |
| 23 | `23-other-letter-friend.json` | `other` (기타 문구) | `purpose: letter` (편지·카드) | 300자 (306자) | 2 | 3 | - | 전학 가는 단짝에게 쓰는 반말 편지 말투 유지 |
| 24 | `24-other-speech-recycle.json` | `other` (기타 문구) | `purpose: speech` (발표문) | 338자 (340자) | 2 | 4 | - | 학급 회의 분리배출 발표문, 격조사 어법(`재활용품으로써`) 검출 |

## 3. 요약 통계

- **전체 편수**: 24편 (글 종류 6개 × 각 4편)
- **심은 오류(`plantedErrors`) 합계**: 50개 (`spelling` 26개, `spacing` 21개, `grammar` 3개) — 2026-11-11 Claude 정답 확인으로 20번 "놓아주었다" 1개를 뺌
- **고치면 안 되는 표현(`mustNotFlag`) 합계**: 87개(실제로 센 값)
- **주의 주제(전쟁·죽음) 글**: 4편 (`03`, `07`, `16`, `19`)
