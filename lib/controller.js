'use strict'
// One project window's game: the rounds (lib/rules.js), the computer players (lib/bots.js), the Claude pause and the
// records, with no ctx and no timers in it (`rng` injected), so `test/controller.test.js` drives it step by step.
// dist/host.js wires it to ctx: page messages in, `snapshot()` out to every view, session lists and shown views in,
// records out to storage, and `step()` called on a timer whenever `nextStep()` asks for one.
//
// The computer players move only while some view shows the panel and the game is not paused: hiding the panel unmounts
// its page, and a move made while nobody looks would be a move you never saw. Each one waits about 650 ms; a round that
// just ended stays on the table 900 ms before its score comes up, so you see the last tile go down.

const R = require('./rules.js')
const bots = require('./bots.js')
const { createReadyWatch } = require('./pause.js')

const STEP_MS = 650
const END_MS = 900
const OUTCOMES = Object.freeze(['won', 'lost'])

/** The title bar's muted text: the game score, `Us 45 : 30 Them · to 101`. */
const headerMeta = (total) => `Us ${total[0]} : ${total[1]} Them · to ${R.TARGET}`

/**
 * `round(m, rng)` makes each round of a game (rules.newRound; tests give it stacked sets of their own) and `match()`
 * each game (rules.newMatch).
 */
