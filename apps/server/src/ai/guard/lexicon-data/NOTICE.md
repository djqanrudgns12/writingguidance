# 비속어·위험 표현 사전 출처와 라이선스 (NOTICE)

이 폴더의 데이터는 `apps/server/src/ai/guard/lexicon.ts`(docs/ai-harness.md 4절, G-01·G-09·R-01·S-09)가 쓴다.
npm 의존성이 아니라, 공개 목록의 **텍스트 데이터만** GitHub raw에서 받아 검토한 뒤 TypeScript 모듈로 옮겼다(실행 코드는 가져오지 않음).
받은 날: 2026-11-13. 정리: H-1 작업(docs/briefs/H-1-lexicon.md, Claude 서브에이전트가 맡음).

## 1. 출처

| 파일 | 출처 | 커밋 | 라이선스 | 쓴 원본 |
|---|---|---|---|---|
| `korcen.ts`, `confusables.ts` | https://github.com/Tanat05/korcen | `eecd9763dbdccce3dc96ddb578ef0b6396058fa9` (2026-05-27 "Update LICENSE") | MIT, Copyright (c) 2026 Tanat | `korcen/korcen.py`의 목록 리터럴(파이썬 `ast`로 리터럴만 읽음, 실행 안 함) |
| `lisuugi.ts` | https://github.com/lisuugi/korean-profanity-filter | `4447832fa1f39ca589a42bdf7ef33b2fb5cb1b65` (2025-08-01) | Apache-2.0, Copyright 2025 Jaeuk Lee | `src/main/resources/dictionary/{profanity,sexuality,harmful}/*.txt` |
| `ldnoobw.ts` | https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words | `5faf2ba42d7b1c0977169ec3611df25a3c08eb13` | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) | `ko` |
| `own.ts` | 쌤유 글방 자체 작성 | — | 저장소와 같음 | — |

받은 파일의 SHA-256(검토할 때 같은 파일인지 확인용):

- korcen/korcen.py: `948ce613c8f170949ebdcd81e728fed6c5dde50dadcde9325ea7fe94b7b50e97`
- korcen/LICENSE: `1a8364a5549535591d94e55f184b9a03f98c296b67e2a194182017c7296827dc`
- lisuugi profanity.level-1.exact.txt: `a8f5f3f2e908c927b53690e4e8353f8088bb57be9b2d5f4714769671aaaae5d5`
- lisuugi profanity.level-2.common.txt: `30e0498aa47b08f0e6e34dfa8d869bc396bdff45df071af285816d91f99e5b89`
- lisuugi profanity.level-3.aggressive.txt: `4af99c055a33b61222ea3188969f908b997176629a52bdda903e413e6feffb25`
- lisuugi sexuality.level-1.exact.txt: `845bc17a642f0eb33e1ccdd7b6e7da23be31fe8cd4af46dac6cc55486ba7f9f9`
- lisuugi sexuality.level-2.common.txt: `92ae1d1a1a526ccc910428fa4be6f911ef02a51e5dd48bc4ffa7aaa0daefde14`
- lisuugi sexuality.level-3.aggressive.txt: `08a3c75e1597f77841d430968681cd2c052e7b2aceea17edb5908569cb807c58`
- lisuugi harmful.level-1.exact.txt: `9d92a654c0e8ee5a97370743b2b9c891f11ec90a7334c8cb7aa211d2fe27bb37`
- lisuugi harmful.level-2.common.txt: `76a9ac47164e45d13ebdd6574a4d35d9552f8a531d513a2425d1f5e009f2441e`
- lisuugi LICENSE: `167098903ff0e73ffb609ad0981a8e67ef06d0395833801e817c44dbe892c140`
- lisuugi NOTICE: `78e3234f2c528dd9b35ddd1c996948c763349fa72bd28a767e72300a4c37c89f`
- LDNOOBW ko: `0dd4b74ffea6e3bb35d658e6d8262b53ee99281eaa48ecb515a2065bfcc7f69d`
- LDNOOBW LICENSE: `55bfbc1759943f7d19acfc68e35644b7fbe10cd8d39ab3551ce5ecff5dda9979`

