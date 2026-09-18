import { render, screen } from '@testing-library/react'
import { Panel } from './Panel'

describe('Panel', () => {
  it('renders its children', () => {
    render(<Panel data-testid="panel">회의록 12분 40초</Panel>)

    expect(screen.getByTestId('panel')).toHaveTextContent('회의록 12분 40초')
  })

  it('sits on the sunken surface at radius 12', () => {
    render(<Panel data-testid="panel">회의록 12분 40초</Panel>)

    expect(screen.getByTestId('panel')).toHaveClass('bg-surface-sunken', 'rounded-12')
  })

  it('uses the measured padding and inner gap', () => {
    render(<Panel data-testid="panel">회의록 12분 40초</Panel>)

    expect(screen.getByTestId('panel')).toHaveClass('px-20', 'py-18', 'flex', 'flex-col', 'gap-7')
  })

  it('draws no border and no shadow', () => {
    render(<Panel data-testid="panel">회의록 12분 40초</Panel>)
    const panel = screen.getByTestId('panel')

    expect(panel.className).not.toMatch(/border/)
    expect(panel.className).not.toMatch(/shadow/)
  })

  it('draws no left accent stripe', () => {
    render(<Panel data-testid="panel">회의록 12분 40초</Panel>)

    expect(screen.getByTestId('panel').className).not.toMatch(/border-l|before:/)
  })

  it('keeps its own classes when the caller adds layout', () => {
    render(
      <Panel className="mt-12" data-testid="panel">
        회의록 12분 40초
      </Panel>,
    )

    expect(screen.getByTestId('panel')).toHaveClass('mt-12', 'bg-surface-sunken', 'rounded-12')
  })

  it('forwards the rest of the div props', () => {
    render(
      <Panel data-testid="panel" id="evidence-1">
        회의록 12분 40초
      </Panel>,
    )

    expect(screen.getByTestId('panel')).toHaveAttribute('id', 'evidence-1')
  })
})
