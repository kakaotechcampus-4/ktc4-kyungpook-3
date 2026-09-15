# 화면 캔버스 — 정적 내보내기

이 폴더는 [디자인 캔버스](https://claude.ai/code/artifact/44424615-6cb5-44b3-9102-8629969e92ea)의 화면 25장을
**그대로 실행 가능한 정적 HTML**로 내보낸 것이다. 클로드 아티팩트는 로그인·전용 뷰어·JSON 안에 이스케이프된
번들 형태라 다른 에이전트(다른 Claude 세션, Grok 등)가 열람도 값 추출도 어렵다 — 이 폴더는 그 문제를 없앤다.

브라우저로 `.dc.html` 파일을 직접 열면 실제 화면이 그대로 뜬다. 어떤 도구로 읽어도(`cat`, `Read`, 텍스트 에디터)
인라인 스타일에 색·크기·간격 값이 실제 숫자로 박혀 있어 그대로 참조할 수 있다 — 재해석이 필요 없다.

## 파일

| 파일 | 화면 | 페이지 |
|---|---|---|
| `Landing.dc.html` | 랜딩페이지 | 진입 |
| `Login.dc.html` / `Signup.dc.html` | 로그인 / 회원가입 | 진입 |
| `SetupTeam` / `SetupDiscord` / `SetupNotion` / `SetupMembers.dc.html` | 온보딩 1–4 | 온보딩 |
| `Main.dc.html` | 홈 대시보드 · 팀 바꾸기 | 제품 |
| `Upload.dc.html` / `Processing.dc.html` | 회의 올리기 / 정리 중 | 제품 |
| `Meetings.dc.html` | 회의록 | 제품 |
| `Tasks` / `TasksBoard` / `TasksGantt` / `TasksCalendar.dc.html` | 태스크 4뷰 (리스트·보드·간트·캘린더) | 제품 |
| `Messages.dc.html` / `MessagesThread.dc.html` | 메시지 승인 / 사람별 대화 | 제품 |
| `Team.dc.html` / `Settings.dc.html` | 팀 / 설정 | 제품 |
| `EmptyMeetings` / `EmptyTasks` / `EmptyMessages.dc.html` | 빈 상태 3종 | 제품 |
| `Foundations.dc.html` | 디자인 파운데이션 — 색·타이포·컨트롤·레이아웃 수치 요약 | 파운데이션 |
| `Mascot.dc.html` / `MascotUsage.dc.html` | 매스(마스코트) 스펙 · 쓰는 법 | 캐릭터 |
| `canvas.json` | 아트보드 배치·페이지 그룹·설계 노트(주석) 원본 |
| `_fonts.css` | 나눔스퀘어 웹폰트 (모든 화면이 공유해서 참조) |

**먼저 볼 것**: `Foundations.dc.html`이 색상·타이포그래피·컨트롤·레이아웃 수치를 한 곳에 모은 요약이다.
값은 전부 나머지 22개 화면 파일에서 실측한 것이라 화면과 어긋나지 않는다.

## 다른 에이전트가 새 화면을 만들 때

1. 역할이 비슷한 기존 화면을 하나 찾아 그 인라인 스타일 값을 그대로 재사용한다 (새로 만들지 않는다).
2. 크기·색·간격이 애매하면 `Foundations.dc.html`의 표를 기준으로 삼는다.
3. 마스코트가 필요하면 `Mascot.dc.html`의 SVG 좌표를 그대로 복사한다 — 임의로 다시 그리지 않는다.
4. 폰트는 `<link rel="stylesheet" href="./_fonts.css">`로 연결한다. 나눔스퀘어는 굵기가
   Light 300 · Regular 400 · Bold 700 · ExtraBold 800 네 단뿐이다 — `500`이나 `600`을 쓰면
   각각 Regular·Bold로 조용히 대체되니 쓰지 않는다.

## 이 폴더는 손으로 고치지 않는다

전부 [캔버스](https://claude.ai/code/artifact/44424615-6cb5-44b3-9102-8629969e92ea)에서 생성한 스냅샷이다.
디자인을 바꿀 때는 캔버스에서 바꾸고, 다시 내보내 이 폴더 전체를 덮어쓴다(부분 수정 금지 — 캔버스와의 원본성이
깨진다). 내보내기는 `scratchpad/export_canvas.py` 참고 — appifact-doc JSON을 읽어 `support.js` 참조를
`_fonts.css` 링크로 바꾸는 것이 전부다.

마지막 내보내기: 2026-09-14 (v77 — Foundations 실측 재작성 · 회의록 본문 여백 정렬 반영).
