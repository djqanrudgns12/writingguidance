import { inflateRawSync } from 'node:zlib';

/**
 * 모두 내려받기 zip(PRD F-21)을 시험에서 읽는 작은 도구. 새 의존성 없이 중앙 목록만 읽어
 * 파일 이름과 내용(저장 0·deflate 8)을 꺼낸다. 시험 대상 파일 크기가 작아 zip64는 다루지 않는다.
 */
export interface ZipEntry {
  readonly name: string;
  readonly text: string;
}

export function readZip(buffer: Buffer): ZipEntry[] {
  // 끝 목록(End of central directory) 찾기: 서명 0x06054b50, 뒤에서 앞으로
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip 끝 목록을 찾을 수 없음');
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('zip 중앙 목록 서명이 틀림');
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip 파일 머리 서명이 틀림');
    const localName = buffer.readUInt16LE(localOffset + 26);
    const localExtra = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const raw = buffer.subarray(start, start + compressedSize);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`모르는 압축 방식 ${method}`);
    entries.push({ name, text: data.toString('utf8') });
  }
  return entries;
}
