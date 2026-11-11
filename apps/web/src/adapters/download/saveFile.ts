import type { DownloadFile, DownloadPort } from '../../ports/download.ts';

/**
 * 브라우저 파일 내려받기(PRD F-12·F-21): `URL.createObjectURL` + 숨긴 `<a download>`를 눌러 저장한다.
 * application은 `ports/download.ts`로만 부른다(PLAN §2.5).
 */

/**
 * blob 주소를 거두기까지 기다리는 시간. 누른 직후에 거두면 Safari가 파일을 다 읽기 전에 사라져 빈 파일이 될 수 있어
 * FileSaver.js와 같은 40초 뒤에 거둔다(설정값이 아니라 브라우저 동작에 맞춘 구현 값).
 */
const REVOKE_AFTER_MS = 40_000;

export interface SaveFileEnv {
  readonly document: Document;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
}

export function browserSaveFileEnv(): SaveFileEnv {
  return {
    document,
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  };
}

export function saveFile(file: DownloadFile, env: SaveFileEnv = browserSaveFileEnv()): void {
  const href = env.createObjectURL(file.blob);
  const anchor = env.document.createElement('a');
  anchor.href = href;
  anchor.download = file.name;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  env.document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    env.setTimeout(() => env.revokeObjectURL(href), REVOKE_AFTER_MS);
  }
}

export function createDownloadPort(env?: SaveFileEnv): DownloadPort {
  return { save: file => saveFile(file, env ?? browserSaveFileEnv()) };
}
