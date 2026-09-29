/* D-016~D-020. 서버에는 이 정규화가 없다 (D-172). 폼이 믿을 곳은 이 함수 하나다.
   오류 문구는 폼(M4) 가까이에 둔다 — 여기서는 사유 코드만 돌려준다 (D-149). */

export const WORKSPACE_NAME_MAX_LENGTH = 20

const graphemes = new Intl.Segmenter('ko', { granularity: 'grapheme' })

/** 앞뒤 공백 제거 → 연속 공백을 하나로. 저장과 중복 검사 전에 항상 거친다 */
export function normalizeWorkspaceName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** 사용자에게 보이는 글자 수. 이모지·국기·결합 문자는 한 글자다 */
export function countVisibleCharacters(value: string): number {
  return Array.from(graphemes.segment(value)).length
}

export type WorkspaceNameIssue = 'empty' | 'too_long' | 'duplicated'

export type WorkspaceNameCheck =
  { ok: true; name: string } | { ok: false; name: string; issue: WorkspaceNameIssue }

/**
 * 정규화한 이름이 1~20자인지, 소속 공간 이름과 겹치지 않는지 본다.
 * 대소문자는 구분한다 — `Alpha` 와 `alpha` 는 다른 이름이다 (D-019).
 * `memberWorkspaceNames` 는 현재 사용자가 소속된 공간의 이름이다. 이것도 정규화해서 비교한다.
 */
export function checkWorkspaceName(
  input: string,
  memberWorkspaceNames: readonly string[] = [],
): WorkspaceNameCheck {
  const name = normalizeWorkspaceName(input)
  const length = countVisibleCharacters(name)
  if (length === 0) return { ok: false, name, issue: 'empty' }
  if (length > WORKSPACE_NAME_MAX_LENGTH) return { ok: false, name, issue: 'too_long' }
  if (memberWorkspaceNames.some((existing) => normalizeWorkspaceName(existing) === name)) {
    return { ok: false, name, issue: 'duplicated' }
  }
  return { ok: true, name }
}
