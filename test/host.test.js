'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fakeCtx } = require('./fake-ctx.js')
const rules = require('../lib/rules.js')
const { stack } = require('./helpers.js')

const root = path.join(__dirname, '..')
const host = require('../dist/host.js')

const tab = (tabId, status, extra = {}) => ({ tabId, status, cwd: '/proj', notes: [], files: [], ...extra })
const settle = async () => {
  for (let k = 0; k < 5; k++) await new Promise((resolve) => setImmediate(resolve))
}

const realNewRound = rules.newRound
test.afterEach(() => {
  host.deactivate()
  rules.newRound = realNewRound
})

/** You hold the 1-1 and open. */
const YOU_OPEN = stack(['1-1 6-6 1-5 5-5 2-4 0-3 3-4'])
/** Left holds the 1-1 and opens. */
const LEFT_OPEN = stack(['6-6 5-5 2-4', '1-1'])

/** Every round from `order`. */
function rig(order) {
  rules.newRound = (m, rng) => realNewRound(m, rng, order)
}

async function started(opts, order) {
  if (order) rig(order)
  const f = fakeCtx(opts)
  host.activate(f.ctx)
  await settle()
  return f
}
async function tick(t, ms) {
  t.mock.timers.tick(ms)
  await settle()
}

test('hello is answered with the state; the tiles live in the host', async () => {
  const f = await started({}, YOU_OPEN)
  await f.send({ hello: 1, visible: true }, 'web:3')
  const s = f.lastState()
  assert.equal(s.seats.length, 4)
  assert.equal(s.hand.length, 7)
  assert.equal(f.posts.at(-1).options, undefined, 'state changes go to every view')
  assert.equal(JSON.stringify(s).includes('"players"'), false)
})

test('header: New game; the game score as its text', async () => {
  const f = await started({}, YOU_OPEN)
  const h = f.headers.at(-1)
  assert.equal(h.meta, 'Us 0 : 0 Them · to 101')
  assert.deepEqual(h.actions, [{ id: 'new', icon: 'refresh', title: 'New game (N)' }])
  const n = f.headers.length
  await f.send({ hello: 1 })
  assert.equal(f.headers.length, n, 'an unchanged header is not set again')
})

test('the computer players move on a timer, about 650 ms each, only while a view shows the panel', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = await started({}, LEFT_OPEN)
  await tick(t, 2000)
  assert.equal(f.lastState(), undefined, 'no page, no moves')
  await f.send({ hello: 1, visible: true })
  assert.equal(f.lastState().thinking, 'Left')
  await tick(t, 600)
  assert.equal(f.lastState().chain.length, 0, 'not yet')
  await tick(t, 60)
  assert.equal(f.lastState().log.startsWith('Left played 1-1.'), true)
  await tick(t, 650)
  await tick(t, 650)
  // By now Partner and Right have had their go (or passed); then it is yours unless you pass too.
  const s = f.lastState()
  if (s.myTurn) {
    const n = f.posts.length
    await tick(t, 5000)
    assert.equal(f.posts.length, n, 'your turn: nothing runs')
  }
})

test('a hidden panel stops them; showing it again goes on', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = await started({}, LEFT_OPEN)
  await f.send({ hello: 1, visible: true })
  await f.send({ hello: 1, visible: true }, 'web:1')
  await tick(t, 300)
  f.viewGone('desktop')
  await tick(t, 400)
  assert.equal(f.lastState().chain.length, 1, 'the browser still shows it')
  await f.click('new')
  f.viewGone('web:1')
  await tick(t, 2000)
  assert.equal(f.lastState().chain.length, 0, 'hidden everywhere: nobody moves')
  await f.send({ hello: 1, visible: true })
  await tick(t, 700)
  assert.equal(f.lastState().chain.length, 1)
  await f.click('new')
  await f.send({ act: 'seen', visible: false })
  await tick(t, 2000)
  assert.equal(f.lastState().chain.length, 0, 'the page out of sight (a minimized window)')
  await f.send({ act: 'seen', visible: true })
  await tick(t, 700)
  assert.equal(f.lastState().chain.length, 1)
})

