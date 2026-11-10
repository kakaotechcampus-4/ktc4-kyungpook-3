import type { MockTask } from './task'

/*
 * 프로젝트 맵의 원본 (#551). 백엔드 topic · topic_meeting · topic_item · decision 표와 임베딩 유사 선에 대응한다.
 * 응답(project-map · topics/{id})은 handler 가 이 표와 db 의 태스크·회의·팀원으로 만든다
 */

export interface MockTopic {
  topic_id: string
  workspace_id: string
  name: string
  description: string
  created_at: string
  /** 주제가 나온 회의 (topic_meeting) */
  meeting_ids: string[]
  /** 주제에 달린 태스크와 그 항목이 나온 회의 (topic_item) */
  items: { task_id: string; meeting_id: string }[]
}

export interface MockDecision {
  decision_id: string
  topic_id: string
  text: string
  reason: string | null
  meeting_id: string
  replaced_by: string | null
}

export interface MockProjectMap {
  topics: MockTopic[]
  decisions: MockDecision[]
  /** 임베딩 유사도로 이은 태스크끼리의 선 */
  taskLinks: { source: string; target: string }[]
}

export const projectMapFixture: MockProjectMap = {
  topics: [
    {
      topic_id: 'tp_01',
      workspace_id: 'ws_01',
      name: '로그인·계정',
      description: '이메일 인증 뒤 가입과 카카오 로그인을 만든다.',
      created_at: '2026-09-08T05:30:00Z',
      meeting_ids: ['mt_07', 'mt_09'],
      items: [
        { task_id: 'tk_01', meeting_id: 'mt_09' },
        { task_id: 'tk_02', meeting_id: 'mt_09' },
        { task_id: 'tk_07', meeting_id: 'mt_07' },
      ],
    },
    {
      topic_id: 'tp_02',
      workspace_id: 'ws_01',
      name: '배포·인프라',
      description: '데이터베이스와 배포 절차를 정리한다.',
      created_at: '2026-09-15T05:30:00Z',
      meeting_ids: ['mt_09'],
      items: [
        { task_id: 'tk_03', meeting_id: 'mt_09' },
        { task_id: 'tk_04', meeting_id: 'mt_09' },
      ],
    },
    {
      topic_id: 'tp_03',
      workspace_id: 'ws_01',
      name: '회의 요약 품질',
      description: '받아쓰기 정확도와 요약 검수 기준을 정한다.',
      created_at: '2026-09-11T00:30:00Z',
      meeting_ids: ['mt_08'],
      items: [
        { task_id: 'tk_05', meeting_id: 'mt_08' },
        { task_id: 'tk_06', meeting_id: 'mt_08' },
      ],
    },
    {
      topic_id: 'tp_04',
      workspace_id: 'ws_01',
      name: '디자인 정리',
      description: '랜딩 문구와 글꼴을 맞춘다.',
      created_at: '2026-09-08T05:30:00Z',
      meeting_ids: ['mt_07'],
      items: [
        { task_id: 'tk_08', meeting_id: 'mt_07' },
        { task_id: 'tk_09', meeting_id: 'mt_07' },
      ],
    },
  ],
  decisions: [
    {
      decision_id: 'dc_01',
      topic_id: 'tp_01',
      text: '이메일 인증 전에는 계정을 만들지 않는다',
      reason: '가짜 계정이 쌓이지 않게 한다',
      meeting_id: 'mt_07',
      replaced_by: 'dc_02',
    },
    {
      decision_id: 'dc_02',
      topic_id: 'tp_01',
      text: '카카오 로그인은 인증 없이 바로 계정을 만든다',
      reason: '카카오가 이미 본인을 확인했다',
      meeting_id: 'mt_09',
      replaced_by: null,
    },
    {
      decision_id: 'dc_03',
      topic_id: 'tp_02',
      text: '배포는 스크립트 하나로 한다',
      reason: null,
      meeting_id: 'mt_09',
      replaced_by: null,
    },
  ],
  taskLinks: [
    { source: 'tk_03', target: 'tk_04' },
    { source: 'tk_09', target: 'tk_10' },
  ],
}

/* 같은 시나리오는 늘 같은 db 여야 해서 고정 씨앗의 선형 합동 생성기를 쓴다 */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const LARGE_TOPICS = 36
const LARGE_TASKS = 500
const LARGE_LOOSE_TASKS = 30
const LARGE_TASK_LINKS = 703
const LARGE_STATUSES: MockTask['status'][] = ['todo', 'in_progress', 'blocked', 'done']
const LARGE_ASSIGNEES = ['mb_01', 'mb_02', 'mb_03', 'mb_04', null]
const LARGE_MEETINGS = ['mt_07', 'mt_08', 'mt_09']

const pad = (value: number) => String(value).padStart(3, '0')

/**
 * 성능 확인용 큰 맵 (#551). 주제 36 · 태스크 500 · 선 1,173(주제 선 470 + 태스크 선 703)이다.
 * BE 가 잰 500 태스크 응답과 같은 규모다
 */
export function largeProjectMap(): { tasks: MockTask[]; projectMap: MockProjectMap } {
  const random = seededRandom(551)
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]
  const tasks: MockTask[] = Array.from({ length: LARGE_TASKS }, (_, index) => {
    const day = String(1 + (index % 28)).padStart(2, '0')
    return {
      task_id: `tk_l${pad(index)}`,
      workspace_id: 'ws_01',
      meeting_id: pick(LARGE_MEETINGS),
      title: `큰 맵 태스크 ${String(index + 1)}`,
      assignee_member_id: pick(LARGE_ASSIGNEES),
      status: pick(LARGE_STATUSES),
      blocker: null,
      due_date: random() < 0.7 ? `2026-10-${day}` : null,
      start_date: null,
      notion_page_id: null,
      version: 1,
      notion_sync_status: null,
      created_at: `2026-09-${String(1 + (index % 17)).padStart(2, '0')}T04:00:00Z`,
      updated_at: '2026-09-17T04:00:00Z',
    }
  })
  const linked = tasks.slice(0, LARGE_TASKS - LARGE_LOOSE_TASKS)
  const topics: MockTopic[] = Array.from({ length: LARGE_TOPICS }, (_, index) => {
    const meeting_id = LARGE_MEETINGS[index % LARGE_MEETINGS.length]
    return {
      topic_id: `tp_l${pad(index)}`,
      workspace_id: 'ws_01',
      name: `큰 맵 주제 ${String(index + 1)}`,
      description: '성능 확인용 주제예요.',
      created_at: '2026-09-01T00:00:00Z',
      meeting_ids: [meeting_id],
      items: linked
        .filter((_, taskIndex) => taskIndex % LARGE_TOPICS === index)
        .map(({ task_id }) => ({ task_id, meeting_id })),
    }
  })
  const pairs = new Set<string>()
  const taskLinks: MockProjectMap['taskLinks'] = []
  while (taskLinks.length < LARGE_TASK_LINKS) {
    const source = pick(tasks).task_id
    const target = pick(tasks).task_id
    const key = source < target ? `${source}|${target}` : `${target}|${source}`
    if (source === target || pairs.has(key)) continue
    pairs.add(key)
    taskLinks.push({ source, target })
  }
  return { tasks, projectMap: { topics, decisions: [], taskLinks } }
}
