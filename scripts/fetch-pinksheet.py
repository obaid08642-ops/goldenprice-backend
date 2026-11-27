#!/usr/bin/env python3
"""Monthly: World Bank Commodity Price Data (Pink Sheet) -> data/pinksheet.json (nominal USD, since 2010). Run by .github/workflows/pinksheet.yml."""
import io, json, re, sys, urllib.request, zipfile, datetime
UA = {"User-Agent": "Mozilla/5.0"}
def get(u, raw=False):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120) as r:
        b = r.read(); return b if raw else b.decode("utf-8", "replace")
page = get("https://www.worldbank.org/en/research/commodity-markets")
m = re.search(r'https://thedocs\.worldbank\.org/[^"]*CMO-Historical-Data-Monthly\.xlsx', page)
if not m: sys.exit("Pink Sheet link not found")
z = zipfile.ZipFile(io.BytesIO(get(m.group(0), True)))
ss = [re.sub(r"<[^>]+>", "", s) for s in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode(), re.S)]
names = re.findall(r'<sheet [^>]*name="([^"]+)"', z.read("xl/workbook.xml").decode())
x = z.read(f"xl/worksheets/sheet{names.index('Monthly Prices') + 1}.xml").decode()
rows = {}
for n, r in re.findall(r'<row [^>]*r="(\d+)"[^>]*>(.*?)</row>', x, re.S):
    d = {}
    for col, attr, inner in re.findall(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', r, re.S):
        v = re.search(r"<v>(.*?)</v>", inner or "")
        if v: d[col] = ss[int(v.group(1))] if 't="s"' in attr else v.group(1)
    rows[int(n)] = d
clean = lambda s: re.sub(r"[\s*]+", " ", s).strip()
head = {clean(v): k for k, v in rows[5].items() if k != "A"}
WANT = {"TEA": "Tea, avg 3 auctions", "PALMOIL": "Palm oil", "COCONUTOIL": "Coconut oil", "SUNFLOWEROIL": "Sunflower oil", "RAPESEEDOIL": "Rapeseed oil", "RUBBER": "Rubber, RSS3", "UREA": "Urea", "DAP": "DAP", "POTASH": "Potassium chloride", "PHOSPHATE": "Phosphate rock", "BEEF": "Beef", "CHICKEN": "Chicken", "BANANA": "Banana, US", "ORANGE": "Orange", "FISHMEAL": "Fish meal", "PLYWOOD": "Plywood", "SAWNWOOD": "Sawnwood, Malaysian"}
out = {"updated": datetime.date.today().isoformat(), "source": "World Bank Commodity Price Data (Pink Sheet), nominal US$", "series": {}}
for sym, name in WANT.items():
    col = head.get(name)
    if not col: print("missing column", name, file=sys.stderr); continue
    pts = []
    for n in sorted(rows):
        if n < 7: continue
        k = rows[n].get("A", ""); mm = re.fullmatch(r"(\d{4})M(\d{2})", k)
        if not mm or int(mm.group(1)) < 2010: continue
        try: v = float(rows[n][col])
        except Exception: continue
        pts.append([f"{mm.group(1)}-{mm.group(2)}-01", round(v, 4)])
    if pts: out["series"][sym] = pts
json.dump(out, open("data/pinksheet.json", "w"), separators=(",", ":"))
print({k: (len(v), v[-1]) for k, v in out["series"].items()})
