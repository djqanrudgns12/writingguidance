/**
 * "받은 쪽이 기기의 변경을 다 가졌는가" 판정 하나(검토 5번). 저장됨 표시(기기)와 제출 검사(서버)가 같이 쓴다.
 *
 * 상태 벡터는 클라이언트별 마지막 시계만 담고 **지우기는 담지 않는다**(Yjs `getStateVector`는 struct 끝만 읽는다).
 * 이미 있던 글자만 지우면 벡터가 그대로라, 벡터만 보면 지우기 전 저장 알림이 지운 뒤 상태도 덮는다고 잘못 판정한다.
 * 그래서 Yjs 스냅숏(상태 벡터 + 삭제 집합)으로 본다. core는 yjs를 모르므로 `Y.Snapshot`과 같은 모양만 받는다.
 */
export interface DeleteRange {
  readonly clock: number;
  readonly len: number;
}

/** `Y.Snapshot`과 구조가 같다(`Y.snapshot(doc)`·`Y.decodeSnapshot(bytes)`을 그대로 넘긴다). */
export interface CoverageSnapshot {
  readonly sv: ReadonlyMap<number, number>;
  readonly ds: { readonly clients: ReadonlyMap<number, readonly DeleteRange[]> };
}

/**
 * `received`(서버 DB·서버 문서)가 `local`(기기)을 덮는가:
 * ① 기기 상태 벡터의 모든 클라이언트 시계를 받은 쪽이 같거나 크게 갖고
 * ② 기기 삭제 집합의 모든 구간이 받은 쪽 삭제 집합 구간 안에 들어 있으면 덮는다.
 */
export function snapshotCovers(received: CoverageSnapshot, local: CoverageSnapshot): boolean {
  for (const [client, clock] of local.sv) if ((received.sv.get(client) ?? 0) < clock) return false;
  for (const [client, ranges] of local.ds.clients) {
    const theirs = mergedRanges(received.ds.clients.get(client) ?? []);
    for (const range of ranges) {
      if (range.len > 0 && !inside(range, theirs)) return false;
    }
  }
  return true;
}

/** 시계 순으로 정렬하고 붙어 있거나 겹치는 구간을 합친다(받은 쪽이 쪼개 보냈어도 판정이 같게). */
function mergedRanges(ranges: readonly DeleteRange[]): DeleteRange[] {
  const sorted = ranges.filter(r => r.len > 0).sort((a, b) => a.clock - b.clock);
  const out: { clock: number; len: number }[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.clock <= last.clock + last.len) {
      last.len = Math.max(last.len, r.clock + r.len - last.clock);
    } else {
      out.push({ clock: r.clock, len: r.len });
    }
  }
  return out;
}

/** `merged`는 정렬·합친 구간. 이분 탐색으로 `range` 시작을 품는 구간을 찾아 끝까지 품는지 본다. */
function inside(range: DeleteRange, merged: readonly DeleteRange[]): boolean {
  let lo = 0;
  let hi = merged.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = merged[mid];
    if (!m) return false;
    if (range.clock < m.clock) hi = mid - 1;
    else if (range.clock >= m.clock + m.len) lo = mid + 1;
    else return range.clock + range.len <= m.clock + m.len;
  }
  return false;
}
