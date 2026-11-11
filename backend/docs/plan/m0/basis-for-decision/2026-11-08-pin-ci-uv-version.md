# CI의 uv 설치 버전을 고정한다

- 기록일: 2026-11-08
- 관련 마일스톤: M0 검증 기반

## 문제와 제약

PR #454·#518의 서로 다른 CI 작업이 검사 실행 전에 `setup-uv@v3`의 `releases/latest/download` 요청에서 HTTP 504로 실패했다. 전체 실행을 다시 기다리는 동안 실제 코드 오류와 설치 장애를 구분해야 했다. `python-version`은 이 액션 버전의 지원 입력이 아니며, Python은 다음 `uv venv --python 3.12`에서 이미 명시한다.

## 실제 검토한 선택지

- 기존 latest 설치와 전체 실행 재시도. #518 AI 작업은 한 번 재시도해 통과했지만 다른 작업에서 같은 다운로드 실패가 발생했다.
- 성공한 작업과 같은 uv 버전을 지정. 설치 대상과 다운로드 주소를 고정할 수 있다.
- setup-uv 액션의 major 변경. 실행 런타임과 입력까지 바뀌므로 이번 PR의 설치 경로 수정에 필요한 범위를 넘는다.

## 선택과 이유

백엔드·AI CI의 `setup-uv@v3`에 `version: "0.13.7"`을 지정한다. #454의 성공한 lint 작업이 실제 설치한 버전이며 공식 릴리스와 액션 입력도 확인했다. 지원하지 않는 `python-version` 입력은 제거하고 다음 명령의 `--python 3.12`를 유지한다. 액션 major와 서비스 의존성은 바꾸지 않는다.

## 장단점과 감수한 제약

같은 도구로 설치를 재현하고 latest 다운로드 경로를 피한다. 자동 도구 업데이트를 받지 못하므로 버전 갱신은 별도 검증이 필요하다. GitHub 자체나 명시한 릴리스 자산의 네트워크 장애까지 해결하는 변경은 아니다.

## 영향 범위와 재검토 조건

[백엔드 CI](../../../../../.github/workflows/backend-ci.yml)와 [AI CI](../../../../../.github/workflows/ai-ci.yml)에 적용한다. 두 워크플로우의 실제 성공은 이번 설정 커밋의 GitHub Actions 결과로 확인한다. 릴리스 보안 수정이나 설치 호환성 문제가 생기면 재검토한다.

## 근거와 관련 문서

- [#454 다운로드 실패 작업](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/actions/runs/42474680246/job/128713223224)
- [같은 실행의 uv 0.13.7 설치 성공](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/actions/runs/42474680246/job/128713223277)
- [setup-uv v3 지원 입력](https://github.com/astral-sh/setup-uv/blob/v3/action.yml)
- [uv 0.13.7 릴리스](https://github.com/astral-sh/uv/releases/tag/0.13.7)
