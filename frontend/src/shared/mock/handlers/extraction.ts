import { http } from 'msw'
import { db } from '../db'
import { ok, fail } from '../envelope'

export const extractionHandlers = [
  http.get('/api/v1/extractions/:extractionId', ({ params }) => {
    const extraction = db.extractions.find(
      ({ extraction_id }) => extraction_id === params.extractionId,
    )
    return extraction ? ok(extraction) : fail('EXTRACTION_NOT_FOUND', '추출 결과가 없습니다.', 404)
  }),
]
