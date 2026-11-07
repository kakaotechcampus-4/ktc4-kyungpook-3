import { ConnectionCardSkeleton } from '@/features/integration-connection/skeleton'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Skeleton } from '@/shared/ui/skeleton'
import { SETTINGS_SECTIONS } from './settingsSections'
import {
  ASIDE,
  COLUMNS,
  CONNECTIONS_LEAD,
  CONTENT,
  MAIN,
  NAV_ITEM,
  SECTION,
  SECTION_HEAD,
  SECTION_LEAD,
  SECTION_TITLE,
  TITLE,
} from './settingsStyles'

export interface SettingsSkeletonProps {
  /** 역할을 모르면 PM 틀이다. PM 에게만 이름의 `되돌리기` 가 있다 */
  isPm: boolean
  /** `?section=notion` 으로 왔다 — 목차의 `연결` 이 골라져 있다 */
  connections: boolean
}

/**
 * 설정 화면의 라우트 뼈대 (#510). SettingsPage 가 연동 상태를 기다릴 때와 같은 틀이다 — 제목·목차, `일반` 절(이름 칸 · `되돌리기`),
 * `연결` 절(Discord·Notion 카드 뼈대). 그 아래 절(자동 반영 · 알림 · 팀 삭제)은 화면이 그릴 때 아래에 붙는다 — 위의 것은 움직이지 않는다.
 * 이름은 소속 목록을 받아야 알아 막대다. 정해진 글자·버튼도 자리표시라 누를 수 없고 스크린리더에서 뺀다
 */
export function SettingsSkeleton({ isPm, connections }: SettingsSkeletonProps) {
  const current = connections ? 'settings-connections' : 'settings-general'
  return (
    <main aria-busy="true" className={MAIN}>
      <div aria-hidden="true" className={COLUMNS}>
        <div className={ASIDE}>
          <p className={TITLE}>설정</p>
          <div className="flex flex-col gap-2">
            {SETTINGS_SECTIONS.map(({ id, label }) => (
              <span
                key={id}
                // 목차와 같은 상태 선택자(aria-[current=location])로 고른 항목을 칠한다
                aria-current={id === current ? 'location' : undefined}
                className={NAV_ITEM}
              >
                {label}
              </span>
            ))}
            <span className={NAV_ITEM}>팀원</span>
            <span className={NAV_ITEM}>내 계정</span>
          </div>
        </div>
        <div className={CONTENT}>
          <div className={SECTION}>
            <div className={SECTION_HEAD}>
              <p className={SECTION_TITLE}>일반</p>
            </div>
            <div className="flex max-w-[420px] flex-col gap-12">
              <div className="flex flex-col">
                <Label className="mb-6">워크스페이스 이름</Label>
                <Skeleton variant="block" className="h-[42px] rounded-9" />
              </div>
              {isPm ? (
                <div>
                  <Button disabled tabIndex={-1}>
                    되돌리기
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          <div className={SECTION}>
            <div className={SECTION_HEAD}>
              <p className={SECTION_TITLE}>연결</p>
              <p className={SECTION_LEAD}>{CONNECTIONS_LEAD}</p>
            </div>
            <ConnectionCardSkeleton service="discord" />
            <ConnectionCardSkeleton service="notion" />
          </div>
        </div>
      </div>
    </main>
  )
}
