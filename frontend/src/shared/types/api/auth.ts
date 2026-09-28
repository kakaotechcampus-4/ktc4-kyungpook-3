export interface UserDto {
  user_id: string
  email: string
  name: string
  avatar_url: string | null
}
export interface SessionDto {
  user: UserDto
  workspace_count: number
  last_workspace_id: string | null
}
export interface LoginDto {
  email: string
  password: string
}
export interface SignupDto extends LoginDto {
  name: string
}
