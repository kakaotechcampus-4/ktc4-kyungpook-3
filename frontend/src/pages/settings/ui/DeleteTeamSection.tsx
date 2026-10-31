import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/toast'

/**
 * 이 팀 삭제하기 (Settings 캔버스). PM 에게만 보인다. 공간 삭제 API 가 없어 누르면 준비 중이라고만 알린다 —
 * 파괴적 조작이라 빨강 채움을 쓰지 않는다 (Button 규칙)
 */
export function DeleteTeamSection() {
  return (
    <section
      aria-labelledby="settings-delete-title"
      className="flex items-center gap-20 rounded-16 border border-line-strong bg-surface px-20 py-18"
    >
      <div className="flex-1">
        <h2 id="settings-delete-title" className="text-[14px] font-semibold text-ink">
          이 팀 삭제하기
        </h2>
        <p className="text-caption text-sub">
          회의록과 전사문이 모두 지워집니다. Notion에 이미 올라간 내용은 그대로 남아요.
        </p>
      </div>
      <Button onClick={() => toast.show({ title: '팀 삭제는 아직 준비 중이에요.' })}>
        팀 삭제
      </Button>
    </section>
  )
}
