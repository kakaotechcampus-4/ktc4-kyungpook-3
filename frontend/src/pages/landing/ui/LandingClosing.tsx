import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import {
  CARD_WIDTH,
  HERO_SIZE,
  LINK_PRIMARY,
  SECTION_LEAD,
  SECTION_TITLE,
  TEXT_WIDTH,
} from './styles'

/** 마지막 CTA. `시작하기` → 로그인 (D-003). `문의하기` 는 창구가 아직 없어 비활성이다 */
export function FinalCta() {
  return (
    <section className={`${TEXT_WIDTH} flex flex-col items-center gap-20 pb-[120px] text-center`}>
      <h2 className={SECTION_TITLE}>이번 주 회의부터 시작해 보세요</h2>
      <p className={`${SECTION_LEAD} max-w-[620px]`}>
        첫 회의를 올리고 확인하는 데까지 10분이면 충분합니다. 팀원에게는 아무것도 요청하지 않아도
        돼요.
      </p>
      <div className="flex items-center gap-10 pt-8">
        <GuardedLink to={paths.login()} className={`${LINK_PRIMARY} ${HERO_SIZE}`}>
          시작하기
        </GuardedLink>
        <Button size="landing-hero" aria-disabled="true">
          문의하기
        </Button>
      </div>
    </section>
  )
}

/* 푸터 항목은 이동할 곳이 아직 없다(안내·약관 화면은 1차 범위 밖, D-001). 링크가 아닌 글자로 둔다.
   라이트/다크 전환은 다크 테마가 없어 뺐다 — docs/impl-decision/2026-09-28-landing-scope.md */
const FOOTER_GROUPS = [
  // 요금제 절을 뺐으니 푸터에서도 뺀다. 캔버스의 `[상태 페이지]` 자리표시도 두지 않는다
  { title: '제품', items: ['기능', '연동', '변경 기록'] },
  { title: '쓰는 법', items: ['시작 가이드', '회의 올리기', '승인 워크벤치'] },
  { title: '회사', items: ['소개', '블로그', '문의하기'] },
  { title: '약관', items: ['이용약관', '개인정보처리방침', '보안'] },
] as const

export function LandingFooter() {
  return (
    <footer className="flex w-full justify-center border-t border-line px-40">
      <div className={`${CARD_WIDTH} flex flex-col gap-44 pt-48 pb-40`}>
        <div className="flex items-start justify-between gap-56">
          <div className="flex max-w-[260px] flex-col gap-14">
            <span className="inline-flex items-center gap-9">
              <BrandMark size="sm" />
              <span className="text-[14px] font-semibold tracking-h3 text-ink">
                Manager&apos;s Manager
              </span>
            </span>
            <p className="text-[13px] leading-[20px] text-dim">
              한 번의 클릭으로, 매니저가 정리합니다
            </p>
          </div>
          <div className="flex gap-56">
            {FOOTER_GROUPS.map(({ title, items }) => (
              <div key={title} className="flex flex-col gap-12">
                <span className="text-[13px] font-semibold text-ink">{title}</span>
                <ul className="flex flex-col gap-12">
                  {items.map((item) => (
                    <li key={item} className="text-body text-dim">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-line pt-28">
          <span className="text-[13px] text-dim">
            © 2026 Manager&apos;s Manager · 카카오테크캠퍼스 4기 · 경북대 3팀
          </span>
        </div>
      </div>
    </footer>
  )
}
