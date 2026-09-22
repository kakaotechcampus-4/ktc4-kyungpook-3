import type { SessionDto, UserDto } from '@/shared/types/api/auth'
import type { Session, User } from './types'

export function toUser(dto: UserDto): User {
  return { id: dto.user_id, email: dto.email, name: dto.name, avatarUrl: dto.avatar_url }
}
export function toSession(dto: SessionDto): Session {
  return {
    user: toUser(dto.user),
    workspaceCount: dto.workspace_count,
    lastWorkspaceId: dto.last_workspace_id,
  }
}
