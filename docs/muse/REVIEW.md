# Review rules (used by the reviewer and by the worker before opening a PR)

A PR is merged into `muse/staging` only if ALL of these hold. Anything else is sent back with a comment.

## All data
- Every figure has a specific page URL (not a bare homepage when the page has a path) and a date. The URL must be the page that really contains the number. A URL that is unrelated to the number (wrong product, wrong year, wrong topic) is a rejection.
- Primary sources only: ministries, regulators, tax/customs authorities, central statistics offices, state or national oil companies, national utilities, official dealer or bank price lists. NOT acceptable: blogs, travel or lifestyle sites, news sites or wire mirrors, shops' marketing articles, forums, PDFs of other products, aggregators. If the only support is a news report, leave the number out.
- Figures must describe the whole country. One distributor, one city or one province is not "the country" (examples to omit: Hydro-Quebec for Canada, Enel Sao Paulo for Brazil, Edenor for Argentina, Moscow for Russia, Meralco for the Philippines, CLP for Hong Kong, Delhi tariff for India, Beijing tariff for China). Exception: a national tariff structure that several operators apply identically.
- Lifeline or first-block tariffs are allowed only if the basis is stated in `src` (they are shown as a tier price, not as an average).
- Fuel: put the main petrol grade in `petrol95` and name the grade (87, 91, 92, 95, E10, premium) in `src`. Never convert a different grade silently.
- If a number could not be verified, omit it. Fewer correct numbers beat many doubtful ones.

## Retail files (T1)
- `tier 1` needs 3 or more sources and all must be primary. If fewer than 3 primary sources remain after removing blogs/shops articles, use `tier: 2` (1 source minimum) and set `confidence: "low"` unless 2+ primary sources agree.
- `confidence: "medium"` means at least two primary sources support the tax and premium figures. Dealer price lists for bar sizes count as primary for premiums.
- Premiums are calculated from the dealer's table against the spot price at the same time; show the calculation in `notes`.

## Cost files (T2)
- Run `NODE_USE_ENV_PROXY=1 node scripts/check-costs.mjs` and paste the output.

## PR hygiene
- Base `muse/staging`, never `main`. Do not merge your own PRs. One PR per batch of up to 10 countries. Stacked PRs must say what they stack on.
- Answer review comments by pushing new commits to the same branch and writing a short note in issue #17.

## Stricter rules (added after round 3)
- Every figure carries a `quote`: the verbatim sentence or table row you read on the page, containing the number. Costs: `quote` next to `url`. Retail: `quote` in each source object (not needed only for `confidence: low`). A figure without a matching quote is rejected by the checker.
- Two independent primary sources for any tax or duty rate that is marked medium confidence (a legislation text plus the authority's own guidance, or two official pages). One source means `low`.
- `src` must name the official body that publishes the number. Phrases like "reports", "according to", "wire" are rejected.
- Dates: use the date printed on the page. If the page has no date, the figure is not used.
- If a page cannot be opened by you, the figure is omitted. Do not reconstruct a number from search snippets, from memory, or from a secondary site that quotes the primary one.
