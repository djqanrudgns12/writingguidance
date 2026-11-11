import {
  artDimensions,
  getResolvedArtEntry,
  homeArt,
  loadLazyArt,
  type ArtDimensions,
  type ArtEntry,
  type ArtName,
  type HomeArtName,
  type LazyArtName,
} from './home.ts';
import { lazyArt } from './lazy.ts';

// Vite 자산 해시 경로와 1x 기준 표시 치수를 이름별로 묶어 내보낸다.
export const art = {
  'gulbeot-face': homeArt['gulbeot-face'],
  'gulbeot-default': lazyArt['gulbeot-default'],
  'gulbeot-reading': lazyArt['gulbeot-reading'],
  'gulbeot-thinking': lazyArt['gulbeot-thinking'],
  'gulbeot-welcoming': lazyArt['gulbeot-welcoming'],
  'gulbeot-resting': lazyArt['gulbeot-resting'],
  'home-book': homeArt['home-book'],
  'waiting-letter': lazyArt['waiting-letter'],
  'closed-door': lazyArt['closed-door'],
  'empty-desks': lazyArt['empty-desks'],
  'offline-umbrella': lazyArt['offline-umbrella'],
  'submit-stamp': lazyArt['submit-stamp'],
  'paper-grain': homeArt['paper-grain'],
} as const satisfies Record<ArtName, ArtEntry>;

export {
  artDimensions,
  getResolvedArtEntry,
  homeArt,
  lazyArt,
  loadLazyArt,
  type ArtDimensions,
  type ArtEntry,
  type ArtName,
  type HomeArtName,
  type LazyArtName,
};
