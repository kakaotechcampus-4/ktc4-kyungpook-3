import { MEETING_UPLOAD_POLICY } from '@/entities/meeting'
import { AUDIO_ACCEPT, checkAudioDuration, checkAudioFiles, fileExtension } from './audioFile'

const MAX = MEETING_UPLOAD_POLICY.maxBytes

/** 크기만 있는 파일 흉내 — 200 MiB 를 실제로 만들지 않는다 */
function fake(name: string, size = 1024) {
  return { name, size }
}

describe('파일 형식·크기 검사 (U3-4)', () => {
  it.each(['a.mp3', 'a.wav', 'a.m4a', 'a.ogg', 'a.webm', '대문자.MP3', '점.이.많은.M4a'])(
    '%s 는 받는다',
    (name) => {
      expect(checkAudioFiles([fake(name)])).toMatchObject({ ok: true })
    },
  )

  it.each(['a.mp4', 'a.txt', 'a.flac', 'a', 'mp3', 'a.mp3.txt'])('%s 는 형식 오류다', (name) => {
    expect(checkAudioFiles([fake(name)])).toEqual({ ok: false, reason: 'format' })
  })

  it('여러 파일을 한 번에 넣으면 고르지 않는다', () => {
    expect(checkAudioFiles([fake('a.mp3'), fake('b.mp3')])).toEqual({
      ok: false,
      reason: 'multiple',
    })
  })

  it('빈 파일은 막는다', () => {
    expect(checkAudioFiles([fake('a.mp3', 0)])).toEqual({ ok: false, reason: 'empty' })
  })

  it('정확히 200 MiB 는 통과, 1바이트라도 넘으면 막는다', () => {
    expect(MAX).toBe(209_715_200)
    expect(checkAudioFiles([fake('a.mp3', MAX)])).toMatchObject({ ok: true })
    expect(checkAudioFiles([fake('a.mp3', MAX + 1)])).toEqual({ ok: false, reason: 'too_large' })
  })

  it('선택 창을 취소해 파일이 없으면 아무 판정도 하지 않는다', () => {
    expect(checkAudioFiles([])).toBeNull()
  })

  it('받은 파일은 그 객체 그대로다', () => {
    const file = fake('a.ogg')
    expect(checkAudioFiles([file])).toEqual({ ok: true, file })
  })

  it('확장자는 마지막 점 뒤를 소문자로 읽는다', () => {
    expect(fileExtension('회의.녹음.WebM')).toBe('webm')
    expect(fileExtension('이름없음')).toBe('')
  })

  it('선택 창은 다섯 형식만 보여 준다', () => {
    expect(AUDIO_ACCEPT).toBe('.mp3,.wav,.m4a,.ogg,.webm')
  })
})

describe('길이 검사 (U3-4)', () => {
  const TWO_HOURS = 2 * 60 * 60 * 1000

  it('정확히 2시간은 통과, 1ms 라도 넘으면 막는다', () => {
    expect(checkAudioDuration(TWO_HOURS)).toBeNull()
    expect(checkAudioDuration(TWO_HOURS + 1)).toBe('too_long')
  })

  it('짧은 녹음은 통과한다', () => {
    expect(checkAudioDuration(1_000)).toBeNull()
  })

  it('길이를 읽지 못했으면 형식 확인 안내다', () => {
    expect(checkAudioDuration(null)).toBe('unreadable')
  })
})
