import { render, screen } from '@testing-library/react'
import { UploadStatus } from './UploadStatus'

describe('UploadStatus — 보내는 중 (U3-7)', () => {
  it('전체 크기를 알면 진행 막대가 전송률을 값으로 갖는다', () => {
    render(<UploadStatus phase={{ kind: 'sending', percent: 42 }} />)

    expect(screen.getByRole('progressbar', { name: '파일 전송' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    )
    expect(screen.getByRole('status')).toHaveTextContent('파일을 보내는 중이에요 · 42%')
  })

  it('전체 크기를 모르면 진행 막대에 값이 없어 불확정으로 읽힌다', () => {
    render(<UploadStatus phase={{ kind: 'sending', percent: null }} />)

    expect(screen.getByRole('progressbar', { name: '파일 전송' })).not.toHaveAttribute(
      'aria-valuenow',
    )
    expect(screen.getByRole('status')).toHaveTextContent('파일을 보내는 중이에요.')
  })
})
