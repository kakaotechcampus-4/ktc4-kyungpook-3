import type { ProjectMapDto } from '@/shared/types/api/projectMap'
import { toProjectMap } from './mapper'

const task = (id: string, appearedAt: string): ProjectMapDto['nodes'][number] => ({
  id,
  kind: 'task',
  label: id,
  status: 'todo',
  due_date: null,
  assignee_name: null,
  blocker: null,
  meeting_ids: [],
  appeared_at: appearedAt,
})

describe('toProjectMap — 이어진 태스크', () => {
  it('태스크끼리 이은 선은 양쪽 태스크에서 나온 순서로 한 번씩 보이고, 자기 자신·주제 선은 넣지 않는다', () => {
    const map = toProjectMap({
      meetings: [],
      nodes: [
        task('c', '2026-09-03T00:00:00Z'),
        task('a', '2026-09-01T00:00:00Z'),
        task('b', '2026-09-02T00:00:00Z'),
        task('alone', '2026-09-04T00:00:00Z'),
        { id: 'tp', kind: 'topic', label: '주제', appeared_at: '2026-09-01T00:00:00Z' },
      ],
      edges: [
        { source: 'a', target: 'c' },
        { source: 'b', target: 'a' },
        { source: 'c', target: 'a' },
        { source: 'a', target: 'a' },
        { source: 'tp', target: 'alone' },
      ],
    })

    const related = (id: string) => map.relatedTasks.get(id)?.map((node) => node.id)
    expect(related('a')).toEqual(['b', 'c'])
    expect(related('b')).toEqual(['a'])
    expect(related('c')).toEqual(['a'])
    expect(related('alone')).toBeUndefined()
    expect(map.looseTasks.map(({ id }) => id)).toEqual(['a', 'b', 'c'])
  })
})
