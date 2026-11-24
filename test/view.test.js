'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const V = require('../panels/view.js')
const R = require('../lib/rules.js')
const B = require('../lib/bots.js')
const { seeded } = require('./helpers.js')

const seats = () => ['You', 'Left', 'Partner', 'Right'].map((name, i) => ({ name, count: 7, team: i % 2, turn: false, pips: null }))
const base = (extra = {}) => ({
  game: 1,
  seq: 1,
  target: 101,
  phase: 'play',
  turn: 0,
  round: 3,
  seats: seats(),
  chain: [{ a: 3, b: 5 }],
  ends: { l: 3, r: 5 },
  hand: [],
  myTurn: false,
  must: false,
  thinking: null,
  log: '',
  paused: null,
  scores: [{ name: 'Us', who: 'You + Partner', total: 40, me: true }, { name: 'Them', who: 'Left + Right', total: 120, me: false }],
  total: [40, 120],
  result: null,
  ...extra,
})

/** Chains from real games, every length from 1 to the longest seen. */
function chains(n, seed) {
  const rng = seeded(seed)
  const out = []
  for (let k = 0; k < n; k++) {
    const m = R.newMatch()
    const g = R.newRound(m, rng)
    while (g.phase === 'play') {
      B.apply(g, B.decide(B.knowledge(g, g.turn), rng))
      out.push(g.chain.map((x) => ({ ...x })))
    }
  }
  // And the longest possible kind: many doubles.
  out.push([0, 1, 2, 3, 4, 5, 6].flatMap((n) => [{ a: n, b: n }, { a: n, b: (n + 1) % 7 }]).slice(0, 13))
  return out
}

const overlap = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h
/** A unit square at `at` touches rectangle `r` along an edge (they share a stretch of border, not only a corner). */
function touches(at, r) {
  const [x, y] = at
  const side = (x + 1 === r.x || r.x + r.w === x) && y < r.y + r.h && r.y < y + 1
  const flat = (y + 1 === r.y || r.y + r.h === y) && x < r.x + r.w && r.x < x + 1
  return side || flat
}

test('pips: 0 to 6 in a half, the 6 in two columns of three standing, turned a quarter lying', () => {
  for (let n = 0; n <= 6; n++) assert.equal(V.pipsOf(n, false).length, n)
  const six = V.pipsOf(6, false)
  assert.deepEqual([...new Set(six.map(([x]) => x))].length, 2, 'two columns')
  const lying = V.pipsOf(6, true)
  assert.deepEqual([...new Set(lying.map(([, y]) => y))].length, 2, 'two rows when lying')
  for (const [x, y] of [...six, ...lying]) assert.ok(x > 0 && x < 1 && y > 0 && y < 1)
  assert.deepEqual(V.pipsOf(7, false), [])
  assert.deepEqual(V.pipsOf('__proto__', false), [])
})

test('the chain snakes: no two tiles overlap, neighbours meet half to half, every tile inside the board', () => {
  let rowsSeen = 0
  for (const chain of chains(40, 3)) {
    for (const cols of [6, 7, 9, 12, 17, 26, 40]) {
      const lay = V.chainLayout(chain, cols)
      assert.equal(lay.tiles.length, chain.length)
      rowsSeen = Math.max(rowsSeen, lay.rows)
      lay.tiles.forEach((p, i) => {
        assert.equal(p.a, chain[i].a)
        assert.equal(p.b, chain[i].b)
        assert.ok(p.x >= 0 && p.y >= 0, 'from the top-left')
        assert.ok(p.x + p.w <= Math.max(cols, V.MIN_COLS), `inside ${cols} columns`)
        assert.ok(p.x + p.w <= lay.width && p.y + p.h <= lay.height)
        assert.ok((p.w === 2 && p.h === 1) || (p.w === 1 && p.h === 2), 'a tile is 2 by 1')
        // The halves are the tile's two unit squares.
        for (const at of [p.A, p.B]) assert.ok(at[0] >= p.x && at[0] + 1 <= p.x + p.w && at[1] >= p.y && at[1] + 1 <= p.y + p.h)
        assert.notDeepEqual(p.A, p.B)
        for (let j = 0; j < i; j++) assert.equal(overlap(p, lay.tiles[j]), false, `tiles ${j} and ${i} overlap at ${cols}`)
        if (i > 0) {
          const q = lay.tiles[i - 1]
          assert.ok(touches(q.B, p), `tile ${i - 1}'s far half meets tile ${i} (${cols} cols)`)
          assert.ok(touches(p.A, q), `tile ${i}'s near half meets tile ${i - 1} (${cols} cols)`)
        }
      })
    }
  }
  assert.ok(rowsSeen >= 4, 'long chains wrap into several rows')
})

