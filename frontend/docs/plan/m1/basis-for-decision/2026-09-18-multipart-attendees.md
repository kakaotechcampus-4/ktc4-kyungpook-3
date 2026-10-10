# multipart 참석자 목록의 전송 방식

- 날짜: 2026-09-18
- 상태: 결정

## 고민

계약 §4.4는 multipart의 `attendee_member_ids` 필드를 지정하지만 배열의 전송 방식을 적지 않았다. JSON 문자열 하나와 같은 이름의 필드 반복 중 구현이 갈린다.

## 고른 길

MSW 업로드는 같은 이름의 필드 반복을 `request.formData().getAll('attendee_member_ids')`로 읽는다. 참석자 한 명도 같은 규칙이다. 각 값은 해당 워크스페이스의 팀원 ID여야 한다.

```js
form.append('attendee_member_ids', 'mb_01')
form.append('attendee_member_ids', 'mb_02')
```

## 왜

FormData의 표준 다중 값 표현을 쓰면 별도 JSON 파싱 규칙이 필요 없다. handler는 실제 `request.formData()`로 파일과 필드를 읽으며 테스트도 multipart HTTP 본문을 전송한다.

## 다시 고민할 때

백엔드 웹 업로드 API가 구현되면 실제 배열 인코딩에 맞춰 handler와 호출부를 함께 조정한다.
