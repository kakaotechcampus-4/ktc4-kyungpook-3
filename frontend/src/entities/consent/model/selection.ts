export interface ConsentSelection {
  terms: boolean
  privacy: boolean
}

export const emptyConsentSelection = (): ConsentSelection => ({ terms: false, privacy: false })
