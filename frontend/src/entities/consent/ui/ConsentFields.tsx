import { useId } from 'react'
import { policyDocuments } from '@/shared/config/policy'
import type { PolicyKind } from '@/shared/config/policy'
import type { PublishedPolicies } from '@/shared/config/policyPublication'

import type { ConsentSelection } from '../model/selection'

export function ConsentFields({
  documents,
  value,
  onChange,
  disabled = false,
}: {
  documents: PublishedPolicies
  value: ConsentSelection
  onChange: (value: ConsentSelection) => void
  disabled?: boolean
}) {
  const id = useId()
  const kinds: readonly PolicyKind[] = ['terms', 'privacy']
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-12">
      <legend className="mb-10 text-body font-semibold">필수 동의</legend>
      {kinds.map((kind) => (
        <div key={kind} className="flex items-start justify-between gap-12 text-body">
          <label htmlFor={`${id}-${kind}`} className="flex items-start gap-9">
            <input
              id={`${id}-${kind}`}
              type="checkbox"
              checked={value[kind]}
              className="mt-3 size-16 shrink-0 accent-ink"
              onChange={(event) => onChange({ ...value, [kind]: event.target.checked })}
            />
            <span>[필수] {policyDocuments[kind].title} 동의</span>
          </label>
          <a
            href={policyDocuments[kind].to}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${policyDocuments[kind].title} 보기 (새 탭)`}
            className="shrink-0 text-dim underline underline-offset-3"
          >
            보기
          </a>
          <span className="sr-only">판본 {documents[kind].version}</span>
        </div>
      ))}
    </fieldset>
  )
}
