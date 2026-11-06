import { formatSeoulDateTime } from '@/shared/lib/date'
import { Card } from '@/shared/ui/card'
import { PagePlaceholder } from '@/shared/ui/page-placeholder'
import { db } from '../db'

const LIST = 'flex flex-col gap-12'

const META = 'text-body text-sub'

const CODE = 'text-body font-semibold text-ink tabular-nums'

const LINK = 'text-body break-all text-ink underline underline-offset-3'

/**
 * 개발·MSW 모드에서만 등록되는 모의 메일함 (#356, #427). 실 API 가 보낼 가입 인증 코드와 비밀번호 재설정 메일을
 * 종류별로 최근 것부터 보인다.
 * 링크는 앱 안 이동이 아니라 문서를 새로 연다 — 메일에서 링크를 누른 것과 같다.
 */
export function MockMailPage() {
  const mails = [...db.passwordReset.outbox].reverse()
  const codes = [...db.signupVerification.outbox].reverse()
  return (
    <PagePlaceholder
      title="모의 메일함"
      description="개발용 MSW 화면이에요. 서버가 보냈을 가입 인증 코드와 비밀번호 재설정 메일을 보여 줘요."
    >
      {mails.length + codes.length === 0 ? (
        <p className={META}>받은 메일이 없어요.</p>
      ) : (
        <ul className={LIST}>
          {codes.map((mail) => (
            <li key={`${mail.to}-${mail.code}`}>
              <Card>
                <p className={META}>
                  {mail.to} · {formatSeoulDateTime(mail.sentAt)}
                </p>
                <p className={META}>가입 인증 코드</p>
                <p className={CODE}>{mail.code}</p>
              </Card>
            </li>
          ))}
          {mails.map((mail) => (
            <li key={mail.resetPath}>
              <Card>
                <p className={META}>
                  {mail.to} · {formatSeoulDateTime(mail.sentAt)}
                </p>
                <a href={mail.resetPath} className={LINK}>
                  {`${window.location.origin}${mail.resetPath}`}
                </a>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PagePlaceholder>
  )
}
