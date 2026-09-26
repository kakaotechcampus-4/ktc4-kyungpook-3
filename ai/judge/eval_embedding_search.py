"""벡터 임베딩 유사도 검색(embedding.find_similar_candidates) 실제 검증 + threshold 보정용 스크립트.

pytest 스위트엔 안 넣는다 — 실제 임베딩 API를 호출해서 비용이 든다(다만 embed 자체는
생성형 LLM과 달리 샘플링이 없어 같은 입력에는 항상 같은 벡터가 나온다 — 결정적이다).

명확한 매치/불일치 케이스로는 코드가 맞는지 확인하고, 애매한 경계 케이스는 정답을 맞다/틀리다로
채점하지 않고 실제 점수만 관찰한다 — 그 점수 분포가 threshold를 어디에 둘지 정하는 근거가 된다.

실행 (ai/ 디렉토리 안에서 — EMBEDDING_API_KEY 필요):
    .venv/bin/python -m judge.eval_embedding_search

결과는 runs/embedding_search_eval.csv 에도 남는다 (runs/ 는 .gitignore 대상 — 커밋 안 됨).
"""

from __future__ import annotations

import csv

from embedding import embed, find_similar_candidates
from shared.config import RUNS_DIR

# (task_id, 후보 task 제목) — 모든 시나리오가 공유하는 "기존 Notion task 목록"
TASKS = [
    ("task_login", "로그인 화면 시안 마무리 작업"),
    ("task_social_login", "로그인 화면에 소셜 로그인 버튼 추가"),
    ("task_payment", "결제 API 연동"),
    ("task_refund", "결제 환불 기능 구현"),
    ("task_design", "디자인 시스템 색상 팔레트 정리"),
    ("task_signup", "회원가입 이메일 인증 기능 구현"),
    ("task_notification", "푸시 알림 기능 구현"),
    ("task_search", "검색 기능 성능 개선"),
    ("task_profile", "회원 프로필 수정 화면 개발"),
    ("task_onboarding", "신규 사용자 온보딩 튜토리얼 제작"),
]

