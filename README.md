# Kozel

A cc-cockpit plugin (`bronos.kozel`): Kozel, the domino game of the goat, against computer players in a panel, to play
while Claude works. You and your partner (across the table) against Left and Right, with the double-six set; the first
pair to 101 wins. When a Claude tab of the window finishes its turn and waits for you, the game pauses and tells you
which tab it is.

It is a harmless game: no commands, no network, no secrets, no overlays and no settings. It reads the window's Claude
tab statuses and names, and its one action on a tab is to show it when you click **Go to the tab**. It never types into
or sends anything to a session.

## Install

From a checkout: `ccc plugin link <path to this repo>`, then Allow it in the app window. The **Kozel** panel opens in
the right zone (move it like any panel).

## How to play

28 tiles (0-0 to 6-6), seven each. Play goes clockwise: you, Left, your partner (top), Right. You and Partner are one
team (**Us**), Left and Right the other (**Them**).

### A round

- In a game's first round, whoever holds the **1-1** opens with it. Later rounds are opened by the last round's
  leader (below), with any tile.
- The chain has two open ends. A tile goes on an end when one of its halves matches that end's number.
- If you have a tile that fits, you must play (there is no voluntary pass). A player with nothing that fits passes at
  once (the line under the board says so).
- The round ends when someone plays their last tile (**goes out**), or when nobody can play (a **fish**).

### Scoring

These are the rules as this plugin plays them; house rules differ.

- **Going out**: that player's team scores the pips left in the two opponents' hands. The partner's tiles are not
  counted. That player opens the next round.
- **Fish**: the player with the fewest pips in their own hand wins the round for their team, which scores the pips in
  both opponents' hands; that player opens next.
  - Partners tied for the fewest are not a tie: their team wins, and of the two, the first in turn order from the round's
    opener opens next.
  - Players of the two teams tied for the fewest: nobody scores, and the same player opens the next round.
- The first team to reach or pass **101** wins the game. If the losing team has **0** at that moment, it is the
  **goat** 🐐.
- No other bonuses: doubles, 0-0 and going out on a double score nothing extra.

### Your moves

- Your hand runs high to low from the left (the most pips first). Tiles you may play now stand raised in a thick amber
  frame; the others sit lower and faded. A tapped tile that cannot go shakes.
- A tile that fits only one end goes there on a tap. A tile that fits both ends (with different numbers) is picked
  (a white double frame): choose **◀ Left end** or **Right end ▶** under the board, or click one of the two dashed rings
  on the chain's ends. Tap the tile again, click elsewhere or press **Escape** to put it back.
- The chain snakes across the board: rows run right, then left, then right again, with a standing tile at each turn,
  so it reads from its left end (top left) to its right end. Doubles stand across the line. The tiles shrink to fit the
  board; past a floor the board scrolls.
- Whose move it is reads by shape and weight, not only colour: a **▶** before the name, bold, an amber tag with a thick
  frame; on your move your hand gets a thick frame and the line under the board says **Your move.**
- After a round a cover shows everyone's tiles left and their pips, who went out or held the fewest, what each team
  scored and the game score; **Next round** goes on. At the end of the game it shows the winner (and the goat).
- Keys work only after a click into the board (it has focus): **N** new game, **Enter** presses a cover's main button,
  **Escape** puts a picked tile back. Tiles and end buttons are buttons: Tab, Enter and Space work on them. Other keys
  go on to the app.

### The title bar

- **New game** (the circular arrow) starts a new game.
- Its text shows the game score: `Us 45 : 30 Them · to 101`.

The score cards above the board show each team's total and a bar toward 101 (yours solid with a ▸ and bold, theirs
striped). The bar under the board counts your games **Won** and **Lost**, kept for every project window, across restarts.

### The computer players

They move about every 650 ms, on a timer in the plugin's host, and only while some view shows the panel: you never come
back to moves you did not see. A round that ends stays on the table 900 ms before its score comes up.

Each decides from what a player at the table could know: its own tiles, the chain, how many tiles each player holds and
the public moves (who played what, who passed on which ends). From the passes it learns which numbers a player does not
hold. It plays a tile that goes out when it has one; otherwise it scores each legal move: heavy tiles and doubles early
(more so when an opponent is close to going out), keeping tiles that fit the new ends (best on both), leaving ends the
next opponent is known not to hold, not blocking its partner, and seeking a fish it surely wins (its own pips well
under what the opponents likely hold) while avoiding one it would lose. Ties are broken by the RNG.

The tiles grow with the panel, sized from both its width and its height (up to a limit); in a narrow panel
your hand takes two rows. The felt and the tiles have their own colours for light and dark themes.

## The Claude pause

While a game is in play (you made a move, and it is neither over nor waiting on Next round), a Claude tab of the same
window that was **working** and becomes **waiting for input** pauses it: the computer players stop, the board takes no
moves, and a cover says **Claude is ready** with the tab's name. **Resume game** goes on; **Go to the tab** shows that
tab and leaves the game paused for when you come back.

- Only a change seen while you play pauses: a tab that was already waiting, or one that finished before your first
  move, does not.
- With several tabs, the cover names the latest one to become ready.
- The game lives in the plugin's host, not in the panel page: it survives the panel being hidden or closed, and every
  view of the window shows the same game. A restart of the plugin host ends the game in progress; records are kept.

How it knows: `ctx.sessions.onChange` and one `ctx.sessions.list()` at start; **Go to the tab** is
`ctx.sessions.focus`. The computer players learn that the panel is gone from `ctx.views.onChange` and that a page is out
of sight from the page itself.

## Known limits

- A tab that stops on a permission prompt (needs permission, not waiting) does not pause the game.
- A turn shorter than the app's status throttle (about a quarter second) can be missed: no pause then.
- A host restart (linking another plugin, an app update) loses the game in progress.
- One difficulty level; the computer players do not count their partner's likely tiles beyond the passes.

## Development

Plain JavaScript, no build step: `dist/host.js` wires `lib/controller.js` (the game, the computer players' timer steps,
the pause and the records) to the plugin API and runs the timer; `lib/rules.js` is the game's rules, `lib/bots.js` the
computer players' choices and `lib/pause.js` the working-to-waiting rule, all pure. The page never sees another hand
before a round ends: the host sends your hand with what each tile may do now, so `panels/` (`view.js` its pure helpers,
the snake layout among them; `kozel.js` the drawing and the input) has no rules of its own, and the host checks every
move again.

`npm test` runs the `node:test` suites: the rules, a seeded fuzz that plays hundreds of whole games (28 tiles always,
every tile played legal, the chain linked, every round scored by its rule, totals never going down, every game ending at
101, the goat exactly at 0; `FUZZ_GAMES=n` plays more) and checks the computer players beat random play, the computer
players (always legal, deterministic for a seed, unchanged when the hidden tiles are dealt differently), the controller,
the host with a fake `ctx` and fake timers, and the page's helpers (the snake never overlaps and always links).

## License

MIT
