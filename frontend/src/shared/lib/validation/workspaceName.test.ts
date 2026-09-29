import {
  WORKSPACE_NAME_MAX_LENGTH,
  checkWorkspaceName,
  countVisibleCharacters,
  normalizeWorkspaceName,
} from './workspaceName'

/* 이모지는 이스케이프로 적는다 — 편집기에 따라 결합 문자가 흩어져 보이지 않게 */
const THUMBS_UP = '\u{1F44D}'
const THUMBS_UP_TONED = '\u{1F44D}\u{1F3FD}'
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'
const KOREA_FLAG = '\u{1F1F0}\u{1F1F7}'
const E_ACUTE = 'é'

describe('normalizeWorkspaceName', () => {
  it('앞뒤 공백을 지우고 연속 공백을 하나로 줄인다', () => {
    expect(normalizeWorkspaceName('  카테캠   3팀  ')).toBe('카테캠 3팀')
  })

  it('탭·줄바꿈·전각 공백도 공백 하나다', () => {
    expect(normalizeWorkspaceName('팀\t\n　A')).toBe('팀 A')
  })
})

describe('countVisibleCharacters', () => {
  it.each([
    ['abc', 3],
    ['카테캠', 3],
    [THUMBS_UP, 1],
    [THUMBS_UP_TONED, 1],
    [FAMILY, 1],
    [KOREA_FLAG, 1],
    [E_ACUTE, 1],
  ])('%s 는 %i 글자다', (value, count) => {
    expect(countVisibleCharacters(value)).toBe(count)
  })
})

describe('checkWorkspaceName', () => {
  it('공백뿐이면 empty 다', () => {
    expect(checkWorkspaceName('   ')).toEqual({ ok: false, name: '', issue: 'empty' })
  })

  it('정규화한 뒤 20자는 통과한다', () => {
    const name = '가'.repeat(WORKSPACE_NAME_MAX_LENGTH)
    expect(checkWorkspaceName(`  ${name}  `)).toEqual({ ok: true, name })
  })

  it('21자는 too_long 이다', () => {
    expect(checkWorkspaceName('가'.repeat(21))).toMatchObject({ ok: false, issue: 'too_long' })
  })

  it('연속 공백은 한 칸으로 센다', () => {
    // 정규화하면 9 + 1 + 10 = 20 글자다
    const input = `${'가'.repeat(9)}     ${'나'.repeat(10)}`
    expect(checkWorkspaceName(input)).toMatchObject({ ok: true })
  })

  it('이모지는 보이는 글자로 센다 — UTF-16 길이가 아니다', () => {
    expect(FAMILY.repeat(20).length).toBeGreaterThan(20)
    expect(checkWorkspaceName(FAMILY.repeat(20))).toMatchObject({ ok: true })
    expect(checkWorkspaceName(FAMILY.repeat(21))).toMatchObject({ ok: false, issue: 'too_long' })
  })

  it('정규화한 소속 공간 이름과 같으면 duplicated 다', () => {
    expect(checkWorkspaceName(' 카테캠   3팀', ['카테캠 3팀'])).toEqual({
      ok: false,
      name: '카테캠 3팀',
      issue: 'duplicated',
    })
    expect(checkWorkspaceName('카테캠 3팀', ['  카테캠   3팀 '])).toMatchObject({
      ok: false,
      issue: 'duplicated',
    })
  })

  it('대소문자만 다르면 다른 이름이다', () => {
    expect(checkWorkspaceName('alpha', ['Alpha'])).toEqual({ ok: true, name: 'alpha' })
  })

  it('특수문자와 이모지를 막지 않는다', () => {
    expect(checkWorkspaceName(`팀 #1 ${THUMBS_UP}`)).toEqual({
      ok: true,
      name: `팀 #1 ${THUMBS_UP}`,
    })
  })
})
