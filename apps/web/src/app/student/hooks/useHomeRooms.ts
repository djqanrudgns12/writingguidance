import { useEffect, useState } from 'react';
import type { AppDeps } from '../../../application/deps.ts';
import type { RecentRoomCard } from '../../../ports/deviceMemory.ts';
import type { HomeRoomEntry } from '../../../ui/screens/student/HomeView.tsx';

/**
 * S0 이어 쓰기 카드·최근 수업방(PRD F-01·F-23, PLAN §6.7). 첫 그림은 localStorage 사본(동기, 토큰 없음)으로 그리고,
 * IndexedDB 기억으로 다시 확인한다(사본이 낡았거나 지워졌을 수 있다). 가장 최근 것이 이어 쓰기 카드다.
 */
export interface HomeRooms {
  readonly resume: HomeRoomEntry | null;
  readonly recent: readonly HomeRoomEntry[];
  /** 방 ID → 들어갈 곳(입장 코드·마지막 글) */
  readonly cards: ReadonlyMap<string, Pick<RecentRoomCard, 'entryCode' | 'lastDocId'>>;
}

function toHome(cards: readonly RecentRoomCard[]): HomeRooms {
  const sorted = [...cards].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const entries: HomeRoomEntry[] = sorted.map(c => ({
    roomId: c.roomId,
    className: c.className,
    roomTitle: c.title,
    nickname: c.nickname,
    lastUsedAt: c.lastUsedAt,
  }));
  return {
    resume: entries[0] ?? null,
    recent: entries.slice(1),
    cards: new Map(sorted.map(c => [c.roomId, { entryCode: c.entryCode, lastDocId: c.lastDocId }])),
  };
}

export function useHomeRooms(deps: Pick<AppDeps, 'memory' | 'now'>): HomeRooms {
  const [rooms, setRooms] = useState<HomeRooms>(() => toHome(deps.memory.recentCardsSync(deps.now())));

  useEffect(() => {
    let alive = true;
    void deps.memory.students(deps.now()).then(
      list => alive && setRooms(toHome(list)),
      () => {
        // 기기 저장소를 못 읽으면 사본 그대로 둔다.
      },
    );
    return () => {
      alive = false;
    };
  }, [deps]);

  return rooms;
}