# (설명, 쿼리 텍스트, 기대값)
# 기대값: task_id 문자열 = 이게 1등이어야 함 / None = 강한 매치 없어야 함 / "AMBIGUOUS" = 정답 없음, 점수만 관찰
SCENARIOS = [
    # ── A. 명확한 매치 — task마다 하나씩 (10) ──────────────────────
    ("매치 — 로그인", "로그인 화면 마감일을 다음 주 화요일로 연기하기로 합의했다.", "task_login"),
    ("매치 — 소셜 로그인", "로그인 화면에 소셜 로그인 버튼을 추가하기로 했다.", "task_social_login"),
    ("매치 — 결제 연동", "결제 모듈 API 붙이는 작업을 다 끝냈다.", "task_payment"),
    ("매치 — 결제 환불", "결제 환불 처리 로직을 다음 주까지 구현하기로 했다.", "task_refund"),
    ("매치 — 디자인 시스템", "디자인 시스템 색상 팔레트 작업이 완료됐다.", "task_design"),
    ("매치 — 회원가입 인증", "회원가입 이메일 인증 기능 담당을 세영님으로 정했다.", "task_signup"),
    ("매치 — 푸시 알림", "푸시 알림 기능 개발을 이번 주까지 마치기로 했다.", "task_notification"),
    ("매치 — 검색 성능", "검색 속도가 느려서 성능 개선 작업을 시작하기로 했다.", "task_search"),
    ("매치 — 프로필 화면", "회원 프로필 수정 화면 개발을 담당하게 됐다.", "task_profile"),
    ("매치 — 온보딩", "신규 사용자 온보딩 튜토리얼 제작을 다음 스프린트에 넣기로 했다.", "task_onboarding"),

    # ── B. 완전히 다른 도메인 (10) ──────────────────────────────
    ("불일치 — 마케팅 예산", "마케팅 캠페인 예산안을 이번 달 말까지 확정하기로 했다.", None),
    ("불일치 — 회식 장소", "다음 회식 장소를 홍대 쪽으로 정하기로 했다.", None),
    ("불일치 — 인프라 이전", "서버를 AWS에서 GCP로 옮기는 작업을 시작하기로 했다.", None),
    ("불일치 — 채용", "채용 공고를 새로 올리기로 했다.", None),
    ("불일치 — 사무실 자리", "사무실 자리 배치를 다시 하기로 했다.", None),
    ("불일치 — 매출 목표", "다음 분기 매출 목표를 다시 세우기로 했다.", None),
    ("불일치 — 회고 일정", "팀 회고 일정을 다음 주 금요일로 잡기로 했다.", None),
    ("불일치 — CI 도구", "새로운 CI 파이프라인 도구를 도입하기로 했다.", None),
    ("불일치 — 고객 지원", "고객 지원 티켓 대응 매뉴얼을 작성하기로 했다.", None),
    ("불일치 — 법인카드", "법인카드 정산 방식을 바꾸기로 했다.", None),

    # ── C. 아주 짧은 완료/시작 보고 (5) ──────────────────────────
    ("짧은 보고 — 로그인", "로그인 완료.", "task_login"),
    ("짧은 보고 — 검색", "검색 기능 작업 시작함.", "task_search"),
    ("짧은 보고 — 프로필 담당자 변경", "프로필 화면 담당자를 하은님으로 변경.", "task_profile"),
    ("짧은 보고 — 알림", "알림 기능 다 됐습니다.", "task_notification"),
    ("짧은 보고 — 온보딩", "온보딩 튜토리얼 초안 나왔어요.", "task_onboarding"),

    # ── D. 다중 후보 구분(비슷한 후보 중 정확한 것 골라야 함) (8) ──
    ("다중후보 — 환불 API(결제 연동과 구분)", "환불 요청 처리하는 API를 새로 만들기로 했다.", "task_refund"),
    ("다중후보 — 소셜 로그인 버튼(로그인 시안과 구분)", "로그인 화면에 카카오/구글 로그인 버튼을 붙이기로 했다.", "task_social_login"),
    ("다중후보 — 로그인 시안 확정(소셜 로그인과 구분)", "로그인 화면 디자인 시안을 최종 확정하기로 했다.", "task_login"),
    ("다중후보 — 인증코드 발송(알림과 구분)", "회원가입 시 이메일로 인증코드를 보내는 기능을 만들기로 했다.", "task_signup"),
    ("다중후보 — 푸시 발송(회원가입과 구분)", "사용자한테 알림을 푸시로 보내는 기능을 붙이기로 했다.", "task_notification"),
    ("다중후보 — 검색 정렬 개선", "검색 결과 정렬 로직을 개선하기로 했다.", "task_search"),
    ("다중후보 — 프로필 사진 업로드(회원가입과 구분)", "회원 프로필 사진 업로드 기능을 추가하기로 했다.", "task_profile"),
    ("다중후보 — 온보딩 안내문구(프로필과 구분)", "신규 유저 첫 화면 안내 문구를 다시 쓰기로 했다.", "task_onboarding"),

    # ── E. 경계 케이스 — 관련은 있는데 다른 하위작업 (8, 관찰용) ──
    ("경계 — 결제+알림+가입 겹침", "결제 완료 후 확인 이메일을 보내는 기능을 추가하기로 했다.", "AMBIGUOUS"),
    ("경계 — 디자인 가이드 문서화", "디자인 시스템 사용 가이드를 문서화하기로 했다.", "AMBIGUOUS"),
    ("경계 — 로그인+디자인 겹침", "로그인 실패 시 에러 메시지 디자인을 개선하기로 했다.", "AMBIGUOUS"),
    ("경계 — 검색+온보딩 겹침", "검색 기능에 온보딩 힌트를 추가하기로 했다.", "AMBIGUOUS"),
    ("경계 — 가입+온보딩 겹침", "회원가입 완료 후 온보딩 화면으로 자동 이동하게 만들기로 했다.", "AMBIGUOUS"),
    ("경계 — 알림+프로필 겹침", "알림 설정을 프로필 화면에서 변경할 수 있게 하기로 했다.", "AMBIGUOUS"),
    ("경계 — 결제+알림 겹침", "결제 실패 알림을 푸시로 보내기로 했다.", "AMBIGUOUS"),
    ("경계 — 소셜로그인+프로필 겹침", "소셜 로그인 연동 시 프로필 정보를 자동으로 채우기로 했다.", "AMBIGUOUS"),

    # ── F. 엣지 케이스 — 짧음/모호함/부정문/다중언급 (9) ──────────
    ("엣지 — 날짜만 있고 내용 빈약", "마감일을 9월 25일로 확정했다.", "AMBIGUOUS"),
    ("엣지 — 너무 일반적인 문장", "다음 주까지 마무리하기로 했다.", "AMBIGUOUS"),
    ("엣지 — 지시대명사만 있음(내용 없음)", "그거 다음 주까지 하기로 했어요.", "AMBIGUOUS"),
    ("엣지 — 부정문(로그인 안 하기로)", "로그인 기능은 이번 스프린트에서 안 하기로 했다.", "task_login"),
    ("엣지 — 부정문(검색 안 하기로)", "검색 기능 안 하기로 했다.", "task_search"),
    ("엣지 — 여러 도메인 동시 언급", "결제, 환불, 로그인 다 관련된 이슈입니다.", "AMBIGUOUS"),
    ("엣지 — 맥락 전혀 없음", "음... 그거 있잖아요, 저번에 얘기했던 거.", "AMBIGUOUS"),
    ("엣지 — 보류지만 키워드는 명확", "온보딩이요? 그건 다음에 하죠.", "task_onboarding"),
    ("엣지 — 인증 관련 3개 동시 언급", "로그인, 회원가입, 프로필까지 전부 이번 주 안에 끝내기로 했다.", "AMBIGUOUS"),
]


