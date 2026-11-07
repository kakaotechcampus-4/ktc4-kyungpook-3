import { speakerTitle, speakingTime } from './speakers'

it('라벨을 응답 순서의 화자 번호로 부른다', () => {
  expect([0, 1, 9].map(speakerTitle)).toEqual(['화자 1', '화자 2', '화자 10'])
})

it.each([
  [0.4, '1초 미만'],
  [0.8, '1초'],
  [45, '45초'],
  [120.5, '2분 1초'],
  [180, '3분'],
  [3725, '1시간 2분 5초'],
])('총 발화 시간 %s초는 %s', (seconds, text) => {
  expect(speakingTime(seconds)).toBe(text)
})
