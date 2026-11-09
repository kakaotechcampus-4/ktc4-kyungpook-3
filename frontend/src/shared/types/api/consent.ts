import { z } from 'zod'

const version = z.string().min(1).max(32)
const document = z
  .object({
    kind: z.enum(['terms', 'privacy']),
    current_version: version,
    agreed_version: version.nullable(),
    agreed_at: z.string().datetime({ offset: true }).nullable(),
  })
  .refine((value) => (value.agreed_version === null) === (value.agreed_at === null), {
    message: 'agreement version and timestamp must both exist or both be null',
  })

export const consentStatusSchema = z
  .object({
    required: z.boolean(),
    documents: z
      .tuple([document, document])
      .refine(([first, second]) => first.kind !== second.kind, {
        message: 'exactly one terms and privacy document is required',
      }),
  })
  .refine(
    (value) =>
      value.required ===
      !value.documents.every(
        (entry) => entry.agreed_version === entry.current_version && entry.agreed_at !== null,
      ),
    {
      message: 'required must match both current document agreements',
    },
  )

export type ConsentStatusDto = z.infer<typeof consentStatusSchema>
