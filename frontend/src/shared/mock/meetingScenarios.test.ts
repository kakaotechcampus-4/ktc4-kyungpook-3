import { File as NodeFile } from 'node:buffer'
import type { RequestOptions } from '@/shared/api/client'
import { fetchDto, fetchSessionDto } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import type { MeetingDto, MeetingSummaryDto, MeetingUploadDto } from '@/shared/types/api/meeting'
import type { MinutesDto } from '@/shared/types/api/minutes'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { MOCK_SCENARIO_PARAM, prepareBrowserDb } from './browserDb'
import { db, resetDb } from './db'
import { MOCK_DB_STORAGE_KEY, restoreDb, saveDb } from './persistence'
import { applyScenario, createScenarioDb } from './scenarios'
import type { MockScenario } from './scenarios'
import { setMockRole } from './sessions'

const BrowserFile = globalThis.File
beforeEach(() => vi.stubGlobal('File', NodeFile))
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

/** 저장값에 원본이 들어가는지 찾을 수 있게 내용에 표식을 넣는다 */
const RAW_AUDIO = 'RAW-AUDIO-BYTES-DO-NOT-PERSIST'

function uploadBody(): RequestOptions {
  const form = new FormData()
  form.append('title', '데모 회의')
  form.append('started_at', '2026-09-17T05:00:00Z')
  form.append('attendee_member_ids', 'mb_01')
  form.append('attendee_member_ids', 'mb_04')
  form.append('file', new BrowserFile([RAW_AUDIO], 'demo.webm', { type: 'audio/webm' }))
  return { method: 'POST', body: form }
}

const upload = () => fetchDto<MeetingUploadDto>('/workspaces/ws_01/meetings/upload', uploadBody())
const detail = (id: string) => fetchDto<MeetingDto>(`/meetings/${id}`)

async function role(workspaceId: string) {
  const { items } = await fetchDto<ListDto<WorkspaceDto>>('/workspaces')
  return items.find(({ workspace_id }) => workspace_id === workspaceId)?.role
}

describe('회의 시나리오 (U2-4)', () => {
  it.each<[MockScenario, string, string]>([
    ['meeting-demo', 'staged', 'connected'],
    ['meeting-instant', 'instant', 'connected'],
    ['meeting-fail', 'fail', 'connected'],
    ['meeting-fail-notion-revoked', 'fail-notion-revoked', 'connected'],
    ['meeting-notion-not-connected', 'instant', 'not_connected'],
    ['meeting-notion-revoked', 'instant', 'revoked'],
  ])(
    '%s: ws_01 PM 으로 로그인, 흐름 %s, Notion %s. 처리 중 회의가 없어 바로 올릴 수 있다',
    async (scenario, mode, notion) => {
      applyScenario(scenario)
      await expect(fetchSessionDto()).resolves.toMatchObject({
        workspace_count: 1,
        last_workspace_id: 'ws_01',
      })
      await expect(role('ws_01')).resolves.toBe('pm')
      expect(db.meetingFlow.mode).toBe(mode)
      await expect(
        fetchDto<IntegrationsDto>('/workspaces/ws_01/integrations'),
      ).resolves.toMatchObject({ notion: { status: notion } })
      const { items } = await fetchDto<ListDto<MeetingSummaryDto>>('/workspaces/ws_01/meetings')
      expect(items.some(({ status }) => status === 'processing')).toBe(false)
      // 픽스처의 mt_10 도 같은 도우미로 끝냈다 — 회의록이 있다
      await expect(fetchDto<MinutesDto>('/meetings/mt_10/minutes')).resolves.toMatchObject({
        source: 'manual_upload',
      })
    },
  )

  it('meeting-demo: 업로드한 회의가 조회마다 한 단계씩 보이다가 끝난다', async () => {
    applyScenario('meeting-demo')
    const { meeting_id } = await upload()
    const statuses: string[] = []
    for (let poll = 0; poll < 4; poll += 1) statuses.push((await detail(meeting_id)).status)
    expect(statuses).toEqual(['processing', 'processing', 'processing', 'done'])
  })

  it('meeting-instant: 인위적 지연 없이 첫 조회에 끝난다', async () => {
    applyScenario('meeting-instant')
    const { meeting_id } = await upload()
    await expect(detail(meeting_id)).resolves.toMatchObject({ status: 'done' })
  })

  it('meeting-fail: 첫 조회에 실패하고 목록에서 빠진다', async () => {
    applyScenario('meeting-fail')
    const { meeting_id } = await upload()
    await expect(detail(meeting_id)).resolves.toMatchObject({ status: 'failed' })
    const { items } = await fetchDto<ListDto<MeetingSummaryDto>>('/workspaces/ws_01/meetings')
    expect(items.map(({ meeting_id: id }) => id)).not.toContain(meeting_id)
  })

  it('meeting-fail-notion-revoked: 실패하면서 Notion 이 끊긴다', async () => {
    applyScenario('meeting-fail-notion-revoked')
    const { meeting_id } = await upload()
    await detail(meeting_id)
    await expect(
      fetchDto<IntegrationsDto>('/workspaces/ws_01/integrations'),
    ).resolves.toMatchObject({ notion: { status: 'revoked' } })
  })

  it.each<[MockScenario, string]>([
    ['meeting-notion-not-connected', 'INTEGRATION_NOT_CONNECTED'],
    ['meeting-notion-revoked', 'INTEGRATION_REVOKED'],
  ])('%s: 업로드는 409 %s 다', async (scenario, code) => {
    applyScenario(scenario)
    await expect(upload()).rejects.toMatchObject({ code, status: 409 })
  })

  it('브라우저 주소의 시나리오 파라미터로 고른다', () => {
    const prepared = prepareBrowserDb(
      new URL(`/login?${MOCK_SCENARIO_PARAM}=meeting-demo`, location.origin),
      sessionStorage,
    )
    expect(prepared).toEqual({ scenario: 'meeting-demo', cleanPath: '/login' })
    expect(db).toEqual(createScenarioDb('meeting-demo'))
  })
})

