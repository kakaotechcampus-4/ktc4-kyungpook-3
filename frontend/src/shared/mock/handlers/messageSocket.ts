import { ws } from 'msw'
import type { WebSocketHandlerConnection } from 'msw'
import { db } from '../db'
import type { MockMessageThread } from '../fixtures/message'
import { isMemberOf, linkedUserIdOf, roleIn } from '../sessions'

/*
 * 대화 신호 웹소켓 (계약 §5.7, 백엔드 api/message_socket.py). 받기 전에 세션(4401)과 소속(4403)을 본다.
 * 모의 서버의 세션은 하나라 연결이 열린 때의 계정을 그 연결의 사람으로 적어 둔다
 */

type Client = WebSocketHandlerConnection['client']

interface Listener {
  workspaceId: string
  userId: string
  client: Client
}

const listeners = new Set<Listener>()

const signals = ws.link('*/api/v1/workspaces/:workspaceId/messages/ws')

export const messageSocketHandler = signals.addEventListener('connection', ({ client, params }) => {
  const workspaceId = String(params.workspaceId)
  if (!db.authenticated) return client.close(4401)
  if (!isMemberOf(workspaceId)) return client.close(4403)
  const listener: Listener = { workspaceId, userId: db.session.user.user_id, client }
  listeners.add(listener)
  client.addEventListener('close', () => listeners.delete(listener))
})

/**
 * 대화에 새 줄이 생겼다고 알린다 (백엔드 thread_signals). 그 공간의 대화 주인과 지금 PM 인 계정의 연결이 받고, 쓴 사람도 받는다
 */
export function signalThreadUpdated(thread: MockMessageThread): void {
  const owner = linkedUserIdOf(thread.member_id)
  const frame = JSON.stringify({ type: 'thread_updated', thread_id: thread.thread_id })
  for (const { workspaceId, userId, client } of listeners) {
    if (workspaceId !== thread.workspace_id) continue
    if (userId === owner || roleIn(workspaceId, userId) === 'pm') client.send(frame)
  }
}

/** 열린 연결. 테스트가 화면이 소켓을 열었는지·닫았는지 본다 */
export function openMessageSockets(): { workspaceId: string; userId: string }[] {
  return [...listeners].map(({ workspaceId, userId }) => ({ workspaceId, userId }))
}

/** 서버 쪽에서 열린 연결을 모두 닫는다. 테스트가 재시작(1012)·만료(4401) 같은 닫힘을 만든다 */
export function closeMessageSockets(code: number): void {
  for (const { client } of listeners) client.close(code)
}
