// 백엔드 schemas/invitation.py (계약 §5.9). 목록은 ListDto 로 감싼다
export interface InvitedUserDto {
  user_id: string
  name: string
  email: string
}
// PM 이 보는 초대 한 건. accepted_user 는 연결을 끊은 뒤에도 남고, 계정이 지워지면 null 이다
export interface InvitationDto {
  invitation_id: string
  member_id: string
  member_display_name: string
  email: string
  status: string
  invited_by_name: string | null
  accepted_user: InvitedUserDto | null
  created_at: string
  responded_at: string | null
}
// 내 가입 이메일로 온 대기 중 초대
export interface MyInvitationDto {
  invitation_id: string
  workspace_id: string
  workspace_name: string
  member_display_name: string
  invited_by_name: string | null
  created_at: string
}
// 요청 본문. 서버가 이메일을 소문자로 바꿔 저장한다
export interface InvitationCreateDto {
  member_id: string
  email: string
}