test('in a row a double stands across the line; a row with room for all stays one row', () => {
  const lay = V.chainLayout([{ a: 1, b: 1 }, { a: 1, b: 5 }, { a: 5, b: 5 }], 20)
  assert.equal(lay.rows, 1)
  assert.deepEqual(lay.tiles.map((x) => [x.w, x.h]), [[1, 2], [2, 1], [1, 2]])
  assert.equal(lay.width, 4)
  assert.equal(lay.height, 2)
  const flat = V.chainLayout([{ a: 2, b: 3 }], 20)
  assert.deepEqual([flat.width, flat.height], [2, 1])
  assert.deepEqual(V.chainLayout([], 20), { tiles: [], width: 0, height: 0, rows: 0 })
  assert.equal(V.chainLayout([{ a: 9, b: 1 }, null], 20).tiles.length, 0)
})

test('the chain fits the board: the biggest tiles that fit, smaller for a long chain, scrolling only past the floor', () => {
  const long = chains(40, 9).reduce((x, y) => (y.length > x.length ? y : x))
  const short = [{ a: 1, b: 1 }, { a: 1, b: 4 }]
  const a = V.chainFit(short, 600, 400, 34)
  assert.equal(a.u, 34, 'a short chain gets the cap')
  const b = V.chainFit(long, 600, 200)
  assert.ok(long.length >= 20, `${long.length} tiles`)
  assert.ok(b.u < 34)
  assert.ok(b.layout.height * b.u <= 200)
  assert.ok(b.layout.width * b.u <= 600)
  const narrow = V.chainFit(long, 280, 220)
  assert.ok(narrow.layout.width * narrow.u <= 280, 'a narrow panel: the snake turns sooner')
  const tiny = V.chainFit(long, 120, 40)
  assert.equal(tiny.u, V.CHAIN_MIN, 'too small: the floor, and the area scrolls')
  assert.ok(V.chainFit(short, 600, 400, 20).u <= 20, 'never above the hand’s size')
})

test('your hand: one row while tiles stay big enough, else two; capped by the panel’s height', () => {
  const wide = V.handSize(7, 900, 900)
  assert.deepEqual(wide.rows, [7])
  assert.equal(wide.u, 36)
  const mid = V.handSize(7, 420, 700)
  assert.deepEqual(mid.rows, [4, 3], 'a 420 px panel: two rows')
  assert.ok(mid.u >= 20)
  const narrow = V.handSize(7, 300, 700)
  assert.deepEqual(narrow.rows, [4, 3])
  assert.ok(narrow.u >= 20 && narrow.u * 2 * 4 + 4 * 10 + 3 * 6 <= 300, `fits: ${narrow.u}`)
  assert.ok(V.handSize(7, 900, 300).u <= 23, 'a short panel: smaller tiles')
  assert.deepEqual(V.handSize(0, 500, 500).rows, [])
  assert.deepEqual(V.handSize(1, 300, 500).rows, [1])
})

test('end choices: only for a tile that fits both ends with different numbers', () => {
  const s = base({ myTurn: true, hand: [{ a: 5, b: 3, ok: true, at: ['L', 'R'] }, { a: 5, b: 1, ok: true, at: ['R'] }] })
  assert.deepEqual(V.endChoices(s, '53'), [
    { end: 'L', n: 3, label: '◀ Left end (3)' },
    { end: 'R', n: 5, label: 'Right end (5) ▶' },
  ])
  assert.deepEqual(V.endChoices(s, '51'), [])
  assert.deepEqual(V.endChoices({ ...s, myTurn: false }, '53'), [])
  assert.deepEqual(V.endChoices(s, 'zz'), [])
})

