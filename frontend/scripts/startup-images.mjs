/**
 * iOS 설치한 앱 시작 이미지(apple-touch-startup-image)를 만든다 (#430).
 *
 *   node scripts/startup-images.mjs   # 또는 npm run startup-images
 *
 * public/splash/ 를 지우고 다시 채운 뒤, index.html <head> 에 넣을 <link> 줄을 stdout 에 찍는다.
 *
 * 마스코트는 src/shared/ui/mascot/Mascot.tsx 를 그대로 그린다(idle·ink). 그림을 따로 두면 마스코트를
 * 고칠 때 시작 이미지만 옛 모양으로 남는다.
 *
 * 크기는 앱 안 스플래시와 같은 CSS 값(src/app/splash/splashSize.ts)을 기기 픽셀 비율로
 * 찍는다. 화면 짧은 변에 비례해 키우면 iPad 에서 시작 이미지가 사라지고 웹 스플래시가 뜨는 순간
 * 마스코트가 작아지며 튄다.
 *
 * 기기 목록은 iOS 26·iPadOS 26 지원 기기와 그 뒤 나온 기기다. iOS 는 media 가 맞는 이미지가 없으면
 * 흰 화면을 보이므로, 목록에서 빠진 기기도 깨지지 않고 마스코트만 없다.
 * - iPhone 은 세로만 만든다. 지원 iPhone 의 홈 화면은 가로로 돌지 않아 앱이 세로로 시작한다.
 * - iPad 는 홈 화면이 가로로도 돌고 가로로 쓰는 일이 흔해 가로도 만든다. media 의 device-width·height 는
 *   방향과 무관하게 세로 기준 값이고 orientation 만 다르다.
 */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = fileURLToPath(new URL('../public/splash/', import.meta.url))
const FONT_FILE = new URL('../src/shared/styles/fonts/NanumSquare-Bold.woff2', import.meta.url)

const WORDMARK = "Manager's Manager"

/** CSS 픽셀 세로 크기와 기기 픽셀 비율. 같은 값을 쓰는 기기는 한 줄에 묶는다 */
const PHONES = [
  { devices: 'iPhone SE 2·3세대', width: 375, height: 667, ratio: 2 },
  { devices: 'iPhone 11', width: 414, height: 896, ratio: 2 },
  { devices: 'iPhone 11 Pro, 12 mini, 13 mini', width: 375, height: 812, ratio: 3 },
  { devices: 'iPhone 11 Pro Max', width: 414, height: 896, ratio: 3 },
  { devices: 'iPhone 12, 12 Pro, 13, 13 Pro, 14, 16e, 17e', width: 390, height: 844, ratio: 3 },
  { devices: 'iPhone 12 Pro Max, 13 Pro Max, 14 Plus', width: 428, height: 926, ratio: 3 },
  { devices: 'iPhone 14 Pro, 15, 15 Pro, 16', width: 393, height: 852, ratio: 3 },
  { devices: 'iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus', width: 430, height: 932, ratio: 3 },
  { devices: 'iPhone 16 Pro, 17, 17 Pro', width: 402, height: 874, ratio: 3 },
  { devices: 'iPhone Air', width: 420, height: 912, ratio: 3 },
  { devices: 'iPhone 16 Pro Max, 17 Pro Max', width: 440, height: 956, ratio: 3 },
]

const TABLETS = [
  { devices: 'iPad mini 6·7세대', width: 744, height: 1133, ratio: 2 },
  { devices: 'iPad mini 5세대', width: 768, height: 1024, ratio: 2 },
  { devices: 'iPad 8·9세대', width: 810, height: 1080, ratio: 2 },
  {
    devices: 'iPad 10세대, iPad (A16), iPad Air 4·5세대, iPad Air 11 (M2·M3)',
    width: 820,
    height: 1180,
    ratio: 2,
  },
  { devices: 'iPad Air 3세대', width: 834, height: 1112, ratio: 2 },
  { devices: 'iPad Pro 11 (1~4세대)', width: 834, height: 1194, ratio: 2 },
  { devices: 'iPad Pro 11 (M4·M5)', width: 834, height: 1210, ratio: 2 },
  { devices: 'iPad Pro 12.9 (3~6세대), iPad Air 13 (M2·M3)', width: 1024, height: 1366, ratio: 2 },
  { devices: 'iPad Pro 13 (M4·M5)', width: 1032, height: 1376, ratio: 2 },
]