넣지 않은 것: Smilegate UnSmile(NC-ND), KOLD(라이선스 없음), BEEP!·APEACH·K-MHaS(BY-SA, 실제 댓글), 2runo·K-HATERS 등 실제 댓글 문장 데이터셋, 출처가 불분명한 재배포 목록(docs/ai-harness.md 4절).
lisuugi `politics/*.txt`는 커밋 시점에 빈 파일이었고 넣지 않았다. lisuugi `profanityWhitelist.txt`는 시험용 낱말(WhiteListTest)뿐이라 넣지 않았다.

## 2. 우리가 바꾼 점(Apache-2.0 4(b)·CC BY 4.0 3(a)(1)(B) 변경 표시)

1. **등급·분류를 다시 매겼다.** 원본 분류(korcen general/minor/sexual/belittle/race/parent, lisuugi profanity/sexuality/harmful level 1~3)를 기본값으로 쓰고 낱말마다 고쳤다.
   - `A` 절대 금지: 노골적 욕설 어근, 성기·성행위 비속어, 멸칭, 자해 방법·조장, 위험 제조법. 원본 korcen general·sexual·race·parent, lisuugi level 1~2 기본값.
   - `B` 문맥 필요: 일상·교과·이야기에 정상 뜻이 있는 말(새끼(동물), 미친(영향을 미친), 자살·자해(예방 교육), 의학·성교육 낱말, 옛 장애 비하어(난쟁이·장님 등, 동화에 나옴), 마약 이름, "죽여 버릴" 같은 위협, 위험 신호).
   - `C` 순화 대상: 가벼운 은어·비하(존나·닥쳐·찐따·개소리, -충 비하어 등). 원본 korcen minor·belittle, lisuugi level 3 기본값.
   - 분류: `profanity` 욕설, `sexual` 성적 표현, `hate` 멸칭·비하(인종·장애·성별·노인·지역 비하어), `selfharm` 자해·자살, `danger` 위험 정보·위협, `risk_signal` 1인칭 위험 신호(R-01).
2. **뺀 것**(낱말 수는 출처 안 중복을 뺀 값):

   | 이유 | korcen | lisuugi | LDNOOBW |
   |---|---:|---:|---:|
   | 정치 성향·정치인·정치 사건 표현(korcen `politics` 33개 전부와 다른 분류의 정치 비하어) | 35 | 0 | 0 |
   | 외국 문자 목록(korcen `japanese`·`chinese`; 다른 언어 출력은 G-03이 막음) | 1169 | 0 | 0 |
   | 이모지(korcen `special` 등; G-03이 막고, 저장소 규칙상 소스에 이모지 금지) | 10 | 1 | 0 |
   | 일상어·학교 말과 겹침(오탐) | 87 | 281 | 10 |
   | 자모·닮은 글자로 쓴 꼴이 정규화 뒤 일상 음절이 되거나 이미 다른 낱말로 잡힘 | 40 | 107 | 0 |
   | 뜻이 불분명하거나 거꾸로 쓴 꼴·시험용 낱말 | 6 | 1 | 0 |

   - 일상어 오탐 예: 사발, 세끼(하루 세끼), 새까(새까맣다), 캐년(그랜드 캐년), 게놈, 십년·십팔·팔년(숫자), 젖도·젖더(젖다), 족까(가족까지), 저까(저까지), 씨방·연병(교과 낱말), 시방(사투리 "지금"), 쫒·좇(쫓다 오타·좇다), 씹(씹다), 꺼져(불이 꺼져), 뒤져·뒤질(뒤지다), 고자(고자질), 망가(망가지다), 유모·야사·노모·호로(호로록)·에로·하드코어, 거시기, 알몸, 첫경험, 다리벌려(체육), 싸게해줄게·싸줄게(값·도시락), 빨아줘·빨고싶다(빨래·사탕), 엄마없는·니엄마(일반 문장), 매국노·돌팔이(역사·일반어), 오입(오입니다), 애널(그 애 널), 개좋아(개 좋아해), 존내(존 내일) 등.
   - 정치·지역 기준: 정치인 이름·별명, 정치 성향 비하어(예: 빨갱이·운지·일베충·메갈), 정치 사건 표현은 뺐다. 일반 지역 이름은 넣지 않았고, 지역 비하어 두 개(전라디언·멍청도)만 자체 목록에 `C hate`로 넣었다. 성별 갈등 비하어(김치녀·한남충 등)는 정치 성향이 아니라 비하어로 보고 `C hate`로 남겼다.
