import type { MouseEvent } from 'react'
import { NavLink } from 'react-router'
import type { NavLinkProps } from 'react-router'
import { useGuardedNavigate } from './useGuardedNavigate'

/**
 * 앱 안 링크는 모두 이것을 쓴다 (D-138). 누르면 라우터 대신 useGuardedNavigate 관문이 옮긴다.
 * 현재 위치 표시(aria-current)가 필요한 곳이 있어 NavLink 위에 만든다.
 * 새 탭 열기(보조 키·가운데 버튼), 다른 target, reloadDocument 는 브라우저 기본 동작에 맡긴다.
 */
export function GuardedLink({ to, replace, state, relative, onClick, ...rest }: NavLinkProps) {
  const navigate = useGuardedNavigate()
  // 라우터 타입이 state 를 any 로 둔다. 그대로 넘기기만 하므로 unknown 으로 좁힌다
  const linkState: unknown = state

  return (
    <NavLink
      {...rest}
      to={to}
      replace={replace}
      state={linkState}
      relative={relative}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || !isPlainClick(event) || rest.reloadDocument) return
        if (rest.target !== undefined && rest.target !== '_self') return
        event.preventDefault()
        navigate(to, { replace, state: linkState, relative })
      }}
    />
  )
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
}
