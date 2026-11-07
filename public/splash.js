// Progress is driven by the main process via window.setProgress(0..100) at real startup steps.
// Between steps the bar creeps forward slowly so it never looks frozen, but never past the next step.
;(() => {
  const fill = document.getElementById('fill')
  const bar = fill.parentElement
  let reported = 0
  let shown = 0

  const render = () => {
    fill.style.width = `${shown}%`
    bar.setAttribute('aria-valuenow', String(Math.round(shown)))
  }

  window.setProgress = (value) => {
    reported = Math.max(reported, Math.min(100, Number(value) || 0))
    shown = Math.max(shown, reported)
    render()
  }

  setInterval(() => {
    const ceiling = reported >= 100 ? 100 : Math.min(reported + 18, 95)
    if (shown < ceiling) {
      shown = Math.min(ceiling, shown + 0.6)
      render()
    }
  }, 60)
})()
