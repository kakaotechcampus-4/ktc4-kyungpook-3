/** 글을 파일로 내려받게 한다. 임시 링크를 눌러 브라우저 저장을 띄우고 바로 치운다 */
export function saveTextFile(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    // 같은 틱에 해제하면 일부 브라우저(구형 Safari)가 내려받기를 시작하기 전에 URL 을 잃는다
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
