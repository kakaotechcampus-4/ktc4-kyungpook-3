// 시나리오 1: 로그인한 PM 이 대시보드를 여는 흐름. 요청 묶음은 frontend/src/widgets/dashboard/model/useDashboardData.ts 와
// 전역 배지(알림 30초 폴링, 안 읽은 대화 수)를 따랐다. 한 바퀴 = 대시보드 열기 + 회의 상세 + 다섯 번에 한 번 태스크 상태 변경
// (LT_READONLY 를 주면 상태 변경을 빼고 읽기만 한다. 운영용)
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE, WORKSPACES, data, levels, login, pmEmail, stages } from './lib.js'

export const options = stages(levels('10,25,50,100,200'), Number(__ENV.LT_STAGE_SECONDS || 60), 'dashboard')

let session = null

function open() {
  const w = ((__VU - 1) % WORKSPACES) + 1
  const headers = login(pmEmail(w), __ENV.LT_PASSWORD)
  const ws = data(http.get(`${BASE}/workspaces`, { headers, tags: { name: 'GET /workspaces' } })).items[0]
  return { headers, ws: ws.workspace_id }
}

function get(path, name) {
  return ['GET', `${BASE}${path}`, null, { headers: session.headers, tags: { name } }]
}

export function dashboard() {
  if (session === null) session = open()
  const ws = session.ws
  const res = http.batch([
    get('/auth/me', 'GET /auth/me'),
    get('/workspaces', 'GET /workspaces'),
    get(`/approvals?workspace_id=${ws}&status=pending`, 'GET /approvals'),
    get(`/members?workspace_id=${ws}`, 'GET /members'),
    get(`/members?workspace_id=${ws}&include_withdrawn=true`, 'GET /members'),
    get(`/workspaces/${ws}/integrations`, 'GET /workspaces/{id}/integrations'),
    get(`/workspaces/${ws}/meetings`, 'GET /workspaces/{id}/meetings'),
    get(`/tasks?workspace_id=${ws}`, 'GET /tasks'),
    get(`/workspaces/${ws}/notifications`, 'GET /workspaces/{id}/notifications'),
    get(`/workspaces/${ws}/messages/unread-count`, 'GET /workspaces/{id}/messages/unread-count'),
  ])
  check(res, { 'dashboard all 200': (r) => r.every((x) => x.status === 200) })

  const meetings = res[6].status === 200 ? data(res[6]).items : []
  if (meetings.length > 0) {
    const m = meetings[__ITER % meetings.length]
    const detail = http.get(`${BASE}/meetings/${m.meeting_id}`, { headers: session.headers, tags: { name: 'GET /meetings/{id}' } })
    check(detail, { 'meeting 200': (r) => r.status === 200 })
  }

  const tasks = res[7].status === 200 ? data(res[7]).items : []
  if (!__ENV.LT_READONLY && __ITER % 5 === 0 && tasks.length > 0) {
    const t = tasks[__ITER % tasks.length]
    const status = t.status === 'todo' ? 'in_progress' : 'todo'
    const patched = http.patch(`${BASE}/tasks/${t.task_id}`, JSON.stringify({ status }), {
      headers: { ...session.headers, 'Content-Type': 'application/json' }, tags: { name: 'PATCH /tasks/{id}' },
    })
    check(patched, { 'task patch 200': (r) => r.status === 200 })
  }
  sleep(3 + Math.random() * 4)
}
