import { useMediaQuery, WIDE_LAYOUT_QUERY } from '../../common/useMediaQuery.ts';
import type { WriteLayout } from './types.ts';

/**
 * 쓰기 화면 배치(옆 패널/바텀시트). 입력칸은 배치가 바뀌어도 같은 DOM 자리에 남는다(PLAN §6.3 "옮기기 금지"):
 * 바뀌는 것은 뿌리의 `data-layout`과 입력칸이 아닌 부품뿐이다. 기준 폭은 `WIDE_LAYOUT_QUERY`(900px).
 */
export function useWriteLayout(override?: WriteLayout): WriteLayout {
  const detected: WriteLayout = useMediaQuery(WIDE_LAYOUT_QUERY) ? 'wide' : 'narrow';
  return override ?? detected;
}

/**
 * 옆 결과 패널(`--side-w`, 최대 420px)이 열려도 쓰기 칸 상단 바 한 줄과 AI 칩 긴 이름 4개가 들어가는 창 폭.
 * 900~1199px에서 패널을 열면 쓰기 칸이 약 530~750px로 줄어, 한 줄 상단 바에서는 제목 칸이 39~160px까지 줄고
 * 칩 줄이 두 줄로 접혔다(P5-4 시각 검토 1번). 디자인 기준 폭이라 설정값이 아니다(`WIDE_LAYOUT_QUERY`와 같은 성격).
 */
export const SIDE_PANEL_ROOMY_QUERY = '(min-width: 1200px)';

/**
 * 좁은 쓰기 칸 배치(`data-compact`): 넓은 배치에서 옆 패널이 열렸는데 창이 넉넉하지 않을 때.
 * - 상단 바를 두 줄로 나눠 제목 칸이 쓰기 칸 폭 전체를 쓴다.
 * - AI 칩은 짧은 이름으로 한 줄을 지킨다.
 * 좁은 배치(바텀시트)는 원래 두 줄 상단 바·짧은 이름이라 해당 없음.
 */
export function isWriteCompact(layout: WriteLayout, sidePanelOpen: boolean, roomy: boolean): boolean {
  return layout === 'wide' && sidePanelOpen && !roomy;
}

export function useWriteCompact(layout: WriteLayout, sidePanelOpen: boolean): boolean {
  const roomy = useMediaQuery(SIDE_PANEL_ROOMY_QUERY);
  return isWriteCompact(layout, sidePanelOpen, roomy);
}
