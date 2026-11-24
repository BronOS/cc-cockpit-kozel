'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const R = require('../lib/rules.js')
const { createController, headerMeta, STEP_MS, END_MS } = require('../lib/controller.js')
const { seeded, t, stack } = require('./helpers.js')

const tab = (tabId, status, extra = {}) => ({ tabId, status, cwd: '/proj', ...extra })

/** A controller whose rounds come from `orders` in turn (then random), shown in the desktop view. */
function make(orders = [], { shown = true, seed = 1 } = {}) {
  const queue = orders.slice()
  const c = createController({
    rng: seeded(seed),
    round: (m, rng) => R.newRound(m, rng, queue.length > 0 ? queue.shift() : undefined),
  })
  if (shown) c.setShown('desktop', true)
  return c
}

/** Runs computer steps until it is your move (or the round is no longer in play); returns how many ran. */
function botsUntilMe(c, limit = 50) {
  let n = 0
  while (c.nextStep() && c.game().phase === 'play' && n < limit) {
    c.step()
    n++
  }
  return n
}

/** You hold the 1-1 and open. */
const YOU_OPEN = stack(['1-1 6-6 1-5 5-5 2-4 0-3 3-4', '1-2 1-3 2-2 0-0 4-5 0-6 3-6'])
/** Left holds the 1-1. */
const LEFT_OPEN = stack(['6-6 5-5 2-4', '1-1'])

test('the snapshot: your tiles high to low, the others only as counts, never their tiles during a round', () => {
  const c = make([YOU_OPEN])
  const s = c.snapshot()
  assert.equal(s.phase, 'play')
  assert.equal(s.myTurn, true)
  assert.equal(s.must, true, 'you hold the 1-1')
  assert.deepEqual(s.hand.map((x) => `${x.a}-${x.b}`), ['6-6', '5-5', '4-3', '5-1', '4-2', '3-0', '1-1'])
  assert.deepEqual(s.hand.map((x) => x.ok), [false, false, false, false, false, false, true])
  assert.deepEqual(s.hand[6].at, ['S'])
  assert.equal(s.hand[0].dim, true)
  assert.deepEqual(s.seats.map((x) => x.count), [7, 7, 7, 7])
  assert.deepEqual(s.seats.map((x) => x.team), [0, 1, 0, 1])
  assert.equal(s.seats[0].turn, true)
  assert.equal(s.seats[1].pips, null)
  assert.equal(s.result, null)
  const text = JSON.stringify(s)
  // Left's 1-2 and 0-6 are nowhere in what the page gets.
  assert.equal(text.includes('"a":2,"b":1'), false)
  assert.equal(text.includes('"a":6,"b":0'), false)
  assert.equal(s.target, 101)
  assert.deepEqual(s.scores.map((x) => [x.name, x.who, x.total, x.me]), [['Us', 'You + Partner', 0, true], ['Them', 'Left + Right', 0, false]])
})

test('your move: only a legal tile on a legal end; refusals change nothing', () => {
  const c = make([YOU_OPEN])
  const seq = c.snapshot().seq
  assert.equal(c.act({ act: 'play', tile: t('6-6'), end: 'S' }).changed, false, 'the 1-1 must open')
  assert.equal(c.act({ act: 'play', tile: t('1-2'), end: 'S' }).changed, false, 'not yours')
  assert.equal(c.snapshot().seq, seq)
  assert.equal(c.act({ act: 'play', tile: t('1-1'), end: 'S' }).changed, true)
  const s = c.snapshot()
  assert.deepEqual(s.chain, [{ a: 1, b: 1 }])
  assert.deepEqual(s.ends, { l: 1, r: 1 })
  assert.equal(s.myTurn, false)
  assert.equal(s.thinking, 'Left')
  assert.equal(c.act({ act: 'play', tile: t('1-5'), end: 'R' }).changed, false, 'not your turn')
})

test('a tile that fits both ends offers both only when the ends differ', () => {
  const c = make([YOU_OPEN])
  c.act({ act: 'play', tile: t('1-1'), end: 'S' })
  botsUntilMe(c)
  const s = c.snapshot()
  assert.equal(s.myTurn, true)
  for (const x of s.hand) {
    if (!x.ok) continue
    const both = R.has(x, s.ends.l) && R.has(x, s.ends.r)
    assert.deepEqual(x.at.length, both && s.ends.l !== s.ends.r ? 2 : 1, `${x.a}-${x.b} on ${s.ends.l}/${s.ends.r}`)
  }
})

test('the steps: a computer move about 650 ms, a round that ended 900 ms before its score', () => {
  const c = make([LEFT_OPEN])
  assert.equal(c.snapshot().turn, 1)
  const st = c.nextStep()
  assert.equal(st.ms, STEP_MS)
  assert.equal(c.step().changed, true)
  assert.equal(c.game().chain.length, 1, 'Left opened with the 1-1')
  assert.notEqual(c.nextStep().key, st.key, 'a new state, a new key')
  const g = c.game()
  g.phase = 'end'
  g.ending = { kind: 'out', p: 1 }
  assert.equal(c.nextStep().ms, END_MS)
  assert.equal(c.snapshot().thinking, null)
  c.step()
  assert.equal(c.snapshot().phase, 'done')
  assert.equal(c.nextStep(), null, 'a scored round waits for you')
})

