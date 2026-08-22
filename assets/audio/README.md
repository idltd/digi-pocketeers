# Pig snort samples

Drop real pig oink/snort recordings in here as:

    oink1.mp3   oink2.mp3   oink3.mp3   oink4.mp3

`js/core/audio.js` loads whatever is present and skips the rest, so **one file is
enough** — but a burst picks at random from what it finds, and four makes the pigs
sound noticeably less repetitive.

## What works best

- **Short.** A single grunt, roughly 0.2–0.5s. `honk()` plays 2–4 of them in a row to
  make a burst, so a file containing several oinks will stack up oddly.
- **Trimmed.** No leading silence — the gap between grunts is timed from the file's
  duration, so dead air at the front makes the rhythm sag.
- **Mono, mp3.** Keep them small; they're served off a phone over its own hotspot.

Pitch is varied per grunt automatically (0.9–1.15×), so the same file repeating doesn't
give itself away.

## Licensing

These get committed to a public repo, so use something clearly redistributable — CC0 is
the safest. freesound.org filtered to CC0 is the usual source for this sort of thing.

## Fallback

With no files here, the game falls back to the synthesised grunt in `audio.js`. It works,
but it sounds electronic — which is exactly why this directory exists.
