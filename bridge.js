// Link the restored studio to its founder's personal site without changing the original app.
const configured = document.querySelector('meta[name="personal-site-url"]')?.content.trim()
const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
const relativeUrl = new URL('../#/studio', location.href).href
const personalUrl = localPreview
  ? (['2220', '2221'].includes(location.port) ? 'http://127.0.0.1:2219/#/studio' : relativeUrl)
  : (configured || relativeUrl)

document.querySelectorAll('[data-personal-link]').forEach(link => {
  link.href = personalUrl
  link.rel = 'noopener'
})
