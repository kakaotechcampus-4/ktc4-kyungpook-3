// 시나리오 2: 봇·워커가 회의 하나를 BE 에 넘기는 흐름(ai/capture/handoff.py). 회의 내용은 심사 시드 데이터를 돌려 쓴다.
// 한 바퀴 = 회의 하나: POST /meetings → PATCH /end → POST /sources → 항목마다 POST /tasks/similar → POST /extractions
import http from 'k6/http'
import { check } from 'k6'
import { BASE, WORKSPACES, data, levels, login, pmEmail, stages } from './lib.js'

const seed = JSON.parse(open('../backend/app/cli/demo_seed/meetings.json'))
export const options = stages(levels('1,2,5,10,20'), Number(__ENV.LT_STAGE_SECONDS || 60), 'handoff')

const SERVICE = { 'X-Service-Token': __ENV.LT_SERVICE_TOKEN, 'Content-Type': 'application/json' }

export function setup() {
  const names = Object.fromEntries(seed.people.map((p) => [p.name, p.key]))
  const workspaces = []
  for (let w = 1; w <= WORKSPACES; w++) {
    const headers = login(pmEmail(w), __ENV.LT_PASSWORD)
    const ws = data(http.get(`${BASE}/workspaces`, { headers })).items[0].workspace_id
    const members = {}
    for (const m of data(http.get(`${BASE}/members?workspace_id=${ws}`, { headers })).items) {
      if (names[m.display_name]) members[names[m.display_name]] = m.member_id
    }
    workspaces.push({ ws, members })
  }
  return { workspaces }
}

function post(path, body, name, method = 'POST', extra = {}) {
  const res = http.request(method, `${BASE}${path}`, body === null ? null : JSON.stringify(body), {
    headers: { ...SERVICE, ...extra }, tags: { name },
  })
  check(res, { [`${name} 2xx`]: (r) => r.status >= 200 && r.status < 300 })
  return res
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function handoff({ workspaces }) {
  const { ws, members } = workspaces[(__VU - 1) % workspaces.length]
  const meeting = seed.meetings[__ITER % seed.meetings.length]
  const startedAt = new Date().toISOString()
  const day = startedAt.slice(0, 10)

  // 운영 봇처럼 회의 계보 헤더를 붙인다(seed_demo.replay_meetings 와 같다)
  const created = post('/meetings', {
    workspace_id: ws, title: `[부하] ${meeting.title}`, source: 'discord', started_at: startedAt,
  }, 'POST /meetings', 'POST', { 'X-Meeting-Lineage-Version': '1' })
  if (created.status !== 201) return
  const id = data(created).meeting_id
  post(`/meetings/${id}/end`, null, 'PATCH /meetings/{id}/end', 'PATCH')

  let at = 0
  const segments = meeting.turns.map((turn, seq) => {
    const end = at + turn.text.length * 0.2
    const s = { seq, start: at, end, text: turn.text, speaker_member_id: members[turn.speaker] }
    at = end + 0.5
    return s
  })
  post(`/meetings/${id}/sources`, { source: 'meeting', segments }, 'POST /meetings/{id}/sources')

  const items = meeting.items.map(({ speaker_key, due_in_days, ...item }) => ({
    ...item,
    ...(speaker_key ? { evidence_speaker_member_id: members[speaker_key] } : {}),
    ...(due_in_days !== undefined && due_in_days !== null ? { due_date: addDays(day, due_in_days) } : {}),
  }))
  for (const item of items) {
    post(`/workspaces/${ws}/tasks/similar`, { text: item.task_title, include_pending: true }, 'POST /workspaces/{id}/tasks/similar')
  }
  post('/extractions', { meeting_id: id, workspace_id: ws, items }, 'POST /extractions')
}
