# masonsellsaustin.com

Personal real estate showcase site for Mason Bleasdell (Mark Martin and Company).

- `index.html` — the full site (single file).
- `hero.jpg` — homepage hero image.
- `scripts/refresh.mjs` — rebuilds the Active Listings and Recently Sold
  sections from Mason's homes.com profile.
- `.github/workflows/refresh.yml` — runs the refresh every Friday (and on
  demand). If homes.com can't be read, it leaves the site unchanged.

Hosted on Netlify with continuous deployment: any push to `main` republishes.
