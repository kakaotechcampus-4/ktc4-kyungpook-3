# M4 인증·온보딩·앱 진입

2026-11-11 GitHub 조회와 저장소 기록을 대조한 사후 안내다. 원래 계획·완료조건과 당시 검증 결과를 소급해 바꾸지 않는다. PR 병합은 운영 검증 완료를 뜻하지 않는다.

[전체 작업 안내](../README.md) · [실제 병합 순서](../implementation-history.md)

## 처음 계획과 구현

| 원래 작업 이슈 | 실제 PR과 병합일 |
|---|---|
| [이슈 #108](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/108) CLOSED | [PR #117](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/117) MERGED · 2026-09-30 UTC |

## 원본 계획·결과·결정

- [basis-for-decision](basis-for-decision/)
- [evidence](evidence/)
- [m4-done-criteria.md](m4-done-criteria.md)
- [m4-handoff.md](m4-handoff.md)
- [plan.md](plan.md)
- [result.md](result.md)
- [trouble-shooting](trouble-shooting/)

## 실제 이슈·PR별 후속 작업

아래 소속은 사후 탐색을 위한 주 담당 영역이다. 처음 계획에 이 작업들이 모두 포함돼 있었다는 뜻은 아니다.

| 작업 결과 원문 | 실제 이슈 상태 | PR 상태·병합일 |
|---|---|---|
| [결과 — 로그인 뒤 돌아가기와 기기 알림 안내 (#411)](work-items/411-login-return-push-prompt/result.md) | [이슈 #411](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/411) CLOSED | [PR #415](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/415) MERGED · 2026-11-06 UTC |
| [결과 — 로딩 스플래시, 설치한 앱 시작 화면, 첫 방문 인트로 (#430)](work-items/430-splash/result.md) | [이슈 #430](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/430) CLOSED | [PR #452](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/452) MERGED · 2026-11-06 UTC |
| [결과 — 첫 방문 인트로 빼기, 스플래시만 남긴다 (#465)](work-items/465-remove-intro/result.md) | [이슈 #465](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/465) CLOSED | [PR #475](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/475) MERGED · 2026-11-06 UTC |
| [결과 — 로딩 스플래시의 마스코트·워드마크 키우기 (#472)](work-items/472-splash-size/result.md) | [이슈 #472](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/472) CLOSED | [PR #481](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/481) MERGED · 2026-11-06 UTC |
| [결과 — 휴대폰 셸: 아래 탭 막대와 360px 넘침 원인 (#478 PR ①)](work-items/478-mobile/result.md) | [이슈 #478](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/478) CLOSED | [PR #486](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/486) MERGED · 2026-11-06 UTC<br>[PR #492](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/492) MERGED · 2026-11-07 UTC<br>[PR #495](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/495) MERGED · 2026-11-07 UTC |
| [결과 — 가입 이름 100자와 로그인 시도 제한 429 반영 (#446·#457)](work-items/446-457-auth-rules/result.md) | [이슈 #446](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/446) CLOSED<br>[이슈 #457](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/457) CLOSED | [PR #489](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/489) MERGED · 2026-11-07 UTC |
| [결과 — 스플래시 끝맺음을 늘려 눈웃음이 다 지어진 뒤 사라지게 하기 (#506)](work-items/506-splash-ending/result.md) | [이슈 #506](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/506) CLOSED | [PR #511](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/511) MERGED · 2026-11-07 UTC |
| [결과 — 스플래시는 12시간에 한 번, 다시 온 사람은 랜딩 대신 로그인으로 (#510)](work-items/510-splash-frequency/result.md) | [이슈 #510](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/510) CLOSED | [PR #537](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/537) MERGED · 2026-11-07 UTC |
| [결과 — 로그인·가입 직후 스플래시는 0.3초 대기 없이 바로 (#539)](work-items/539-login-splash-instant/result.md) | [이슈 #539](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/539) CLOSED | [PR #540](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/540) MERGED · 2026-11-07 UTC |
| [결과 — 비밀번호 재설정 마무리: 로그인 링크와 BE 명세 대조 (#451)](work-items/451-password-reset-finish/result.md) | [이슈 #451](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/451) CLOSED | [PR #458](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/458) MERGED · 2026-11-08 UTC |
| [결과 — 로그인 429 화면의 비밀번호 재설정 안내 (#554)](work-items/554-login-429-reset/result.md) | [이슈 #554](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/554) CLOSED | [PR #585](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/585) MERGED · 2026-11-09 UTC |
| [575 계정 탈퇴와 정리 상태 표시](work-items/575-account-withdrawal/result.md) | [이슈 #575](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/575) CLOSED | [PR #584](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/584) MERGED · 2026-11-09 UTC |
| [566 정책 문서 진입점과 업로드 전송 안내](work-items/566-policy-entrypoints/result.md) | [이슈 #566](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/566) CLOSED | [PR #574](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/574) MERGED · 2026-11-09 UTC |
| [결과 — 카카오 로그인 보완과 휴대폰 로그인 H-1 (#538)](work-items/538-kakao-login-finish/result.md) | [이슈 #538](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/538) CLOSED | [PR #590](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/590) MERGED · 2026-11-09 UTC |
| [566 동의 화면 연결](work-items/566-consent-connection/result.md) | [이슈 #566](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/566) CLOSED | [PR #596](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/596) MERGED · 2026-11-09 UTC |
| [565 정책 공개와 동의 활성화 결과](work-items/565-policy-publication/result.md) | [이슈 #565](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/565) OPEN | [PR #612](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/612) MERGED · 2026-11-09 UTC<br>[PR #618](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/618) MERGED · 2026-11-09 UTC |
| [626 백엔드 통합 검증](work-items/626-backend-integration/result.md) | [이슈 #610](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/610) CLOSED | [PR #641](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/641) MERGED · 2026-11-10 UTC |
| [627 가입 아이디와 카카오 가입 화면](work-items/627-signup-username/result.md) | [이슈 #627](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/627) CLOSED | [PR #638](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/638) MERGED · 2026-11-10 UTC |
| [650 처음 쓰는 사람을 위한 ? 안내 패널과 빈 화면 방법 보기](work-items/650-quick-guide/result.md) | [이슈 #650](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/650) CLOSED | [PR #664](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/664) MERGED · 2026-11-10 UTC |
| [랜딩 내용·브랜드 디자인과 탐색 개선](work-items/682-landing-navigation/result.md) | 연결 이슈 근거 없음 | [PR #682](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/682) MERGED · 2026-11-10 UTC |

## 상태를 해석할 때

- OPEN 이슈에 MERGED PR이 연결돼 있어도 이슈를 완료로 바꾸지 않았다.
- 결과 원문의 `PR 전`·`미검증`은 당시 상태다. 위 GitHub 사실은 그 이후 병합 여부만 보완한다.
- 폴더 숫자가 PR인 기록도 있다. 이슈·PR은 위 링크 종류로 구분한다.
- AI·BE 구현과 연동 검증 기록은 FE의 지원·연결 근거로 읽는다. 모든 코드를 FE가 작성했다고 해석하지 않는다.
- PR #682는 처음 조사할 때 로컬에만 있던 기록이다. 추가 확인 상태는 MERGED이며 위 표의 병합일을 따른다. 이 이관이 앱 코드를 변경한 것은 아니다.
