'use strict'
// Pure helpers of the Kozel page: where a tile's pips sit, how the chain snakes across the board, how big the tiles
// are, which ends a tile may go on, the status line, the score cards, the covers (the pause, a round's or the game's
// result), which key is which action, and whether a state is a new round, a change or a resend. No DOM and no ccPanel,
// so `test/view.test.js` runs them under node; the page loads this file as a classic script (the CSP allows only the
// plugin's own files) and reads `KozelView`.
;(function (root) {
  const has = (o, k) => (typeof k === 'string' || typeof k === 'number') && Object.prototype.hasOwnProperty.call(o, k)
  const isPip = (n) => Number.isInteger(n) && n >= 0 && n <= 6
  const isTile = (t) => !!t && typeof t === 'object' && isPip(t.a) && isPip(t.b)

  /**
   * Pip centres in one half of a standing tile (a unit square, x across, y down): the 6 in two columns of three, the 2
   * and 3 on the diagonal. A lying tile's half is the same turned a quarter (`lying`), as on a real domino.
   */
  const PIPS = {
    0: [],
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
    6: [[0.27, 0.22], [0.27, 0.5], [0.27, 0.78], [0.73, 0.22], [0.73, 0.5], [0.73, 0.78]],
  }
  function pipsOf(n, lying) {
    if (!has(PIPS, n)) return []
    return PIPS[n].map(([x, y]) => (lying ? [Math.round((1 - y) * 100) / 100, x] : [x, y]))
  }

  /** The tile's text: `6-4`. */
  const tileText = (t) => (isTile(t) ? `${t.a}-${t.b}` : '')
  const tileLabel = (t) => (isTile(t) ? `${t.a}-${t.b}${t.a === t.b ? ' (double)' : ''}` : '')

  /** The narrowest chain, in half-tile units: a row needs room for a few tiles and a turn at each side. */
  const MIN_COLS = 6

  /**
   * The chain laid out as a snake, in half-tile units, on a board `cols` units wide: rows go right, then left, then
   * right again, like text read in a zigzag, with a standing tile at each turn so neighbours always meet half to half.
   * In a row a tile lies (2 by 1) and a double stands across it (1 by 2); the turn tile stands; the tile after a turn
   * lies (a double too: there the chain runs down, so lying is across it). Rows are 2 units apart, so doubles of two
   * rows never overlap. One unit is kept free at each side for a turn tile.
   *
   * Returns `{ tiles, width, height, rows }`: per tile `{ a, b, x, y, w, h, A, B }`, `A` and `B` the top-left corners
   * of the unit squares that hold the tile's `a` and `b` halves (the chain reads from `tiles[0].A`, the left end, to the
   * last tile's `B`, the right end).
   */
  function chainLayout(chain, cols) {
    const W = Math.max(MIN_COLS, Math.floor(Number(cols) || 0))
    const out = []
    let c = 0
    let d = 1
    let line = 0.5
    let afterTurn = false
    let rows = 1
    for (const t of Array.isArray(chain) ? chain : []) {
      if (!isTile(t)) continue
      let p
      if (afterTurn) {
        p = d > 0 ? { x: c, y: line, w: 2, h: 1, A: [c, line], B: [c + 1, line] } : { x: c - 2, y: line, w: 2, h: 1, A: [c - 1, line], B: [c - 2, line] }
        c += 2 * d
        afterTurn = false
      } else {
        const dbl = t.a === t.b
        const w = dbl ? 1 : 2
        const fits = d > 0 ? c + w <= W - 1 : c - w >= 1
        if (fits) {
          const x = d > 0 ? c : c - w
          if (dbl) p = { x, y: line - 0.5, w: 1, h: 2, A: [x, line - 0.5], B: [x, line + 0.5] }
          else if (d > 0) p = { x, y: line, w: 2, h: 1, A: [x, line], B: [x + 1, line] }
          else p = { x, y: line, w: 2, h: 1, A: [x + 1, line], B: [x, line] }
          c += w * d
        } else {
          const x = d > 0 ? c : c - 1
          p = { x, y: line, w: 1, h: 2, A: [x, line], B: [x, line + 1] }
          line += 2
          rows++
          c = d > 0 ? c + 1 : c - 1
          d = -d
          afterTurn = true
        }
      }
      out.push({ a: t.a, b: t.b, ...p })
    }
    if (out.length === 0) return { tiles: [], width: 0, height: 0, rows: 0 }
    // From the top-left of what is drawn, so a row with no double has no empty strip above it.
    const minX = Math.min(...out.map((t) => t.x))
    const minY = Math.min(...out.map((t) => t.y))
    const tiles = out.map((t) => ({
      ...t,
      x: t.x - minX,
      y: t.y - minY,
      A: [t.A[0] - minX, t.A[1] - minY],
      B: [t.B[0] - minX, t.B[1] - minY],
    }))
    return {
      tiles,
      width: Math.max(...tiles.map((t) => t.x + t.w)),
      height: Math.max(...tiles.map((t) => t.y + t.h)),
      rows,
    }
  }

  /** Half-tile size bounds of the chain, in px. */
  const CHAIN_MAX = 34
  const CHAIN_MIN = 10

  /**
   * The chain's half-tile size `u` (px) and layout for a board area `width` by `height` px: the biggest size, up to
   * `max` (the hand's, so the table never looks bigger than your tiles), at which the whole snake fits; else the
   * smallest, and the area scrolls.
   */
  function chainFit(chain, width, height, max = CHAIN_MAX) {
    const w = Math.max(0, Number(width) || 0)
    const h = Math.max(0, Number(height) || 0)
    const top = Math.max(CHAIN_MIN, Math.min(CHAIN_MAX, Math.floor(Number(max) || CHAIN_MAX)))
    for (let u = top; u >= CHAIN_MIN; u--) {
      const cols = Math.floor(w / u)
      if (cols < MIN_COLS) continue
      const layout = chainLayout(chain, cols)
      if (layout.height * u <= h) return { u, cols, layout }
    }
    const cols = Math.max(MIN_COLS, Math.floor(w / CHAIN_MIN))
    return { u: CHAIN_MIN, cols, layout: chainLayout(chain, cols) }
  }

  /** Your tiles: a button is the tile (2u by u) plus its frame and padding, with a gap between buttons. */
  const HAND_PAD = 10
  const HAND_GAP = 6
  const HAND_MIN = 12
  /**
   * Your hand's half-tile size `u` and rows for `n` tiles in `width` by `height` px: one row when the tiles stay at
   * least 24 px tall, else two; never taller than the panel's height allows (a short bottom zone gets smaller tiles
   * rather than a hand cut off).
   */
  function handSize(n, width, height) {
    const count = Math.max(0, Math.floor(Number(n) || 0))
    const w = Math.max(0, Number(width) || 0)
    const hh = Math.max(0, Number(height) || 0)
    const cap = Math.max(16, Math.min(36, Math.floor(hh / 13) || 36))
    const fit = (per) => Math.floor(((w - HAND_GAP * (per - 1)) / per - HAND_PAD) / 2)
    if (count === 0) return { u: cap, rows: [] }
    let rows = [count]
    let u = fit(count)
    if (u < 24 && count > 1) {
      const per = Math.ceil(count / 2)
      rows = [per, count - per]
      u = fit(per)
    }
    return { u: Math.max(HAND_MIN, Math.min(cap, u)), rows }
  }

  /**
   * The ends a tile of your hand may go on when you must choose, as buttons `{ end, n, label }`: only for a tile that
   * fits both ends with different numbers (the host sends `at` with both). Empty otherwise.
   */
  function endChoices(state, key) {
    if (!state || !state.myTurn || !state.ends) return []
    const tile = (state.hand || []).find((t) => keyOf(t) === key)
    if (!tile || !Array.isArray(tile.at) || tile.at.length !== 2) return []
    return [
      { end: 'L', n: state.ends.l, label: `◀ Left end (${state.ends.l})` },
      { end: 'R', n: state.ends.r, label: `Right end (${state.ends.r}) ▶` },
    ]
  }

  /** The hint in an empty chain: your lead, or who opens. */
  function chainHint(state) {
    if (!state || state.chain.length > 0) return ''
    if (state.myTurn) return state.must ? 'Open with the 1-1' : 'Your lead: tap any tile'
    return 'The table is empty'
  }

  /**
   * The status line as parts `{ text, strong?, muted? }`: what just happened, then what you may do now (bold), or who
   * is thinking (muted).
   */
  function statusOf(state) {
    if (!state) return []
    const parts = []
    if (state.log) parts.push({ text: state.log })
    if (state.myTurn) {
      if (state.must) parts.push({ text: 'You hold the 1-1: open with it.', strong: true })
      else if (state.chain.length === 0) parts.push({ text: 'Your lead.', strong: true })
      else parts.push({ text: 'Your move.', strong: true })
    } else if (state.thinking && !state.paused) {
      parts.push({ text: `${state.thinking} is thinking…`, muted: true })
    }
    return parts
  }

  /** The score cards: one per team `{ name, who, total, pct, me }` (the bar toward 101) and the line under them. */
  function scoreRows(state) {
    if (!state || !Array.isArray(state.scores)) return { rows: [], foot: '' }
    const target = state.target || 101
    const rows = state.scores.map((s) => ({
      name: s.name,
      who: s.who,
      total: s.total,
      pct: Math.max(0, Math.min(100, (s.total / target) * 100)),
      me: s.me === true,
    }))
    return { rows, foot: `to ${target} · round ${state.round || 1}` }
  }

  /**
   * The cover over the board, or null for none: `{ kind, dot?, title, sub?, text?, seats?, buttons: [{ label, msg,
   * primary }] }`. The pause wins, then a round's or the game's result (which shows everyone's tiles).
   */
  function coverFor(state) {
    if (!state) return null
    if (state.paused) {
      return {
        kind: 'paused',
        dot: true,
        title: 'Claude is ready',
        text: `“${state.paused.name}” is waiting for you.`,
        buttons: [
          { label: 'Resume game', msg: { act: 'resume' }, primary: true },
          { label: 'Go to the tab', msg: { act: 'goto' }, primary: false },
        ],
      }
    }
    const r = state.result
    if (r && (state.phase === 'done' || state.phase === 'over')) {
      return {
        kind: r.kind,
        goat: r.goat === true,
        title: r.title,
        sub: r.sub || '',
        text: r.text || '',
        seats: Array.isArray(r.seats) ? r.seats : [],
        total: Array.isArray(r.total) ? r.total : [],
        buttons: [
          r.next === 'next'
            ? { label: 'Next round', msg: { act: 'next' }, primary: true }
            : { label: 'New game', msg: { act: 'new' }, primary: true },
        ],
      }
    }
    return null
  }

  /** The result cover's seats in table order: your team first (you, Partner), then Left and Right. */
  function resultOrder(seats) {
    const list = Array.isArray(seats) ? seats : []
    return [0, 2, 1, 3].filter((i) => list[i]).map((i) => ({ ...list[i], seat: i }))
  }

  const KEYS = { n: 'new', N: 'new' }
  /** The action a key asks for while the board has focus (N), or null. */
  const actOfKey = (key) => (has(KEYS, key) ? KEYS[key] : null)

  /**
   * How a state relates to the one drawn (`shown`: `{ game, seq }` or null): `reset` for another round, `change` for
   * a move, `same` for a resend (a hello's answer).
   */
  function changeOf(shown, state) {
    if (!shown || shown.game !== state.game) return 'reset'
    return shown.seq === state.seq ? 'same' : 'change'
  }

  /** A tile's key, the same for 6-4 and 4-6, for elements that stay with a tile across draws. */
  const keyOf = (t) => (isTile(t) ? `${Math.max(t.a, t.b)}${Math.min(t.a, t.b)}` : '')

  const api = {
    PIPS,
    MIN_COLS,
    CHAIN_MAX,
    CHAIN_MIN,
    isTile,
    pipsOf,
    tileText,
    tileLabel,
    chainLayout,
    chainFit,
    handSize,
    endChoices,
    chainHint,
    statusOf,
    scoreRows,
    coverFor,
    resultOrder,
    actOfKey,
    changeOf,
    keyOf,
  }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.KozelView = api
})(globalThis)
