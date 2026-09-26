import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { toApproval } from '../model/mapper'
import { sortByWaiting } from './sortByWaiting'

it('sorts the newest-first response into oldest-waiting-first without mutating it', () => {
  const response = [approvalFixtures[2], approvalFixtures[1], approvalFixtures[0]].map(toApproval)
  expect(sortByWaiting(response).map(({ id }) => id)).toEqual(['ap_01', 'ap_02', 'ap_03'])
  expect(response.map(({ id }) => id)).toEqual(['ap_03', 'ap_02', 'ap_01'])
})
