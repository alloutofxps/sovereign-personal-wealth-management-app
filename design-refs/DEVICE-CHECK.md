# Taking Sovereign to a phone

One page. Work down it in order — the early ones fail loudest and the later
ones need you to have been using the app for a few days.

You don't need to remember anything else. For each thing there's what to do,
and what "wrong" looks like. If something looks wrong, **write down what you
were doing and what you saw**, and if you can, whether it happens every time.
That's worth more than a guess at the cause.

Nothing here can lose your data. There's an export in Settings — take one
before you start, and again at the end of the week.

---

## Before anything else

**Add it to your home screen.** In Safari, Share → Add to Home Screen. Open it
from that icon, not from Safari. Everything below assumes the home-screen
version, because that's the one with the problems.

> **Wrong:** the icon is a grey square, a tiny screenshot of the page, or has
> white corners where the others are rounded.

---

## 1. The status bar, in both themes

The strip at the very top with the clock and battery.

Open the app from the home screen. Look at the clock. Then Settings → switch
between Daylight and Midnight, and go back to the top of the app.

> **Wrong:** the clock or battery is invisible, or nearly — dark grey on near
> black, or white on cream. Either theme.
>
> **Wrong:** the app's own content slides up underneath the clock, so a
> heading and the time overlap.
>
> **Wrong:** there's a band of the wrong colour behind the clock — white above
> a dark app, or dark above a light one.

This is the thing most likely to be wrong, and it cannot be tested anywhere
but on a real phone.

---

## 2. Rotate it, and come back

Turn the phone sideways, then upright again. Also: pull the notification
shade down and push it back up.

> **Wrong:** a strip of blank colour appears at the bottom or top and stays.
>
> **Wrong:** the bar of buttons along the bottom ends up in the middle of the
> screen, or off it.
>
> **Wrong:** you have to scroll to reach something that was visible before.

---

## 3. The home-screen shortcut

Press and hold the app's icon on the home screen. A short menu should appear
with one or two shortcuts.

Tap one.

> **Wrong:** nothing appears when you hold the icon.
>
> **Wrong:** the shortcut says one thing and opens another — e.g. it offers to
> record a payment and lands you on the main screen instead.

---

## 4. The keyboard, on a form

Tap the **+** button in the middle of the bottom bar. Type an amount. Then tap
the payee or note field and type a few words.

> **Wrong:** the whole page zooms in when you tap a field, and stays zoomed.
>
> **Wrong:** the keyboard covers the field you're typing into, so you can't
> see what you're writing.
>
> **Wrong:** the keyboard covers the button you need to press to save, with no
> way to scroll to it.
>
> **Wrong:** the number pad shows letters, or the amount field brings up a
> full keyboard instead of digits.
>
> **Wrong:** you type and nothing appears, or the cursor jumps to the front.

Then dismiss the keyboard by tapping away.

> **Wrong:** the page stays scrolled up with a gap where the keyboard was.

---

## 5. A panel sliding up and down

Lots of things open as a panel from the bottom — tapping a payment, the **+**
button, an information button.

Open one. Close it with the X. Open it again and close it by **dragging it
down**. Open it and close it by tapping the dimmed area behind it.

> **Wrong:** it appears instantly with no movement, or it jumps.
>
> **Wrong:** dragging it down does nothing, or it sticks half-way.
>
> **Wrong:** after it closes, the screen behind stays slightly shrunk or
> dimmed.
>
> **Wrong:** you close it and the page behind has jumped to a different scroll
> position.
>
> **Wrong:** you can still scroll the page behind while the panel is open.

---

## 6. The bottom bar over a long list

Go to the record of everything (**Ahead** → or the main list of payments) and
scroll right to the very bottom.

> **Wrong:** the last row is stuck behind the bottom bar and you can't read it
> or tap it, however far you scroll.
>
> **Wrong:** the bar is solid where it should be slightly see-through, or the
> blur behind it flickers as you scroll.
>
> **Wrong:** the bar drifts up and down as you scroll instead of staying put.

---

## 7. A long name

Record a payment to something with a genuinely long name — a full company
name, or "Amsterdam Municipal Waste Collection Service". Then find it in the
list and open it.

> **Wrong:** the name pushes the amount off the right-hand edge.
>
> **Wrong:** the name runs over the top of the amount.
>
> **Wrong:** the row grows to three or four lines and the list becomes
> unreadable.
>
> A name ending in **…** is *correct* — that's deliberate.

---

## 8. Labels cut off mid-word

This is a known weak spot, so it's worth a deliberate look. Small grey labels
sit above figures in the coloured panel at the top of several screens —
**Today**, **Envelopes**, **Pots**, **Ahead → Where it went**, **Payoff**.

Read each label.

> **Wrong:** a label ends in **…** and you can't tell what the number is —
> "More than c…", "Still to go th…", "Assigned this…".

Three of these were found and fixed on one screen this week by measuring them.
The others have never been measured, and they're the most likely thing on this
list to be quietly wrong.

---

## 9. Tapping small things

Work along the bottom bar, then the small **i** buttons beside headings, then
the little pills that switch between time periods.

> **Wrong:** you have to aim. If a tap lands next to a button and nothing
> happens, or the wrong thing opens, note which one.
>
> **Wrong:** a button stays highlighted after you lift your finger, as though
> it's still being pressed.

That last one is specific: on a phone there's no such thing as hovering, and a
highlight that sticks is a real fault. It was found and fixed in 57 places;
if you see one that was missed, it'll look like a permanently shaded row.

---

## 10. Turn animation off

iOS Settings → Accessibility → Motion → **Reduce Motion** on. Then reopen the
app and move around it.

> **Wrong:** anything still slides or fades.
>
> **Wrong:** something is *missing* — a figure or a line of text that was
> there before. Blank space where words should be is the specific failure to
> watch for here, and it looks like a gap rather than an error.

Turn it back off afterwards.

---

## 11. Aeroplane mode

Turn on aeroplane mode and use the app normally for a few minutes — record
something, look at every screen.

> **Wrong:** anything at all changes. No screen should notice. There is no
> server, so if something breaks without a network, something is reaching for
> one that shouldn't be.

---

## 12. Close it properly, and come back

Swipe the app fully away (app switcher → flick it up). Wait a minute. Open it
again from the home-screen icon.

> **Wrong:** anything you recorded is missing.
>
> **Wrong:** it asks you to set up from scratch.
>
> **Wrong:** a blank screen, a spinner that never stops, or an error with
> code-looking text in it.

Then leave it closed overnight and open it in the morning. Same checks.

**This is the most valuable item on the page.** Storage is the one part of the
app whose failure behaviour has never been tested anywhere, and the dogfooding
database lost everything twice during the build. If your week's records
survive seven days and a few restarts, that's the single best piece of news
this project could get.

---

## Over the week

Use it with real money. Then, at the end:

- Do the figures on **Today** match what your bank app says you have, once you
  account for what you've told Sovereign is set aside?
- Does anything ever say you have **more** spare money than you think you do?
  That's the direction that matters — a figure that flatters you is worse than
  one that doesn't.
- Is there any screen you avoided because you weren't sure what it was telling
  you?

That last question is the one no test can ask.

---

## If something goes badly wrong

Settings → export. It writes a file you can keep. Do that **before** trying to
fix anything, because the export is the evidence as well as the backup.

Then write down what you were doing. Not what you think caused it — what you
were doing. Every worthwhile finding in this project came from someone
noticing something looked off and saying exactly what they saw.
