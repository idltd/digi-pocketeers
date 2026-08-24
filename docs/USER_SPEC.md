# Digi Pocketeers — user specification

What the app does, described only as the people using it experience it.

## The idea

A pocket handheld games machine, in the spirit of Tomy Pocketeers, that a group
of people can play together around a table — in a pub, on a train, in a field —
with no internet, no accounts, and nothing for most of them to install.

One person's phone runs the show. Everybody else joins it with their camera and
plays in their browser.

## The people

- **The host.** Owns the phone that runs the app. The only person who installs
  anything. Can play too.
- **The guests.** Anyone at the table with a phone and a camera. They install
  nothing, type nothing, and create no account.

## Non-negotiables

1. Works with no internet, no mobile data and no local network. The host's phone
   provides everything.
2. Guests never install an app, never type a code, never make an account.
3. Nothing about joining requires reading small print off someone else's screen.
   A camera does the work.
4. The host can play at the same time as running the game.
5. A phone locking, a call arriving, or someone wandering off for a minute does
   not break the game for anyone else.
6. It is a pub toy: readable at arm's length, playable with one hand, funny when
   it goes wrong.

## Solo play

Opening the app puts the player straight into the games machine — the same
screen a guest would see. They pick a game and play. No sign-in, no lobby, no
mention of other players unless they ask for it.

Solo scores are kept on that phone and shown as personal bests.

## Hosting a game

The host chooses to host from inside the games machine, not from a separate
settings screen. From their point of view it is three things in order:

1. **"Get on my Wi-Fi."** The phone starts offering its own Wi-Fi and shows a
   code for it. Guests point their cameras at it and their phones join. The
   host can show this again at any time, because people arrive late.
2. **"Open the game."** A second code sends each guest's phone straight into
   the games machine, already part of this table's game. Nothing to type.
3. **"Who's here."** The host sees people arrive as they arrive, numbered in the
   order they joined, and can start a game when the table is ready.

The host stays in control of what is played. Guests wait to be taken into a
game; they never start one.

While hosting, the host's phone must be usable as a games machine — hosting is
a state it is in, not a mode that takes the screen away.

## Joining as a guest

A guest points their camera at the first code, then the second. They land in the
game already joined and are told who they are ("player 3"). They wait for the
host to start something.

If a guest arrives before the host has opened a game, they are told so plainly
and are let in as soon as it exists — without having to scan again.

If a guest's phone locks or their browser is put away for a moment, coming back
puts them into the same game as the same player, with their score intact.

## Playing together

When the host starts a game, every phone at the table enters it at once. Nobody
taps "ready".

Two shapes of multiplayer, both of which must exist:

**Everyone on their own screen, at the same time.** Each player plays the same
game with the same content, racing the same clock, and the table compares
results at the end.

**Everyone acting on one shared situation.** All phones show the same live
state, and the first person to act on something claims it. Ties are resolved
consistently — one winner, never two.

### Racing Pigs

Pigs waddle, stop, snort and dawdle their way up a track. It is a spectator
sport: the fun is watching them dither and get overtaken.

- Every player claims one pig by tapping a free lane. One pig each.
- The host — the games master — sends them off when the table is ready. It never
  starts on its own.
- Lanes nobody claimed still run, so a half-empty table is not blocked.
- Everyone watches the same race on their own phone, in step.
- **Each phone only makes the noise of its owner's pig.** A table of five phones
  is five different pigs snorting from five different pockets, not the same
  sound five times. This is the joke; it is a requirement, not a detail.
- Everyone sees who won, named.

### Target Range

Targets appear and vanish; tap them before they go. Gold ones pay more, bombs
cost you.

- **Own clock:** everyone shoots the same sequence of targets at the same time on
  their own phone, and the table gets a leaderboard at the end.
- **Shared range:** every phone shows the same targets, and the first person to
  hit one takes the points for it. Everyone sees who claimed each target as it
  happens.

### Other games

Any game may be played solo. A game that has not been made multiplayer is
offered to a solo player normally and is simply not on the host's list of things
to start for the table.

## Interruptions and leaving

- A player who disappears briefly comes back as themselves.
- A player who leaves for good stops holding up the table.
- If the host leaves or stops hosting, the table is told; it does not silently
  freeze.
- Ending the session puts the host's phone back to normal — its Wi-Fi as it was,
  nothing left running.

## When something cannot happen

Whenever the app cannot do what was asked, it says which of these is true, in
one plain sentence, on the screen the person is already looking at:

- the phone will not open its Wi-Fi (and what the host should do about it);
- the game the guest scanned into is not running yet;
- the connection to the table has dropped and is being retried;
- this phone is not able to host at all.

No error codes, no jargon, and never a screen that just sits there.

## Controls

Multiplayer games are played with taps and swipes so that they work identically
on every phone at the table. Tilt-driven games are solo games.

## Sound

Sound is part of the toy. Every phone plays its own player's sounds, never the
whole table's. A phone can be silenced without leaving the game.

## Out of scope

- Playing with people who are not in the room.
- Accounts, friends lists, persistent leaderboards across sessions.
- More than one table hosted at once by the same phone.
- Guests installing anything at all.

## Done means

With no internet available at all:

1. A host starts a game on their phone.
2. Three guests join it using only their cameras, having installed nothing.
3. The table plays Racing Pigs — everyone picks a pig, the host sends them off,
   every phone shows the same race, and each phone snorts only for its own pig.
4. The table plays Target Range in both shapes and gets one agreed winner each
   time.
5. A guest's phone locks mid-game and returns as the same player.
6. A late arrival joins between games with the same two scans.
7. The host stops hosting, and every phone — including the host's — is left in a
   normal state.