test('pause: a working tab turning waiting after your move pauses everything; Go to the tab focuses it; Resume goes on', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = await started({ sessions: [tab('t1', 'working', { title: 'Fix the scroll test' })] }, YOU_OPEN)
  await f.send({ hello: 1, visible: true })
  f.setSessions([tab('t1', 'waiting', { title: 'Fix the scroll test' })])
  assert.equal(f.lastState().paused, null, 'no move of yours yet')
  await f.send({ act: 'play', tile: { a: 1, b: 1 }, end: 'S' })
  assert.equal(f.lastState().chain.length, 1)
  f.setSessions([tab('t1', 'working', { title: 'Fix the scroll test' })])
  f.setSessions([tab('t1', 'waiting', { title: 'Fix the scroll test' })])
  assert.deepEqual(f.lastState().paused, { name: 'Fix the scroll test' })
  const n = f.posts.length
  await tick(t, 5000)
  assert.equal(f.posts.length, n, 'nothing moves while paused')

  await f.send({ act: 'goto' }, 'web:1')
  assert.deepEqual(f.focused, ['t1'])
  assert.equal(f.posts.length, n, 'a focus that worked posts nothing')
  assert.ok(f.lastState().paused, 'Go to the tab does not resume')

  await f.send({ act: 'resume' })
  assert.equal(f.lastState().paused, null)
  const resumed = f.lastState()
  assert.notEqual(resumed.turn, 0, 'a computer player is to move')
  await tick(t, 700)
  assert.ok(f.lastState().seq > resumed.seq, 'it moved once resumed')
  assert.ok(f.lastState().log !== resumed.log)
})

test('Go to the tab on a closed tab tells only that view', async () => {
  const f = await started({ sessions: [tab('t1', 'working')] }, YOU_OPEN)
  await f.send({ hello: 1, visible: true })
  await f.send({ act: 'play', tile: { a: 1, b: 1 }, end: 'S' })
  f.setSessions([tab('t1', 'waiting')])
  f.setSessions([])
  await f.send({ act: 'goto' }, 'web:2')
  assert.deepEqual(f.posts.at(-1), { panelId: 'kozel', message: { notice: 'That Claude tab is closed.' }, options: { view: 'web:2' } })
})

/** Plays the game to its end at once: you hold every move, the computer steps run on the mocked clock. */
async function playToEnd(t, f) {
  for (let k = 0; k < 4000; k++) {
    const s = f.lastState()
    if (s.phase === 'over') return s
    if (s.phase === 'done') await f.send({ act: 'next' })
    else if (s.myTurn) {
      const x = s.hand.find((h) => h.ok)
      await f.send({ act: 'play', tile: { a: x.a, b: x.b }, end: x.at[0] })
    } else await tick(t, 1000)
  }
  throw new Error('the game did not end')
}

test('a result is stored app-wide, on top of other windows, and counted once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fakeCtx()
  await f.ctx.appStorage.set('won', 10)
  await f.ctx.appStorage.set('lost', 7)
  host.activate(f.ctx)
  await f.send({ hello: 1, visible: true })
  assert.deepEqual(f.lastState().stats, { won: 10, lost: 7 })
  await f.ctx.appStorage.set('won', 12) // another window won twice meanwhile
  await f.ctx.appStorage.set('lost', 9)
  const s = await playToEnd(t, f)
  await settle()
  const kind = s.result.kind
  assert.ok(kind === 'won' || kind === 'lost')
  const stored = { won: await f.ctx.appStorage.get('won'), lost: await f.ctx.appStorage.get('lost') }
  assert.deepEqual(stored, kind === 'won' ? { won: 13, lost: 9 } : { won: 12, lost: 10 })
  assert.equal(f.lastState().stats[kind], stored[kind], 'the stored total raises this window’s count')
  await f.send({ act: 'next' })
  await tick(t, 5000)
  assert.deepEqual({ won: await f.ctx.appStorage.get('won'), lost: await f.ctx.appStorage.get('lost') }, stored, 'counted once')
})

test('without ctx.appStorage the records go to ctx.storage', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = await started({ appStorage: false })
  await f.send({ hello: 1, visible: true })
  const s = await playToEnd(t, f)
  await settle()
  assert.equal(await f.ctx.storage.get(s.result.kind), 1)
})

test('New game from the title bar or the page (N) starts a game and drops the pending computer move', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = await started({}, LEFT_OPEN)
  await f.send({ hello: 1, visible: true })
  await tick(t, 600)
  await f.click('new')
  await tick(t, 100)
  assert.equal(f.lastState().chain.length, 0, 'the old timer did not fire on the new round')
  await tick(t, 600)
  assert.equal(f.lastState().chain.length, 1, 'the new round has its own')
  const game = f.lastState().game
  await f.send({ act: 'new' })
  assert.equal(f.lastState().game, game + 1)
})

test('junk from the page is ignored', async () => {
  const f = await started({}, YOU_OPEN)
  await f.send({ hello: 1, visible: false })
  const n = f.posts.length
  for (const m of [
    null,
    'x',
    5,
    {},
    { act: 'play' },
    { act: 'play', tile: { a: 'zz', b: 1 }, end: 'S' },
    { act: 'play', tile: { a: 6, b: 6 }, end: 'S' },
    { act: 'play', tile: { a: 1, b: 1 }, end: '__proto__' },
    { act: 'next' },
    { act: 'goto' },
    { act: 'resume' },
    { act: 'seen' },
    { act: 'toString' },
    { act: 'step' },
  ]) {
    await f.send(m)
  }
  assert.equal(f.posts.length, n)
  await f.click('nope')
  assert.equal(f.posts.length, n)
})

