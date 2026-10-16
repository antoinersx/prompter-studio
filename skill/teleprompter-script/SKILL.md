---
name: teleprompter-script
description: Write or reformat any script that will be read on camera from a teleprompter (Prompter Studio format): spoken-style rewriting, short phrase lines, numbers written as spoken, sections, cues and emphasis.
---

# Teleprompter Script

Use this whenever a script is going to be read on camera from a teleprompter: long YouTube videos, Shorts/Reels batches, intros, ad reads, or when someone pastes a script and says "format this for the prompter". If a voice or tone skill exists for the speaker, use it for tone. This skill decides how the words sit on the screen and how easy they are to say.

The output is designed for **Prompter Studio** (a two-camera recorder in Chrome with voice-follow scrolling, usually on a small screen such as the Elgato Prompter). Prompter Studio has a "Format for prompter" button that does the mechanical layout. This skill does what the button can't: rewriting for the mouth.

## Output format (exactly what Prompter Studio understands)

```
# 1. Hook
I made ten thousand
four hundred dollars
with memecoins in just one week
following a simple strategy.

[SHOW WALLET]

And I'm breaking down
exactly how you can *copy it*.

# 2. The problem
...
```

- `# Title` = section. Shown small, never read. Number them (`# 1. Hook`, `# 2. ...`): keys 1–9 jump to sections while recording. Aim for 4–9 sections in a long video.
- `[CUE]` = stage direction (B-roll, show screen, pause, look at camera B). Shown small in blue, never read, ignored by voice-follow. Uppercase, on its own line, short.
- `*word*` = emphasis, shown underlined. Use sparingly: at most one per sentence, only on the word that carries the punch.
- Blank line = new paragraph (a breath, a beat). One idea per paragraph, 1–4 sentences.
- Each sentence starts on a new line.
- No other markdown: no bold, bullets, links, tables, emoji or URLs. They show up as clutter on the prompter.

## Line layout

- **Short lines: 3–6 words, about 32 characters max.** Prompter screens are small and the eyes must not travel. If the speaker gives a font size or measured width, match it.
- **Break at phrase boundaries,** the way you'd breathe: after commas, before *and / but / because / so / which / when / if*, before prepositions (*to, from, with, for*), before *-ing* phrases.
- **Never break** between an article/possessive and its noun (*the / coin*), inside a number (*ten thousand / four hundred* is OK, *ten / thousand* is not), inside a name or ticker, or between a verb and a tiny object (*copy / it*).
- **No one-word orphan lines.** Rebalance with the line above.

## Write for the mouth, not the eye

- **Sentences: 8–18 words, never over 25.** Split anything longer.
- Contractions always (*I'm, you'll, don't, it's*).
- Front-load the point. Put the important word last in the sentence; that's where the voice naturally lands.
- Remove parentheticals and mid-sentence asides. Make them their own short sentence.
- Replace written-only connectors: *however* → *but*; *therefore* → *so*; *in addition* → *also*; *utilize* → *use*; *approximately* → *about*.
- Avoid stacked adjectives and noun piles (*on-chain smart-money wallet-tracking tool* → *a tool that tracks smart-money wallets on-chain*).
- Watch tongue twisters and repeated sounds. Read each line in your head out loud.
- Signpost structure out loud: *First… Here's the thing… Now the important part… So, to recap…*
- Questions and direct address (*you*) keep energy up. A rhetorical question every 30–60 seconds is a good pace.

## Numbers, symbols and names: write exactly what is said

- Money: `$10,400` → *ten thousand four hundred dollars*; `$3.5M` → *three and a half million dollars*; `$65k` → *sixty-five K* only if that's how the speaker says it.
- Percent: `20%` → *twenty percent*; `0.5%` → *half a percent*.
- Years: `2026` → *twenty twenty-six*. Multipliers: `10x` → *ten-X*. Ranges: `5–10` → *five to ten*.
- Prices with many decimals: round to what you'd say (*a third of a cent*).
- Symbols: `&` → *and*, `vs.` → *versus*, `→` → *to*, `e.g.` → *for example*.
- Names, tickers and products: write them the way the speaker says them. For an unclear pronunciation, add a cue once: `[SAY: "stalk-chain"]`.
- Wallet addresses, URLs and contract addresses never go on the prompter. Use a cue: `[ON SCREEN: WALLET ADDRESS]`.

## Voice-follow friendly

Prompter Studio scrolls by matching what the speaker says against the script.
- Write what will actually be said. The closer the words, the smoother the scroll.
- Avoid repeating the exact same 4+ word phrase within the same minute (a repeated line can make it jump back). If a repeat is intentional, keep it and add a `[REPEAT]` cue before the second one.
- Jokes and ad-libs don't need to be scripted: the prompter waits. Leave room with a `[RIFF]` cue.

## Length and timing

- Default reading pace: **150 words per minute** (adjust if the speaker gives theirs). 12–15 minutes ≈ 1,800–2,250 words. A 30–45 s Short ≈ 75–110 words.
- State the word count and estimated runtime at the top of the reply (not inside the script).

## When reformatting an existing script

1. Keep the meaning, the jokes and the voice. Change only what makes it hard to read aloud or follow on a small screen.
2. Apply the format and layout rules above.
3. Split sentences over 25 words; fix written-only phrasing; spell out numbers.
4. After the script, list the non-mechanical changes in 3–6 bullets so the speaker can veto them.

## Delivery

- Put the script in a single code block (so line breaks survive copy-paste), or save it as a `.md` file named after the video, which loads with "Load .txt / .md" in Prompter Studio.
- Nothing inside the script except spoken lines, `# sections` and `[CUES]`.

## Final checklist

- [ ] Sections numbered with `#`, 4–9 for long-form
- [ ] No line over ~32 characters, no orphan words, no break after *the / a / to / of*
- [ ] Every sentence ≤ 25 words, most 8–18
- [ ] All numbers, money, percentages and symbols written as spoken
- [ ] No markdown, links, emoji, URLs or addresses
- [ ] Cues uppercase in `[ ]` on their own line; emphasis ≤ 1 per sentence
- [ ] Word count and runtime stated outside the script
