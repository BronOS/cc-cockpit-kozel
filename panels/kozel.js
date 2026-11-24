'use strict'
// The Kozel panel page. It draws the state the host sends and posts your moves; the game, the computer players and the
// Claude pause live in the host (lib/controller.js), so this page can be closed or hidden at any time. The host marks
// which of your tiles may be played now and on which ends, so the page needs no rules of its own; the host checks
// every move again. Only the shake of a tile that may not be played and the pick of an end are the page's own.
//
// Everything sits in one IIFE: a top-level `const top` (or any name a window property already holds: `name`, `open`,
// `history`) in a classic script throws and kills the whole page.
;(function () {
  const V = globalThis.KozelView
  const SVG = 'http://www.w3.org/2000/svg'
  const $ = (id) => document.getElementById(id)
  const felt = $('felt')
  const cover = $('cover')
  const mid = $('mid')
  const chainSvg = $('chain')

  let state = null
  let shown = null // { game, seq } of the state drawn
  let notice = '' // a refusal for this page (Go to the tab on a closed tab), until the next state
  /** The key of your tile picked to go on an end you choose (it fits both), or null. */
  let picked = null
  /** The chain's tiles drawn last, by key, so a tile new in the chain fades in once. */
  let inChain = new Set()

  const post = (message) => ccPanel.post(message)

  // ---- drawing ----

  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG, name)
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v))
    return el
  }

  /**
   * One tile into `parent` (an svg in half-tile units): its face, the bar between the halves and the pips, `a` in the
   * square at `A` and `b` at `B`. Lying when 2 wide, standing when 2 tall.
   */
  function drawTile(parent, t) {
    const g = svgEl('g', { class: 'tile-g' })
    g.append(svgEl('rect', { class: 'face', x: t.x + 0.04, y: t.y + 0.04, width: t.w - 0.08, height: t.h - 0.08, rx: 0.14 }))
    const lying = t.w === 2
    if (lying) g.append(svgEl('line', { class: 'split', x1: t.x + 1, y1: t.y + 0.16, x2: t.x + 1, y2: t.y + t.h - 0.16 }))
    else g.append(svgEl('line', { class: 'split', x1: t.x + 0.16, y1: t.y + 1, x2: t.x + t.w - 0.16, y2: t.y + 1 }))
    for (const [n, at] of [[t.a, t.A], [t.b, t.B]]) {
      for (const [px, py] of V.pipsOf(n, lying)) g.append(svgEl('circle', { class: 'pip', cx: at[0] + px, cy: at[1] + py, r: 0.085 }))
    }
    parent.append(g)
    return g
  }

  /** A lying tile on its own, `u` px a half, high half first: your hand and the revealed hands. */
  function tileSvg(tile, u) {
    const s = svgEl('svg', { viewBox: '0 0 2 1', width: 2 * u, height: u, 'aria-hidden': 'true' })
    drawTile(s, { a: tile.a, b: tile.b, x: 0, y: 0, w: 2, h: 1, A: [0, 0], B: [1, 0] })
    return s
  }

  function drawScores() {
    const box = $('scores')
    box.replaceChildren()
    const { rows, foot } = V.scoreRows(state)
    for (const r of rows) {
      const card = document.createElement('div')
      card.className = `team${r.me ? ' me-side' : ''}`
      const label = document.createElement('small')
      label.textContent = `${r.name} · ${r.who}`
      const total = document.createElement('b')
      total.textContent = String(r.total)
      const bar = document.createElement('div')
      bar.className = 'bar'
      const fill = document.createElement('i')
      fill.style.width = `${r.pct}%`
      bar.append(fill)
      card.append(label, total, bar)
      card.title = `${r.who}: ${r.total} of ${state.target}`
      box.append(card)
    }
    const f = document.createElement('div')
    f.className = 'sfoot'
    f.textContent = foot
    box.append(f)
  }

  function drawSeat(i) {
    const seat = state.seats[i]
    const el = $(`seat${i}`)
    el.classList.toggle('turn', seat.turn)
    el.replaceChildren()
    const nm = document.createElement('span')
    nm.className = 'nm'
    const name = document.createElement('b')
    name.textContent = seat.name
    const n = document.createElement('span')
    n.className = 'n'
    n.textContent = String(seat.count)
    nm.append(name, n)
    nm.title = `${seat.name}: ${seat.count} ${seat.count === 1 ? 'tile' : 'tiles'}${seat.turn ? ', to play' : ''}`
    const backs = document.createElement('div')
    backs.className = 'backs'
    for (let k = 0; k < seat.count; k++) {
      const b = document.createElement('i')
      b.className = 'back'
      backs.append(b)
    }
    el.append(nm, backs)
  }

  /** The chain as a snake sized to the board; the open ends marked while you pick one for a tile. */
  function drawChain(kind, handU) {
    chainSvg.replaceChildren()
    const w = mid.clientWidth - 8
    const h = mid.clientHeight - 8
    const { u, layout } = V.chainFit(state.chain, w, h, Math.round(handU * 0.9))
    chainSvg.setAttribute('viewBox', `0 0 ${Math.max(1, layout.width)} ${Math.max(1, layout.height)}`)
    chainSvg.setAttribute('width', String(layout.width * u))
    chainSvg.setAttribute('height', String(layout.height * u))
    const now = new Set()
    for (const t of layout.tiles) {
      const key = V.keyOf(t)
      now.add(key)
      const g = drawTile(chainSvg, t)
      if (kind === 'change' && !inChain.has(key)) g.classList.add('new')
    }
    inChain = now
    // The ends you may choose: a dashed ring on each, which takes a click like the buttons under the board.
    const choices = picked ? V.endChoices(state, picked) : []
    if (choices.length === 2 && layout.tiles.length > 0) {
      const first = layout.tiles[0]
      const last = layout.tiles[layout.tiles.length - 1]
      for (const [end, at] of [['L', first.A], ['R', last.B]]) {
        const ring = svgEl('rect', { class: 'endmark', x: at[0] + 0.02, y: at[1] + 0.02, width: 0.96, height: 0.96, rx: 0.18 })
        ring.dataset.end = end
        const title = svgEl('title')
        title.textContent = end === 'L' ? 'Play on the left end' : 'Play on the right end'
        ring.append(title)
        chainSvg.append(ring)
      }
    }
    const hint = V.chainHint(state)
    $('hint').textContent = hint
    $('hint').hidden = hint === ''
    chainSvg.hidden = layout.tiles.length === 0
  }

  function drawStatus() {
    const st = $('status')
    st.replaceChildren()
    for (const part of V.statusOf(state)) {
      const el = document.createElement(part.strong ? 'b' : part.muted ? 'small' : 'span')
      el.textContent = part.text
      if (st.childNodes.length > 0) st.append(' ')
      st.append(el)
    }
  }

  function drawEnds() {
    const box = $('ends')
    box.replaceChildren()
    for (const c of picked ? V.endChoices(state, picked) : []) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'cc-primary'
      b.textContent = c.label
      b.dataset.end = c.end
      box.append(b)
    }
  }

  /** Your hand; returns the half-tile size it used, which caps the chain's. */
  function drawHand() {
    const me = $('me')
    me.classList.toggle('turn', !!state.myTurn)
    const mine = $('mine')
    const you = document.createElement('b')
    you.textContent = 'You'
    const n = document.createElement('span')
    n.className = 'n'
    n.textContent = String(state.hand.length)
    mine.replaceChildren(you, n)

    const box = $('hand')
    // Keyboard focus stays with its tile across a redraw (the elements are new each time).
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.key : null
    box.replaceChildren()
    const { u, rows } = V.handSize(state.hand.length, felt.clientWidth - 24, felt.clientHeight)
    let k = 0
    let refocus = null
    for (const count of rows) {
      const row = document.createElement('div')
      row.className = 'row'
      for (let j = 0; j < count; j++, k++) {
        const tile = state.hand[k]
        const key = V.keyOf(tile)
        const b = document.createElement('button')
        b.type = 'button'
        b.className = `tile ${tile.ok ? 'ok' : tile.dim ? 'no' : 'idle'}${key === picked ? ' sel' : ''}`
        b.dataset.key = key
        b.title = V.tileLabel(tile)
        b.setAttribute('aria-label', `${V.tileLabel(tile)}${tile.ok ? ', playable' : ''}`)
        if (!tile.ok) b.setAttribute('aria-disabled', 'true')
        b.append(tileSvg(tile, u))
        if (key === focused) refocus = b
        row.append(b)
      }
      box.append(row)
    }
    if (refocus) refocus.focus({ preventScroll: true })
    else if (focused) felt.focus({ preventScroll: true })
    return u
  }

  /** The result's table: each player's tiles left and their pips, your side first. */
  function seatsTable(spec) {
    const t = document.createElement('table')
    for (const s of V.resultOrder(spec.seats)) {
      const tr = document.createElement('tr')
      if (s.team === 0) tr.className = 'us'
      const name = document.createElement('td')
      name.className = 'who'
      name.textContent = s.name
      if (s.out || s.low) {
        const mark = document.createElement('span')
        mark.className = 'mark'
        mark.textContent = s.out ? 'out' : 'fewest'
        name.append(' ', mark)
      }
      const tiles = document.createElement('td')
      tiles.className = 'tiles'
      if (s.tiles.length === 0) tiles.textContent = '–'
      for (const tile of s.tiles) tiles.append(tileSvg(tile, 11))
      const pips = document.createElement('td')
      pips.className = 'pips'
      pips.textContent = String(s.pips)
      tr.append(name, tiles, pips)
      t.append(tr)
    }
    return t
  }

  let coverButtons = []
  function drawCover() {
    const spec = V.coverFor(state)
    if (!spec) {
      if (!cover.hidden && cover.contains(document.activeElement)) felt.focus({ preventScroll: true })
      cover.hidden = true
      cover.textContent = ''
      coverButtons = []
      return
    }
    cover.className = `cover ${spec.kind}`
    cover.textContent = ''
    if (spec.goat) {
      const goat = document.createElement('div')
      goat.className = 'goat'
      goat.textContent = '🐐'
      goat.setAttribute('aria-hidden', 'true')
      cover.append(goat)
    }
    const big = document.createElement('div')
    big.className = 'big'
    if (spec.dot) {
      const dot = document.createElement('span')
      dot.className = 'dot'
      big.append(dot)
    }
    // Plain text only: a tab's name is never put into HTML.
    big.append(spec.title)
    cover.append(big)
    for (const line of [spec.sub, spec.text]) {
      if (!line) continue
      const el = document.createElement('div')
      el.className = 'what'
      el.textContent = line
      cover.append(el)
    }
    if (spec.seats && spec.seats.length > 0) {
      const wrap = document.createElement('div')
      wrap.className = 'sheet'
      wrap.append(seatsTable(spec))
      cover.append(wrap)
    }
    if (spec.total && spec.total.length === 2) {
      const tot = document.createElement('div')
      tot.className = 'what tot'
      tot.textContent = `Game: Us ${spec.total[0]} : ${spec.total[1]} Them`
      cover.append(tot)
    }
    if (notice) {
      const line = document.createElement('div')
      line.className = 'cc-error-line'
      line.textContent = notice
      cover.append(line)
    }
    const row = document.createElement('div')
    row.className = 'buttons'
    coverButtons = spec.buttons
    spec.buttons.forEach((b, k) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = b.label
      btn.dataset.k = String(k)
      if (b.primary) btn.className = 'cc-primary'
      row.append(btn)
    })
    cover.append(row)
    cover.hidden = false
    // The board keeps the keyboard: Enter on the board presses the cover's main button.
  }

  function draw() {
    if (!state) return
    const kind = V.changeOf(shown, state)
    $('loading').hidden = true
    // A pick holds only while it is still your move with that tile fitting both ends.
    if (picked && V.endChoices(state, picked).length !== 2) picked = null
    drawScores()
    for (const i of [1, 2, 3]) drawSeat(i)
    // The backs follow your tiles' size, so the table scales as one.
    const handU = drawHand()
    felt.style.setProperty('--u', `${handU}px`)
    felt.style.setProperty('--bu', `${Math.max(6, Math.min(14, Math.round(handU * 0.42)))}px`)
    drawStatus()
    drawEnds()
    drawChain(kind, handU)
    drawCover()
    const stats = state.stats || {}
    $('won').textContent = String(stats.won || 0)
    $('lost').textContent = String(stats.lost || 0)
    for (const id of ['won', 'lost']) $(id).parentElement.title = `games to ${state.target}`
    shown = { game: state.game, seq: state.seq }
  }

  // ---- the host ----

  ccPanel.onMessage((message) => {
    if (!message || typeof message !== 'object') return
    if (message.state) {
      state = message.state
      notice = ''
      draw()
    } else if (typeof message.notice === 'string') {
      notice = message.notice
      drawCover()
    }
  })
  // Each new connection (the first one, a host restart) asks for the whole state and says whether the page is on
  // screen (the computer players move only while some view shows the board); an app without onConnect gets one ask.
  const hello = () => post({ hello: 1, visible: !document.hidden })
  if (typeof ccPanel.onConnect === 'function') ccPanel.onConnect(hello)
  else hello()
  document.addEventListener('visibilitychange', () => post({ act: 'seen', visible: !document.hidden }))
  // The panel being hidden or closed unmounts the page; the host also learns it from ctx.views. Best effort.
  window.addEventListener('pagehide', () => post({ act: 'seen', visible: false }))

  let resizeFrame = 0
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      if (!state) return
      shown = { game: state.game, seq: state.seq } // a resize is no move: nothing fades in
      draw()
    })
  }).observe(felt)

  // ---- input ----

  function shake(el) {
    el.classList.remove('shake')
    void el.offsetWidth
    el.classList.add('shake')
  }

  function playOn(key, end) {
    const tile = state && state.hand.find((t) => V.keyOf(t) === key)
    if (!tile) return
    picked = null
    post({ act: 'play', tile: { a: tile.a, b: tile.b }, end })
  }

  /**
   * A tap on one of your tiles: play it when it fits one end, pick it when it fits both, shake it when it cannot go.
   * `byKey`: Enter or Space on the tile, so the first end button takes the keyboard.
   */
  function tapTile(el, byKey) {
    if (!state || !state.myTurn) return
    const key = el.dataset.key
    const tile = state.hand.find((t) => V.keyOf(t) === key)
    if (!tile) return
    if (!tile.ok) return shake(el)
    if (tile.at.length === 1) return playOn(key, tile.at[0])
    picked = picked === key ? null : key
    draw()
    const first = $('ends').querySelector('button')
    if (first && byKey) first.focus({ preventScroll: true })
  }

  felt.addEventListener('click', (e) => {
    const tileEl = e.target.closest('#hand .tile')
    // A click from Enter or Space has no pointer detail.
    if (tileEl) return tapTile(tileEl, e.detail === 0)
    const endBtn = e.target.closest('#ends button[data-end], #chain .endmark')
    if (endBtn && picked) {
      playOn(picked, endBtn.dataset.end)
      felt.focus({ preventScroll: true })
      return
    }
    if (picked && !e.target.closest('#ends')) {
      picked = null
      draw()
    }
  })

  // Keys only while the board (or one of your tiles) has focus, and only these; everything else goes on to the app.
  felt.addEventListener('keydown', (e) => {
    if (!state || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Enter' && e.target === felt && !cover.hidden) {
      const primary = cover.querySelector('button.cc-primary')
      if (primary) {
        e.preventDefault()
        primary.click()
      }
      return
    }
    if (e.key === 'Escape' && picked) {
      e.preventDefault()
      picked = null
      draw()
      felt.focus({ preventScroll: true })
      return
    }
    const act = V.actOfKey(e.key)
    if (!act) return
    e.preventDefault()
    picked = null
    post({ act })
  })

  cover.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-k]')
    if (!btn) return
    const b = coverButtons[Number(btn.dataset.k)]
    if (!b) return
    post(b.msg)
    // The cover goes; the board takes the keyboard back.
    if (b.msg.act !== 'goto') felt.focus({ preventScroll: true })
  })
})()
