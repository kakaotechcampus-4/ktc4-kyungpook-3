# 0009. 전사와 추출 결과는 봇이 BE 회의 API 를 직접 불러 넘긴다

- 날짜: 2026-09-19
- 상태: 결정됨. BE 쪽 전제는 PR #55 (fail 엔드포인트, 추출 등록 멱등 처리, assignee_type). 아래 "남은 것" 은
  BE 와 정하는 중

## 배경

PR #45 리뷰 R01. 전사와 추출이 끝나도 `on_session_saved` 훅이 로그만 찍고, BE 가 요구하는 회의 생성 →
종료 → 추출 등록을 아무도 부르지 않았다. 누가 넘기는지, 회의 ID 와 실패 상태와 재시도 키가 무엇인지,
정상 종료와 복구가 같은 길을 가는지가 비어 있었다.

## 결정

봇 프로세스가 BE 의 회의 API 를 직접 부른다 (`capture/handoff.py`). 시점은 넷이다.

```
/record 직후       POST  /api/v1/meetings              created     매니페스트 be.meeting_id
트랙을 닫은 뒤     PATCH /api/v1/meetings/{id}/end     processing
추출이 끝난 뒤     POST  /api/v1/extractions           done        항목 저장, 담당자 매칭, 게이트
어느 단계든 실패   PATCH /api/v1/meetings/{id}/fail    failed      failed_stage = stt | extract | handoff
```

정상 종료(/stop)와 복구(/recover)가 같은 `recorder.process_session` 을 타고, 그 안의 마지막 단계가 인계다.
회의 ID 는 매니페스트 `be.meeting_id` 이고 재시도 키다. BE 가 processing → done 을 조건부 UPDATE 로
선점하고 이미 done 이면 기존 추출을 돌려주므로(#55) 복구가 다시 보내도 중복이 없다.

항목의 `evidence_speaker` 에는 그 문장을 말한 트랙의 디스코드 uid 를 넣는다. 1인칭("제가 할게요")은
`assignee_type=first` 이고 별칭 텍스트가 없어서, BE 가 이 uid 로 사람을 찾아야 한다.

## 왜 봇이 부르나

대안은 BE 가 매니페스트나 훅을 보고 가져가는 것이었다. 그러면 BE 가 봇의 파일 구조를 알아야 하고, 봇이
죽은 뒤 복구한 회의를 누가 다시 넘길지가 다시 비게 된다. 봇이 부르면 단계 재개와 인계가 한 함수에 있고,
BE 는 이미 있는 API 만 지키면 된다. BE 가 준비되지 않은 환경(설정 없음)에서는 인계 단계에서 멈추고
전사와 회의록은 그대로 나온다.

## 남은 것 (BE 와 정한다)

- BE 가 first 담당자를 별칭 텍스트가 아니라 `Member.discord_user_id` 로 찾아야 uid 가 사람이 된다.
  지금 #55 는 별칭 텍스트로 찾는다
- `fail` 은 끝 상태라 되돌리는 전이가 없다. 실패했다가 복구한 회의는 새 BE 회의로 넘기고 옛 ID 를
  `be.replaced` 에 남긴다. 되돌리는 전이가 생기면 바꾼다
- 길드와 워크스페이스를 잇는 조회가 BE 에 없다. `BE_WORKSPACE_ID` 하나로 시작한다
- 추출기의 certain / inferred / missing 을 BE 의 숫자 신뢰도로 바꾸는 규칙. 지금은 마감만 1.0 / 0.6 / 0.0
- 회의 참가자(uid, 표시 이름) 목록을 받을 자리. 전사 계약 파일의 speakers 맵에는 있다

## 재검토 조건

BE 가 봇 프로세스를 자기 안(backend/bot)에 두고 매니페스트를 직접 읽게 되면, 인계 함수는 그대로 두고
호출하는 쪽만 옮긴다.
