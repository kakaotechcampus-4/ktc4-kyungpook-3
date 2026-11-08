import { objectParticle } from '@/shared/lib/korean'

/** 답장에서 말한 담당자를 찾지 못한 카드의 안내 문장 (#344) */
export function assigneePickNotice(raw: string): string {
  return `답장에서 말한 담당자 ${raw}${objectParticle(raw)} 팀원에서 찾지 못했어요. 담당자를 골라 주세요.`
}
