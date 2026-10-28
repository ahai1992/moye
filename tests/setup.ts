if (!document.doctype) {
  document.insertBefore(document.implementation.createDocumentType('html', '', ''), document.documentElement)
}