test('the status line: what happened, then your move in bold or who is thinking', () => {
  assert.deepEqual(V.statusOf(base({ log: 'Left played 3-5.', myTurn: true })), [{ text: 'Left played 3-5.' }, { text: 'Your move.', strong: true }])
  assert.deepEqual(V.statusOf(base({ myTurn: true, must: true, chain: [] })), [{ text: 'You hold the 1-1: open with it.', strong: true }])
  assert.deepEqual(V.statusOf(base({ myTurn: true, chain: [] })), [{ text: 'Your lead.', strong: true }])
  assert.deepEqual(V.statusOf(base({ thinking: 'Right' })), [{ text: 'Right is thinking…', muted: true }])
  assert.deepEqual(V.statusOf(base({ thinking: 'Right', paused: { name: 'x' } })), [])
})

test('the chain’s hint', () => {
  assert.equal(V.chainHint(base()), '')
  assert.equal(V.chainHint(base({ chain: [], myTurn: true, must: true })), 'Open with the 1-1')
  assert.equal(V.chainHint(base({ chain: [], myTurn: true })), 'Your lead: tap any tile')
  assert.equal(V.chainHint(base({ chain: [] })), 'The table is empty')
})

test('the score cards: totals and a bar toward 101, capped at full; the line under them', () => {
  const { rows, foot } = V.scoreRows(base())
  assert.deepEqual(rows[0], { name: 'Us', who: 'You + Partner', total: 40, pct: (40 / 101) * 100, me: true })
  assert.equal(rows[1].pct, 100)
  assert.equal(foot, 'to 101 · round 3')
  assert.deepEqual(V.scoreRows(null), { rows: [], foot: '' })
})

test('covers: the pause wins, then a result with everyone’s tiles', () => {
  const result = { kind: 'won', title: 'You went out!', sub: '', text: 'Us score 12.', seats: seats(), total: [52, 120], next: 'next', goat: false }
  const paused = V.coverFor(base({ paused: { name: 'Fix it' }, phase: 'done', result }))
  assert.equal(paused.kind, 'paused')
  assert.equal(paused.text, '“Fix it” is waiting for you.')
  assert.deepEqual(paused.buttons.map((b) => b.msg.act), ['resume', 'goto'])
  const done = V.coverFor(base({ phase: 'done', result }))
  assert.equal(done.title, 'You went out!')
  assert.deepEqual(done.buttons, [{ label: 'Next round', msg: { act: 'next' }, primary: true }])
  assert.equal(done.seats.length, 4)
  const over = V.coverFor(base({ phase: 'over', result: { ...result, next: 'new', goat: true } }))
  assert.equal(over.goat, true)
  assert.deepEqual(over.buttons, [{ label: 'New game', msg: { act: 'new' }, primary: true }])
  assert.equal(V.coverFor(base()), null)
  assert.equal(V.coverFor(base({ result })), null, 'a result only once the round is scored')
  assert.deepEqual(V.resultOrder(seats()).map((s) => s.name), ['You', 'Partner', 'Left', 'Right'])
})

test('keys: N new game; nothing else', () => {
  assert.equal(V.actOfKey('n'), 'new')
  assert.equal(V.actOfKey('N'), 'new')
  for (const k of ['x', 'Enter', ' ', 'toString', '__proto__']) assert.equal(V.actOfKey(k), null)
})

test('a new round, a change, or a resend; tile keys the same either way round', () => {
  assert.equal(V.changeOf(null, base()), 'reset')
  assert.equal(V.changeOf({ game: 1, seq: 1 }, base()), 'same')
  assert.equal(V.changeOf({ game: 1, seq: 0 }, base()), 'change')
  assert.equal(V.changeOf({ game: 0, seq: 1 }, base()), 'reset')
  assert.equal(V.keyOf({ a: 4, b: 6 }), V.keyOf({ a: 6, b: 4 }))
  assert.equal(V.keyOf({ a: 9, b: 1 }), '')
  assert.equal(V.tileLabel({ a: 5, b: 5 }), '5-5 (double)')
})
