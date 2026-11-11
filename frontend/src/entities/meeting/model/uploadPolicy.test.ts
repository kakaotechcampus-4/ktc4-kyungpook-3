import { MEETING_UPLOAD_POLICY } from './uploadPolicy'

it('업로드 한도는 700 MiB·2시간·다섯 형식이다', () => {
  expect(MEETING_UPLOAD_POLICY).toEqual({
    maxBytes: 734_003_200,
    maxDurationMs: 7_200_000,
    extensions: ['mp3', 'wav', 'm4a', 'ogg', 'webm'],
  })
})
