import { postLoginRoute } from './postLoginRoute'

it.each([
  [0, 'onboarding'],
  [1, 'dashboard'],
  [2, 'workspace-select'],
])('routes %s workspaces to %s', (count, route) => {
  expect(postLoginRoute(count)).toBe(route)
})