3. **허용 목록**: korcen 오탐 예외(`FALSE_POSITIVE_PATTERNS_*`, politics·영어 제외) 가운데 우리 낱말을 품는 것만 남겼다(153개; 그 자체로 비하어인 "흑형님"과 너무 넓은 "씨발라"는 뺐다). 우리가 더한 허용어는 `own.ts`(275개, 수박씨발라·포도씨발라처럼 좁힌 예외 포함, 예: 시발점·시바견·전염병·성교육·자살 예방·새끼 고양이·보지 않·자지 말고·개 새끼가 태어). 허용어는 지우고 찾는 방식이 아니라 **구간 포함 방식**으로만 쓴다.
4. **첫머리 고정(`wordStart`)**: 일상 낱말 안에 흔히 드는 말(보지·자지·버지…로 시작하는 낱말, 미친, 자살, 자해, 애미 등)은 앞 글자가 한글이 아닐 때만 잡는다. 구절(공백이 든 낱말)은 모두 첫머리 고정이다.
5. **닮은 글자 표**(`confusables.ts`): korcen `SINGLE_CHAR_NORMALIZATION_MAP`에서 한글 자모로 가는 것만 골랐다(전각·수학 글자는 NFKD가 처리). 적용은 한글과 섞인 덩어리 안, 자모와 맞물릴 때만.
6. **자체 작성**(`own.ts`): 자해·자살 방법·조장(A), 위험 제조법·위험 놀이(A), 마약 이름·위협(B), 1인칭 위험 신호(B, 예: "죽고 싶", "나를 때려", "아무한테도 말하지 마"), 보충 은어·비하어. 이야기·역사 속 죽음·전쟁 낱말과 "아무도 모르게"처럼 이야기에 흔한 말은 넣지 않았다.
7. 정규화·조립기·다중 패턴 찾기는 직접 구현했다(외부 코드 복사 없음).

## 3. 낱말 수

파일에 적힌 낱말 수(출처 안 중복만 뺀 값, 출처끼리 겹치는 낱말 포함):

| 파일 | A | B | C | 허용어 |
|---|---|---|---|---:|
| `korcen.ts` | 욕설 525 · 성적 117 · 멸칭 19 | 욕설 4 · 성적 5 · 비하 1 | 욕설 43 · 성적 10 · 비하 12 | 153 |
| `lisuugi.ts` | 욕설 2216 · 성적 433 · 멸칭 9 | 욕설 9 · 성적 34 · 비하 2 · 위험 2 | 욕설 68 · 성적 16 · 비하 2 | 0 |
| `ldnoobw.ts` | 욕설 22 · 성적 15 · 멸칭 2 | 욕설 1 · 성적 5 | 욕설 8 · 성적 7 · 비하 2 | 0 |
| `own.ts` | 자해 36 · 위험 123 | 욕설 7 · 비하 5 · 자해 2 · 위험 12 · 위험 신호 51 | 욕설 8 · 비하 7 | 275 |

사전에 실제로 든 열쇠 수(정규화·출처 간 중복을 합친 뒤, 같은 열쇠는 먼저 넣은 출처 기준 — korcen → lisuugi → LDNOOBW → 자체). 합 3342개. 숫자는 `lexiconStats()`로 다시 셀 수 있다.

| 등급/분류 | korcen | lisuugi | LDNOOBW | 자체 | 합 |
|---|---:|---:|---:|---:|---:|
| A/danger | 0 | 0 | 0 | 122 | 122 |
| A/hate | 19 | 0 | 0 | 0 | 19 |
| A/profanity | 525 | 1905 | 0 | 0 | 2430 |
| A/selfharm | 0 | 0 | 0 | 34 | 34 |
| A/sexual | 115 | 351 | 0 | 0 | 466 |
| B/danger | 0 | 2 | 0 | 12 | 14 |
| B/hate | 1 | 1 | 0 | 5 | 7 |
| B/profanity | 4 | 5 | 0 | 7 | 16 |
| B/risk_signal | 0 | 0 | 0 | 51 | 51 |
| B/selfharm | 0 | 0 | 0 | 2 | 2 |
| B/sexual | 5 | 31 | 0 | 0 | 36 |
| C/hate | 12 | 1 | 1 | 7 | 21 |
| C/profanity | 43 | 51 | 2 | 8 | 104 |
| C/sexual | 10 | 10 | 0 | 0 | 20 |

