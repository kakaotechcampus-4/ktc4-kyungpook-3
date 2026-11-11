import { failureNotice } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { pythonStrip } from '@/shared/lib/validation'

/* 회의록 제목·발화 고치기의 문구와 입력 검사 (#551). 길이와 빈 글 규칙은 BE schemas/record_edit.py 와 같다 (계약 §4.4.3) */

export const TITLE_MAX_LENGTH = 200
export const LINE_MAX_LENGTH = 10_000

const TITLE_LENGTH = `제목은 1~${TITLE_MAX_LENGTH}자로 적어 주세요.`
const LINE_LENGTH = `발화는 1~${LINE_MAX_LENGTH.toLocaleString('ko-KR')}자로 적어 주세요.`
const LINE_BLANK = '발화를 비워 둘 수 없어요. 고치지 않으려면 취소를 눌러 주세요.'

/** 고친 이름이 별칭이 되지 않는다는 BE 규칙(§4.4.3)을 고치는 사람에게 미리 말한다 */
export const LINE_EDIT_HINT = '원문은 남아요. 이름을 고쳐도 팀원 별칭은 바뀌지 않아요.'
export const TITLE_EDIT_HINT = '고친 제목은 회의 목록과 프로젝트 맵에도 보여요.'

export const DELETED_MEETING = '삭제된 회의라 고칠 수 없어요.'
const LINE_NOT_FOUND = '발화를 찾을 수 없어요. 회의록을 다시 불러왔어요.'

export const titleReverted = '처음 제목으로 되돌렸어요'
export const lineReverted = '원래 문장으로 되돌렸어요'

/** 서버(Python `len`)처럼 문자(코드 포인트)로 센다 */
const length = (text: string) => [...text].length

/** 서버가 저장하는 제목 모양. 앞뒤 공백을 Python `strip` 처럼 뺀다 */
export function normalizeTitle(title: string): string {
  return pythonStrip(title)
}

/** 보내기 전에 막을 제목. 서버처럼 앞뒤 공백을 뺀 값을 본다 */
export function titleInputFailure(title: string): string | null {
  const count = length(pythonStrip(title))
  return count < 1 || count > TITLE_MAX_LENGTH ? TITLE_LENGTH : null
}

/** 보내기 전에 막을 발화. 원문과 견주므로 앞뒤 공백을 빼지 않고 보낸다 */
export function lineInputFailure(text: string): string | null {
  if (pythonStrip(text) === '') return LINE_BLANK
  return length(text) > LINE_MAX_LENGTH ? LINE_LENGTH : null
}

export function isDeletedMeeting(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'http' && error.status === 410
}

export function isMissingLine(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR_CODES.TRANSCRIPT_LINE_NOT_FOUND
}

/** 고치기 실패 문구. 취소는 실패가 아니라 null 이다 */
export function editFailure(error: unknown, target: 'title' | 'line'): string | null {
  if (isDeletedMeeting(error)) return DELETED_MEETING
  if (isMissingLine(error)) return LINE_NOT_FOUND
  if (error instanceof ApiError && error.code === ERROR_CODES.INVALID_REQUEST)
    return target === 'title' ? TITLE_LENGTH : LINE_LENGTH
  return failureNotice(error)
}
