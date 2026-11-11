import type { ErrorCode } from '@geulbang/core/errors';
import type { Hello } from '@geulbang/core/protocol';
import { describe, expect, it } from 'vitest';
import { value } from '../ports/observable.ts';
import type { RoomChannel, RoomChannelState } from '../ports/realtime.ts';
import { waitHello } from './openWriting.ts';

function channelIn(state: RoomChannelState, failure: ErrorCode | null = null): RoomChannel {
  return {
    roomId: 'r1',
    state: value(state),
    hello: value<Hello | null>(null),
    failure: value(failure),
    on: () => () => {},
    send: async () => {
      throw new Error('쓰지 않음');
    },
    queue: { enqueue: async () => '', pending: async () => [], onResult: () => () => {} },
    close() {},
  };
}

describe('waitHello', () => {
  it.each<[RoomChannelState, ErrorCode | null, ErrorCode, boolean]>([
    ['failed', 'E_AUTH', 'E_AUTH', false],
    ['failed', 'E_SERVER_DOWN', 'E_SERVER_DOWN', true],
    ['gone', null, 'E_ROOM_NOT_FOUND', false],
    ['closed', null, 'E_ROOM_NOT_FOUND', false],
  ])('이미 %s(%s)인 채널은 기다리지 않고 바로 거부한다', async (state, failure, code, retryable) => {
    await expect(waitHello(channelIn(state, failure))).rejects.toEqual({ code, retryable });
  });

  it('연결 중이면 hello를 기다리고, 나중에 끝나면 그때 거부한다', async () => {
    const state = value<RoomChannelState>('connecting');
    const pending = waitHello({ ...channelIn('connecting'), state });
    state.set('gone');
    await expect(pending).rejects.toMatchObject({ code: 'E_ROOM_NOT_FOUND' });
  });
});
