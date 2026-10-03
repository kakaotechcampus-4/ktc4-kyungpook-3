import { paths } from './routes'

it.each([
  [paths.landing(), '/'],
  [paths.login(), '/login'],
  [paths.signup(), '/signup'],
  [paths.workspaceSelect(), '/workspaces'],
  [paths.onboardingCreate(), '/onboarding/create_workspace'],
  [paths.onboardingStep('ws_02', 'connect_notion'), '/onboarding/ws_02/connect_notion'],
  [
    paths.onboardingReview('ws_02', 'connect_discord'),
    '/onboarding/ws_02/connect_discord?review=1',
  ],
  [paths.dashboard('ws_01'), '/workspaces/ws_01/dashboard'],
  [paths.meetings('ws_01'), '/workspaces/ws_01/meetings'],
  [paths.meetings('ws_01', 'mt_09'), '/workspaces/ws_01/meetings/mt_09'],
  [paths.tasks('ws_01'), '/workspaces/ws_01/tasks'],
  [paths.tasks('ws_01', 'tk_01'), '/workspaces/ws_01/tasks/tk_01'],
  [paths.approval('ws_01', 'ap_01'), '/workspaces/ws_01/approvals/ap_01'],
  [paths.messages('ws_01'), '/workspaces/ws_01/messages'],
  [paths.members('ws_01'), '/workspaces/ws_01/members'],
  [paths.settings('ws_01'), '/workspaces/ws_01/settings'],
])('%s 를 만든다 (기대값 %s)', (actual, expected) => {
  expect(actual).toBe(expected)
})

it('ID 를 경로 조각으로 인코딩한다', () => {
  expect(paths.dashboard('a b/c')).toBe('/workspaces/a%20b%2Fc/dashboard')
})
