# Work packages for the Muse worker

Repository: obaid08642-ops/goldenprice-backend (website in `web/`, backend in the root).
You work only through pull requests. A reviewer (Claude) checks every PR, merges it or asks for changes in the PR comments. Check your open PRs for comments every time you start a pass.

## Branches (strict)
- `main` is production source. **You must never push, merge or open a PR into `main`.** Do not change branch protection or settings.
- `muse/staging` is your integration branch (created from `main`). Branch each piece of work from `muse/staging` as `muse/<task>-<topic>` and open the PR **with base `muse/staging`**.
- **Do not merge your own PRs.** Leave them open; the reviewer merges them into `muse/staging` and later promotes `muse/staging` to `main` after validation. If the code or data in a branch is incomplete or failing, it simply stays open: nothing breaks.
- Do not rebase or force-push after review has started; add new commits instead.

## Messages and loop
- The channel for messages is the GitHub issue titled "Muse and Claude work channel". The reviewer posts instructions and feedback there and as PR comments.
- Check that issue and the comments on all your open PRs at the start of every pass and again every 20-30 minutes while work remains. Reply in the issue with a short status after each PR (PR link, countries done, what you could not find).
- Keep going through the task lists without waiting for permission. Stop only when a list is finished or the issue says STOP.

## Rules (all tasks)
1. One PR = one task and at most 10 countries (or one language).
2. Change only the files named in the task. Do not touch application code, workflows, or any secret/config file. Never write keys or tokens anywhere.
3. Every number must come from a page you actually opened. No estimates, no memory, no search snippets. Put the exact URL and the date you read it next to the number (the data files have fields for it). If you cannot find a number, leave the field out or `null`.
4. Primary sources only: ministries, regulators, utilities, state oil companies, central banks, tax authorities, official dealer or bank price lists. Never use aggregators: globalpetrolprices.com, numbeo, statista, tradingeconomics, goodreturns, zahabprice, wikipedia, forums. (Their licences forbid reuse.)
5. Run the check script for your task before opening the PR and paste its output in the PR description. A PR whose check fails will be sent back.
6. Be conservative: fewer, correct countries beat many doubtful ones. Say in the PR what you could not find.

## Task T1: local gold retail data
Files: `web/src/data/retail/<CC>.json` (copy the structure of `_example.json`; read `scripts/check-retail.mjs` for the exact rules).
Countries first: BD LK NP ID TH VN PH TW KR KZ PL RO GR RU SE CZ HU NZ, then upgrade files whose `confidence` is `low`.
Content: VAT on jewelry and bullion, import duty, typical making charge range, bar premium by size over spot (from a dealer's price list for bars: ask price per size vs spot at the same time), buy-back discount, used-gold discount, 3+ sources for tier 1.
Check: `cd web && node scripts/check-retail.mjs <CC> [<CC> ...]`

## Task T2: official fuel and electricity prices
File: `web/src/data/costs-manual.json` (add countries, keep existing ones). Not for EU countries (they are fed automatically). Shape:
```json
{ "SA": {
  "fuel": { "cur": "SAR", "date": "2026-11-01", "src": "Saudi Aramco", "url": "https://...", "petrol95": 2.33, "diesel": 1.66, "lpg": null },
  "electricity": { "cur": "SAR", "kwh": 0.18, "period": "2026-11", "src": "SEC residential tariff", "url": "https://..." } } }
```
Values per litre and per kWh in the local currency, as published; `petrol95` means the main premium grade (91/92/95, say which in `src`). Maximum age 18 months.
Check: `cd web && NODE_USE_ENV_PROXY=1 node scripts/check-costs.mjs`
Countries: EG SA AE KW QA BH OM JO LB IQ DZ TN MA TR IR IN PK BD LK NP ID MY SG TH VN PH CN HK TW JP KR KZ GB CH UA RU US CA MX BR AR CO CL PE NG ZA KE GH ET AU NZ

## Task T3: dealer price-list pages for the daily updater
File: `web/scripts/dealers.json` (array of `{cc, cur, mode, perGram, name, url}`; see the two existing entries). Add a country only if the page shows a stable table of gold bar prices by size and `cd web && PW_PATH=<playwright path> node scripts/update-retail.mjs <CC>` prints "updated" with at least 3 sizes.

## Task T4: translation quality pass
Files: `web/src/i18n/lang/<code>.json`. Fix wrong, stiff or machine-sounding strings, one language per PR. Keep keys and placeholders (`{t}`, `{u}`, `{country}`, ...). Check: `cd web && node scripts/check-i18n.mjs <code>`.

## Start prompt to paste into the Muse session
> Clone obaid08642-ops/goldenprice-backend, check out `muse/staging`, read docs/muse/README.md completely and follow it. Never push or merge to main; never merge your own PRs; open PRs with base muse/staging only. Start with task T1 for BD, LK, NP, ID, TH (one PR), then T2 for the first 10 countries (second PR). Open PRs against muse/staging, describe sources in the PR body, then check the PR comments for review feedback and fix what is asked. Repeat until the lists are done.

## PHASE 2 queue (start after the fixes requested in issue #17 are merged; keep going until all lists are done)
All REVIEW.md rules apply. Every task: fewer correct figures beat many doubtful ones; a country with no primary source is simply skipped (list skipped countries in the PR).

### T5: local gold data for every remaining country
Files `web/src/data/retail/<CC>.json`. Order: by population, over every country in `web/src/data/countries.ts` that has no retail file or only `confidence: low`. Small countries and territories: a `tier: 2` file with only what a tax or customs authority page states (VAT on gold jewelry and bullion, import duty) is valuable; leave the rest null. Check: `check-retail.mjs`. Batches of at most 10 countries per PR.

### T6: official fuel and electricity for every remaining country
`web/src/data/costs-manual.json`, same shape and rules as T2, for every country not yet there and not in the EU (EU is automated). Check: `check-costs.mjs`.

### T7: food staples (new dataset)
File `web/src/data/staples.json`, validated by `NODE_USE_ENV_PROXY=1 node scripts/check-datasets.mjs`. Shape:
```json
{ "EG": { "cur": "EGP", "items": {
  "sugar": { "value": 32.0, "unit": "kg", "date": "2026-10-31", "src": "CAPMAS retail price bulletin", "url": "https://..." },
  "rice": {...}, "wheat_flour": {...}, "cooking_oil": {"unit":"litre"}, "eggs": {"unit":"dozen"}, "milk": {"unit":"litre"}, "chicken": {"unit":"kg"}, "beef": {"unit":"kg"} } } }
```
Items: sugar, rice, wheat_flour, cooking_oil, eggs, milk, chicken, beef, bread (unit loaf), tea. Sources: national statistics office, ministry of trade/agriculture, consumer protection authority. UN or World Bank databases (FAO FPMA, WFP) only if their licence allows commercial reuse: quote the licence line in the PR body, otherwise do not use them. National average only (not one market/city) unless the source itself is the national reference.

### T8: building materials (new dataset)
File `web/src/data/construction.json`, same validator. Items: cement (unit bag50kg) or cement_tonne (unit tonne), rebar (tonne), bricks (1000pcs), sand (m3). Sources: statistics office, ministry of housing/industry, national cement or steel association with published price lists. Same rules.

### T4 (parallel, low priority): translation quality pass
One language per PR, in this order: ar es fr de pt ru tr id hi zh ja ko it fa ur. Native-sounding wording, same keys and placeholders. Check: `check-i18n.mjs <code>`.

Not in scope (no free consistent official source): car prices and real estate prices. Do not add them.
