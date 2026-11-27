#!/usr/bin/env python3
"""Refreshes src/data/costs.json from free public sources (run monthly; see .github/workflows/costs.yml).
 - Big Mac price per country (The Economist, CC BY 4.0): local-currency price of one Big Mac
 - EU Weekly Oil Bulletin (European Commission): pump prices incl. taxes, EUR per 1000 L
 - Eurostat nrg_pc_204: household electricity price incl. taxes, EUR per kWh (band 2,500-4,999 kWh/yr)
Nothing here is estimated; a country is only present when the source row exists."""
import csv, io, json, re, sys, urllib.request, zipfile, datetime
UA = {"User-Agent": "Mozilla/5.0"}
def get(url, raw=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        b = r.read(); return b if raw else b.decode("utf-8")
out = {"updated": datetime.date.today().isoformat(), "bigmac": {}, "fuel": {}, "electricity": {}}
# ISO3 -> ISO2
iso = {r["alpha-3"]: r["alpha-2"] for r in csv.DictReader(io.StringIO(get("https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.csv")))}
# Big Mac: latest row per country
rows = list(csv.DictReader(io.StringIO(get("https://raw.githubusercontent.com/TheEconomist/big-mac-data/master/output-data/big-mac-full-index.csv"))))
for r in sorted(rows, key=lambda r: r["date"]):
    cc = iso.get(r["iso_a3"])
    if cc and r["local_price"] and r["currency_code"] and r["dollar_price"]:
        out["bigmac"][cc] = {"cur": r["currency_code"], "local": float(r["local_price"]), "usd": round(float(r["dollar_price"]), 2), "date": r["date"]}
# EU Weekly Oil Bulletin
NAMES = {"Austria":"AT","Belgium":"BE","Bulgaria":"BG","Croatia":"HR","Cyprus":"CY","Czechia":"CZ","Denmark":"DK","Estonia":"EE","Finland":"FI","France":"FR","Germany":"DE","Greece":"GR","Hungary":"HU","Ireland":"IE","Italy":"IT","Latvia":"LV","Lithuania":"LT","Luxembourg":"LU","Malta":"MT","Netherlands":"NL","Poland":"PL","Portugal":"PT","Romania":"RO","Slovakia":"SK","Slovenia":"SI","Spain":"ES","Sweden":"SE"}
try:
    page = get("https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en")
    m = re.search(r'href="([^"]*Weekly_Oil_Bulletin_Prices_History[^"]*\.xlsx[^"]*)"', page) or re.search(r'href="([^"]*document/download[^"]*Prices_History[^"]*)"', page)
    url = "https://energy.ec.europa.eu/document/download/264c2d0f-f161-4ea3-a777-78faae59bea0_en?filename=Weekly_Oil_Bulletin_Prices_History_maticni_4web.xlsx"
    z = zipfile.ZipFile(io.BytesIO(get(url, True)))
    ss = [re.sub(r"<[^>]+>", "", s) for s in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode(), re.S)]
    x = z.read("xl/worksheets/sheet1.xml").decode()
    def cells(r):
        d = {}
        for col, attr, inner in re.findall(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', r, re.S):
            v = re.search(r"<v>(.*?)</v>", inner or "")
            if v: d[col] = ss[int(v.group(1))] if 't="s"' in attr else float(v.group(1))
        return d
    rws = {int(n): cells(r) for n, r in re.findall(r'<row [^>]*r="(\d+)"[^>]*>(.*?)</row>', x, re.S)}
    date = (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(rws[2]["A"]))).isoformat()
    for r in rws.values():
        cc = NAMES.get(str(r.get("A", "")).strip())
        if cc and isinstance(r.get("B"), float):
            f = {"cur": "EUR", "date": date, "src": "EU Weekly Oil Bulletin", "petrol95": round(r["B"] / 1000, 3)}
            if isinstance(r.get("C"), float): f["diesel"] = round(r["C"] / 1000, 3)
            if isinstance(r.get("G"), float): f["lpg"] = round(r["G"] / 1000, 3)
            out["fuel"][cc] = f
except Exception as e: print("oil bulletin failed:", e, file=sys.stderr)
# Eurostat household electricity (all taxes)
try:
    d = json.loads(get("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_204?format=JSON&lang=EN&nrg_cons=KWH2500-4999&tax=I_TAX&currency=EUR&unit=KWH&sinceTimePeriod=2024-S1"))
    geo = list(d["dimension"]["geo"]["category"]["index"]); tm = list(d["dimension"]["time"]["category"]["index"]); nt = len(tm)
    for gi, g in enumerate(geo):
        for ti in range(nt - 1, -1, -1):
            v = d["value"].get(str(gi * nt + ti))
            if v is not None:
                cc = {"EL": "GR", "UK": "GB"}.get(g, g)
                if len(cc) == 2: out["electricity"][cc] = {"cur": "EUR", "kwh": round(v, 4), "period": tm[ti], "src": "Eurostat nrg_pc_204, household 2,500-4,999 kWh/yr, all taxes"}
                break
except Exception as e: print("eurostat failed:", e, file=sys.stderr)
json.dump(out, open("src/data/costs.json", "w"), indent=1, sort_keys=True)
print({k: len(v) for k, v in out.items() if isinstance(v, dict)})
