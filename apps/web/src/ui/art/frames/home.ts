import homeCardLg from './home-card-lg.svg';
import homeCardMd from './home-card-md.svg';
import homeCardSm from './home-card-sm.svg';

export interface FrameDimensions {
  readonly width: number;
  readonly height: number;
}

export interface FrameEntry extends FrameDimensions {
  readonly src: string;
}

// 주소를 동적으로 받기 전에도 같은 크기 빈 자리를 잡을 수 있도록 표시 치수를 정적으로 둔다.
export const frameDimensions = {
  'home-card-sm': { width: 328, height: 176 },
  'home-card-md': { width: 480, height: 200 },
  'home-card-lg': { width: 640, height: 220 },
  'stamp-sm': { width: 128, height: 128 },
  'stamp-md': { width: 168, height: 168 },
  'empty-sm': { width: 160, height: 160 },
  'empty-md': { width: 240, height: 180 },
  'empty-lg': { width: 320, height: 220 },
} as const satisfies Record<string, FrameDimensions>;

export type FrameName = keyof typeof frameDimensions;

// 첫 화면(학생 홈 `/`) 카드가 쓰는 손그림 테두리 SVG만 정적으로 둔다(PRD 8.3, 8.8).
export const homeFrames = {
  'home-card-sm': { src: homeCardSm, ...frameDimensions['home-card-sm'] },
  'home-card-md': { src: homeCardMd, ...frameDimensions['home-card-md'] },
  'home-card-lg': { src: homeCardLg, ...frameDimensions['home-card-lg'] },
} as const satisfies Partial<Record<FrameName, FrameEntry>>;

export type HomeFrameName = keyof typeof homeFrames;
export type LazyFrameName = Exclude<FrameName, HomeFrameName>;

let cachedLazyFrames: Readonly<Record<LazyFrameName, FrameEntry>> | null = null;
let pendingLazyFrames: Promise<Readonly<Record<LazyFrameName, FrameEntry>> | null> | null = null;

/**
 * 첫 화면 정적 테두리이거나 이미 동적으로 받아 둔 테두리이면 즉시 돌려주고, 아직 안 받았으면 `undefined`를 돌려준다.
 */
export function getResolvedFrameEntry(name: FrameName): FrameEntry | undefined {
  if (name in homeFrames) {
    return homeFrames[name as HomeFrameName];
  }
  return cachedLazyFrames?.[name as LazyFrameName];
}

/**
 * 첫 화면 밖의 도장·빈 화면 테두리 SVG 묶음을 동적으로 불러와 캐시에 기억한다.
 */
export function loadLazyFrames(): Promise<Readonly<Record<LazyFrameName, FrameEntry>> | null> {
  if (cachedLazyFrames) {
    return Promise.resolve(cachedLazyFrames);
  }
  if (!pendingLazyFrames) {
    pendingLazyFrames = import('./lazy.ts')
      .then(mod => {
        cachedLazyFrames = mod.lazyFrames;
        return mod.lazyFrames;
      })
      .catch(() => {
        pendingLazyFrames = null;
        return null;
      });
  }
  return pendingLazyFrames;
}
