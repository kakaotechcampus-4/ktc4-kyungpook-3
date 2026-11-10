import type { ReactNode } from 'react'
import { Command, ExternalLink } from './inline'

/*
 * 원고는 저장소의 docs/user/quick-guide.md 다. 뜻은 원고 그대로이고 화면에 맞춰 줄바꿈·강조만 고친다.
 * 원고를 고치면 여기도 같이 고친다
 */

/** 사용자 가이드. 문서 포털 주소가 생기면 이 값만 바꾼다 */
export const USER_GUIDE_URL =
  'https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/docs/user/getting-started.md'

export interface QuickGuideStep {
  title: string
  body: ReactNode
  /** 같은 단계에서 팀원이 할 일. 원고에 없으면 null */
  member: ReactNode | null
}

const STEPS_LIST = 'list-decimal pl-18'
const NOTES_LIST = 'list-disc pl-18 text-sub'
const TABLE = 'w-full border-collapse text-left'
const CELL = 'border-b border-line py-6 pr-12 align-top'

export const QUICK_GUIDE_STEPS: readonly QuickGuideStep[] = [
  {
    title: 'Discord 서버 준비',
    body: (
      <>
        <p>팀이 함께 쓸 Discord 서버가 없으면 하나 만들고, 팀원들을 서버에 초대해요.</p>
        <ol className={STEPS_LIST}>
          <li>
            Discord 왼쪽 서버 목록의 <strong>+</strong>를 눌러 <strong>직접 만들기</strong>를
            골라요.
          </li>
          <li>
            서버 이름 옆 메뉴에서 <strong>초대하기</strong>를 눌러 초대 링크를 복사해요.
          </li>
          <li>링크를 팀원들에게 보내요.</li>
        </ol>
        <p>
          자세한 방법은 Discord 도움말을 봐요:{' '}
          <ExternalLink href="https://support.discord.com/hc/ko/articles/204849977">
            서버 만들기
          </ExternalLink>{' '}
          ·{' '}
          <ExternalLink href="https://support.discord.com/hc/ko/articles/208866998">
            초대 링크
          </ExternalLink>
        </p>
      </>
    ),
    member: <>받은 링크로 서버에 들어와요. 서버에 들어와 있어야 3단계에서 PM이 연결할 수 있어요.</>,
  },
  {
    title: '팀원 초대',
    body: (
      <ol className={STEPS_LIST}>
        <li>
          <strong>팀</strong> 화면에서 팀원 줄의 <strong>초대</strong>를 눌러요.
        </li>
        <li>
          팀원이 <strong>가입할 때 정한 아이디</strong>로 찾아요. 이름과 아이디를 확인하고 초대해요.
        </li>
        <li>
          <strong>알림은 가지 않아요.</strong> 초대한 뒤 Discord 등으로 직접 알려 주세요.
        </li>
      </ol>
    ),
    member: (
      <>
        먼저 가입하고, 가입할 때 정한 <strong>아이디</strong>를 PM에게 알려 줘요. 초대를 받으면
        로그인 → <strong>팀원으로 시작</strong> → <strong>받은 초대</strong>에서{' '}
        <strong>수락</strong>을 눌러요. 거절하면 그 초대로는 다시 들어갈 수 없어요.
      </>
    ),
  },
  {
    title: 'Discord 연결과 팀원 연결',
    body: (
      <>
        <ol className={STEPS_LIST}>
          <li>
            <strong>설정 &gt; 연결</strong>에서 Discord를 연결하고, 봇을 1단계의 서버에 추가해요.
          </li>
          <li>서버 사용자와 서비스 팀원을 짝지어요.</li>
        </ol>
        <ul className={NOTES_LIST}>
          <li>서버에 아직 들어오지 않은 사람은 목록에 보이지 않아요. 1단계부터 확인해요.</li>
          <li>
            팀원 이름을 정확히 고르세요. 잘못 고르면 그 사람이 말한 할 일의 담당자를 찾지 못해요.
          </li>
        </ul>
      </>
    ),
    member: <>할 일이 없어요. 서버에만 들어와 있으면 돼요.</>,
  },
  {
    title: '회의 기록',
    body: (
      <>
        <ol className={STEPS_LIST}>
          <li>Discord 음성 채널에 들어가요.</li>
          <li>
            채팅창에 <Command>/join</Command>을 입력해 봇을 부르고, <Command>/record</Command>로
            녹음을 시작해요.
          </li>
          <li>
            회의가 끝나면 <Command>/stop</Command>을 입력해요.
          </li>
        </ol>
        <ul className={NOTES_LIST}>
          <li>
            음성 채널에 있는 사람이면 <strong>누구나</strong> 명령을 쓸 수 있어요.
          </li>
          <li>녹음을 시작하면 채널에 녹음 안내가 올라가요.</li>
          <li>
            Discord 없이 만나서 회의했다면 녹음 파일을 웹에서 <strong>업로드</strong>해요(PM).
          </li>
        </ul>
      </>
    ),
    member: null,
  },
  {
    title: '결과 확인',
    body: (
      <>
        <p>몇 분 뒤 대시보드와 회의 화면에 정리된 결과가 보여요.</p>
        <table className={TABLE}>
          <thead className="text-caption text-dim">
            <tr>
              <th scope="col" className={CELL}>
                표시
              </th>
              <th scope="col" className={CELL}>
                뜻
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className={`${CELL} whitespace-nowrap`}>
                반영된 것
              </th>
              <td className={CELL}>승인 없이 태스크로 만든 일</td>
            </tr>
            <tr>
              <th scope="row" className={`${CELL} whitespace-nowrap`}>
                확인 필요
              </th>
              <td className={CELL}>PM이 보고 승인해야 하는 일</td>
            </tr>
            <tr>
              <th scope="row" className={`${CELL} whitespace-nowrap`}>
                보류
              </th>
              <td className={CELL}>담당자를 찾지 못한 일. PM이 담당자를 골라 승인해요</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
    member: (
      <>
        대시보드에서 내 할 일을 봐요. 마감이 다가오면 Discord <strong>DM</strong>으로 리마인드가
        와요. 답장은 DM이 아니라 <strong>웹의 메시지 화면</strong>에서 해요. 서버 멤버의 DM을 막아
        두었다면 리마인드를 받지 못할 수 있어요.
      </>
    ),
  },
]
