import DOMPurify from 'dompurify'

export function cleanNoteHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['div', 'p', 'br', 'span', 'mark', 'b', 'strong', 'i', 'em', 'u', 's'],
    ALLOWED_ATTR: ['style'], ALLOW_DATA_ATTR: false,
  })
  template.content.querySelectorAll<HTMLElement>('[style]').forEach(element => {
    const background = element.style.backgroundColor
    element.removeAttribute('style')
    if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
      element.style.backgroundColor = background
    }
  })
  return template.innerHTML
}
