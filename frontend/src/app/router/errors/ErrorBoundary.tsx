import { Component } from 'react'
import type { ReactNode } from 'react'

interface ErrorBoundaryProps {
  /** 오류가 나면 children 대신 그린다 */
  fallback: ReactNode
  /** 값이 바뀌면 오류 상태를 풀고 children 을 다시 그린다 */
  resetKey?: unknown
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * 렌더 오류 경계 (D-129). React 는 이것을 클래스로만 만들 수 있다. 라우터와 무관하다.
 * 오류는 React 19 가 기본으로 console.error 에 남긴다. 외부 오류 모니터링은 M3 범위 밖이다.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  override componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.failed && !Object.is(previous.resetKey, this.props.resetKey)) {
      this.setState({ failed: false })
    }
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