const SCREENS = [
  ...PHONES.map((device) => ({ ...device, orientation: 'portrait' })),
  ...TABLETS.flatMap((device) => [
    { ...device, orientation: 'portrait' },
    { ...device, orientation: 'landscape' },
  ]),
]

function viewport({ width, height, orientation }) {
  return orientation === 'portrait' ? { width, height } : { width: height, height: width }
}

function fileName(screen) {
  const { width, height } = viewport(screen)
  return `${width * screen.ratio}x${height * screen.ratio}.png`
}

function linkTag(screen) {
  const media = [
    `(device-width: ${screen.width}px)`,
    `(device-height: ${screen.height}px)`,
    `(-webkit-device-pixel-ratio: ${screen.ratio})`,
    `(orientation: ${screen.orientation})`,
  ].join(' and ')
  return `<link rel="apple-touch-startup-image" media="${media}" href="/splash/${fileName(screen)}" />`
}

async function loadSplash() {
  const vite = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
  })
  try {
    const { Mascot } = await vite.ssrLoadModule('/src/shared/ui/mascot/Mascot.tsx')
    const { SPLASH_SIZE } = await vite.ssrLoadModule('/src/app/splash/splashSize.ts')
    const mascot = renderToStaticMarkup(
      createElement(Mascot, { pose: 'idle', palette: 'ink', size: SPLASH_SIZE.mascot }),
    )
    return { mascot, size: SPLASH_SIZE }
  } finally {
    await vite.close()
  }
}

function pageHtml({ mascot, size }, font) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<style>
@font-face {
  font-family: 'NanumSquare';
  font-weight: 700;
  src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');
}
html, body { margin: 0; height: 100%; background: #ffffff; }
body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${size.gap}px; }
p { margin: 0; font: ${WORDMARK_FONT}; line-height: 1.2; color: #171717; }
</style>
</head>
<body>${mascot}<p>${WORDMARK}</p></body>
</html>`
}

const [splash, font] = await Promise.all([loadSplash(), readFile(FONT_FILE)])
const WORDMARK_FONT = `700 ${splash.size.wordmark}px NanumSquare`
const html = pageHtml(splash, font)

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })

// Windows 의 LCD 서브픽셀 안티앨리어싱은 글자 가장자리에 빨강·파랑 테두리를 남긴다. 시작 이미지는 먹색 하나다
const browser = await chromium.launch({ args: ['--disable-lcd-text'] })
try {
  for (const screen of SCREENS) {
    const context = await browser.newContext({
      viewport: viewport(screen),
      deviceScaleFactor: screen.ratio,
    })
    const page = await context.newPage()
    await page.setContent(html)
    // 글꼴이 늦게 붙으면 대체 글꼴로 찍힌다. NanumSquare 가 실제로 쓰였는지 확인하고 찍는다
    const usesFont = await page.evaluate(
      `document.fonts.load(${JSON.stringify(WORDMARK_FONT)}, ${JSON.stringify(WORDMARK)})
        .then((faces) => document.fonts.ready.then(() => faces.length > 0))`,
    )
    if (!usesFont) throw new Error(`NanumSquare Bold 가 로드되지 않았다: ${fileName(screen)}`)
    await page.screenshot({ path: `${OUT_DIR}${fileName(screen)}` })
    await context.close()
    console.error(`${fileName(screen)}  ${screen.devices} (${screen.orientation})`)
  }
} finally {
  await browser.close()
}

console.log(SCREENS.map(linkTag).join('\n'))
