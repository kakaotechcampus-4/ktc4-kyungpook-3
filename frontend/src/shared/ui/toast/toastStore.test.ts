import { MAX_VISIBLE_TOASTS, toast, useToastStore } from './toastStore'

function items() {
  return useToastStore.getState().items
}

describe('toast store', () => {
  it('같은 key 는 하나로 합치고 나중 내용으로 바꾼다', () => {
    toast.show({ key: 'saved', title: '저장했어요' })
    toast.show({ key: 'saved', title: '다시 저장했어요' })
    expect(items()).toHaveLength(1)
    expect(items()[0]).toMatchObject({ key: 'saved', title: '다시 저장했어요' })
  })

  it('key 가 없으면 제목이 key 다', () => {
    toast.show({ title: '접근 권한이 없어요' })
    toast.show({ title: '접근 권한이 없어요' })
    expect(items()).toHaveLength(1)
  })

  it('합치면 새 id 를 받는다 — 표시 시간이 처음부터 다시 흐른다', () => {
    toast.show({ key: 'saved', title: '저장했어요' })
    const first = items()[0].id
    toast.show({ key: 'saved', title: '저장했어요' })
    expect(items()[0].id).not.toBe(first)
  })

  it('동시에 3개까지만 남기고 오래된 것부터 뺀다', () => {
    for (const key of ['a', 'b', 'c', 'd']) toast.show({ key, title: key })
    expect(MAX_VISIBLE_TOASTS).toBe(3)
    expect(items().map(({ key }) => key)).toEqual(['b', 'c', 'd'])
  })

  it('remove 는 하나를, clear 는 전부를 뺀다', () => {
    toast.show({ key: 'a', title: 'a' })
    toast.show({ key: 'b', title: 'b' })
    useToastStore.getState().remove(items()[0].id)
    expect(items().map(({ key }) => key)).toEqual(['b'])
    toast.clear()
    expect(items()).toEqual([])
  })
})
