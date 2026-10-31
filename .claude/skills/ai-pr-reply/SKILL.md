---
name: ai-pr-reply
description: ai/ 파트 PR 에 달린 리뷰(팀원 상호 리뷰·리뷰어 코멘트)를 모아 지적마다 검증하고, 맞는 지적은 고쳐서 push 한 뒤 답글을 단다. 사용자가 PR 리뷰에 답하라고 하거나 /ai-pr-reply 로 부를 때 쓴다. 남의 PR 을 리뷰하는 작업에는 쓰지 않는다.
argument-hint: "[PR번호, 없으면 현재 브랜치의 PR]"
model: sonnet
---

# PR 리뷰 답변

대상 PR: $ARGUMENTS (비어 있으면 `gh pr view --json number -q .number` 로 현재 브랜치의 PR)

판단 원칙은 `superpowers:receiving-code-review` 를 따른다. 리뷰어 말을 그대로 따르지도, 방어하지도 않는다. 코드로 확인하고 판정한다.

## 1. 준비

- `git status` 가 깨끗하지 않으면 멈추고 묻는다.
- `gh pr view <N> --json headRefName,baseRefName,state,url` 로 PR 브랜치를 확인하고 체크아웃한 뒤 `git pull` 한다. PR 이 열려 있지 않으면 멈춘다.

## 2. 리뷰 모으기

아직 해결되지 않았고 우리가 답하지 않은 것만 모은다.

- 인라인 스레드 (해결 여부 포함):
  ```bash
  gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved isOutdated path line comments(first:50){nodes{databaseId author{login} body createdAt}}}}}}}' -F o=<owner> -F r=<repo> -F n=<N>
  ```
- 리뷰 본문과 일반 코멘트: `gh pr view <N> --json reviews,comments`
- `isResolved` 인 스레드, 마지막 코멘트가 우리(`gh api user -q .login`)인 스레드, 봇 코멘트는 뺀다.

## 3. 판정

지적마다 코드를 읽고 하나로 판정한다.

| 판정 | 기준 | 처리 |
|---|---|---|
| 반영 | 지적이 맞고 PR 범위 안 | 고친다 |
| 반박 | 코드·테스트·설계 근거로 지적이 틀림 | 근거를 단 답글 초안 |
| 질문 | 지적이 모호해서 판정 불가 | 되묻는 답글 초안 |
| 범위 밖 | 맞지만 이 PR 범위 밖 | 후속 이슈 제안 답글 초안 |

`shared/schemas.py`·BE 계약을 바꾸게 되는 지적은 판정과 상관없이 사람에게 넘긴다.

## 4. 반영

- 한두 파일의 작은 수정은 메인 세션에서 직접 한다. 여러 파일에 걸치면 지적마다 `ai-implementer` 에게 브리프(지적 원문, 파일 경로, 판정 이유)를 넘긴다.
- 테스트로 드러나는 지적이면 실패하는 테스트부터 쓴다.
- 지적 하나에 커밋 하나: `fix(scope): 리뷰 반영 - <요약>`.
- 다 고친 뒤 전체 pytest (`ai/` 안에서 `.venv/bin/python -m pytest -q`) 통과를 확인하고 PR 브랜치에 push 한다.

## 5. 답글

- **반영**: 자동으로 단다. `반영했습니다 (<커밋 짧은 해시>): <무엇을 어떻게 바꿨는지 한 줄>`
- **반박·질문·범위 밖**: 초안을 사용자에게 한 번에 보여주고, 승인받은 것만 단다. 고쳐 달라고 하면 고쳐서 단다.
- 인라인 스레드 답글: `gh api repos/<owner>/<repo>/pulls/<N>/comments/<databaseId>/replies -f body='...'`
- 리뷰 본문·일반 코멘트 답글: `gh pr comment <N> --body '...'` 에 원 코멘트를 인용한다.
- 스레드를 resolve 하지 않는다. 해결 여부는 리뷰어가 정한다.

## 6. 보고

| 지적 | 판정 | 처리 (커밋 또는 답글) |
|---|---|---|

그리고 실제로 돌린 테스트 명령과 결과, 사람에게 넘긴 지적을 적는다.
