import { objectParticle, topicParticle } from '@/shared/lib/korean'
import type { AsrSuspect } from '../model/types'

/**
 * 확인 카드에 보일 전사 오인식 의심 한 줄 (#643). `labeled` 는 앞에 「전사」 라벨이 붙는 자리다.
 * 검사 실패 문구가 라벨을 되풀이하지 않게 줄인다
 */
export function asrSuspectLine(suspect: AsrSuspect, { labeled = false } = {}): string {
  if (suspect.kind === 'check_failed')
    return labeled ? '확인하지 못했어요' : '전사 확인을 하지 못했어요'
  const { word, candidates } = suspect
  const heard = `'${word}'`
  const quoted = candidates.map((each) => `'${each}'`).join(', ')
  if (candidates.length === 0) return `${heard}${objectParticle(word)} 다시 확인해 주세요`
  if (candidates.length === 1) return `${heard}${topicParticle(word)} ${quoted}일 수 있어요`
  return `${heard}${topicParticle(word)} ${quoted} 중 하나일 수 있어요`
}
