import {
  frameDimensions,
  getResolvedFrameEntry,
  homeFrames,
  loadLazyFrames,
  type FrameDimensions,
  type FrameEntry,
  type FrameName,
  type HomeFrameName,
  type LazyFrameName,
} from './home.ts';
import { lazyFrames } from './lazy.ts';

// PRD 8.3, PLAN §9.3-5: 홈 수업 카드·제출 도장·빈 화면 둘레용 고정 씨앗값 흔들림 선 SVG 목록.
export const frames = {
  'home-card-sm': homeFrames['home-card-sm'],
  'home-card-md': homeFrames['home-card-md'],
  'home-card-lg': homeFrames['home-card-lg'],
  'stamp-sm': lazyFrames['stamp-sm'],
  'stamp-md': lazyFrames['stamp-md'],
  'empty-sm': lazyFrames['empty-sm'],
  'empty-md': lazyFrames['empty-md'],
  'empty-lg': lazyFrames['empty-lg'],
} as const satisfies Record<FrameName, FrameEntry>;

export {
  frameDimensions,
  getResolvedFrameEntry,
  homeFrames,
  lazyFrames,
  loadLazyFrames,
  type FrameDimensions,
  type FrameEntry,
  type FrameName,
  type HomeFrameName,
  type LazyFrameName,
};
