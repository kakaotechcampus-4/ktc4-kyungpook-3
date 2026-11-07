import type { ReactNode } from 'react'

export interface SelectOption<V extends string> {
  value: V
  /** 트리거에 보이는 글자이자 글자 검색·찾기 칸 거르기 대상 */
  label: string
  /** 글자 앞 아이콘 자리 — 이니셜 원, 상태 표식 */
  leading?: ReactNode
  /** 글자 아래 둘째 줄. 트리거에는 보이지 않는다 */
  description?: ReactNode
  disabled?: boolean
}

/** 목록 줄의 DOM id — aria-activedescendant 가 가리킨다 */
export function optionDomId(listId: string, index: number): string {
  return `${listId}-option-${String(index)}`
}

/** 목록을 열 때 처음 짚는 줄 — 고른 줄, 없거나 고를 수 없으면 첫 번째 고를 수 있는 줄 */
export function initialActive<V extends string>(
  options: readonly SelectOption<V>[],
  selected: V | null,
): V | null {
  const chosen = options.find((option) => option.value === selected && !option.disabled)
  return (chosen ?? options.find((option) => !option.disabled))?.value ?? null
}

export type StepKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

export function isStepKey(key: string): key is StepKey {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End'
}

/** 키 하나만큼 옮긴 줄. 고를 수 없는 줄은 건너뛰고, 끝에서는 돌아가지 않고 멈춘다 */
export function stepActive<V extends string>(
  options: readonly SelectOption<V>[],
  active: V | null,
  key: StepKey,
): V | null {
  const enabled = options.filter((option) => !option.disabled)
  const first = enabled.at(0)?.value ?? null
  const last = enabled.at(-1)?.value ?? null
  if (key === 'Home') return first
  if (key === 'End') return last
  const index = options.findIndex((option) => option.value === active)
  if (index === -1) return key === 'ArrowDown' ? first : last
  const ahead = key === 'ArrowDown' ? options.slice(index + 1) : options.slice(0, index).reverse()
  return ahead.find((option) => !option.disabled)?.value ?? active
}

/** 글자로 찾기. 같은 글자를 거듭 치면 그 글자로 시작하는 다음 줄로 넘어간다 */
export function matchTyped<V extends string>(
  options: readonly SelectOption<V>[],
  active: V | null,
  typed: string,
): V | null {
  const index = options.findIndex((option) => option.value === active)
  const start = typed.length === 1 ? index + 1 : Math.max(index, 0)
  const ordered = [...options.slice(start), ...options.slice(0, start)]
  const prefix = typed.toLocaleLowerCase('ko')
  return (
    ordered.find(
      (option) => !option.disabled && option.label.toLocaleLowerCase('ko').startsWith(prefix),
    )?.value ?? null
  )
}

/** 찾기 칸의 글자가 이름 어디에든 들어 있는 줄 */
export function filterOptions<V extends string>(
  options: readonly SelectOption<V>[],
  query: string,
): readonly SelectOption<V>[] {
  const needle = query.trim().toLocaleLowerCase('ko')
  if (needle === '') return options
  return options.filter((option) => option.label.toLocaleLowerCase('ko').includes(needle))
}