test('the computer players move only while a view shows the panel', () => {
  const c = make([LEFT_OPEN], { shown: false })
  assert.equal(c.nextStep(), null)
  assert.equal(c.setShown('desktop', true), true)
  assert.ok(c.nextStep())
  assert.equal(c.setShown('web:1', true), false, 'already shown')
  assert.equal(c.setShown('desktop', false), false, 'the browser still shows it')
  assert.equal(c.setShown('web:1', undefined), true)
  assert.equal(c.nextStep(), null)
  assert.equal(c.setShown(5, true), false)
})

test('a round scored: everyone’s tiles and pips come out, Next round goes on, the leader opens', () => {
  const c = make([YOU_OPEN])
  const g = c.game()
  g.players[0].hand = []
  g.phase = 'end'
  g.ending = { kind: 'out', p: 0 }
  c.step()
  const s = c.snapshot()
  assert.equal(s.phase, 'done')
  const r = s.result
  assert.equal(r.kind, 'won')
  assert.equal(r.title, 'You went out!')
  assert.match(r.text, /^Us score \d+: the pips left in Left’s and Right’s hands\.$/)
  assert.equal(r.next, 'next')
  assert.equal(r.seats.length, 4)
  assert.equal(r.seats[0].out, true)
  assert.equal(r.seats[1].tiles.length, 7, 'Left’s tiles shown')
  assert.equal(r.seats[1].pips, R.handPips(c.game().players[1].hand))
  assert.equal(s.seats[1].pips, r.seats[1].pips)
  assert.equal(r.points, r.seats[1].pips + r.seats[3].pips)
  assert.deepEqual(s.total, [r.points, 0])
  const game = s.game
  assert.equal(c.act({ act: 'next' }).changed, true)
  const n = c.snapshot()
  assert.equal(n.game, game + 1)
  assert.equal(n.turn, 0, 'you went out: you open')
  assert.equal(n.must, false)
  assert.equal(n.round, 2)
  assert.equal(c.act({ act: 'next' }).changed, false, 'only after a scored round')
})

test('a fish and a tie read as such', () => {
  const c = make([YOU_OPEN])
  const g = c.game()
  g.players[0].hand = [t('1-2')]
  g.players[1].hand = [t('0-3')]
  g.players[2].hand = [t('6-6')]
  g.players[3].hand = [t('5-5')]
  g.phase = 'end'
  g.ending = { kind: 'fish', p: null }
  c.step()
  const r = c.snapshot().result
  assert.equal(r.kind, 'draw')
  assert.equal(r.title, 'Fish, and a tie.')
  assert.equal(r.text, 'You and Left hold the fewest pips (3). Nobody scores; You open again.')
  assert.deepEqual(r.seats.map((x) => x.low), [true, true, false, false])

  const d = make([YOU_OPEN])
  const h = d.game()
  h.players[0].hand = [t('6-6')]
  h.players[1].hand = [t('0-1')]
  h.players[2].hand = [t('5-5')]
  h.players[3].hand = [t('4-4')]
  h.phase = 'end'
  h.ending = { kind: 'fish', p: null }
  d.step()
  const f = d.snapshot().result
  assert.equal(f.kind, 'lost')
  assert.equal(f.title, 'Fish: nobody can play.')
  assert.equal(f.text, 'Left holds the fewest pips (1). Them score 22, the opponents’ pips.')
})

test('the game’s end: 101, the goat, counted once', () => {
  const c = make([YOU_OPEN])
  c.act({ act: 'play', tile: t('1-1'), end: 'S' })
  c.match().total = [90, 0]
  const g = c.game()
  g.players[0].hand = []
  g.phase = 'end'
  g.ending = { kind: 'out', p: 0 }
  const res = c.step()
  assert.deepEqual(res.outcome, { kind: 'won' })
  const s = c.snapshot()
  assert.equal(s.phase, 'over')
  assert.equal(s.result.goat, true)
  assert.match(s.result.title, /^You win, and they are the goat! 🐐 1\d\d : 0$/)
  assert.equal(s.result.sub, 'You went out!')
  assert.equal(s.result.next, 'new')
  assert.deepEqual(s.stats, { won: 1, lost: 0 })
  assert.equal(c.step().changed, false)
  assert.equal(c.act({ act: 'new' }).changed, true)
  assert.equal(c.snapshot().phase, 'play')
  assert.deepEqual(c.snapshot().total, [0, 0])

  const d = make([YOU_OPEN])
  d.match().total = [3, 95]
  const h = d.game()
  h.players[1].hand = []
  h.phase = 'end'
  h.ending = { kind: 'out', p: 1 }
  assert.deepEqual(d.step().outcome, { kind: 'lost' })
  assert.equal(d.snapshot().result.goat, false)
  assert.match(d.snapshot().result.title, /^Left and Right win\. 3 : 1\d\d$/)
  const e = make([YOU_OPEN])
  e.match().total = [0, 95]
  e.game().players[3].hand = []
  e.game().phase = 'end'
  e.game().ending = { kind: 'out', p: 3 }
  e.step()
  assert.match(e.snapshot().result.title, /^You are the goat! 🐐/)
})

