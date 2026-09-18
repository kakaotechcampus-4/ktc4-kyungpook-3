import { toExtraction } from '../model/mapper'
import { extractionFixtures } from '@/shared/mock/fixtures/extraction'
import { appliedItems, pendingItems, visibleItems } from './extractionView'

it('removes pending approval items entirely for members who cannot review', () => {
  const extraction = toExtraction(extractionFixtures[1])
  expect(appliedItems(extraction).map(({ id }) => id)).toEqual(['it_01', 'it_02', 'it_03'])
  expect(pendingItems(extraction).map(({ id }) => id)).toEqual(['it_04', 'it_05', 'it_06'])
  expect(visibleItems(extraction, false).map(({ id }) => id)).toEqual(['it_01', 'it_02', 'it_03'])
  expect(visibleItems(extraction, true)).toHaveLength(6)
})