function createController({ rng = Math.random, round = R.newRound, match = R.newMatch } = {}) {
  let m = match()
  let g = round(m, rng)
  /** Counts rounds, so the page knows a new round from a move on the one it drew. */
  let gameNo = 1
  /** Counts changes of the game, so a timer armed for one state is not run on another. */
  let seq = 1
  /** The Claude tab the pause is about, `{ tabId, name }`, or null when the game is not paused. */
  let paused = null
  let started = false // you made a move in this game
  let counted = false // this game's result went to the records
  /** view -> whether its page is on screen. A view is in it from its page's hello until the page is gone. */
  const shown = new Map()
  /** Your games won and lost (app-wide, from storage and this window). */
  const stats = { won: 0, lost: 0 }
  const watch = createReadyWatch()

  const anyShown = () => [...shown.values()].some(Boolean)
  const held = () => paused !== null
  const myTurn = () => !held() && g.phase === 'play' && g.turn === R.YOU
  /** In play for the pause: you made a move, and the game is neither over nor waiting on your Next round. */
  const inPlay = () => started && !m.over && (g.phase === 'play' || g.phase === 'end')
  /** A step the host runs on a timer: a computer player's move, or scoring a round that ended. */
  const stepDue = () => g.phase === 'end' || (g.phase === 'play' && g.turn !== R.YOU)

  function newMatch() {
    m = match()
    g = round(m, rng)
    gameNo++
    seq++
    paused = null
    started = false
    counted = false
  }

  function nextRound() {
    g = round(m, rng)
    gameNo++
    seq++
  }

  /** The game's result for you, once, when it was just decided (`{ kind }`); the host stores it. */
  function withOutcome(result) {
    if (!m.over || counted) return result
    counted = true
    const kind = m.winner === 0 ? 'won' : 'lost'
    stats[kind]++
    return { ...result, outcome: { kind } }
  }

  /**
   * Your hand as the page draws it, high to low from the left, each tile with whether it may be played now and on
   * which ends (`at`). A tile that fits both ends offers both only when they show different numbers: on equal ends
   * either way leaves the same two numbers open.
   */
  function handView() {
    const mine = myTurn() ? R.movesOf(g, R.YOU) : []
    const e = R.endsOf(g)
    return R.sortedHand(g.players[R.YOU].hand).map((t) => {
      let at = mine.filter((x) => R.same(x.tile, t)).map((x) => x.end)
      if (at.length === 2 && e && e.l === e.r) at = ['R']
      return { a: t.a, b: t.b, ok: at.length > 0, dim: myTurn() && at.length === 0, at }
    })
  }

  /** The cover's content once a round is scored or the game is over: a title, a line, everyone's tiles. */
  function resultView() {
    if ((g.phase !== 'done' && g.phase !== 'over') || !g.result) return null
    const r = g.result
    const who = (p) => R.NAMES[p]
    let title
    let text
    if (r.kind === 'out') {
      title = r.by === R.YOU ? 'You went out!' : `${who(r.by)} went out.`
      text = `${R.TEAM_NAMES[r.team]} score ${r.points}: the pips left in ${r.team === 0 ? 'Left’s and Right’s' : 'your and Partner’s'} hands.`
    } else if (r.tie) {
      title = 'Fish, and a tie.'
      const names = r.tied.map(who)
      text = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} hold the fewest pips (${r.low}). Nobody scores; ${who(m.leader)} ${m.leader === R.YOU ? 'open' : 'opens'} again.`
    } else {
      title = 'Fish: nobody can play.'
      text = `${who(r.by)} ${r.by === R.YOU ? 'hold' : 'holds'} the fewest pips (${r.low}). ${R.TEAM_NAMES[r.team]} score ${r.points}, the opponents’ pips.`
    }
    const kind = r.tie ? 'draw' : r.team === 0 ? 'won' : 'lost'
    const seats = g.players.map((p, i) => ({
      name: p.name,
      team: R.teamOf(i),
      tiles: R.sortedHand(p.hand),
      pips: r.sums[i],
      out: r.kind === 'out' && r.by === i,
      low: r.kind === 'fish' && (r.by === i || r.tied.includes(i)),
    }))
    const base = { kind, text, seats, points: r.points, team: r.team, total: m.total.slice(), goat: false }
    if (g.phase === 'over') {
      const win = m.winner
      let over
      if (m.goat) over = win === 0 ? 'You win, and they are the goat! 🐐' : 'You are the goat! 🐐'
      else over = win === 0 ? 'You and Partner win!' : 'Left and Right win.'
      return { ...base, kind: win === 0 ? 'won' : 'lost', title: `${over} ${m.total.join(' : ')}`, sub: title, goat: m.goat, next: 'new' }
    }
    return { ...base, title, sub: '', next: 'next' }
  }

  return {
    /** The whole state the page draws: your tiles, the others' counts, the chain; never another hand before the end. */
    snapshot() {
      const due = stepDue()
      const reveal = g.phase === 'done' || g.phase === 'over'
      return {
        game: gameNo,
        seq,
        target: R.TARGET,
        phase: g.phase,
        turn: g.turn,
        opener: g.opener,
        round: m.rounds + (g.result ? 0 : 1),
        seats: g.players.map((p, i) => ({
          name: p.name,
          count: p.hand.length,
          team: R.teamOf(i),
          turn: g.phase === 'play' && g.turn === i,
          pips: reveal && g.result ? g.result.sums[i] : null,
        })),
        chain: g.chain.map((t) => ({ a: t.a, b: t.b })),
        ends: R.endsOf(g),
        hand: handView(),
        myTurn: myTurn(),
        must: g.must !== null && g.turn === R.YOU,
        thinking: due && g.phase === 'play' && !held() ? g.players[g.turn].name : null,
        log: g.log,
        paused: paused ? { name: paused.name } : null,
        scores: [0, 1].map((t) => ({ name: R.TEAM_NAMES[t], who: R.TEAM_WHO[t], total: m.total[t], me: t === 0 })),
        total: m.total.slice(),
        result: resultView(),
        stats: { ...stats },
      }
    },

    /**
     * One page action, untrusted: `play` `{ tile: { a, b }, end }` (`'L'`, `'R'` or `'S'`), `next` (the next round once
     * one is scored), `new`, `resume`. Your moves are refused while paused. Returns `{ changed, outcome? }`, `outcome`
     * `{ kind }` when the game's result for you was just decided.
     */
    act(msg) {
      if (!msg || typeof msg !== 'object') return { changed: false }
      switch (msg.act) {
        case 'play':
          if (!myTurn() || !R.play(g, R.YOU, msg.tile, msg.end)) return { changed: false }
          started = true
          seq++
          return { changed: true }
        case 'next':
          if (held() || g.phase !== 'done') return { changed: false }
          started = true
          nextRound()
          return { changed: true }
        case 'new':
          newMatch()
          return { changed: true }
        case 'resume':
          if (!paused) return { changed: false }
          paused = null
          seq++
          return { changed: true }
        default:
          return { changed: false }
      }
    },

    /**
     * What the host should run next, `{ key, ms }`, or null: a computer player's move or a round's score is due, the
     * game is not paused, and some view shows the panel. `key` names the state it is for; the host keeps one timer.
     */
    nextStep() {
      if (held() || !anyShown() || !stepDue()) return null
      return { key: `${gameNo}:${seq}`, ms: g.phase === 'end' ? END_MS : STEP_MS }
    },

    /** Runs the step `nextStep` asked for. Returns `{ changed, outcome? }`, as `act` does. Refused while paused. */
    step() {
      if (held() || !stepDue()) return { changed: false }
      const moved = g.phase === 'end' ? R.score(g, m) : bots.apply(g, bots.choose(g, rng))
      if (!moved) return { changed: false }
      seq++
      return withOutcome({ changed: true })
    },

    /**
     * The window's Claude tabs (every `ctx.sessions` list). A tab going from working to waiting pauses a game in play;
     * while paused, a later one only renames the cover to it (the latest wins). A game with no move of yours yet, one
     * that is over, or a scored round waiting on Next round is never paused. Returns whether the state changed.
     */
    sessions(list) {
      const ready = watch.observe(list)
      if (ready.length === 0) return false
      const latest = ready[ready.length - 1]
      if (paused) {
        if (paused.tabId === latest.tabId && paused.name === latest.name) return false
        paused = latest
        return true
      }
      if (!inPlay()) return false
      paused = latest
      seq++
      return true
    },

    /**
     * Whether `view`'s page is on screen: `true` / `false` from the page (its hello, its visibility), `undefined` when
     * the page is gone. Returns whether the computer players may now move where they could not before, or the other
     * way round.
     */
    setShown(view, visible) {
      if (typeof view !== 'string') return false
      const before = anyShown()
      if (visible === undefined) shown.delete(view)
      else shown.set(view, visible === true)
      return anyShown() !== before
    },

    /** The tab the pause names, for Go to the tab; null when not paused. */
    pausedTab: () => (paused ? paused.tabId : null),

    /**
     * Records from storage: `{ won, lost }`. A stored count only raises the one this window knows (storage counts
     * every window's games). Returns whether anything changed.
     */
    setStats(stored) {
      if (!stored || typeof stored !== 'object') return false
      let changed = false
      for (const k of OUTCOMES) {
        const v = stored[k]
        if (typeof v === 'number' && Number.isFinite(v) && v > stats[k]) {
          stats[k] = Math.floor(v)
          changed = true
        }
      }
      return changed
    },

    meta: () => headerMeta(m.total),
    isPaused: () => paused !== null,
    /** The round and the game themselves, for tests. */
    game: () => g,
    match: () => m,
  }
}

module.exports = { createController, headerMeta, STEP_MS, END_MS }
