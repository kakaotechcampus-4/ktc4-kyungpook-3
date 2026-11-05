import { execSync } from 'node:child_process'
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { cache, frontend } from './paths.mjs'

const fontsDir = join(frontend, 'src/shared/styles/fonts')
const htmlPath = join(frontend, 'index.html')
const cssPath = join(frontend, 'src/app/styles/fonts.css')
const weights = [
  ['Light', '100 300'],
  ['Regular', '400 500'],
  ['Bold', '600 700'],
  ['ExtraBold', '800 900'],
]
const { ranges } = JSON.parse(readFileSync(join(cache, 'split.json'), 'utf8'))
const origHtml = readFileSync(htmlPath, 'utf8')
const origCss = readFileSync(cssPath, 'utf8')
const header = origCss.slice(0, origCss.indexOf('@font-face'))
const origFonts = Object.fromEntries(weights.map(([w]) => [w, readFileSync(join(fontsDir, `NanumSquare-${w}.woff2`))]))

const preload = (file) =>
  `    <link\n      rel="preload"\n      as="font"\n      type="font/woff2"\n      crossorigin\n      href="/src/shared/styles/fonts/${file}"\n    />\n`
const html = (files) =>
  origHtml.replace(/ {4}<link\n {6}rel="preload"[\s\S]*?\/>\n/g, '').replace('  </head>', files.map(preload).join('') + '  </head>')
const face = (file, weight, range) =>
  `@font-face {\n  font-family: 'NanumSquare';\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  unicode-range: ${range};\n  src: url('../../shared/styles/fonts/${file}') format('woff2');\n}\n`

// 같은 굵기 안에서 겹치는 unicode-range 는 나중에 선언한 면을 먼저 본다. ks 를 마지막에 두어 rest 를 받지 않게 한다
const splitCss =
  header +
  weights
    .map(([w, weight]) => ['rest', 'base', 'ks'].map((p) => face(`NanumSquare-${w}-${p}.woff2`, weight, ranges[p])).join('\n'))
    .join('\n')
const both = ['NanumSquare-Regular.woff2', 'NanumSquare-Bold.woff2']
const splitParts = (...ws) => ws.flatMap((w) => [`NanumSquare-${w}-base.woff2`, `NanumSquare-${w}-ks.woff2`])

const variants = {
  A: { preloads: both },
  B: { preloads: ['NanumSquare-Regular.woff2'] },
  C: { preloads: splitParts('Regular', 'Bold'), css: splitCss, fonts: 'split' },
  C2: { preloads: splitParts('Regular'), css: splitCss, fonts: 'split' },
  D: { preloads: [] },
  E: { preloads: both, fonts: 'opt' },
}

const only = process.argv.slice(2)
const added = []
try {
  for (const [name, v] of Object.entries(variants)) {
    if (only.length && !only.includes(name)) continue
    writeFileSync(htmlPath, html(v.preloads))
    writeFileSync(cssPath, v.css ?? origCss)
    for (const [w, buf] of Object.entries(origFonts)) writeFileSync(join(fontsDir, `NanumSquare-${w}.woff2`), buf)
    if (v.fonts === 'opt') {
      for (const [w] of weights) copyFileSync(join(cache, 'opt', `NanumSquare-${w}.woff2`), join(fontsDir, `NanumSquare-${w}.woff2`))
    }
    if (v.fonts === 'split') {
      for (const [w] of weights)
        for (const p of ['base', 'ks', 'rest']) {
          const f = `NanumSquare-${w}-${p}.woff2`
          copyFileSync(join(cache, 'split', f), join(fontsDir, f))
          added.push(join(fontsDir, f))
        }
    }
    const outDir = relative(frontend, join(cache, `dist-${name}`))
    execSync(`npx vite build --outDir "${outDir}" --emptyOutDir --logLevel error`, { cwd: frontend, stdio: 'inherit', shell: true })
    console.log('BUILT', name, outDir)
  }
} finally {
  writeFileSync(htmlPath, origHtml)
  writeFileSync(cssPath, origCss)
  for (const [w, buf] of Object.entries(origFonts)) writeFileSync(join(fontsDir, `NanumSquare-${w}.woff2`), buf)
  for (const f of added) rmSync(f, { force: true })
}
