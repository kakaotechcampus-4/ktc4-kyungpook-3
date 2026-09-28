export interface User {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}
export interface Session {
  user: User
  workspaceCount: number
  lastWorkspaceId: string | null
}