## 4. 고치는 법

- 낱말을 더하거나 뺄 때는 해당 출처 파일의 묶음(등급·분류)에 넣고, 일상어와 겹치면 `wordStart` 묶음에 넣거나 허용어를 더한다.
- `npx vitest run apps/server/test/guard/lexicon.test.ts`로 회피 수법·오탐 예·위치·성능 시험을 돌린다.
- 목록을 새로 받으면 위 커밋·SHA-256을 바꾸고 2절의 기준으로 다시 거른다.

## 5. 라이선스 원문

### 5.1 korcen — MIT License

```
MIT License

Copyright (c) 2026 Tanat

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 5.2 lisuugi/korean-profanity-filter — NOTICE

```
Korean Profanity Filter
Copyright 2025 Jaeuk Lee

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).

===========================================================================

This product includes software from the Aho-Corasick project.
Copyright 2012-2015 Robert Bor

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

===========================================================================
```

### 5.3 lisuugi/korean-profanity-filter — Apache License 2.0

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2025 Jaeuk Lee

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### 5.4 LDNOOBW — Creative Commons Attribution 4.0 International

저작자 표시: "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" by LDNOOBW contributors, CC BY 4.0. 이 저장소에서는 `ko` 목록을 고쳐(2절) 썼다.

```
Attribution 4.0 International

=======================================================================

Creative Commons Corporation ("Creative Commons") is not a law firm and
does not provide legal services or legal advice. Distribution of
Creative Commons public licenses does not create a lawyer-client or
other relationship. Creative Commons makes its licenses and related
information available on an "as-is" basis. Creative Commons gives no
warranties regarding its licenses, any material licensed under their
terms and conditions, or any related information. Creative Commons
disclaims all liability for damages resulting from their use to the
fullest extent possible.

Using Creative Commons Public Licenses

Creative Commons public licenses provide a standard set of terms and
conditions that creators and other rights holders may use to share
original works of authorship and other material subject to copyright
and certain other rights specified in the public license below. The
following considerations are for informational purposes only, are not
exhaustive, and do not form part of our licenses.

     Considerations for licensors: Our public licenses are
     intended for use by those authorized to give the public
     permission to use material in ways otherwise restricted by
     copyright and certain other rights. Our licenses are
     irrevocable. Licensors should read and understand the terms
     and conditions of the license they choose before applying it.
     Licensors should also secure all rights necessary before
     applying our licenses so that the public can reuse the
     material as expected. Licensors should clearly mark any
     material not subject to the license. This includes other CC-
     licensed material, or material used under an exception or
     limitation to copyright. More considerations for licensors:
	wiki.creativecommons.org/Considerations_for_licensors

     Considerations for the public: By using one of our public
     licenses, a licensor grants the public permission to use the
     licensed material under specified terms and conditions. If
     the licensor's permission is not necessary for any reason--for
     example, because of any applicable exception or limitation to
     copyright--then that use is not regulated by the license. Our
     licenses grant only permissions under copyright and certain
     other rights that a licensor has authority to grant. Use of
     the licensed material may still be restricted for other
     reasons, including because others have copyright or other
     rights in the material. A licensor may make special requests,
     such as asking that all changes be marked or described.
     Although not required by our licenses, you are encouraged to
     respect those requests where reasonable. More_considerations
     for the public:
	wiki.creativecommons.org/Considerations_for_licensees

=======================================================================

Creative Commons Attribution 4.0 International Public License

By exercising the Licensed Rights (defined below), You accept and agree
to be bound by the terms and conditions of this Creative Commons
Attribution 4.0 International Public License ("Public License"). To the
extent this Public License may be interpreted as a contract, You are
granted the Licensed Rights in consideration of Your acceptance of
these terms and conditions, and the Licensor grants You such rights in
consideration of benefits the Licensor receives from making the
Licensed Material available under these terms and conditions.


