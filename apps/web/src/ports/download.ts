/**
 * 파일 내려받기 포트(PRD F-12·F-21, PLAN §6.7). application은 이 포트로만 기기에 파일을 남긴다.
 * 실제 내려받기(`URL.createObjectURL` + `<a download>`)는 `adapters/download/saveFile.ts`가 맡는다.
 */
export interface DownloadFile {
  /** 정리된 파일 이름(확장자 포함). 이름 정리는 application이 끝낸 뒤 넘긴다. */
  readonly name: string;
  readonly blob: Blob;
}

export interface DownloadPort {
  /** 파일 하나를 기기에 내려받게 한다. 버튼을 누른 흐름에서 부른다(누르지 않고 연달아 부르면 브라우저가 막을 수 있다). */
  save(file: DownloadFile): void;
}
