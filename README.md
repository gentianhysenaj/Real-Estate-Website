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
`assets/journey.js` drives the home page: scrolling walks through a home (exterior → front door → rooms → backyard at sunset).
Swap the photos in `TOUR.shots`, or set `TOUR.video` to a walk-through clip to scrub through it on scroll.
