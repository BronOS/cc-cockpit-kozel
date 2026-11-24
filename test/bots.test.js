'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const R = require('../lib/rules.js')
const B = require('../lib/bots.js')
const { seeded, t, key, setup, playMine } = require('./helpers.js')

const moveText = (mv) => (mv ? `${key(mv.tile)}${mv.end}` : null)

/** Rounds in random states, partway through: the seat in turn a computer player. */
function* randomStates(n, seed) {
  const rng = seeded(seed)
  for (let k = 0; k < n; k++) {
    const m = R.newMatch()
    if (k % 2) {
      m.first = false
      m.leader = 1 + (k % 3)
    }
    const g = R.newRound(m, rng)
    const stop = Math.floor(rng() * 24)
    for (let s = 0; s < stop && g.phase === 'play'; s++) {
      if (g.turn === R.YOU) playMine(g, rng)
      else B.apply(g, B.choose(g, rng))
    }
    if (g.phase === 'play' && g.turn !== R.YOU) yield { g, rng }
  }
}

test('knowledge: its own hand, the chain, the counts and the public moves; never another hand', () => {
  const { g } = setup({ hands: ['1-2', '3-4 5-5', '6-6', '0-0 0-1'], chain: '2-3', turn: 1 })
  g.moves = [{ p: 0, tile: t('2-3'), end: 'S' }, { p: 2, pass: true, ends: [2, 3] }]
  const k = B.knowledge(g, 1)
  assert.deepEqual(Object.keys(k).sort(), ['chain', 'counts', 'hand', 'moves', 'must', 'seat'])
  assert.deepEqual(k.hand, [t('3-4'), t('5-5')])
  assert.deepEqual(k.counts, [1, 2, 1, 2])
  assert.equal(JSON.stringify(k).includes('"6,6"') || JSON.stringify(k).includes('{"a":6,"b":6}'), false)
  assert.equal(JSON.stringify(k).includes('{"a":0,"b":1}'), false)
  k.hand.push(t('6-6'))
  assert.equal(g.players[1].hand.length, 2, 'a copy')
})

test('always a legal move, from many random states', () => {
  let n = 0
  for (const { g, rng } of randomStates(400, 7)) {
    const mv = B.choose(g, rng)
    const legal = R.movesOf(g, g.turn).map(moveText)
    assert.ok(legal.includes(moveText(mv)), `${moveText(mv)} not in ${legal}`)
    n++
  }
  assert.ok(n > 150, `${n} states`)
})

test('deterministic: the same state and seed give the same move', () => {
  for (const { g } of randomStates(60, 11)) {
    const a = B.choose(g, seeded(5))
    const b = B.choose(structuredClone(g), seeded(5))
    assert.deepEqual(a, b)
  }
})

test('it never reads another hand: swapping the hidden tiles among the others changes nothing', () => {
  let n = 0
  for (const { g } of randomStates(120, 21)) {
    const me = g.turn
    const others = [0, 1, 2, 3].filter((q) => q !== me)
    const pool = others.flatMap((q) => g.players[q].hand)
    const h = structuredClone(g)
    // Deal the others' tiles again, same counts, in another order.
    const order = pool.slice().reverse()
    for (const q of others) h.players[q].hand = order.splice(0, g.players[q].hand.length)
    assert.deepEqual(B.choose(h, seeded(3)), B.choose(g, seeded(3)))
    n++
  }
  assert.ok(n > 40)
})

test('goes out when it can', () => {
  const { g } = setup({ hands: ['1-2 2-2', '5-1', '6-6', '0-0'], chain: '1-3 3-4', turn: 1 })
  // 5-1 fits on the left 1: its last tile.
  assert.deepEqual(B.choose(g, seeded(1)), { tile: { a: 1, b: 5 }, end: 'L' })
})

test('heavy tiles and doubles first, other things equal', () => {
  // Both fit the 6; 6-6 is the heavier and a double.
  const { g } = setup({ hands: ['', '6-6 6-1 3-3 1-1', '', ''], chain: '2-6', turn: 1 })
  for (const p of [0, 2, 3]) g.players[p].hand = [t('0-0'), t('0-1'), t('0-2')]
  assert.equal(moveText(B.choose(g, seeded(1))), '6-6R')
})

