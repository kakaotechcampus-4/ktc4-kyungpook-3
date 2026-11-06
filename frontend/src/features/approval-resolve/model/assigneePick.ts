import { objectParticle } from '@/shared/lib/korean'

/** 답장에서 말한 담당자를 찾지 못한 카드의 안내 문장 (#344 사용자 결정) */
export function assigneePickNotice(raw: string | null): string {
  const named =
    raw === null || raw.trim() === '' ? '담당자를' : `담당자 ${raw}${objectParticle(raw)}`
  return `답장에서 말한 ${named} 팀원에서 찾지 못했어요. 담당자를 골라 주세요.`
}
