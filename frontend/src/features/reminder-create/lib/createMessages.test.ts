import type { Bundle, CreatedReminder } from '@/entities/message'
import { ApiError } from '@/shared/api/errors'
import { createdNotice, knownCreateFailure } from './createMessages'

const created = (
  taskCount: number,
  stage: Bundle['stage'] = 'awaitingApproval',
): CreatedReminder => ({
  reminderId: 'rm_04',
  bundle: {
    recipientName: '이재환',
    stage,
    tasks: Array.from({ length: taskCount }, (_, index) => ({ reminderId: `rm_0${index}` })),
  } as Bundle,
})

const apiError = (code: string, status: number) =>
  new ApiError({ code, message: '', details: null }, status)

it('다른 태스크와 같은 메시지에 들어갔으면 함께 확인하라고, 아니면 승인해야 나간다고 알린다', () => {
  expect(createdNotice(created(1))).toBe(
    '재촉을 만들었어요. 메시지 화면에서 확인하고 승인해야 나가요.',
  )
  expect(createdNotice(created(2))).toBe(
    '같은 시각에 이재환님에게 보낼 메시지에 넣었어요. 함께 보낼 태스크와 문구를 확인하고 승인해 주세요.',
  )
})

it('돌려받은 묶음이 승인돼 있으면 같은 재촉이 이미 있던 것이라 승인한 그대로 나간다고 알린다', () => {
  for (const count of [1, 2])
    expect(createdNotice(created(count, 'approved'))).toBe(
      '같은 재촉이 이미 있어요. 승인한 메시지 그대로 나가요.',
    )
})

it('다시 보내도 같은 거절만 문구가 있고, 나머지는 다시 시도할 실패다', () => {
  expect(knownCreateFailure(apiError('REMINDER_SCHEDULED_AT_PASSED', 409))).toBe(
    '보낼 시각이 지났어요. 시각을 다시 골라 주세요.',
  )
  expect(knownCreateFailure(apiError('TASK_NOT_FOUND', 404))).toBe(
    '태스크가 지워졌어요. 목록을 다시 확인해 주세요.',
  )
  expect(knownCreateFailure(apiError('MEMBER_NOT_FOUND', 404))).toBe(
    '팀원을 찾을 수 없어요. 팀원 목록을 다시 확인해 주세요.',
  )
  expect(knownCreateFailure(apiError('INTERNAL_ERROR', 500))).toBeNull()
  expect(knownCreateFailure(new Error('network'))).toBeNull()
})
