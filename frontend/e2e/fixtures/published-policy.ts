import type { PolicyPublication } from '../../src/shared/config/policyPublication'

// Synthetic content used only by the isolated consent fault-injection tests.
export const currentPolicyPublication: PolicyPublication = {
  kind: 'published',
  documents: {
    terms: {
      version: 'test-terms-v1',
      effectiveOn: '2000-01-01',
      references: [],
      sections: [
        { title: '테스트 이용약관', paragraphs: ['합성 테스트 문서입니다. 실제 약관이 아닙니다.'] },
      ],
    },
    privacy: {
      version: 'test-privacy-v1',
      effectiveOn: '2000-01-01',
      references: [],
      sections: [
        {
          title: '테스트 개인정보처리방침',
          paragraphs: ['합성 개인정보 테스트 문서입니다. 실제 방침이 아닙니다.'],
        },
      ],
    },
  },
}
