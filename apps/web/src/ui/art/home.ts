import gulbeotFace1x from './gulbeot-face@1x.webp';
import gulbeotFace2x from './gulbeot-face@2x.webp';
import homeBook1x from './home-book@1x.webp';
import homeBook2x from './home-book@2x.webp';
import paperGrain from './paper-grain.webp';

export interface ArtDimensions {
  readonly width: number;
  readonly height: number;
}

export interface ArtEntry extends ArtDimensions {
  readonly src1x: string;
  readonly src2x: string;
}

// 주소를 동적으로 받기 전에도 같은 크기 빈 자리를 잡아 배치가 흔들리지 않게 1x 기준 치수를 정적으로 둔다.
export const artDimensions = {
  'gulbeot-face': { width: 48, height: 44 },
  'gulbeot-default': { width: 160, height: 160 },
  'gulbeot-reading': { width: 160, height: 160 },
  'gulbeot-thinking': { width: 160, height: 160 },
  'gulbeot-welcoming': { width: 160, height: 160 },
  'gulbeot-resting': { width: 160, height: 129 },
  'home-book': { width: 240, height: 217 },
  'waiting-letter': { width: 240, height: 240 },
  'closed-door': { width: 240, height: 240 },
  'empty-desks': { width: 240, height: 114 },
  'offline-umbrella': { width: 240, height: 240 },
  'submit-stamp': { width: 240, height: 176 },
  'paper-grain': { width: 256, height: 256 },
} as const satisfies Record<string, ArtDimensions>;

export type ArtName = keyof typeof artDimensions;

// 첫 화면(학생 홈 `/`)이 실제로 그리는 그림만 첫 묶음에 정적으로 둔다(PRD 8.8 첫 화면 그림 예산 80KB).
export const homeArt = {
  'gulbeot-face': {
    src1x: gulbeotFace1x,
    src2x: gulbeotFace2x,
    ...artDimensions['gulbeot-face'],
  },
  'home-book': {
    src1x: homeBook1x,
    src2x: homeBook2x,
    ...artDimensions['home-book'],
  },
  'paper-grain': {
    src1x: paperGrain,
    src2x: paperGrain,
    ...artDimensions['paper-grain'],
  },
} as const satisfies Partial<Record<ArtName, ArtEntry>>;

export type HomeArtName = keyof typeof homeArt;
export type LazyArtName = Exclude<ArtName, HomeArtName>;

let cachedLazyArt: Readonly<Record<LazyArtName, ArtEntry>> | null = null;
let pendingLazyArt: Promise<Readonly<Record<LazyArtName, ArtEntry>> | null> | null = null;

/**
 * 첫 화면 정적 그림이거나 이미 동적으로 받아 둔 그림이면 즉시 돌려주고, 아직 안 받았으면 `undefined`를 돌려준다.
 */
export function getResolvedArtEntry(name: ArtName): ArtEntry | undefined {
  if (name in homeArt) {
    return homeArt[name as HomeArtName];
  }
  return cachedLazyArt?.[name as LazyArtName];
}

/**
 * 첫 화면 밖의 글벗 표정·장면 그림 묶음을 동적으로 불러와 캐시에 기억한다.
 */
export function loadLazyArt(): Promise<Readonly<Record<LazyArtName, ArtEntry>> | null> {
  if (cachedLazyArt) {
    return Promise.resolve(cachedLazyArt);
  }
  if (!pendingLazyArt) {
    pendingLazyArt = import('./lazy.ts')
      .then(mod => {
        cachedLazyArt = mod.lazyArt;
        return mod.lazyArt;
      })
      .catch(() => {
        pendingLazyArt = null;
        return null;
      });
  }
  return pendingLazyArt;
}
