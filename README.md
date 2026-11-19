# Gentian Hysenaj Real Estate website

A fast static site, hosted on Netlify (no build step).

| Page | Path | What it does |
| --- | --- | --- |
| Home | `/` | The walk-through tour with panels (intro, how I sell, buying, numbers), then: areas, recently sold, home prep before/after slider, selling plan (busy vs slower market), net proceeds calculator, four steps to sold, reviews, journal, contact form |
| Journal | `/journal/<article>/` | Three short guides for buyers and sellers |
| Home search | `/search/` | Visitors leave first name, last name, email and phone, then can search homes (sample listings until the MLS®/IDX feed is connected) |
| Presentations | `/presentations/` | PIN-protected listing (24 slides) and buyer (23 slides) presentations: full-screen presenter with speaker notes, a slide overview, live calculators and slides the client taps |

## Leads
The contact form and the home-search sign-up use **Netlify Forms**. Submissions show in the Netlify dashboard under *Forms*, and you can turn on email notifications there.

## Placeholders to replace
- Stats, recent sales and client reviews in `index.html` (search for `PLACEHOLDER`). The review cards are hidden until real ones are added: remove `hidden` from `#rev-track` and `.arrows`.
- Done: brokerage (Royal LePage Pinnacle Real Estate, Brokerage), headshot (`assets/img/gentian-avatar.webp`, `gentian-portrait.webp`), phone, email, Instagram, WhatsApp click-to-chat (`wa.me` link with a ready-made first message) and the Google reviews link.
- Home prep slider photos: `assets/img/prep-before.webp` and `prep-after.webp` (a sample until real before/after photos are in)
- Presentation stats: add numbers to the "About me" slides once they're ready (`ABOUT_TABS` in `assets/presentations.js`)

## Presentations
`/presentations/` (PIN 2468 for now) opens a picker with two decks. Everything lives in `assets/presentations.js` and `assets/presentations.css`.
- **Words:** each deck is a list in `DECKS`; each slide is made by one of the templates in `T` (cards, statement, calculators, offers, timeline, reviews and so on). Every slide has speaker notes (`notes`).
- **Presenting:** → / Space / Page Down or a clicker = next, ← = back, F = full screen, O = all slides, N = notes, Esc = close. Swipe on a tablet. Items appear one at a time; on a phone, turn it sideways.
- **Client answers:** the name typed on the title slide, the priorities they tap (shown again on the recap slide) and their must-haves stay in that browser tab only (`sessionStorage`). "Clear answers for a new client" on the picker wipes them.
- **Calculators** use Ontario rules for 2026: land transfer tax with the Toronto rates from April 1, 2026, first-time buyer refunds ($4,000 Ontario, $4,475 Toronto), mortgage insurance (4.00 / 3.10 / 2.80%, +0.20% for 30 years), 8% sales tax on the premium, minimum down payments, semi-annual compounding, and 13% HST on commission.
- **PIN:** `PIN_HASH` in `assets/presentations.js` (SHA-256 of the PIN). It keeps visitors out, but it is not bank-grade security, so keep confidential client details out of the slides.

## Home page scripts
`assets/home.js` runs the before/after slider, the selling-plan tabs, the net proceeds calculator (Ontario HST of 13% on commission) and the reviews carousel. Links with `data-reason` pre-pick the matching option on the contact form.

## Home page scroll tour
`assets/journey.js` drives the home page: one continuous camera move through one house, from the front in full sun, through the front door into the foyer and the open-concept living space, out the back glass doors to the backyard at sunset as the lights come on.
- Now: eight AI-generated photos of one house (made in Canva) in `assets/tour/01-front.webp` ... `08-backyard.webp` (`TOUR.shots`). The front door and the back doors open in place as you scroll.
- Each photo comes in three files, all made from 8K AI upscales of the original 1920 px images (`tools/upscale/esrgan_upscale.py` with no width, then `tools/upscale/make_tour_images.py`):
  - `name.webp` (1920 px) loads first for everyone.
  - `name@2x.webp` (3840 px) is added on large and retina screens.
  - `name@hd.webp` is the middle half of the photo, full height, at 6144 px across the whole photo. Phones and tall screens only ever see that strip, and desktops see it when the camera pushes in, so it is drawn whenever it covers the whole screen. This is what keeps phones sharp.
  - Sharper files are fetched only as the camera gets near each room, and decoded only for the rooms around it. The tour is drawn on a canvas straight from these files.
- The view through the open front door is the foyer photo itself, set in with `tools/compose-doorway.py` (`make_tour_images.py` does this for you), so walking through the door lines up exactly. Re-run it if you replace `03` or `04`.
- Later: a walk-through video. Cut it into frames with `tools/make-tour-frames.sh` and set `TOUR.frames.count` for a fully seamless, preloaded tour.

## Logo
GH monogram. Files in `assets/brand/` (`logo.svg` for the header, `logo-full.svg` with "Real estate", dark versions, app icons) and `/favicon.svg`. All are drawn by `tools/logo/build_logo.py` from the Inter typeface; it also draws the other GH options (house, doorway, solid).
