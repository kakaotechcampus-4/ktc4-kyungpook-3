import type { ApprovalDto } from '@/shared/types/api/approval'
import type { ExtractionItemDto } from '@/shared/types/api/extraction'
import { db } from './db'

/**
 * 모의 추출 항목. 백엔드는 담당자 표현 유형(`assignee_type`)을 저장하고 응답에는 싣지 않는다 — 별칭 후보를 응답마다
 * 다시 구하는 데만 쓴다(services/alias_learning.py). 응답으로 낼 때는 handler 가 뺀다
 */
export type MockExtractionItem = ExtractionItemDto & {
  assignee_type?: string | null
  /** 아직 합치지 않았지만 처리 요청 직전에 이 승인에 합쳐질 항목 (`approvalMerge`). 응답에는 싣지 않는다 */
  merge_into?: string
}

/* 아래는 backend services/alias_learning.py 의 규칙을 옮긴 것이다. 바꾸면 그쪽과 맞춘다 */

const LEARNABLE_ASSIGNEE_TYPES = new Set(['thirdname'])
const TRAILING_PARTICLES = ['께서', '한테', '에게', '이가', '가', '이', '는', '을', '를', '께']
const SELF_REFERENCE =
  /^(?:(?:제|저|나|내)(?:도|만)?|(?:저희|우리)(?:도|만|들(?:도|만|은)?)?|본인(?:들)?(?:도|만|은)?)$/

/** 끝 조사 한 번, 끝 「님」 한 번을 떼고 공백을 정리한다(`trim_alias_text`). 남는 글자가 없으면 null */
export function trimAliasText(raw: string | null): string | null {
  if (raw === null) return null
  let text = raw.trim()
  const particle = TRAILING_PARTICLES.find((ending) => text.endsWith(ending))
  if (particle !== undefined) text = text.slice(0, -particle.length).trim()
  if (text.endsWith('님')) text = text.slice(0, -1)
  text = text.trim().replace(/\s+/g, ' ')
  return text === '' ? null : text
}

/** 이 항목의 표현을 별칭으로 배울 수 있으면 저장될 글자(`learnable_alias_text`). 생성 항목인지는 승인 종류로 본다 */
function learnableText(item: MockExtractionItem): string | null {
  if (item.assignee.member_id !== null) return null
  if (!LEARNABLE_ASSIGNEE_TYPES.has(item.assignee_type ?? '')) return null
  const text = trimAliasText(item.assignee.raw)
  return text === null || SELF_REFERENCE.test(text) ? null : text
}

/**
 * 승인의 별칭 후보(`approval_alias_texts`). 저장값이 아니라 추출 항목의 원문·유형과 지금 별칭으로 응답마다 구한다 —
 * 막던 별칭을 지우면 다시 후보가 된다. 대기 중인 생성 승인만 본다. 모의는 찾기 후보(님·조사 떼기)와 탈퇴한 팀원을
 * 흉내 내지 않고 같은 글자만 본다
 */
export function aliasCandidateOf(approval: ApprovalDto | undefined): string | null {
  if (approval?.type !== 'task_create' || approval.status !== 'pending') return null
  // 합친 카드는 담당자를 정한 항목만 본다 (backend pending_merge.assignee_item_of)
  const itemId = approval.payload.assignee_item_id ?? approval.payload.extraction_item_id
  const item = db.extractions
    .flatMap(({ items }): MockExtractionItem[] => items)
    .find(({ item_id }) => item_id === itemId)
  const text = item === undefined ? null : learnableText(item)
  if (text === null) return null
  const taken = db.aliases.some(
    ({ workspace_id, alias_text }) => workspace_id === approval.workspace_id && alias_text === text,
  )
  return taken ? null : text
}

/** 응답에 싣는 두 필드 */
export function aliasFieldsOf(
  approval: ApprovalDto | undefined,
): Pick<ApprovalDto, 'alias_candidate' | 'alias_text'> {
  const text = aliasCandidateOf(approval)
  return { alias_candidate: text !== null, alias_text: text }
}
