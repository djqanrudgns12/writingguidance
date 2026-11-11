import emptyLg from './empty-lg.svg';
import emptyMd from './empty-md.svg';
import emptySm from './empty-sm.svg';
import stampMd from './stamp-md.svg';
import stampSm from './stamp-sm.svg';
import { frameDimensions, type FrameEntry, type LazyFrameName } from './home.ts';

// 첫 화면(홈) 밖에서 쓰는 제출 도장·빈 화면 둘레 손그림 테두리 SVG 묶음. 부품이 그릴 때 동적 import로 불러온다.
export const lazyFrames = {
  'stamp-sm': { src: stampSm, ...frameDimensions['stamp-sm'] },
  'stamp-md': { src: stampMd, ...frameDimensions['stamp-md'] },
  'empty-sm': { src: emptySm, ...frameDimensions['empty-sm'] },
  'empty-md': { src: emptyMd, ...frameDimensions['empty-md'] },
  'empty-lg': { src: emptyLg, ...frameDimensions['empty-lg'] },
} as const satisfies Record<LazyFrameName, FrameEntry>;
