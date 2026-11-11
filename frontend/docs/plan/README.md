# 프론트엔드 계획과 실제 작업 이력

2026-11-11 GitHub 조회와 저장소 기록을 대조한 사후 안내다. 원래 계획·완료조건과 당시 검증 결과를 소급해 바꾸지 않는다. PR 병합은 운영 검증 완료를 뜻하지 않는다.

M0~M8는 기능 영역과 원래 계획의 번호다. 실제 이슈 생성·병합 순서가 번호 순서와 항상 같지는 않다. M2의 초기 PR은 M1보다 먼저 병합됐다. 각 영역의 README에서 처음 구현과 후속 수정을 이어 읽는다.

## 기능별 진입점

| 영역 | 원래 구현 이슈 | 실제 PR | 후속 결과 파일 |
|---|---|---|---|
| [M0 프로젝트 기반·검증 도구](m0/README.md) | [이슈 #34](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/34) CLOSED | [#35](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/35) | 2 |
| [M1 도메인 모델·API·MSW](m1/README.md) | [이슈 #54](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/54) CLOSED | [#69](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/69) | 0 |
| [M2 디자인 토큰·공통 UI](m2/README.md) | [이슈 #36](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/36) CLOSED | [#47](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/47) | 5 |
| [M3 라우팅·데이터·세션 경계](m3/README.md) | [이슈 #77](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/77) CLOSED | [#107](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/107) | 3 |
| [M4 인증·온보딩·앱 진입](m4/README.md) | [이슈 #108](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/108) CLOSED | [#117](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/117) | 20 |
| [M5 회의 입력·처리·회의록](m5/README.md) | [이슈 #143](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/143) CLOSED | [#169](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/169) | 16 |
| [M6 태스크·승인](m6/README.md) | [이슈 #178](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/178) CLOSED | [#203](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/203) | 6 |
| [M6-API 실제 API 연결](m6-api/README.md) | [이슈 #212](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/212) CLOSED | [#214](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/214) | 0 |
| [M7 대시보드](m7/README.md) | [이슈 #235](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/235) CLOSED | [#237](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/237) | 0 |
| [M8 태스크 보기·메시지·팀·설정](m8/README.md) | [이슈 #243](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/243) CLOSED<br>[이슈 #244](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/244) CLOSED<br>[이슈 #245](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/245) CLOSED<br>[이슈 #259](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/259) CLOSED | [#262](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/262), [#264](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/264), [#263](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/263), [#260](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/260) | 13 |
| [REFACTOR 독립 개선·검증·제품 정리](refactor/README.md) | 작업별 이슈로 관리 | 개별 작업 안내 참조 | 7 |

## 실제 순서와 기록의 범위

- [이슈 생성·PR 병합 이력](implementation-history.md)은 확인된 날짜 순서로 초기 구현과 후속 작업을 연결한다.
- 기존 이슈 결과 디렉터리의 추적 결과 65개와 로컬 PR #682 결과 1개를 합쳐 66개 결과 파일을 이관했다. 같은 이슈 #551의 개별 결과 파일도 각각 보존했다.
- refactor의 계획·결과 5쌍과 제품 결정 1개는 작업별 폴더에 보존했다.
- [2026-11-07까지의 기존 후속 목록](history/2026-11-07-followups.md)은 과거 안내 원문이다. 그 안의 당시 운영 규칙은 현재 규칙을 대체하지 않는다.
- [원본 전체 계획](frontend-plan.md)은 과거 사전 계획으로 보존한다. [제품·기술 결정](../decision/frontend-decisions.md), [대표 API 계약](../contracts/frontend-api-contract.md), [구현 결정 안내](basis-for-decision-guide.md)는 기존 위치에서 관리한다.

## 이관과 검증

[work-items.json](work-items.json)은 원래 경로·새 경로·원문 해시·허용한 링크 편집과 조회 당시 이슈·PR 사실의 단일 색인이다. 새 원문 위치만 관리하며 기존 issues 디렉터리는 제거했다. 문서 원문의 실험 결과를 새 실행처럼 고쳐 쓰지 않았다.

```sh
python tools/check_frontend_history.py
python tools/render_frontend_history.py
```

첫 명령은 이관 누락·원문 보존·링크를 검사한다. 두 번째는 같은 색인에서 이 안내와 영역별 README를 다시 만든다. 새 작업 기록은 주 담당 `plan/mN/work-items/<식별자>-<이름>/`에 둔다. 독립적인 개선은 `plan/refactor/work-items/`를 사용한다. 이슈가 없는 PR 번호를 식별자로 쓰면 색인에서 그 종류를 명시한다.

전체 계획의 이동 전 인라인 경로는 역사적 표기다. 현재 위치는 위 진입점에서 찾는다. 사람이 작성하는 트러블슈팅은 원문을 보존한다.

재구성 과정의 선택과 검증은 [작업 기록](history/2026-11-11-reorganization.tsv)에 남겼다.
