import closedDoor1x from './closed-door@1x.webp';
import closedDoor2x from './closed-door@2x.webp';
import emptyDesks1x from './empty-desks@1x.webp';
import emptyDesks2x from './empty-desks@2x.webp';
import gulbeotDefault1x from './gulbeot-default@1x.webp';
import gulbeotDefault2x from './gulbeot-default@2x.webp';
import gulbeotReading1x from './gulbeot-reading@1x.webp';
import gulbeotReading2x from './gulbeot-reading@2x.webp';
import gulbeotResting1x from './gulbeot-resting@1x.webp';
import gulbeotResting2x from './gulbeot-resting@2x.webp';
import gulbeotThinking1x from './gulbeot-thinking@1x.webp';
import gulbeotThinking2x from './gulbeot-thinking@2x.webp';
import gulbeotWelcoming1x from './gulbeot-welcoming@1x.webp';
import gulbeotWelcoming2x from './gulbeot-welcoming@2x.webp';
import offlineUmbrella1x from './offline-umbrella@1x.webp';
import offlineUmbrella2x from './offline-umbrella@2x.webp';
import submitStamp1x from './submit-stamp@1x.webp';
import submitStamp2x from './submit-stamp@2x.webp';
import waitingLetter1x from './waiting-letter@1x.webp';
import waitingLetter2x from './waiting-letter@2x.webp';
import { artDimensions, type ArtEntry, type LazyArtName } from './home.ts';

// 첫 화면(홈) 밖에서 쓰는 글벗 표정 5개와 장면 그림 5개 묶음. 부품이 그릴 때 동적 import로 불러온다.
export const lazyArt = {
  'gulbeot-default': {
    src1x: gulbeotDefault1x,
    src2x: gulbeotDefault2x,
    ...artDimensions['gulbeot-default'],
  },
  'gulbeot-reading': {
    src1x: gulbeotReading1x,
    src2x: gulbeotReading2x,
    ...artDimensions['gulbeot-reading'],
  },
  'gulbeot-thinking': {
    src1x: gulbeotThinking1x,
    src2x: gulbeotThinking2x,
    ...artDimensions['gulbeot-thinking'],
  },
  'gulbeot-welcoming': {
    src1x: gulbeotWelcoming1x,
    src2x: gulbeotWelcoming2x,
    ...artDimensions['gulbeot-welcoming'],
  },
  'gulbeot-resting': {
    src1x: gulbeotResting1x,
    src2x: gulbeotResting2x,
    ...artDimensions['gulbeot-resting'],
  },
  'waiting-letter': {
    src1x: waitingLetter1x,
    src2x: waitingLetter2x,
    ...artDimensions['waiting-letter'],
  },
  'closed-door': {
    src1x: closedDoor1x,
    src2x: closedDoor2x,
    ...artDimensions['closed-door'],
  },
  'empty-desks': {
    src1x: emptyDesks1x,
    src2x: emptyDesks2x,
    ...artDimensions['empty-desks'],
  },
  'offline-umbrella': {
    src1x: offlineUmbrella1x,
    src2x: offlineUmbrella2x,
    ...artDimensions['offline-umbrella'],
  },
  'submit-stamp': {
    src1x: submitStamp1x,
    src2x: submitStamp2x,
    ...artDimensions['submit-stamp'],
  },
} as const satisfies Record<LazyArtName, ArtEntry>;
