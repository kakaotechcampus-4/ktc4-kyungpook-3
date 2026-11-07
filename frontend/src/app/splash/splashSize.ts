/**
 * 스플래시 크기(CSS px, #472). index.html 의 정적 판은 JS 보다 먼저 그려야 해서 같은 값을 손으로 적어 둔다 —
 * staticSplash.test.tsx 가 둘이 같은지 본다. iOS 시작 이미지(scripts/startup-images.mjs)도 이 값으로 찍는다.
 */
export const SPLASH_SIZE = {
  mascot: 176,
  gap: 18,
  wordmark: 24,
} as const
