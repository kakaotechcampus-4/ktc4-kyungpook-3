import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useRef } from 'react'
import type { BaseSyntheticEvent } from 'react'
import { useForm } from 'react-hook-form'
import type { DefaultValues, FieldValues, UseFormReturn } from 'react-hook-form'
import type { z } from 'zod'

/**
 * 폼 공통 정책 (D-142). 처음 입력하는 동안에는 오류를 보이지 않고 첫 blur 에서 검사한다.
 * 한 번 만진 칸과 제출 뒤 오류 칸은 값이 바뀔 때마다 다시 검사하고, 제출하면 첫 오류 칸으로 포커스를 옮긴다.
 */
export const FORM_POLICY = {
  mode: 'onTouched',
  reValidateMode: 'onChange',
  shouldFocusError: true,
} as const

export interface AppForm<TValues extends FieldValues> {
  form: UseFormReturn<TValues>
  /**
   * `<form onSubmit>` 에 건다. 검사를 통과하면 handler 를 부른다.
   * 앞 제출이 끝나기 전의 제출은 무시한다 — Enter 연타·더블클릭으로 요청이 두 번 나가지 않는다.
   * 제출 중인지는 `form.formState.isSubmitting` 으로 버튼에 알린다.
   */
  submit: (
    handler: (values: TValues) => Promise<void>,
  ) => (event?: BaseSyntheticEvent) => Promise<void>
}

/** 모든 폼은 이 훅으로 만든다. 검증은 Zod 스키마 하나다. 스키마가 값을 바꾸면(trim 등) handler 가 바뀐 값을 받는다 */
export function useAppForm<TValues extends FieldValues>(
  schema: z.ZodType<TValues, TValues>,
  defaultValues: DefaultValues<TValues>,
): AppForm<TValues> {
  const form = useForm<TValues>({
    ...FORM_POLICY,
    resolver: zodResolver(schema),
    defaultValues,
  })
  const inFlight = useRef(false)

  const submit = useCallback<AppForm<TValues>['submit']>(
    (handler) => async (event) => {
      event?.preventDefault()
      // 렌더를 기다리지 않는다 — 버튼이 비활성으로 바뀌기 전의 두 번째 제출도 여기서 막는다
      if (inFlight.current) return
      inFlight.current = true
      try {
        await form.handleSubmit(handler)(event)
      } finally {
        inFlight.current = false
      }
    },
    [form],
  )

  return { form, submit }
}
