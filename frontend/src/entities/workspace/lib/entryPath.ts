import { paths } from '@/shared/config/routes'
import type { OnboardingProgress, OnboardingStep, Workspace } from '../model/types'
import { findMemberWorkspace } from './membership'

/**
 * 온보딩을 이어 갈 단계. 서버의 현재 단계 → 첫 pending 단계 → 생성 단계 순이다.
 * 모르는 단계 이름은 mapper 가 이미 null 로 내렸다.
 */
export function resumeStep(onboarding: OnboardingProgress): OnboardingStep {
  return (
    onboarding.currentStep ??
    onboarding.steps.find(({ status }) => status === 'pending')?.step ??
    'create_workspace'
  )
}

export function onboardingResumePath(workspace: Workspace): string {
  return paths.onboardingStep(workspace.id, resumeStep(workspace.onboarding))
}

/** 공간에 들어가는 곳. 미완료 공간은 언제나 온보딩이다 (D-071, D-072) */
export function workspaceEntryPath(workspace: Workspace): string {
  return workspace.onboarding.completed
    ? paths.dashboard(workspace.id)
    : onboardingResumePath(workspace)
}

/** 로그인 완료 직후. 0개 → 생성 온보딩, 1개 → 그 공간, 여러 개 → 선택 화면 (D-010) */
export function postLoginPath(workspaces: readonly Workspace[]): string {
  if (workspaces.length === 0) return paths.onboardingCreate()
  if (workspaces.length === 1) return workspaceEntryPath(workspaces[0])
  return paths.workspaceSelect()
}

/**
 * 로그인한 사용자가 인증 화면(랜딩·로그인·회원가입)에 다시 왔을 때.
 * 마지막 공간이 소속 목록에 있으면 그곳이 먼저고, 아니면 로그인 완료와 같은 분기다 (D-131).
 */
export function authRevisitPath(
  workspaces: readonly Workspace[],
  lastWorkspaceId: string | null,
): string {
  const last = findMemberWorkspace(workspaces, lastWorkspaceId)
  return last === null ? postLoginPath(workspaces) : workspaceEntryPath(last)
}
