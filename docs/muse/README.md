# Work packages for the Muse worker

Repository: obaid08642-ops/goldenprice-backend (website in `web/`, backend in the root).
You work only through pull requests. A reviewer (Claude) checks every PR, merges it or asks for changes in the PR comments. Check your open PRs for comments every time you start a pass.

## Rules (all tasks)
1. Branch name `muse/<task>-<topic>`, branched from `main`. One PR = one task and at most 10 countries. Never push to `main`.
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
> Clone obaid08642-ops/goldenprice-backend, read docs/muse/README.md completely and follow it. Start with task T1 for BD, LK, NP, ID, TH (one PR), then T2 for the first 10 countries (second PR). Open PRs against main, describe sources in the PR body, then check the PR comments for review feedback and fix what is asked. Repeat until the lists are done.