def main() -> None:
    task_vectors = [(tid, embed(title)) for tid, title in TASKS]
    if any(v is None for _, v in task_vectors):
        print("EMBEDDING_API_KEY가 없어서 임베딩이 안 됩니다 — .env를 확인하세요.")
        return

    correct = graded = 0
    rows = []
    for desc, query, expected in SCENARIOS:
        ranked = find_similar_candidates(query, task_vectors, k=len(TASKS))
        top_id, top_score = ranked[0]

        if expected == "AMBIGUOUS":
            status = "OBSERVE"
            result_str = "(관찰용 — 채점 안 함)"
        else:
            graded += 1
            if expected is None:
                passed = top_score < 0.35
                result_str = "기대: 강한 매치 없음(<0.35)"
            else:
                passed = top_id == expected
                result_str = f"기대: {expected}"
            correct += passed
            status = "PASS" if passed else "FAIL"

        mark = {"PASS": "✓", "FAIL": "✗", "OBSERVE": "?"}[status]
        print(f"[{mark}] {desc}")
        print(f"    쿼리: {query!r}")
        print(f"    {result_str} | 실제 1등: {top_id}({top_score:.4f})")
        print(f"    전체 순위(상위 4): {[(tid, round(s, 4)) for tid, s in ranked[:4]]}")
        print()

        rows.append({
            "description": desc,
            "query": query,
            "expected": expected if expected is not None else "NONE",
            "status": status,
            "top_id": top_id,
            "top_score": round(top_score, 4),
            "ranking": "; ".join(f"{tid}:{s:.4f}" for tid, s in ranked),
        })

    print("=" * 60)
    print(f"채점 대상 {correct}/{graded} 통과 (관찰용 {len(SCENARIOS) - graded}개 제외, 전체 {len(SCENARIOS)}개)")

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = RUNS_DIR / "embedding_search_eval.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"CSV 저장: {csv_path}")


if __name__ == "__main__":
    main()