Section 1 -- Definitions.

  a. Adapted Material means material subject to Copyright and Similar
     Rights that is derived from or based upon the Licensed Material
     and in which the Licensed Material is translated, altered,
     arranged, transformed, or otherwise modified in a manner requiring
     permission under the Copyright and Similar Rights held by the
     Licensor. For purposes of this Public License, where the Licensed
     Material is a musical work, performance, or sound recording,
     Adapted Material is always produced where the Licensed Material is
     synched in timed relation with a moving image.

  b. Adapter's License means the license You apply to Your Copyright
     and Similar Rights in Your contributions to Adapted Material in
     accordance with the terms and conditions of this Public License.

  c. Copyright and Similar Rights means copyright and/or similar rights
     closely related to copyright including, without limitation,
     performance, broadcast, sound recording, and Sui Generis Database
     Rights, without regard to how the rights are labeled or
     categorized. For purposes of this Public License, the rights
     specified in Section 2(b)(1)-(2) are not Copyright and Similar
     Rights.

  d. Effective Technological Measures means those measures that, in the
     absence of proper authority, may not be circumvented under laws
     fulfilling obligations under Article 11 of the WIPO Copyright
     Treaty adopted on December 20, 1996, and/or similar international
     agreements.

  e. Exceptions and Limitations means fair use, fair dealing, and/or
     any other exception or limitation to Copyright and Similar Rights
     that applies to Your use of the Licensed Material.

  f. Licensed Material means the artistic or literary work, database,
     or other material to which the Licensor applied this Public
     License.

  g. Licensed Rights means the rights granted to You subject to the
     terms and conditions of this Public License, which are limited to
     all Copyright and Similar Rights that apply to Your use of the
     Licensed Material and that the Licensor has authority to license.

  h. Licensor means the individual(s) or entity(ies) granting rights
     under this Public License.

  i. Share means to provide material to the public by any means or
     process that requires permission under the Licensed Rights, such
     as reproduction, public display, public performance, distribution,
     dissemination, communication, or importation, and to make material
     available to the public including in ways that members of the
     public may access the material from a place and at a time
     individually chosen by them.

  j. Sui Generis Database Rights means rights other than copyright
     resulting from Directive 96/9/EC of the European Parliament and of
     the Council of 11 March 1996 on the legal protection of databases,
     as amended and/or succeeded, as well as other essentially
     equivalent rights anywhere in the world.

  k. You means the individual or entity exercising the Licensed Rights
     under this Public License. Your has a corresponding meaning.


Section 2 -- Scope.

  a. License grant.

       1. Subject to the terms and conditions of this Public License,
          the Licensor hereby grants You a worldwide, royalty-free,
          non-sublicensable, non-exclusive, irrevocable license to
          exercise the Licensed Rights in the Licensed Material to:

            a. reproduce and Share the Licensed Material, in whole or
               in part; and

            b. produce, reproduce, and Share Adapted Material.

       2. Exceptions and Limitations. For the avoidance of doubt, where
          Exceptions and Limitations apply to Your use, this Public
          License does not apply, and You do not need to comply with
          its terms and conditions.

       3. Term. The term of this Public License is specified in Section
          6(a).

       4. Media and formats; technical modifications allowed. The
          Licensor authorizes You to exercise the Licensed Rights in
          all media and formats whether now known or hereafter created,
          and to make technical modifications necessary to do so. The
          Licensor waives and/or agrees not to assert any right or
          authority to forbid You from making technical modifications
          necessary to exercise the Licensed Rights, including
          technical modifications necessary to circumvent Effective
          Technological Measures. For purposes of this Public License,
          simply making modifications authorized by this Section 2(a)
          (4) never produces Adapted Material.

       5. Downstream recipients.

            a. Offer from the Licensor -- Licensed Material. Every
               recipient of the Licensed Material automatically
               receives an offer from the Licensor to exercise the
               Licensed Rights under the terms and conditions of this
               Public License.

            b. No downstream restrictions. You may not offer or impose
               any additional or different terms or conditions on, or
               apply any Effective Technological Measures to, the
               Licensed Material if doing so restricts exercise of the
               Licensed Rights by any recipient of the Licensed
               Material.

       6. No endorsement. Nothing in this Public License constitutes or
          may be construed as permission to assert or imply that You
          are, or that Your use of the Licensed Material is, connected
          with, or sponsored, endorsed, or granted official status by,
          the Licensor or others designated to receive attribution as
          provided in Section 3(a)(1)(A)(i).

  b. Other rights.

       1. Moral rights, such as the right of integrity, are not
          licensed under this Public License, nor are publicity,
          privacy, and/or other similar personality rights; however, to
          the extent possible, the Licensor waives and/or agrees not to
          assert any such rights held by the Licensor to the limited
          extent necessary to allow You to exercise the Licensed
          Rights, but not otherwise.

       2. Patent and trademark rights are not licensed under this
          Public License.

       3. To the extent possible, the Licensor waives any right to
          collect royalties from You for the exercise of the Licensed
          Rights, whether directly or through a collecting society
          under any voluntary or waivable statutory or compulsory
          licensing scheme. In all other cases the Licensor expressly
          reserves any right to collect such royalties.