test('the plugin is harmless: no exec, network, secrets, overlays or session writes in its code', () => {
  const files = ['dist/host.js', 'lib/rules.js', 'lib/bots.js', 'lib/pause.js', 'lib/controller.js', 'panels/kozel.js', 'panels/view.js']
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    for (const bad of [
      'ctx.exec',
      'ctx.processes',
      'ctx.secrets',
      'ctx.oauth',
      'ctx.overlay',
      'ctx.openExternal',
      'sessions.send',
      'sessions.open',
      'sessions.close',
      'sessions.rename',
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      "require('node:child_process')",
      "require('child_process')",
      'localStorage',
      'alert(',
      'innerHTML',
      'insertAdjacentHTML',
    ]) {
      assert.equal(text.includes(bad), false, `${file} uses ${bad}`)
    }
  }
})

test('the computer players see only what a player at the table could: bots.js reads no other hand', () => {
  const text = fs.readFileSync(path.join(root, 'lib/bots.js'), 'utf8')
  // The only read of g.players is the seat's own hand and every hand's length, in knowledge().
  const reads = [...text.matchAll(/g\.players[^\n]*/g)].map((m) => m[0])
  assert.deepEqual(reads, ['g.players[p].hand.map((t) => ({ a: t.a, b: t.b })),', 'g.players.map((x) => x.hand.length),'])
})

test('English only: no Cyrillic anywhere in the plugin', () => {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === 'node_modules' || e.name === '.git') return []
      const p = path.join(dir, e.name)
      return e.isDirectory() ? walk(p) : [p]
    })
  for (const file of walk(root)) {
    if (!/\.(js|json|html|css|svg|md)$/.test(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    assert.equal([...text].some((ch) => ch.codePointAt(0) >= 0x400 && ch.codePointAt(0) <= 0x4ff), false, path.relative(root, file))
  }
})

test('the manifest: id, one right-zone panel with an svg icon, no settings, files present, no cli, skills or access', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'))
  assert.equal(m.id, 'bronos.kozel')
  assert.equal(m.name, 'Kozel')
  assert.equal(m.api, 1)
  assert.equal(m.version, '0.1.0')
  assert.deepEqual(Object.keys(m.contributes), ['panels'])
  assert.equal(m.access, undefined)
  assert.equal(m.services, undefined)
  const [p] = m.contributes.panels
  assert.equal(p.id, 'kozel')
  assert.equal(p.title, 'Kozel')
  assert.equal(p.defaultZone, 'right')
  assert.match(p.icon, /\.svg$/)
  for (const file of [m.main, p.entry, p.icon]) assert.ok(fs.existsSync(path.join(root, file)), file)
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.version, m.version)
})

test('the page: no inline script or handlers, relative URLs only, the SDK first, the helpers before the page', () => {
  const html = fs.readFileSync(path.join(root, 'panels/kozel.html'), 'utf8')
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1], /src="/, 'every script has a src')
    assert.equal(m[2].trim(), '', 'no inline script')
  }
  assert.equal(/\son[a-z]+=/i.test(html), false, 'no inline event handlers')
  assert.equal(/(src|href)="\//.test(html), false, 'no root-absolute URL')
  assert.ok(html.indexOf('src="../__sdk/panel.js"') < html.indexOf('src="view.js"'))
  assert.ok(html.indexOf('src="view.js"') < html.indexOf('src="kozel.js"'))
  assert.equal(html.includes('lib/'), false, 'the rules stay in the host')
  assert.equal(/<form\b/i.test(html), false)
  // Plugin pages have no reset: without this a class with a display shows a hidden element.
  const css = fs.readFileSync(path.join(root, 'panels/kozel.css'), 'utf8')
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/)
  assert.equal(/url\(\s*['"]?\//.test(css), false, 'no root-absolute URL in the css')
  // Each page script is one IIFE: a top-level const that clashes with a window property (top, name, open, history)
  // kills a classic script.
  for (const file of ['panels/kozel.js', 'panels/view.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    assert.equal(/^(const|let|var|function|class)\s/m.test(text), false, `${file} declares nothing at its top level`)
  }
})

test('the page has light and dark colours: the felt and tiles through light-dark()', () => {
  const css = fs.readFileSync(path.join(root, 'panels/kozel.css'), 'utf8')
  for (const v of ['--k-felt', '--k-tile', '--k-turn']) assert.match(css, new RegExp(`${v}: light-dark\\(`), v)
})
