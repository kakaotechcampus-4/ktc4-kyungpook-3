/*
 * 화면 코드 미리 부르기의 신호 (#536, #539). 어느 경로에 어느 화면 코드가 있는지는 app 층의 경로 표만 안다.
 * 아래 층(로그인 기능, 셸)은 「이 경로의 화면 코드를 받아 두라」고만 알린다. 듣는 쪽(경로 표)이 없으면 아무 일도 없다 —
 * 경로 표 없이 폼만 그리는 테스트가 그렇다. 스플래시 신호(`@/shared/lib/splash`)와 같은 모양이다.
 */

type ScreenCodeLoader = (path: string) => void

const loaders = new Set<ScreenCodeLoader>()

/**
 * 경로(`/workspaces/ws_01/tasks?tab=…` 꼴, 검색 문자열은 무시된다)가 그리는 화면의 코드를 미리 부른다.
 * 미리 부르기는 덤이라 실패해도 부른 쪽에 알리지 않는다 — 화면을 열 때 지연 로드가 다시 부른다
 */
export function preloadScreenCode(path: string): void {
  for (const loader of loaders) {
    try {
      loader(path)
    } catch {
      // 미리 부르기의 실패는 알리지 않는다
    }
  }
}

/** 경로 표를 아는 쪽(app)이 미리 부르기를 맡는다. 돌려받은 함수로 그만둔다 */
export function provideScreenCode(loader: ScreenCodeLoader): () => void {
  loaders.add(loader)
  return () => {
    loaders.delete(loader)
  }
}
