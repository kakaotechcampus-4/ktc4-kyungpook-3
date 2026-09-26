import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'

const seeds: [string, string, string | null, string, string | null, string | null, string][] = [
  ['tk_01', '로그인 API 연동', 'mb_01', 'in_progress', '2026-09-20', '2026-09-15', '2026-09-15'],
  ['tk_02', '회원가입 화면', 'mb_02', 'todo', '2026-09-16', null, '2026-09-10'],
  ['tk_03', 'DB 스키마 정리', 'mb_03', 'blocked', '2026-09-22', '2026-09-16', '2026-09-15'],
  ['tk_04', '배포 스크립트', 'mb_01', 'in_progress', '2026-09-24', '2026-09-17', '2026-09-16'],
  ['tk_05', '회의록 요약 검수', 'mb_02', 'todo', null, null, '2026-09-15'],
  ['tk_06', 'STT 정확도 측정', 'mb_04', 'in_progress', '2026-09-19', '2026-09-16', '2026-09-15'],
  ['tk_07', '온보딩 문구 수정', null, 'todo', '2026-09-10', null, '2026-09-08'],
  ['tk_08', '랜딩 카피', 'mb_03', 'done', '2026-09-12', '2026-09-08', '2026-09-08'],
  ['tk_09', '폰트 적용', 'mb_01', 'done', '2026-09-14', null, '2026-09-10'],
  ['tk_10', '토큰 정리', 'mb_02', 'done', '2026-09-17', '2026-09-12', '2026-09-12'],
]
export const taskFixtures: TaskDto[] = seeds.map(
  ([task_id, title, assignee_member_id, status, due_date, start_date, created]) => ({
    task_id,
    workspace_id: 'ws_01',
    meeting_id: ['tk_01', 'tk_02', 'tk_03'].includes(task_id) ? 'mt_09' : null,
    title,
    assignee_member_id,
    status,
    progress: task_id === 'tk_01' ? 40 : null,
    blocker: task_id === 'tk_03' ? 'Notion 권한 대기' : null,
    due_date,
    start_date,
    notion_page_id: ['tk_01', 'tk_09'].includes(task_id) ? `notion_${task_id}` : null,
    created_at: `${created}T04:00:00Z`,
    updated_at: '2026-09-17T04:00:00Z',
  }),
)
export const taskHistoryFixtures: TaskHistoryDto[] = [
  {
    history_id: 'hs_01',
    task_id: 'tk_01',
    changed_field: 'due_date',
    old_value: '2026-09-13',
    new_value: '2026-09-20',
    change_source: 'meeting',
    changed_by: null,
    is_auto: true,
    is_rolled_back: false,
    rolled_back_at: null,
    created_at: '2026-09-15T06:00:00Z',
  },
  {
    history_id: 'hs_02',
    task_id: 'tk_01',
    changed_field: 'status',
    old_value: 'todo',
    new_value: 'in_progress',
    change_source: 'manual',
    changed_by: 'mb_01',
    is_auto: false,
    is_rolled_back: false,
    rolled_back_at: null,
    created_at: '2026-09-16T06:00:00Z',
  },
]
