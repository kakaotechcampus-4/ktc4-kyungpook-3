import { setupServer } from 'msw/node'
import { handlers } from './handlers'
import { messageSocketHandler } from './handlers/messageSocket'

// 소켓 handler 는 handlers 에 넣지 않는다. 테스트가 handlers 를 getResponse 에 그대로 넘긴다
export const server = setupServer(...handlers, messageSocketHandler)