Section 3 -- License Conditions.

Your exercise of the Licensed Rights is expressly made subject to the
following conditions.

  a. Attribution.

       1. If You Share the Licensed Material (including in modified
          form), You must:

            a. retain the following if it is supplied by the Licensor
               with the Licensed Material:

                 i. identification of the creator(s) of the Licensed
                    Material and any others designated to receive
                    attribution, in any reasonable manner requested by
                    the Licensor (including by pseudonym if
                    designated);

                ii. a copyright notice;

               iii. a notice that refers to this Public License;

                iv. a notice that refers to the disclaimer of
                    warranties;

                 v. a URI or hyperlink to the Licensed Material to the
                    extent reasonably practicable;

            b. indicate if You modified the Licensed Material and
               retain an indication of any previous modifications; and

            c. indicate the Licensed Material is licensed under this
               Public License, and include the text of, or the URI or
               hyperlink to, this Public License.

       2. You may satisfy the conditions in Section 3(a)(1) in any
          reasonable manner based on the medium, means, and context in
          which You Share the Licensed Material. For example, it may be
          reasonable to satisfy the conditions by providing a URI or
          hyperlink to a resource that includes the required
          information.

       3. If requested by the Licensor, You must remove any of the
          information required by Section 3(a)(1)(A) to the extent
          reasonably practicable.

       4. If You Share Adapted Material You produce, the Adapter's
          License You apply must not prevent recipients of the Adapted
          Material from complying with this Public License.


Section 4 -- Sui Generis Database Rights.

Where the Licensed Rights include Sui Generis Database Rights that
apply to Your use of the Licensed Material:

  a. for the avoidance of doubt, Section 2(a)(1) grants You the right
     to extract, reuse, reproduce, and Share all or a substantial
     portion of the contents of the database;

  b. if You include all or a substantial portion of the database
     contents in a database in which You have Sui Generis Database
     Rights, then the database in which You have Sui Generis Database
     Rights (but not its individual contents) is Adapted Material; and

  c. You must comply with the conditions in Section 3(a) if You Share
     all or a substantial portion of the contents of the database.

For the avoidance of doubt, this Section 4 supplements and does not
replace Your obligations under this Public License where the Licensed
Rights include other Copyright and Similar Rights.


