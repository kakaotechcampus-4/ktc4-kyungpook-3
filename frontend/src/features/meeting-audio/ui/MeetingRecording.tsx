import type { AudioUnavailableReason } from '@/entities/meeting'
import { meetingAudioUrl } from '@/entities/meeting'
import { Button } from '@/shared/ui/button'
import { useMeetingAudio } from '../model/useMeetingAudio'

/* 회의록 머리와 탭 줄 사이. 좌우 여백은 머리·탭 줄(36, 휴대폰 20)과 같다 */
const SECTION = 'flex flex-col items-start gap-8 px-36 pb-14 max-md:px-20'
const PLAYER = 'block h-40 w-full max-w-[560px]'
const NOTE = 'text-caption text-dim'

const UNAVAILABLE_TEXT = '녹음이 없거나 보관 기간(7일)이 지났어요.'
const REASON_TEXT: Record<AudioUnavailableReason, string> = {
  expired: '보관 기간(7일)이 지나 녹음을 들을 수 없어요.',
  no_recording: '이 회의는 녹음이 없어요.',
}

export interface MeetingRecordingProps {
  meetingId: string
  /** 회의록이 지금 들을 수 있는 녹음이 있다고 했다 (`minutes.audio !== null`) */
  playable: boolean
  /** 근거 시각(초). '원문 듣기'로 들어오면 있다 */
  startAt: number | null
}

/**
 * 회의 녹음 (#676). 들을 수 있으면 플레이어를 그리고 근거 시각으로 옮긴다.
 * 녹음이 없을 때는 근거 시각을 들으러 온 경우에만 알린다 — 그냥 회의록을 연 사람에게는 아무것도 그리지 않는다
 */
export function MeetingRecording({ meetingId, playable, startAt }: MeetingRecordingProps) {
  if (playable) return <RecordingPlayer meetingId={meetingId} startAt={startAt} />
  if (startAt === null) return null
  return (
    <section aria-label="회의 녹음" className={SECTION}>
      <p className={NOTE}>{UNAVAILABLE_TEXT}</p>
    </section>
  )
}

function RecordingPlayer({ meetingId, startAt }: { meetingId: string; startAt: number | null }) {
  const audio = useMeetingAudio(meetingId, startAt)
  const { phase } = audio
  return (
    <section aria-label="회의 녹음" className={SECTION}>
      {phase.kind === 'unavailable' ? (
        <p className={NOTE} role="status">
          {phase.reason === null ? UNAVAILABLE_TEXT : REASON_TEXT[phase.reason]}
        </p>
      ) : phase.kind === 'failed' ? (
        <>
          <p className={NOTE} role="status">
            녹음을 불러오지 못했어요.
          </p>
          <Button onClick={audio.retry}>다시 시도</Button>
        </>
      ) : (
        // 회의 원본이라 자막 파일이 없다. 같은 내용은 전사문 탭에 있다
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          key={audio.load}
          className={PLAYER}
          controls
          preload="metadata"
          src={meetingAudioUrl(meetingId)}
          onLoadedMetadata={audio.onLoadedMetadata}
          onLoadedData={audio.onReceived}
          onPlaying={audio.onReceived}
          onError={audio.onError}
        />
      )}
    </section>
  )
}
