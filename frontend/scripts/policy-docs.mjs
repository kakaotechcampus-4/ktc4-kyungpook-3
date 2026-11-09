import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { publishedPolicies } from '../src/shared/config/publishedPolicies.ts'

const backend = readFileSync(
  new URL('../../backend/app/services/consents.py', import.meta.url),
  'utf8',
)
const declaration = backend.match(/CURRENT_VERSIONS[^=]*=\s*\{([^}]+)\}/)?.[1] ?? ''
for (const [kind, key] of [
  ['terms', 'TERMS'],
  ['privacy', 'PRIVACY'],
]) {
  const serverVersion = declaration.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`))?.[1]
  if (serverVersion !== publishedPolicies[kind].version) {
    throw new Error(`${kind}: FE 정책 판본과 BE CURRENT_VERSIONS를 함께 변경하세요.`)
  }
}

for (const [kind, document] of Object.entries(publishedPolicies)) {
  const title = kind === 'terms' ? '이용약관' : '개인정보처리방침'
  const text =
    [
      `# ${title}`,
      `판본: ${document.version} · 시행일: ${document.effectiveOn}`,
      ...document.sections.flatMap(({ title: sectionTitle, paragraphs }) => [
        `## ${sectionTitle}`,
        ...paragraphs,
      ]),
      '## 공식 참고 자료와 문의',
      document.references.map(({ label, href }) => `- [${label}](${href})`).join('\n'),
    ].join('\n\n') + '\n'
  const url = new URL(`../../docs/policy/${kind}.md`, import.meta.url)
  if (process.argv.includes('--check')) {
    if (readFileSync(url, 'utf8').replaceAll('\r\n', '\n') !== text) {
      throw new Error(`${fileURLToPath(url)}: npm run policy:docs로 사이트 본문과 문서를 맞추세요.`)
    }
  } else {
    writeFileSync(url, text)
  }
}
