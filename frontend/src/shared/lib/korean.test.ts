import { objectParticle, topicParticle } from './korean'

it('받침에 따라 을/를을 고른다', () => {
  expect(objectParticle('3주차 정기회의')).toBe('를')
  expect(objectParticle('기획 논의 녹음')).toBe('을')
  expect(objectParticle('Sprint 1')).toBe('을(를)')
})

it('받침에 따라 은/는을 고른다', () => {
  expect(topicParticle('애포')).toBe('는')
  expect(topicParticle('폴런')).toBe('은')
  expect(topicParticle('API')).toBe('은(는)')
  expect(topicParticle('')).toBe('은(는)')
})
