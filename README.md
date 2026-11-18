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
`assets/journey.js` drives the home page: one continuous camera move from a sunny arrival, through the living room and staircase, to the backyard at sunset as the lights come on.
- Now: three reference photos in `assets/tour/` (`TOUR.shots`). They are placeholders sourced from Pinterest; replace them with images you own or have licensed before promoting the site.
- Later: a walk-through video. Cut it into frames with `tools/make-tour-frames.sh` and set `TOUR.frames.count` for a fully seamless, preloaded tour.
