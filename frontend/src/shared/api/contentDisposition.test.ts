import { filenameFromContentDisposition } from './contentDisposition'

const korean = '2026-09-15 3주차 정기회의.md'

describe('filenameFromContentDisposition', () => {
  it('filename* 의 한글 이름을 푼다', () => {
    expect(
      filenameFromContentDisposition(`attachment; filename*=UTF-8''${encodeURIComponent(korean)}`),
    ).toBe(korean)
  })

  it('둘 다 있으면 filename* 를 쓴다', () => {
    expect(
      filenameFromContentDisposition(
        `attachment; filename="summary.md"; filename*=UTF-8''${encodeURIComponent(korean)}`,
      ),
    ).toBe(korean)
  })

  it('filename 만 있으면 그 이름이다', () => {
    expect(filenameFromContentDisposition('attachment; filename="project-bundle.md"')).toBe(
      'project-bundle.md',
    )
    expect(filenameFromContentDisposition('attachment; filename=summary.md')).toBe('summary.md')
  })

  it('따옴표 안의 이스케이프와 세미콜론을 그대로 읽는다', () => {
    expect(filenameFromContentDisposition('attachment; filename="a\\"b;c.md"')).toBe('a"b;c.md')
  })

  it('filename* 의 퍼센트 인코딩이 깨졌으면 filename 으로 돌아간다', () => {
    expect(
      filenameFromContentDisposition(
        `attachment; filename="summary.md"; filename*=UTF-8''%E0%A4%A`,
      ),
    ).toBe('summary.md')
  })

  it('이름이 없으면 null 이다', () => {
    expect(filenameFromContentDisposition(null)).toBeNull()
    expect(filenameFromContentDisposition('')).toBeNull()
    expect(filenameFromContentDisposition('attachment')).toBeNull()
    expect(filenameFromContentDisposition('attachment; filename=""')).toBeNull()
  })
})