test('whole games through the controller: each ends once, at 101, and counts once', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const c = make([], { seed })
    const rng = seeded(seed + 100)
    let outcomes = 0
    for (let k = 0; k < 5000 && c.snapshot().phase !== 'over'; k++) {
      const s = c.snapshot()
      let r
      if (s.phase === 'done') r = c.act({ act: 'next' })
      else if (s.myTurn) {
        const ok = s.hand.filter((x) => x.ok)
        const x = ok[Math.floor(rng() * ok.length)]
        r = c.act({ act: 'play', tile: { a: x.a, b: x.b }, end: x.at[0] })
      } else r = c.step()
      assert.equal(r.changed, true, `seed ${seed} step ${k} (${s.phase})`)
      if (r.outcome) outcomes++
    }
    const s = c.snapshot()
    assert.equal(s.phase, 'over', `seed ${seed}`)
    assert.ok(Math.max(...s.total) >= 101)
    assert.equal(outcomes, 1)
    assert.equal(s.stats.won + s.stats.lost, 1)
  }
})

test('pause: a working tab turning waiting after your move pauses everything until Resume', () => {
  const c = make([YOU_OPEN])
  c.sessions([tab('t1', 'working', { name: 'Fix the tests' })])
  assert.equal(c.sessions([tab('t1', 'waiting', { name: 'Fix the tests' })]), false, 'no move of yours yet')
  c.act({ act: 'play', tile: t('1-1'), end: 'S' })
  c.sessions([tab('t1', 'working', { name: 'Fix the tests' })])
  assert.equal(c.sessions([tab('t1', 'waiting', { name: 'Fix the tests' })]), true)
  const s = c.snapshot()
  assert.deepEqual(s.paused, { name: 'Fix the tests' })
  assert.equal(s.thinking, null)
  assert.equal(c.nextStep(), null)
  assert.equal(c.step().changed, false)
  assert.equal(c.pausedTab(), 't1')
  // A later one renames the cover.
  c.sessions([tab('t1', 'waiting', { name: 'Fix the tests' }), tab('t2', 'working')])
  assert.equal(c.sessions([tab('t1', 'waiting', { name: 'Fix the tests' }), tab('t2', 'waiting', { title: 'Docs' })]), true)
  assert.deepEqual(c.snapshot().paused, { name: 'Docs' })
  assert.equal(c.act({ act: 'resume' }).changed, true)
  assert.equal(c.isPaused(), false)
  assert.ok(c.nextStep())
  assert.equal(c.act({ act: 'resume' }).changed, false)
})

test('never paused once a round is scored or the game is over; your moves refused while paused', () => {
  const c = make([YOU_OPEN])
  c.act({ act: 'play', tile: t('1-1'), end: 'S' })
  botsUntilMe(c)
  c.sessions([tab('t1', 'working')])
  c.sessions([tab('t1', 'waiting')])
  assert.equal(c.isPaused(), true)
  const ok = c.snapshot().hand.find((x) => x.ok)
  assert.equal(c.snapshot().myTurn, false, 'paused: not your move')
  assert.equal(c.act({ act: 'play', tile: { a: ok ? ok.a : 0, b: ok ? ok.b : 0 }, end: 'R' }).changed, false)
  c.act({ act: 'resume' })
  const g = c.game()
  g.phase = 'end'
  g.ending = { kind: 'out', p: 1 }
  c.step()
  c.sessions([tab('t1', 'working')])
  assert.equal(c.sessions([tab('t1', 'waiting')]), false, 'a scored round waits anyway')
})

test('records and the header text', () => {
  const c = make()
  assert.equal(c.meta(), 'Us 0 : 0 Them · to 101')
  assert.equal(headerMeta([45, 30]), 'Us 45 : 30 Them · to 101')
  assert.equal(c.setStats({ won: 4, lost: 2 }), true)
  assert.deepEqual(c.snapshot().stats, { won: 4, lost: 2 })
  assert.equal(c.setStats({ won: 3 }), false, 'never lowers')
  assert.equal(c.setStats({ won: 'x', lost: Infinity }), false)
  assert.equal(c.setStats(null), false)
})

test('junk from the page changes nothing', () => {
  const c = make([YOU_OPEN])
  const seq = c.snapshot().seq
  for (const m of [null, 'x', 5, {}, { act: 'play' }, { act: 'play', tile: { a: 9, b: 1 }, end: 'S' }, { act: 'play', tile: t('1-1'), end: '__proto__' }, { act: 'next' }, { act: 'resume' }, { act: 'toString' }, { act: 'step' }]) {
    assert.equal(c.act(m).changed, false, JSON.stringify(m))
  }
  assert.equal(c.snapshot().seq, seq)
})
