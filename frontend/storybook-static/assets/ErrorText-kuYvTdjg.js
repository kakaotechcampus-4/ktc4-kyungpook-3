import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{t}from"./jsx-runtime-DeHZSEgm.js";function n({className:e,children:t,...n}){let i=[`text-[12px] font-normal text-accent`,e].filter(Boolean).join(` `);return(0,r.jsx)(`p`,{className:i,...n,children:t})}var r;function i(){return(i=e((()=>{r=t(),n.__docgenInfo={description:`필드 오류 한 줄. 입력 **아래**에 놓고, 입력의 \`aria-describedby\` 가 이걸 가리킨다 (D-142).

**\`role="alert"\` 를 붙이지 않는다.** 입력이 \`aria-invalid\` + \`aria-describedby\` 로 이미 이 문구를 읽는다 —
alert 까지 붙이면 재검증 때마다 한 번 더 읽힌다. 제출 뒤에는 첫 오류 칸으로 포커스가 가서(shouldFocusError)
라벨과 함께 읽힌다 (impl-decision 2026-09-29-field-error-announcement).

실측 근거가 없는 제안 값이다 — 캔버스 25장에 오류 메시지 텍스트가 한 줄도 없다.
라벨과 같은 단(12/400)에 경계·라벨과 같은 강조색을 쓴다.

**아이콘을 붙이지 않는다.** 유채 정보/성공/경고/오류 박스를 쓰지 않는다 (design-system.md §7-13).
비필드 서버 오류는 폼 상단의 별도 블록이다 — 이 컴포넌트가 아니다.`,methods:[],displayName:`ErrorText`,props:{children:{required:!0,tsType:{name:`ReactNode`},description:`문구는 호출자가 준다`}},composes:[`ComponentPropsWithoutRef`]}})))()}export{i as n,n as t};