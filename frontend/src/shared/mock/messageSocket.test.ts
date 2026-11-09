import { fetchDto, jsonRequest } from '@/shared/test/api'
import { db } from './db'
import { applyScenario } from './scenarios'
import { setMockRole } from './sessions'
import { signalThreadUpdated } from './handlers/messageSocket'

/*
 * 대화 신호 웹소켓 handler (계약 §5.7, 백엔드 api/message_socket.py). 받기 전 검사의 닫힘 코드와 신호를 받는 사람을 본다.
 * 화면 쪽 연결은 entities/message 와 app/messagesSignals 테스트가 본다
 */

interface Opened {
  socket: WebSocket
  frames: unknown[]
  closed: Promise<number>
  opened: Promise<void>
}

const sockets: WebSocket[] = []

function open(workspaceId = 'ws_01'): Opened {
  const socket = new WebSocket(`ws://localhost:3000/api/v1/workspaces/${workspaceId}/messages/ws`)
  sockets.push(socket)
  const frames: unknown[] = []
  socket.addEventListener('message', ({ data }) => frames.push(JSON.parse(String(data))))
  return {
    socket,
    frames,
    opened: new Promise((resolve) => socket.addEventListener('open', () => resolve())),
    closed: new Promise((resolve) => socket.addEventListener('close', ({ code }) => resolve(code))),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const thread = (threadId: string) => {
  const found = db.messageThreads.find(({ thread_id }) => thread_id === threadId)
  if (!found) throw new Error(`mock thread ${threadId} is missing`)
  return found
}
const replyTo = (threadId: string, body: string) =>
  fetchDto(`/workspaces/ws_01/messages/threads/${threadId}/replies`, jsonRequest('POST', { body }))

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close()
})

it('로그인하지 않았으면 4401 로 닫는다', async () => {
  db.authenticated = false
  await expect(open().closed).resolves.toBe(4401)
})

it('그 공간 소속이 아니면 4403 으로 닫는다', async () => {
  await expect(open('ws_99').closed).resolves.toBe(4403)
})

it('PM 이 남의 대화에 쓰면 쓴 PM 의 연결도 그 대화의 신호를 받는다', async () => {
  const pm = open()
  await pm.opened
  await replyTo('th_01', '재환님, 확인 부탁해요')
  await settle()
  expect(pm.frames).toEqual([{ type: 'thread_updated', thread_id: 'th_01' }])
})

it('대화 주인은 자기 대화의 신호만 받는다', async () => {
  applyScenario('messages-member')
  const owner = open()
  await owner.opened
  await replyTo('th_06', '웹에서 한 줄 더')
  signalThreadUpdated(thread('th_01'))
  await settle()
  expect(owner.frames).toEqual([{ type: 'thread_updated', thread_id: 'th_06' }])
})

it('받는 PM 은 신호를 보낼 때의 역할로 정한다', async () => {
  setMockRole('member')
  const socket = open()
  await socket.opened
  signalThreadUpdated(thread('th_01'))
  setMockRole('pm')
  signalThreadUpdated(thread('th_02'))
  await settle()
  expect(socket.frames).toEqual([{ type: 'thread_updated', thread_id: 'th_02' }])
})

it('다른 공간의 연결은 받지 않고, 닫은 연결에는 보내지 않는다', async () => {
  const closedEarly = open()
  await closedEarly.opened
  closedEarly.socket.close()
  await closedEarly.closed
  const other = open('ws_02')
  await other.opened

  await replyTo('th_01', '재환님, 확인 부탁해요')
  await settle()
  expect(other.frames).toEqual([])
  expect(closedEarly.frames).toEqual([])
})
