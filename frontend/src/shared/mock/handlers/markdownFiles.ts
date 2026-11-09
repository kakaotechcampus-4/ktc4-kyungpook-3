import { HttpResponse, http } from 'msw'
import { seoulDateOf } from '@/shared/lib/date'
import type { MinutesDto } from '@/shared/types/api/minutes'
import { requireAuth, requireMember } from '../auth-guard'
import { db } from '../db'
import { fail } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
import { deletedMeetingResponse } from '../meetingDeletion'

type Summary = NonNullable<MinutesDto['summary']>

// 백엔드 _markdown_response 와 같은 헤더다. 한글 이름은 filename* 에만 싣는다 (api/project_map.py)
function markdownFile(body: string, filename: string, asciiFilename: string) {
  return new HttpResponse(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
    },
  })
}

function meetingDate(minutes: MinutesDto): string {
  return seoulDateOf(minutes.started_at) ?? minutes.started_at.slice(0, 10)
}

function summaryLines(summary: Summary): string[] {
  return [
    summary.overview,
    '',
    '### 핵심 내용',
    ...summary.key_points.map((point) => `- ${point}`),
    '',
    '### 결정한 것',
    ...summary.decisions.map((decision) => `- ${decision}`),
  ]
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export const markdownFileHandlers = [
  // 가드 순서는 회의록과 같다 — 삭제 410, 비로그인 401, 없는 회의 404, 다른 공간 403 (handlers/minutes.ts)
  http.get('/api/v1/meetings/:meetingId/summary.md', ({ params }) => {
    const meetingId = String(params.meetingId)
    const deleted = deletedMeetingResponse(meetingId)
    if (deleted) return deleted
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === meetingId)
    if (!meeting) return fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404)
    const denied = requireMember(meeting.workspace_id)
    if (denied) return denied
    const minutes = db.minutes.find(({ meeting_id }) => meeting_id === meetingId)
    if (!minutes?.summary)
      return fail('SUMMARY_NOT_FOUND', '이 회의의 요약본이 아직 없습니다.', 404, {
        meeting_id: meetingId,
      })
    const title = minutes.title ?? '회의'
    const date = meetingDate(minutes)
    const body = [
      `# ${title}`,
      '',
      `- 날짜: ${date}`,
      '',
      ...summaryLines(minutes.summary),
      '',
    ].join('\n')
    return markdownFile(body, `${date} ${title}.md`, 'summary.md')
  }),

  http.get('/api/v1/workspaces/:workspaceId/project-bundle.md', ({ params, request }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    const search = new URL(request.url).searchParams
    const from = search.get('from')
    const to = search.get('to')
    if ((from !== null && !DATE_ONLY.test(from)) || (to !== null && !DATE_ONLY.test(to)))
      return fail('INVALID_REQUEST', '날짜 형식이 올바르지 않습니다.', 400)
    if (from !== null && to !== null && from > to)
      return fail('INVALID_REQUEST', 'from 이 to 보다 늦습니다.', 400)
    const workspace = db.workspaces.find(({ workspace_id }) => workspace_id === workspaceId)
    const name = workspace?.name ?? '워크스페이스'
    const today = MOCK_NOW.slice(0, 10)
    const meetingIds = new Set(
      db.meetings
        .filter((meeting) => meeting.workspace_id === workspaceId)
        .map(({ meeting_id }) => meeting_id),
    )
    const summaries = db.minutes.flatMap((minutes) => {
      const date = meetingDate(minutes)
      const inPeriod = (from === null || date >= from) && (to === null || date <= to)
      return meetingIds.has(minutes.meeting_id) && minutes.summary !== null && inPeriod
        ? [{ date, title: minutes.title ?? '회의', summary: minutes.summary }]
        : []
    })
    const period =
      from === null && to === null ? '전체 기간' : `${from ?? '처음'} ~ ${to ?? '지금'}`
    const body = [
      `# ${name} 프로젝트 맥락`,
      '',
      `- 만든 날: ${today}`,
      `- 기간: ${period}`,
      '',
      '## 회의 요약',
      ...summaries.flatMap(({ date, title, summary }) => [
        '',
        `### ${date} ${title}`,
        '',
        ...summaryLines(summary),
      ]),
      '',
    ].join('\n')
    return markdownFile(body, `${name} 프로젝트 맥락 ${today}.md`, 'project-bundle.md')
  }),
]