test('keeps a move for later: prefers leaving an end it can play again', () => {
  // On the 4: 4-5 leaves a 5 (it holds 5-0) and 4-2 leaves a 2 (nothing). Same pips, so the follow-up decides.
  const { g } = setup({ hands: ['', '4-5 4-2 5-0 3-1', '', ''], chain: '6-4', turn: 1 })
  for (const p of [0, 2, 3]) g.players[p].hand = [t('0-0'), t('0-1'), t('0-2')]
  const k = B.knowledge(g, 1)
  const s45 = B.scoreMove(k, { tile: t('4-5'), end: 'R' })
  const s42 = B.scoreMove(k, { tile: t('4-2'), end: 'R' })
  assert.ok(s45 > s42 + 3, `${s45} vs ${s42}`)
})

test('blocks the next opponent where it is known void, and does not block its partner', () => {
  // Chain 3 ... 5. Partner (seat 3 for Left is Right) passed on 2 and 3: holds no 2 and no 3.
  // Left (seat 1) holds 5-2 and 5-6; the next opponent after Left is Partner (seat 2), void in 2 and 3 too? Make it so:
  // seat 2 passed on [3, 2]: 5-2 leaves ends 3 and 2, so seat 2 must pass.
  const { g } = setup({ hands: ['0-0 0-1 0-2', '5-2 5-6 0-3', '0-4 1-4 2-4', '1-1 1-6 4-6'], chain: '3-1 1-5', turn: 1 })
  g.moves = [{ p: 2, pass: true, ends: [3, 2] }]
  const k = B.knowledge(g, 1)
  const block = B.scoreMove(k, { tile: t('5-2'), end: 'R' })
  const open = B.scoreMove(k, { tile: t('5-6'), end: 'R' })
  assert.ok(block > open, `blocking the next opponent: ${block} vs ${open}`)
  // The same ends against its partner: Right (seat 3) passed on 3 and 2 instead.
  g.moves = [{ p: 3, pass: true, ends: [3, 2] }]
  const k2 = B.knowledge(g, 1)
  const blockPartner = B.scoreMove(k2, { tile: t('5-2'), end: 'R' })
  const open2 = B.scoreMove(k2, { tile: t('5-6'), end: 'R' })
  assert.ok(blockPartner < open2, `blocking its partner: ${blockPartner} vs ${open2}`)
})

test('a sure fish: sought with a light hand against heavy opponents, avoided with a heavy one', () => {
  // Every 6 but the 6-6 is in the chain, which shows 6 at both ends: Left's 6-6 is the last 6, and after it nobody can
  // play (the others hold no 6, and nothing else of Left's fits). A sure fish.
  const chain = '6-0 0-1 1-6 6-2 2-3 3-6 6-4 4-5 5-6'
  const light = setup({ hands: ['5-4 5-3 4-3', '6-6 0-2', '5-2 4-2 5-1', '3-1 4-0 5-5'], chain, turn: 1 })
  assert.deepEqual(R.endsOf(light.g), { l: 6, r: 6 })
  const k = B.knowledge(light.g, 1)
  const fish = B.scoreMove(k, { tile: t('6-6'), end: 'R' })
  assert.ok(fish > 40, `light hand (2 pips left) forces the fish: ${fish}`)
  const heavy = setup({ hands: ['0-2 1-2', '6-6 5-5 4-4 3-3 2-2', '0-0 1-1', '0-3 1-3'], chain, turn: 1 })
  const kh = B.knowledge(heavy.g, 1)
  const lose = B.scoreMove(kh, { tile: t('6-6'), end: 'R' })
  assert.ok(lose < fish - 40, `heavy hand (30 pips left) marks it down: ${lose}`)
  // And the rules agree it is a fish.
  assert.equal(R.play(light.g, 1, t('6-6'), 'R'), true)
  assert.equal(light.g.ending.kind, 'fish')
})

test('no move on your turn or outside play', () => {
  const { g } = setup({ hands: ['1-2', '2-3', '', ''], chain: '2-2', turn: 0 })
  assert.equal(B.choose(g, seeded(1)), null)
  g.turn = 1
  g.phase = 'done'
  assert.equal(B.choose(g, seeded(1)), null)
  assert.equal(B.apply(g, null), false)
})
