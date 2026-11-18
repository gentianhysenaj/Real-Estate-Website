# Gentian Real Estate website

A fast static site, hosted on Netlify (no build step).

| Page | Path | What it does |
| --- | --- | --- |
| Home / About | `/` | Introduces Gentian, services, reviews and a contact form |
| Home search | `/search/` | Visitors leave first name, last name, email and phone, then can search homes (sample listings until the MLS®/IDX feed is connected) |
| Presentations | `/presentations/` | PIN-protected buyer and listing presentations |

## Leads
The contact form and the home-search sign-up use **Netlify Forms**. Submissions show in the Netlify dashboard under *Forms*, and you can turn on email notifications there.

## Placeholders to replace
- Photo, bio, stats, reviews, phone and email in `index.html` (search for `PLACEHOLDER`)
- Slide content in `presentations/index.html` (`DECKS`)
- PIN: `PIN_HASH` in `presentations/index.html` (SHA-256 of the PIN)

## Home page scroll tour
`assets/journey.js` drives the home page: one continuous camera move through one house, from the front in full sun, through the front door into the foyer and the open-concept living space, out the back glass doors to the backyard at sunset as the lights come on.
- Now: eight AI-generated photos of one house (made in Canva) in `assets/tour/01-front.webp` ... `08-backyard.webp` (`TOUR.shots`). The front door and the back doors open in place as you scroll.
- Each photo comes in two sizes: `name.webp` (1920 px) loads first for everyone, and `name@2x.webp` (3840 px) is added on large and retina screens. Both are made from AI 4x upscales (`tools/upscale/esrgan_upscale.py`, then `tools/upscale/make_tour_images.py`). The tour is drawn on a canvas straight from these files, so zoomed-in rooms stay crisp.
- The view through the open front door is the foyer photo itself, set in with `tools/compose-doorway.py` (`make_tour_images.py` does this for you), so walking through the door lines up exactly. Re-run it if you replace `03` or `04`.
- Later: a walk-through video. Cut it into frames with `tools/make-tour-frames.sh` and set `TOUR.frames.count` for a fully seamless, preloaded tour.

## Logo
GH monogram. Files in `assets/brand/` (`logo.svg` for the header, `logo-full.svg` with "Real estate", dark versions, app icons) and `/favicon.svg`. All are drawn by `tools/logo/build_logo.py` from the Inter typeface; it also draws the other GH options (house, doorway, solid).