describe('세션 역할 (U2-5)', () => {
  it('meeting-member: ws_01 의 일반 팀원이고 처리 중 mt_10 은 첫 조회에 끝난다', async () => {
    applyScenario('meeting-member')
    await expect(role('ws_01')).resolves.toBe('member')
    await expect(fetchDto<MinutesDto>('/meetings/mt_09/minutes')).resolves.toMatchObject({
      permissions: { can_review: false, can_undo: false },
    })
    await expect(detail('mt_10')).resolves.toMatchObject({ status: 'done' })
  })

  it('통합 테스트는 setMockRole 로 팀원·PM 세션을 고른다', async () => {
    await expect(role('ws_01')).resolves.toBe('pm')
    setMockRole('member')
    await expect(role('ws_01')).resolves.toBe('member')
    await expect(fetchDto<MinutesDto>('/meetings/mt_09/minutes')).resolves.toMatchObject({
      permissions: { can_review: false },
    })
    setMockRole('pm')
    await expect(role('ws_01')).resolves.toBe('pm')
    expect(() => setMockRole('member', 'ws_99')).toThrow(/missing/)
  })
})

describe('sessionStorage 영속 (U2-4)', () => {
  it('생성 데이터·흐름 방식·참석자는 새로고침 뒤에도 남고 원본 파일은 저장하지 않는다', async () => {
    applyScenario('meeting-demo')
    const { meeting_id } = await upload()
    await detail(meeting_id)
    saveDb(sessionStorage)

    const raw = sessionStorage.getItem(MOCK_DB_STORAGE_KEY) ?? ''
    expect(raw).not.toContain(RAW_AUDIO)
    expect(raw).not.toContain('demo.webm')

    // 새로고침: 모듈 상태가 시작 상태로 돌아갔다가 저장값으로 복원된다
    resetDb()
    expect(restoreDb(sessionStorage)).toBe(true)
    expect(db.meetingFlow).toEqual({
      mode: 'staged',
      attendees: { [meeting_id]: ['mb_01', 'mb_04'] },
    })
    // 복원된 진행 단계에서 이어 간다
    await expect(detail(meeting_id)).resolves.toMatchObject({
      progress: { audio_merged: true, transcribed: true, extracted: false },
    })
    await detail(meeting_id)
    await detail(meeting_id)
    await expect(fetchDto<MinutesDto>(`/meetings/${meeting_id}/minutes`)).resolves.toMatchObject({
      attendees: [{ member_id: 'mb_01' }, { member_id: 'mb_04' }],
    })
  })

  it('흐름 칸이 망가진 저장값은 버린다', () => {
    applyScenario('meeting-demo')
    saveDb(sessionStorage)
    const stored = JSON.parse(sessionStorage.getItem(MOCK_DB_STORAGE_KEY) ?? 'null') as {
      db: { meetingFlow: { mode: string } }
    }
    stored.db.meetingFlow.mode = 'whenever'
    sessionStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(stored))
    expect(restoreDb(sessionStorage)).toBe(false)
  })
})