Section 5 -- Disclaimer of Warranties and Limitation of Liability.

  a. UNLESS OTHERWISE SEPARATELY UNDERTAKEN BY THE LICENSOR, TO THE
     EXTENT POSSIBLE, THE LICENSOR OFFERS THE LICENSED MATERIAL AS-IS
     AND AS-AVAILABLE, AND MAKES NO REPRESENTATIONS OR WARRANTIES OF
     ANY KIND CONCERNING THE LICENSED MATERIAL, WHETHER EXPRESS,
     IMPLIED, STATUTORY, OR OTHER. THIS INCLUDES, WITHOUT LIMITATION,
     WARRANTIES OF TITLE, MERCHANTABILITY, FITNESS FOR A PARTICULAR
     PURPOSE, NON-INFRINGEMENT, ABSENCE OF LATENT OR OTHER DEFECTS,
     ACCURACY, OR THE PRESENCE OR ABSENCE OF ERRORS, WHETHER OR NOT
     KNOWN OR DISCOVERABLE. WHERE DISCLAIMERS OF WARRANTIES ARE NOT
     ALLOWED IN FULL OR IN PART, THIS DISCLAIMER MAY NOT APPLY TO YOU.

  b. TO THE EXTENT POSSIBLE, IN NO EVENT WILL THE LICENSOR BE LIABLE
     TO YOU ON ANY LEGAL THEORY (INCLUDING, WITHOUT LIMITATION,
     NEGLIGENCE) OR OTHERWISE FOR ANY DIRECT, SPECIAL, INDIRECT,
     INCIDENTAL, CONSEQUENTIAL, PUNITIVE, EXEMPLARY, OR OTHER LOSSES,
     COSTS, EXPENSES, OR DAMAGES ARISING OUT OF THIS PUBLIC LICENSE OR
     USE OF THE LICENSED MATERIAL, EVEN IF THE LICENSOR HAS BEEN
     ADVISED OF THE POSSIBILITY OF SUCH LOSSES, COSTS, EXPENSES, OR
     DAMAGES. WHERE A LIMITATION OF LIABILITY IS NOT ALLOWED IN FULL OR
     IN PART, THIS LIMITATION MAY NOT APPLY TO YOU.

  c. The disclaimer of warranties and limitation of liability provided
     above shall be interpreted in a manner that, to the extent
     possible, most closely approximates an absolute disclaimer and
     waiver of all liability.


Section 6 -- Term and Termination.

  a. This Public License applies for the term of the Copyright and
     Similar Rights licensed here. However, if You fail to comply with
     this Public License, then Your rights under this Public License
     terminate automatically.

  b. Where Your right to use the Licensed Material has terminated under
     Section 6(a), it reinstates:

       1. automatically as of the date the violation is cured, provided
          it is cured within 30 days of Your discovery of the
          violation; or

       2. upon express reinstatement by the Licensor.

     For the avoidance of doubt, this Section 6(b) does not affect any
     right the Licensor may have to seek remedies for Your violations
     of this Public License.

  c. For the avoidance of doubt, the Licensor may also offer the
     Licensed Material under separate terms or conditions or stop
     distributing the Licensed Material at any time; however, doing so
     will not terminate this Public License.

  d. Sections 1, 5, 6, 7, and 8 survive termination of this Public
     License.


Section 7 -- Other Terms and Conditions.

  a. The Licensor shall not be bound by any additional or different
     terms or conditions communicated by You unless expressly agreed.

  b. Any arrangements, understandings, or agreements regarding the
     Licensed Material not stated herein are separate from and
     independent of the terms and conditions of this Public License.


Section 8 -- Interpretation.

  a. For the avoidance of doubt, this Public License does not, and
     shall not be interpreted to, reduce, limit, restrict, or impose
     conditions on any use of the Licensed Material that could lawfully
     be made without permission under this Public License.

  b. To the extent possible, if any provision of this Public License is
     deemed unenforceable, it shall be automatically reformed to the
     minimum extent necessary to make it enforceable. If the provision
     cannot be reformed, it shall be severed from this Public License
     without affecting the enforceability of the remaining terms and
     conditions.

  c. No term or condition of this Public License will be waived and no
     failure to comply consented to unless expressly agreed to by the
     Licensor.

  d. Nothing in this Public License constitutes or may be interpreted
     as a limitation upon, or waiver of, any privileges and immunities
     that apply to the Licensor or You, including from the legal
     processes of any jurisdiction or authority.


=======================================================================

Creative Commons is not a party to its public licenses.
Notwithstanding, Creative Commons may elect to apply one of its public
licenses to material it publishes and in those instances will be
considered the "Licensor." Except for the limited purpose of indicating
that material is shared under a Creative Commons public license or as
otherwise permitted by the Creative Commons policies published at
creativecommons.org/policies, Creative Commons does not authorize the
use of the trademark "Creative Commons" or any other trademark or logo
of Creative Commons without its prior written consent including,
without limitation, in connection with any unauthorized modifications
to any of its public licenses or any other arrangements,
understandings, or agreements concerning use of licensed material. For
the avoidance of doubt, this paragraph does not form part of the public
licenses.

Creative Commons may be contacted at creativecommons.org.
```
