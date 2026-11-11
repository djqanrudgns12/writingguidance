# 글방 그림 생성용 화풍 시트 — 색연필 스케치 (ADR-055)

기준: `PRD.md` 8.1~8.4·8.7·8.8·8.10, `docs/PLAN.md` 9.3, `docs/decisions.md` ADR-055.
사용자 결정(ADR-055)으로 확정된 **5번 "색연필 스케치"** 화풍을 정의하며, 글벗 캐릭터 시트(PRD 8.8 #1)와 나머지 모든 일러스트(PRD 8.8 #2~#7)가 같은 손으로 그려지도록 이 시트를 따른다. 그림 생성은 추가 비용이 없는 내장 이미지 생성 도구만 사용한다.

---

## 1. 화풍 규칙

- **매체와 분위기**: 한 권의 인쇄된 그림책 속 다정하고 시적인 **손그림 색연필 스케치**. 따뜻한 종이 숨결이 은은하게 살아 있으되 지저분하지 않고 차분하며 또렷하다.
- **선 (코코아 색연필)**:
  - 코코아 갈색(`--ink` `#4A3B32`) 근처 한 계열의 가늘고 부드러운 마른 색연필 스케치 선을 쓴다. **순검정(`#000000`)은 절대 쓰지 않는다.**
  - `1024×1024` 원화 기준 전신·장면 그림(96·160px 이상 표시용)은 3~5px 체감의 섬세하고 부드러운 색연필 선을 유지한다.
  - **예외 — 소형 기본 얼굴 아이콘(24·32·48px 표시용)**: 작은 크기에서도 이목구비와 실루엣이 흐려지지 않도록, 같은 코코아 색연필 질감을 유지한 채 외곽선(특히 아래쪽 턱선·귀·가시 윤곽)과 눈·코·입만 6~8px 체감으로 조금 더 굵고 또렷하게 그린다.
  - 배경 투명화 후처리가 새어 들어가지 않도록 밝은 몸통·얼굴·종이 사물의 바깥 윤곽선은 끊김 없이 자연스럽게 닫는다.
- **채색 (옅은 색연필 결 + 파스텔 토큰 근처)**:
  - 종이 결이 가볍게 비치는 **옅고 부드러운 색연필 해칭·터치**로 칠한다. 두껍게 떡진 크레용·유화 질감이나 자글거리는 과잉 잡음은 금지한다.
  - 색은 `PRD.md` 8.2의 파스텔 토큰 근처로 절제한다:
    - 살구 `#F2A07B` (`--primary`), 버터 `#F7D98B` (`--butter`), 세이지 `#A9C9A4` (`--sage`), 하늘 `#A8CBE6` (`--sky`), 장미 `#EE9A8E` (`--rose`), 라벤더 `#9C8ADE` (`--teacher`)
    - 밝은 몸통 털·색연필 나무 원뿔·책 속지·편지·구름은 크림 `#FFF8EF` (`--bg`) ~ 흰색 `#FFFFFF` (`--surface`) 근처로 둔다.
  - 바닥 그림자는 발이나 사물 바로 아래에 옅은 코코아·파스텔 색연필 결 한 겹만 **그림 파일 안에** 둔다(화면 UI 위에 따로 반투명 물감 얼룩을 띄우지 않는다).
- **비율과 시점**:
  - 원근 과장이 없는 **정면 또는 정면에 가까운 3/4 측면** 시점으로 그린다.
  - 글벗 캐릭터는 실제 아기 고슴도치에 가까운 다정한 비율(전체 키가 머리 높이의 약 1.5배)을 유지한다.
  - 사물(책, 편지, 문과 팻말, 교실 책상들, 구름과 우산, 도장)도 투시를 과장하지 않은 평면 정면·완만한 3/4 그림책 구도로 그린다.
- **배경 없음**:
  - 최종 파일은 실제 알파 채널을 가진 **배경 투명 PNG**(앱 배포본은 투명 WebP)다. 배경에 풍경, 방, 액자 테두리, 종이 네모, 불투명 체커보드를 그리지 않는다.
  - 내장 생성 도구가 단색 바탕(`#FFF8EF` 등)을 출력할 때는 균일한 단색 바탕 위에 그린 뒤, `MAGICK_THREAD_LIMIT=1` ImageMagick 후처리로 바탕과 닫힌 배경 구멍을 지우고 크림(`#FFF8EF`)과 흰색(`#FFFFFF`) 바탕 모두에서 가장자리 흰·누런 번짐이 보이지 않게 마감한다.
- **그림 안 글자 없음**:
  - 그림 안에 글자, 숫자, 로고, 워터마크, 서명, 캡션, 말풍선, 기호(`?`, `!`, `...`, `Zzz`), 줄글 흔적을 넣지 않는다.
  - 펼친 책 속지, 편지 봉투, 작은 팻말, 몽당연필 몸통(`HB`, `No.2` 등)도 모두 글자 없는 빈 면으로 그린다. (PRD 8.8 #7 도장의 `"다 썼어요!"` 문구는 생성 AI 글자에 맡기지 않고 후처리 타이포그래피·벡터 결합으로 얹는다.)
- **하지 않는 것 (PRD 8.7·8.10 고정 금지)**:
  - 말풍선으로 수다 떨기, 말풍선 꼬리, 계속 움직이는 장식.
  - AI 그림 특유의 표시: 광택 나는 3D 캐릭터, **반짝이는 큰 눈(눈동자 안 흰 반사점·하이라이트 점 일절 금지)**, 빛 가루·마법·별·하트 반짝이 효과, 에어브러시·내부 그라데이션, 지나치게 세밀한 판타지 배경, 사람 손가락처럼 갈라지거나 뭉개진 손.
  - 세피아로 누렇게 뜬 색감, 그림마다 선 굵기·색 온도가 달라지는 것.
  - 실존 작가·작품·브랜드·기존 캐릭터 이름 참조나 흉내.

---

## 2. 글벗 캐릭터 고정 특징

- **모습**: 실제 아기 고슴도치에 가까운 다정하고 순한 인상의 문구류 친구. 살짝 들린 작고 뾰족한 코코아색 코끝, 반사광 없는 작고 동그란 무광 코코아 점눈 두 개, 부드러운 미소, 은은한 장미색(`#EE9A8E`) 색연필 볼터치, 양옆의 작고 둥근 귀, 손가락 갈라짐 없는 짧고 둥근 앞발·뒷발을 가진다.
- **색연필(몽당연필) 가시 결**: 머리와 등을 감싸는 가시 망토는 깎은 색연필·몽당연필 끝 콘셉트다. 크림색 나무 원뿔과 파스텔 색심 끝(세이지·하늘·장미·버터·살구·라벤더)이 가시 결을 따라 자연스럽게 읽히되, 딱딱한 기하학 삼각형이나 무거운 크레용처럼 과장하지 않는다.
- **표정·크기 구성**:
  - **기본 얼굴 1컷** (24·32·48px용): 정면에 가까운 3/4 얼굴 단독 아이콘. 턱 아래에는 가시를 두지 않고 매끄럽고 또렷한 코코아 색연필 곡선으로 여민다.
  - **표정 5컷** (96·160px용): 기본 · 읽는 중(작은 책을 펼침) · 생각 중(고개를 갸웃) · 반가움(두 팔을 듦) · 쉬는 중(몽당연필 베개에 기대 잠). 48px보다 작은 자리에는 표정 컷을 줄여 쓰지 않고 기본 얼굴만 쓴다.

---

## 3. 생성 지시문 고정 머리말 (영어 문단)

모든 그림 생성 지시문 맨 앞에 아래 **공통 머리말(3.1)**을 붙이고, 글벗이 등장하는 그림에는 **글벗 고정 문단(3.2)**과 캐릭터 시트 기준 이미지 참조(`ImagePaths`: `.local/art/P3-8a/raw/02-default-raw.png` 또는 `.local/art/P1-8b/5-colored-pencil-sketch/02-full.png`)를 함께 넣는다. 그 뒤에 장면별 대상·동작·배치만 덧붙인다.

### 3.1 공통 화풍 머리말 (PRD 8.8 #1~#7 공통)

```text
Delicate hand-drawn colored-pencil storybook illustration, warm and poetic printed picture-book aesthetic. Drawn with fine, soft cocoa-brown #4A3B32 colored-pencil sketch lines (strictly NO pure black #000000 lines) and airy, light hand-shaded colored-pencil strokes with gentle paper breathability, avoiding heavy wax crayon buildup or noisy grain. Muted pastel palette near apricot #F2A07B, butter yellow #F7D98B, sage green #A9C9A4, sky blue #A8CBE6, rose pink #EE9A8E, soft lavender #9C8ADE, and warm cream #FFF8EF, with only a single faint colored-pencil ground shadow wash directly beneath the subject. Flat front or gentle near-front three-quarter view without exaggerated perspective; continuous closed outer cocoa-brown contour around light cream shapes, isolated with clean margins on a completely plain, uniform, flat cream #FFF8EF background (no background scenery, no frames, no vignette, no checkerboard). Strictly NO text, NO letters, NO numbers, NO punctuation, NO speech bubbles, NO symbols (?, !, ..., Zzz), NO watermarks anywhere in the image. Strictly NO 3D gloss, NO airbrush gradients, NO sepia tint, NO sparkles or magic dust, NO anime eyes or white eye catchlights/shine, and NO mangled fingers.
```

### 3.2 글벗 캐릭터 고정 문단 (글벗이 나오는 #1·#2·#3·#6·#7에 추가)

```text
Featuring the exact same sweet tiny baby hedgehog character "Geulbeot" from the reference image (about 1.5 heads tall): tender affectionate expression, petite pointed upturned snout with a tiny cocoa-brown #4A3B32 nose tip, two tiny solid matte cocoa-brown dot eyes with zero white shine or catchlights, gentle little smile, soft rose #EE9A8E colored-pencil cheek blush, small rounded low-set hedgehog ears, and tiny stubby rounded paws without human fingers. Its head and back are covered by a cozy sweeping mantle of slender sharpened colored-pencil quills subtly showing cream #FFF8EF wooden cones and soft pastel colored lead tips alternating sage green #A9C9A4, sky blue #A8CBE6, rose pink #EE9A8E, butter yellow #F7D98B, apricot #F2A07B, and lavender #9C8ADE.
```

### 3.3 소형 아이콘 전용 보강 문단 (24·32·48px 기본 얼굴 컷에만 추가)

```text
Small-avatar legibility override: Head and face portrait ONLY (no torso, no neck, no limbs, no ground shadow), generously filling ~80% of the square frame with a smooth closed rounded cream chin and zero quills under the chin. Draw the cocoa-brown #4A3B32 colored-pencil outlines (chin curve, ears, outer quill tips, eyes, nose, and smile) noticeably thicker, darker, and crisper (~6-8px at 1024px) with slightly richer pastel tip contrast so the hedgehog face and colored-pencil quills remain unmistakably clear at 48x48, 32x32, and 24x24 pixels.
```

---

## 4. PRD 8.8 그림 2~7번 적용 지침

| # | 그림 | 쓰는 곳 | 참조 이미지(`ImagePaths`) | 장면별 주의 사항 |
|---|---|---|---|---|
| 2 | 펼친 책 위의 글벗 | 홈 | 캐릭터 시트 기본/읽기 컷 | 큰 펼친 백지 그림책 위에 다정하게 자리 잡은 글벗. 책 속지에 글자·줄선 금지. 48px에서도 책 형태가 읽혀야 함 |
| 3 | 편지를 든 글벗 | 이어 쓰기 기다림 | 캐릭터 시트 기본 컷 | 작은 파스텔 봉투 편지를 두 앞발로 소중히 든 글벗. 봉투 위 글자·우표 숫자 금지, 봉투 접힘선과 작은 색연필 도장 점 정도로만 표현 |
| 4 | 닫힌 문과 작은 팻말 | 만료·없는 수업방 | 캐릭터 시트 기본 컷(선·색 참조) | 투시 없는 평면 정면의 따뜻한 나무 교실 문과 빈 작은 팻말. **팻말 안에 글자 금지**. 선 굵기·색 온도를 캐릭터 시트와 일치 |
| 5 | 빈 교실 책상들 | 대시보드 빈 화면 | 캐릭터 시트 기본 컷(선·색 참조) | 원근 과장 없는 차분한 정면/완만한 3/4 구도의 작은 나무 책상·의자 2~3개와 놓인 색연필 한 자루. 과밀한 배경 금지 |
| 6 | 구름 아래 우산 쓴 글벗 | 오프라인 안내 | 캐릭터 시트 기본 컷 | 작고 둥근 비구름 아래 파스텔 우산을 두 앞발로 받쳐 든 글벗. 어둡고 무서운 폭풍우 대신 차분하고 포근한 색연필 빗방울 몇 줄 |
| 7 | 도장 "다 썼어요!" | 제출 순간 | 캐릭터 시트 반가움/기본 컷 | 원형·둥근 나무/종이 도장 테두리와 옆의 작은 글벗. 생성 단계에서는 도장 안을 비워 두고, 한글 문구는 깨끗한 벡터/글꼴로 결합 |

---

## 5. 후처리 및 검수 기준 (PRD 8.8)

1. **원본 보존**: 생성 도구가 출력한 무보정 단색 바탕 원본(`1024×1024` PNG)을 작업 폴더(`raw/`)에 함께 보관한다.
2. **배경 투명화 (`MAGICK_THREAD_LIMIT=1`)**:
   - ImageMagick으로 바깥 바탕과 닫힌 배경 구멍(다리 사이, 팔과 몸 사이 등)을 알파 추출·색 번짐 제거(unmixing)하여 배경 투명 PNG를 만든다.
   - 크림(`#FFF8EF`) 바탕과 흰색(`#FFFFFF`) 바탕 양쪽에 올려 **가장자리 흰 테두리·누런 번짐이 전혀 없는지** 1× 및 확대 뷰로 확인한다. 불투명 체커보드는 불합격이다.
3. **작은 크기 식별성**:
   - 기본 얼굴은 24·32·48px 실제 픽셀 크기로 축소해 고슴도치 얼굴과 색연필 가시가 분명히 알아봐지는지 확인한다.
   - 장면 그림(#2~#7)도 48px로 줄였을 때 핵심 사물(책·편지·문·책상·우산·도장)의 실루엣이 구분되는지 확인한다.
4. **같은 손·금지 요소 점검**:
   - 모든 컷의 코코아 색연필 선 온도, 색연필 결 밀도, 파스텔 채도가 기준 시트와 같은 손인지 대조한다.
   - PRD 8.7·8.10 금지 항목(눈 반사광, 3D 광택, 빛 가루, 말풍선, 그림 속 깨진 글자·기호, 뭉개진 손, 순검정 선, 세피아 변색, 실존 작가 흉내)이 하나라도 있으면 다시 만든다.
5. **반영 절차**: 작업 산출물은 `.local/art/` 아래 해당 작업 폴더에만 두며, 사용자 최종 승인 뒤 통합 담당(Claude)이 WebP 변환 및 `apps/web/src/ui/art/` 반영을 수행한다.
