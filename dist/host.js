'use strict'
// Kozel for cc-cockpit: a game of Kozel (the Soviet domino game, "the goat") against computer players in a panel, to
// play while Claude works: you and your partner against Left and Right, to 101. The game lives here in the host
// (lib/controller.js), one per project window, and so do the computer players: their moves run on a timer here, and
// the panel page only draws what it is sent and posts your moves. Closing, hiding or reopening the panel never loses
// or unpauses a game.
//
// Harmless by design: no exec, no network, no secrets, no overlays, and nothing is ever typed into or sent to a
// session. Its only calls on Claude tabs are reading the window's list (ctx.sessions.list / onChange) for the pause
// and `ctx.sessions.focus` for the person's own Go to the tab click.

const { createController } = require('../lib/controller.js')

const PANEL = 'kozel'
const KINDS = ['won', 'lost']

let disposers = []

exports.activate = (ctx) => {
  // Records are app-wide (every project window plays the same records); an app without ctx.appStorage keeps them per
  // project instead.
  const store = typeof ctx.appStorage === 'object' && ctx.appStorage !== null ? ctx.appStorage : ctx.storage
  const controller = createController()

  // The title bar: New game as an icon button, the game score as its muted text.
  let headerKey = ''
  function header() {
    const meta = controller.meta()
    if (meta === headerKey) return
    headerKey = meta
    try {
      ctx.panels.header(PANEL, { meta, actions: [{ id: 'new', icon: 'refresh', title: 'New game (N)' }] })
    } catch (err) {
      ctx.log.warn(`could not set the panel header: ${err && err.message}`)
    }
  }

  // One timer for the computer players: armed for the state `nextStep` names, dropped when that state is gone (a
  // move, a new round), the game paused, or no view shows the panel.
  let timer = null
  let timerKey = null
  function stopTimer() {
    clearTimeout(timer)
    timer = null
    timerKey = null
  }
  function schedule() {
    const next = controller.nextStep()
    if (!next) return stopTimer()
    if (timer && timerKey === next.key) return
    stopTimer()
    timerKey = next.key
    timer = setTimeout(() => {
      timer = null
      timerKey = null
      handle(controller.step())
    }, next.ms)
  }
  disposers.push(stopTimer)

  /** A step's or a move's result: the new state to every view, and a game's end to the records. */
  function handle(result) {
    if (result.changed) push()
    else schedule()
    if (result.outcome) saveOutcome(result.outcome)
  }

  function push() {
    header()
    ctx.panels.post(PANEL, { state: controller.snapshot() })
    schedule()
  }
  header()
  /** To the one page that asked (`from.view`), or to every view when the app gave none. */
  const answer = (message, from) =>
    from && typeof from.view === 'string' ? ctx.panels.post(PANEL, message, { view: from.view }) : ctx.panels.post(PANEL, message)
  const viewOf = (from) => (from && typeof from.view === 'string' ? from.view : 'desktop')

  async function load() {
    const stored = {}
    for (const kind of KINDS) stored[kind] = await store.get(kind)
    controller.setStats(stored)
  }
  // activate's return value is ignored, so messages can come before the store answered: each waits for it.
  const loaded = load().catch((err) => ctx.log.warn(`could not read the records: ${err && err.message}`))

  // A result counts in storage with `increment` (atomic across windows), one save at a time, in order; the stored
  // total then raises this window's count (other windows' games included).
  let saving = Promise.resolve()
  function saveOutcome({ kind }) {
    saving = saving.then(async () => {
      try {
        const total = typeof store.increment === 'function' ? await store.increment(kind) : await bump(kind)
        if (controller.setStats({ [kind]: total })) push()
      } catch (err) {
        ctx.log.warn(`could not save the records: ${err && err.message}`)
      }
    })
    return saving
  }
  /** `increment` for a store without it (ctx.storage has one writer, the project's host). */
  async function bump(key) {
    const v = await store.get(key)
    const next = (typeof v === 'number' && Number.isFinite(v) ? v : 0) + 1
    await store.set(key, next)
    return next
  }

  if (typeof ctx.panels.onAction === 'function') {
    disposers.push(
      ctx.panels.onAction(PANEL, async (id) => {
        await loaded
        if (id === 'new') handle(controller.act({ act: 'new' }))
      }),
    )
  }

  disposers.push(
    ctx.panels.onMessage(PANEL, async (msg, from) => {
      await loaded
      if (!msg || typeof msg !== 'object') return
      if (msg.hello) {
        controller.setShown(viewOf(from), msg.visible !== false)
        // Every view hears it: the computer players may have started moving for all of them.
        push()
        return
      }
      if (msg.act === 'seen') {
        if (controller.setShown(viewOf(from), msg.visible === true)) push()
        return
      }
      if (msg.act === 'goto') {
        // Returned (awaited) from the listener, so the focus acts in the view the click came from.
        const tabId = controller.pausedTab()
        if (!tabId) return
        const ok = await ctx.sessions.focus(tabId).catch(() => false)
        if (!ok) answer({ notice: 'That Claude tab is closed.' }, from)
        return
      }
      const result = controller.act(msg)
      if (result.changed) handle(result)
    }),
  )

  // A page gone (the panel hidden or closed in that view) stops the computer players unless another view still shows
  // it. The page cannot say so itself: it is unmounted. An app without ctx.views only has the page's visibility.
  if (typeof ctx.views === 'object' && ctx.views !== null && typeof ctx.views.onChange === 'function') {
    disposers.push(
      ctx.views.onChange(({ view, access }) => {
        if (access === undefined && controller.setShown(view, undefined)) push()
      }),
    )
  }

  // The pause: every change of this window's Claude tabs (statuses included) comes as the whole list. The first list
  // is read once at start so a tab already working then is known when it turns to waiting; an onChange that came
  // first is newer, so the start list is dropped then.
  let changeSeen = false
  disposers.push(
    ctx.sessions.onChange((list) => {
      changeSeen = true
      if (controller.sessions(list)) push()
    }),
  )
  ctx.sessions
    .list()
    .then((list) => {
      if (!changeSeen) controller.sessions(list)
    })
    .catch((err) => ctx.log.warn(`could not list the Claude tabs: ${err && err.message}`))
}

exports.deactivate = () => {
  for (const dispose of disposers) {
    try {
      if (typeof dispose === 'function') dispose()
    } catch {
      // the host is stopping anyway
    }
  }
  disposers = []
}
