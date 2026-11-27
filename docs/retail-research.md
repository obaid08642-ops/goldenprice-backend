# Local gold & silver price research: status and links

Generated from `web/src/data/retail/`. **Shown on the site** only for medium/high confidence files.

- Shown on the site (15): EG, SA, AE, KW, QA, BH, MY, SG, JP, IE, DE, NL, CA, ZA, AU
- Low confidence, not shown (35): OM, JO, LB, IQ, LY, TN, DZ, MA, SD, YE, TR, IR, IN, PK, CN, HK, GB, AT, CH, FR, BE, ES, IT, PT, US, MX, BR, AR, CO, CL, PE, NG, KE, GH, ET
- No research file yet (19): BD, LK, NP, ID, TH, VN, PH, TW, KR, KZ, PL, RO, GR, UA, RU, SE, CZ, HU, NZ

How to help: open the links below, find a dealer price list (ask price per bar size next to the spot price), the VAT rule for gold, and typical making charges, then edit `web/src/data/retail/<CC>.json` (schema in `_example.json`, validate with `node scripts/check-retail.mjs <CC>`). Or send me the numbers and I will enter them.

## Missing files

### BD Bangladesh
- [news] https://www.jagonews24.com/en/biz-econ/news/97521 — BAJUS revised gold rates per bhori including VAT
- [tax] https://www.thedailystar.net/business/news/govt-fixes-flat-vat-gold-diamonds-silver-4212521 — Fixed VAT per bhori on gold and silver jewellery
- [news] https://www.tbsnews.net/bangladesh/gold-price-crosses-tk-286000-bhori-bangladesh-hits-fresh-record-1346976 — Gold price per bhori record report

### LK Sri Lanka
- [spot] https://www.goodreturns.in/gold-rates/sri-lanka.html — Sri Lanka gold rate table by karat
- [tax] https://www.dailymirror.lk/business/Sri-Lanka-explores-local-gold-refinery-as-IMF-regulations-delay-import-tax-relief-for-jewellers/215-345876 — Import taxes on gold and VAT on jewellery
- [tax] https://www.customs.gov.lk/wp-content/uploads/current_Tariff/Tariff%202022%20Chapter%20-%2071%20Final.pdf — Customs tariff chapter 71 with duty and VAT by HS code

### NP Nepal
- [news] https://kathmandupost.com/money/2026/11/19/gold-cheaper-by-rs78-400-a-tola-in-10-months — Recent tola price movement and market drivers
- [news] https://ekantipur.com/business/2026/08/06/en/gold-price-increases-by-8000-per-tola-14-55.html — Hallmark gold per tola price changes
- [tax] https://farsightnepal.com/news/nepals-gold-sector-squeezed-by-quotas-taxes-and-smuggling/ — Overview of duties, quotas and taxes on gold in Nepal

### ID Indonesia
- [news] https://www.metrotvnews.com/read/kM6CgEwO-harga-emas-antam-hari-ini-dijual-rp2-540-juta-buyback-rp2-335-juta-gram — Antam sell and buyback price per gram
- [news] https://market.bisnis.com/read/20260424/235/1969024/tabel-harga-buyback-emas-antam-hari-ini-jumat-24-april-2026-nilai-pajaknya — Antam buyback table with PPh 22 tax values
- [tax] https://pajak.go.id/id/artikel/pmk-512025-dan-pmk-522025-atur-ulang-pajak-emas-masyarakat-tak-perlu-cemas — DJP explainer on PMK 51/2025 and 52/2025 gold tax rules
- [tax] https://www.pajak.go.id/sites/default/files/2026-07/Aspek%20Perpajakan%20Pedagang%20Emas.pdf — DJP document on tax aspects for gold traders
- [tax] https://news.ddtc.co.id/berita/nasional/1810112/beli-emas-batangan-konsumen-akhir-tak-kena-pph-pasal-22-dan-ppn — Tax guide: end consumers buying bullion exempt from PPh 22 and VAT

### TH Thailand
- [association] https://www.lbma.org.uk/publications/spotlight-on-thailand/chapter-2-introduction-and-regulations — LBMA overview of Thai gold regulations and VAT
- [tax] https://www.rd.go.th/fileadmin/user_upload/kormor/7_Jewel_Business.pdf — Revenue Department guide for jewellery businesses
- [news] https://www.bangkokbiznews.com/business/economic/1146453 — Daily Thai gold bar buy and sell prices

### VN Vietnam
- [dealer] https://webgia.com/gia-vang/sjc/2001-09-28.html — SJC buy and sell gold prices in Ho Chi Minh City
- [tax] https://vietnamnet.vn/en/ministry-of-finance-clarifies-new-gold-bar-tax-amid-market-concerns-2490002.html — Ministry of Finance on gold bar tax
- [association] https://www.lbma.org.uk/publications/spotlight-on-vietnam/chapter-2-regulations-and-tax-regime — LBMA overview of Vietnam gold regulations and VAT

### PH Philippines
- [spot] https://www.fxstreet.com/news/philippines-gold-price-today-gold-rises-according-to-fxstreet-data-202601280500 — Gold price per gram and tola in PHP
- [tax] https://business.inquirer.net/290917/rules-issued-to-exempt-from-tax-sale-of-gold-by-small-scale-miners-traders-to-bsp — Tax rules on gold sales to BSP
- [tax] https://www.pwc.com/ph/en/publications/pdf/pwcph-tax-code-2019.pdf — PwC Philippines tax code guide (VAT rates)

### TW Taiwan
- [dealer] https://rate.bot.com.tw/gold/chart/2026-06-29/TWD/ — Bank of Taiwan gold passbook buy and sell prices per gram
- [tax] https://www.vatupdate.com/2025/11/13/taiwan-clarifies-uniform-invoice-rules-for-gold-sales-and-labor-fees-details-tax-exemptions — Business tax exemption for gold and taxable labour fees
- [tax] https://law-out.mof.gov.tw/EngLawContent.aspx?id=329&lan=E — MOF English law text on business tax exemption for pure gold

### KR South Korea
- [spot] https://goldpricez.com/kr/gram — Gold price per gram in KRW
- [association] https://global.krx.co.kr/contents/GLB/02/0201/0201050201/GLB0201050201.jsp — KRX gold market VAT and tax treatment
- [news] https://www.asiae.co.kr/en/article/2024030420491785930 — Korean gold market price news

### KZ Kazakhstan
- [dealer] https://bcc.kz/en/personal/savings/gold-operations/ — CenterCredit gold bar buy and sell operations
- [dealer] https://halykbank.kz/en/other/zoloto — Halyk Bank gold bar buy and sell prices and VAT notes
- [association] https://nationalbank.kz/en/news/informacionnye-soobshcheniya/18639 — National Bank of Kazakhstan gold bar market information

### PL Poland
- [dealer] https://stonexbullion.com/pl/sztabki-zlota/waga-10g/10g-zlota-sztabka-valcambi-green-gold/ — Polish-language 10g bar sale listing with premium
- [dealer] https://en.mennicaskarbowa.pl/zlote-sztabki/612-10-g-sztabka-zlota.html — Polish state mint 10g bar price (undated)
- [news] https://ksiegowosc.infor.pl/podatki/vat/zwolnienia/310010,VAT-od-zlota-inwestycyjnego.html — guide on VAT exemption for investment gold in Poland

### RO Romania
- [dealer] https://tavex.ro/faq/aur-de-investitii — Romanian exchange FAQ on investment gold buy and buyback
- [dealer] https://cdn0.erstegroup.com/content/dam/ro/bcr/www_bcr_ro/Aur/Cotatii_Aur.pdf — BCR bank indicative gold price sheet (dated 2025)
- [tax] https://static.anaf.ro/static/10/Anaf/AsistentaContribuabili_r/Titlul_6_TVA.htm — ANAF taxpayer guide, Title 6 VAT

### GR Greece
- [dealer] https://suissegold.com/gr/product/argor-heraeus-10-gram-multigram-gold-bar — Greek-language dealer listing for Argor-Heraeus 10g bar
- [spot] https://www.zahabprice.com/en-gr/bullion/10-gram — 10g gold bar price page for Greece
- [tax] https://www.aade.gr/sites/default/files/2023-03/e_2012ada.pdf — AADE circular on list of investment gold coins for VAT exemption

### UA Ukraine
- [dealer] https://privatbank.ua/banking-metals — PrivatBank buy and sell prices for bank bars and coins
- [news] https://finance.ua/ua/saving/prodazh-bankivskykh-metaliv-shcho-proponuiut-banky — comparison of bank bullion buyback offers in Ukraine
- [tax] https://ch.tax.gov.ua/data/material/000/532/644131/32.pdf — State Tax Service document on VAT and taxes for bank metals (content not verified)

### RU Russia
- [dealer] https://www.vbr.ru/investicii/zoloto/10-gramm/ — Russian bank 10g bar prices including Sberbank
- [dealer] https://bankiros.ru/metall/zoloto/10gramm — bank bar price comparison for 10g gold
- [tax] https://www.consultant.ru/law/podborki/dragocennye_metally_nds/ — legal reference on VAT for precious metals (Russia)

### SE Sweden
- [dealer] https://www.libertysilver.se/kopa/produkt/greek100eur — Swedish dealer listing with per-gram price and premium
- [news] https://hurbra.se/salja-guld-2026/ — comparison of Swedish gold buyers and buyback rates
- [tax] https://www.skatteverket.se/download/18.84f6651040cdcb1b480002471 — Skatteverket VAT handbook section on investment gold (older edition)

### CZ Czechia
- [dealer] https://ceskamincovna.cz/en/investment-gold-bar-10g-900-3017-d — Czech Mint 10g Argor-Heraeus bar buyback and sale prices
- [dealer] https://www.bessergold.cz/en/zlaty-slitek-10-g-argor-heraeus-svycarsko.html — Czech dealer 10g bar pricing
- [tax] https://portal.pohoda.cz/dane-ucetnictvi-mzdy/dph/zvlastni-rezim-pro-investicni-zlato — accountant guide on the Czech special VAT regime for investment gold

### HU Hungary
- [dealer] https://www.aranypiac.hu/arlista — Hungarian dealer price list with buy and sell columns (last updated 2025)
- [news] https://aranypiac.hu/szakerto-tippek/adozasi-tudnivalok-befektetesi-arany — dealer guide on tax treatment of investment gold
- [tax] https://njt.jog.gov.hu/jogszabaly/2026-2-20-8K — Hungarian legal database entry (content not verified)

### NZ New Zealand
- [dealer] https://newzealandmint.com/collections/gold-bullion — NZ Mint gold bullion listings and buyback process
- [dealer] https://www.mygold.co.nz/buy/gold/perth-mint/minted-bars/ — MyGold Perth Mint minted bar prices
- [tax] https://www.mygold.co.nz/faqs/ — Dealer FAQ on GST for bullion

## Low confidence (need dealer prices / making charges)

### OM Oman
- [spot] https://www.zahabprice.com/en-om/bullion/10-gram — 24K 10g bar price in OMR with buy/sell notes
- [spot] https://goldpricez.com/om/24k/gram — Oman 24K per-gram rates with buy and sell
- [tax] https://taxsummaries.pwc.com/oman/corporate/other-taxes — PwC summary of Oman VAT rates and zero-rated supplies

### JO Jordan
- [spot] https://www.zahabprice.com/en-jo/bullion/10-gram — 24K 10g bar price in JOD
- [association] https://www.petra.gov.jo/en/news/gold-prices-21-karat-sells-at-jd8320 — Petra report on Jewelers Syndicate local gold prices
- [news] https://jordantimes.com/news/local/gold-prices-spike-new-tax-comes-into-force — Coverage of new gold-sector tax and its price effect
- [used] https://petra.gov.jo/Eventum/htdocs/index.php/en/news/21-karat-gold-priced-at-jd845-per-gram-in-local-market — 22 Jul 2026 Jewelers Syndicate prices: 21K JD84.50 sell / JD80.20 buy; 24K JD97.10. No same-day spot taken, so
- [used] https://taxsummaries.pwc.com/jordan/corporate/other-taxes — General sales tax 16%; gold listed among exempt goods (reviewed 5 Jul 2026).

### LB Lebanon
- [spot] https://www.livepriceofgold.com/lebanon-gold-price-per-gram.html — Live Lebanon gold price per gram in LBP
- [spot] https://goldpricez.com/lb/gram — Lebanon gram gold rates with buy and sell
- [spot] https://www.goldrate24.com/gold-prices/middle-east/lebanon/ — Lebanon gold price reference page
- [used] https://taxsummaries.pwc.com/lebanon/corporate/other-taxes — Standard VAT rate 11% (reviewed 1 Jul 2026); no gold-specific treatment found.

### IQ Iraq
- [spot] https://www.zahabprice.com/en-iq/bullion/10-gram — 24K 10g bar price in IQD
- [spot] https://goldpricez.com/iq/24k/gram — Iraq 24K per-gram rates with buy and sell
- [spot] https://goldpricedata.com/en/gold-prices-in-iraq.php — Iraq gold price reference in IQD
- [used] https://taxsummaries.pwc.com/iraq/corporate/other-taxes — No VAT; sales-tax list (reviewed 24 Jun 2026) does not include gold or jewelry.

### LY Libya
- [spot] https://www.zahabprice.com/en-ly/bullion/10-gram — 24K 10g bar price in LYD
- [spot] https://goldpricez.com/ly/24k/gram — Libya 24K per-gram rates with buy and sell
- [spot] https://www.livepriceofgold.com/libya-gold-price-per-gram.html — Live Libya gold price per gram
- [used] https://taxsummaries.pwc.com/libya/corporate/other-taxes — No VAT; customs duties abolished 2005 except tobacco; 5% service fee on most imports (reviewed 31 May 2026).

### TN Tunisia
- [spot] https://www.zahabprice.com/en-tn/bullion/10-gram — 24K 10g bar price in TND
- [news] https://www.tunisienumerique.com/or-en-tunisie-le-gramme-reprend-10-dinars-mais-reste-loin-de-son-pic-proche-de-450-dinars/ — Tunisian press on gram gold and jewellery price moves
- [tax] https://taxsummaries.pwc.com/Tunisia/Corporate/Other-taxes — PwC summary of Tunisian VAT and customs
- [used] https://taxsummaries.pwc.com/tunisia/corporate/other-taxes — Standard VAT 19% (reviewed 29 Jun 2026); jewelry-specific rate not confirmed.
- [used] https://www.tuniscope.com/ar/article/443918/actualites/societe/or-tunisie-234409 — 4 Nov 2026 Souk El Berka prices: 18K 340, 24K 380, scrap about 300 TND/g.

### DZ Algeria
- [spot] https://www.zahabprice.com/en-dz/bullion/10-gram — 24K 10g bar price in DZD
- [tax] https://taxsummaries.pwc.com/algeria/corporate/other-taxes — PwC summary of Algerian VAT and customs rates
- [tax] https://www.trade.gov/country-commercial-guides/algeria-customs-regulations — US commercial guide on Algerian customs duties (CIF basis)
- [used] https://taxratesbycountry.com/fr/vat-rate-algeria/ — Standard VAT 19%, reduced 9% (2026).
- [used] https://www.tsa-algerie.com/lalgerie-interdit-les-bijoux-sans-poincon-et-importes-illegalement/ — 23 Jul 2026 article on new ministerial order tightening jeweler licensing and hallmark rules.

### MA Morocco
- [spot] https://www.goldpricedata.com/gold-rates/morocco/ — Morocco gold rates reference
- [tax] https://taxsummaries.pwc.com/morocco/corporate/other-taxes — PwC summary of Moroccan VAT (TVA) rates
- [tax] https://www.casainvest.ma/sites/default/files/Guide%20Taxes%20MDM.pdf — Moroccan tax guide from Casablanca investment body

### SD Sudan
- [spot] https://www.zahabprice.com/en-sd/bullion — Sudan bullion price table in SDG
- [news] https://sudantribune.com/?p=317200 — Sudan Tribune on local gold prices and refinery buying price
- [spot] https://goldpricez.com/sd/24k/gram — Sudan 24K per-gram rates
- [used] https://goldpricez.com/ye/24k/gram — Opened 27 Nov 2026: spot USD 3645.37/oz; aggregator only, no local dealer data.

### YE Yemen
- [spot] https://goldpricez.com/ye/24k/gram — Yemen 24K per-gram rates with buy and sell
- [spot] https://www.zahabprice.com/en-ye/bullion — Yemen bullion price table
- [spot] https://www.policybazaar.com/gold-rate/yemen/ — Yemen gold rate reference

### TR Türkiye
- [spot] https://halktv.com.tr/altin — Gram gold buy/sell in TRY, daily table
- [dealer] https://bigpara.hurriyet.com.tr/altin/kapali-carsi-altin-fiyatlari/ — Kapalicarsi dealer buy/sell quotes for bullion and quarter gold
- [news] https://www.gzt.com/ekonomi/altin-fiyatlari-bugun-ne-kadar-15-agustos-2026-kuyumcu-altin-fiyatlari-canli-kapali-carsi-gram-ve-ceyrek-altin-fiyati-4251460 — Daily report of jeweller and Kapalicarsi gram and quarter prices
- [tax] https://vergidegundem.com/documents/10156/5022893/22.08.2023.pdf/f3dfc437-42f7-4d77-b2fc-bd349ee38283 — VAT exemption for bullion delivery under KDV Law 17/4-g
- [tax] https://gib.gov.tr/sites/default/files/fileadmin/Vergi_Harcamalari_Raporu/Vergi_Harcamalari_Raporu_2023.pdf — Official Revenue Administration tax expenditure report
- [tax] https://www.alomaliye.com/2020/09/14/altin-ve-altina-endeksli-islemlerin-vergisel-boyutu/ — Tax treatment of gold and gold-indexed transactions (2020)
- [used] https://www.alomaliye.com/2025/07/02/kuyumculuk-sektorunde-kdv-uygulamasi/ — 20% KDV on jewelry after deducting bullion value (special base); bullion gold/silver exempt under 17/4-g
- [used] https://www.gzt.com/ekonomi/kuyumcuda-altin-bozdururken-zarar-etmemenin-puf-noktalari-4004439 — Qualitative: jewelers pay below screen price, deduct making charge and wider spread on coins; no percentages g

### IR Iran
- [spot] https://goldpricez.com/ir/24k/gram — Iran 24K per-gram rates in IRR
- [spot] https://www.goldpricedata.com/en/gold-rates/iran/ — Iran gold price reference in IRR
- [spot] https://www.livepriceofgold.com/iran-gold-price-per-gram.html — Live Iran gold price per gram
- [used] https://www.alanchand.com/en/gold-price — 27 Nov 2026 09:20 Tehran: 18K gram 259.0M IRR, mesghal 1.122bn, Emami coin 2.65bn IRR with bubble vs intrinsic

### IN India
- [dealer] https://www.flipkart.com/mmtc-pamp-india-pvt-ltd-peacock-24-9999-k-10-g-yellow-gold-bar/p/itmc33c3477587df — MMTC-PAMP 10g bar retail listing with buyback guarantee note
- [tax] https://gstcouncil.gov.in/sites/default/files/2024-02/sectoral-fq-gems-jewellery.pdf — GST Council FAQ on gems and jewellery (official)
- [tax] https://www.angelone.in/knowledge-center/income-tax/gst-on-gold — GST rates on gold bars, coins and jewellery
- [news] https://www.bajajfinserv.in/10-gram-gold-price-today-and-market-insights — 10g gold price guide with buyback advice
- [news] https://www.5paisa.com/blog/gold-rate-today-28-oct-2026 — Daily city-wise 24K/22K rates per 10g

### PK Pakistan
- [news] https://pakobserver.net/gold-prices-in-pakistan-today-per-tola-10-gram-rates-12-june-2026/ — Per tola and per 10g gold rates
- [news] https://en.dailypakistan.com.pk/?p=292469 — Daily gold price per tola, 22K and 24K
- [tax] https://taxationpk.com/gold-precious-metals-taxation-pakistan/ — Overview of sales tax and advance tax on gold and jewellery
- [tax] https://fbr.gov.pk/pr — FBR official press releases on gold customs and sales tax
- [news] https://www.dawn.com/news/1846958/fbrs-wrong-decision-halts-gold-imports — Reporting on FBR changes to gold import sales tax exemption

### CN China
- [news] https://www.caixinglobal.com/2025-10-21/chow-tai-fook-to-hike-gold-product-prices-by-up-to-18-102374122.html — Chow Tai Fook retail gold price increase reporting
- [association] https://www.gold.org/goldhub/gold-focus/2025/11/you-asked-we-answered-what-are-implications-vat-reform-china — World Gold Council explainer on China gold VAT reform
- [tax] https://www.vatupdate.com/2025/11/03/china-ends-vat-exemption-on-investment-gold-sales-raising-costs-for-retail-buyers/ — Summary of Nov 2025 VAT change on investment gold
- [tax] https://bullionstar.com/blogs/koos-jansen/the-value-added-tax-system-in-chinas-domestic-gold-market — Explainer of VAT system in China domestic gold market
- [news] https://www.chinadaily.com.cn/a/202511/07/WS690d2bf7a310bfcd27fc54bf.html — China Daily report on gold VAT trade reform
- [news] https://news.metal.com/newscontent/103356905/Domestic-gold-jewelry-price-per-gram-returns-to-1000-yuan — Domestic gold jewellery price per gram in yuan
- [used] https://www.bullionstar.com/gold-university/gold-tax-asia — China 13% VAT on gold to consumers; only licensed banks may import gold
- [used] https://www.livepriceofgold.com/china-gold-price.html — Spot 24K 782.00 CNY/g, USD/CNY 6.6563 at 27 Nov 2026 (reference only)

### HK Hong Kong SAR China
- [dealer] https://goldbar.chowsangsang.com/en/productDetail/999.9 — Chow Sang Sang 999.9 gold bar sell prices per tael
- [dealer] https://www.cmbwinglungbank.com/wlb_corporate/en/personal/investments/gold-bar-and-gold-coin.html — Bank physical gold bar and buyback service
- [spot] https://www.hangseng.com/en-hk/rates/gold-prices/ — Bank published gold prices
- [dealer] https://www.hsbc.com.hk/investments/market-information/hk/gold-services/ — HSBC Hong Kong gold services
- [tax] https://www.bullionstar.com/gold-university/gold-tax-asia — Overview of gold tax treatment across Asia including Hong Kong
- [tax] https://www.hkex.com.hk/-/media/HKEX-Market/Products/Listed-Derivatives/Commodities/Gold-Futures/HKE_Infosheet_The-Rise-of-Gold-Investments_EN_260821.pdf — HKEX infosheet on gold investment and tax position
- [used] https://www.livepriceofgold.com/hong-kong-gold-price.html — Spot 24K HKD919.99/g, USD/HKD 7.8308 at 27 Nov 2026 (reference only)

### GB United Kingdom
- [dealer] https://www.bullionbypost.co.uk/gold-bars/10-gram-gold-bar/ — 10g bar buy prices and buy-back terms from a large UK dealer
- [dealer] https://www.thegoldbullion.co.uk/buy-gold-bars/10g-gold-bar/ — 10g gold bar ask prices from a UK bullion dealer
- [dealer] https://www.gold.co.uk/gold-bars/10-gram-gold-bars/ — 10g bar listings with premiums over spot
- [dealer] https://www.gold.co.uk/sell/ — UK bar and coin buy-back terms (percentage of spot)
- [tax] https://www.gov.uk/guidance/gold-acquisitions-imports-investments-and-vat-notice-70121 — HMRC VAT Notice 701/21 on investment gold and jewellery
- [association] https://www.lbma.org.uk/memorandum-of-understanding-mou-between-hmrc-lbma-and-lppm-2013 — LBMA/HMRC memorandum on bullion trade treatment
- [used] https://www.gov.uk/vat-rates — Standard VAT rate 20%

### AT Austria
- [dealer] https://www.goldundco.at/shop/goldbarren-muenze-oesterreich-10-gramm/ — 10g Austrian Mint bar sale prices
- [dealer] https://philoro.at/preisliste/goldbarren — Austrian bar price list with buy and sell columns
- [tax] https://www.bmf.gv.at/dam/jcr:df797299-ebab-49a2-a806-5de30683a5c5/Text_Goldm%C3%BCnzenV_2026.docx.pdf — BMF gold coin regulation (2026) listing investment gold coins
- [used] https://en.wikipedia.org/wiki/European_Union_value-added_tax — Standard VAT rate AT 20% (applied to jewelry; read 2026-11-27)

### CH Switzerland
- [dealer] https://www.goldsilbershop.de/goldbarren-aus-schweiz.html — Swiss-made bar listings (German dealer, prices in EUR)
- [dealer] https://www.goldavenue.com/de/kaufen/gold/10-g-goldbarren — 10g gold bar sale listings in German
- [dealer] https://www.goldundco.at/shop/goldbarren-valcambi-suisse-10-gramm/ — Valcambi (Swiss refiner) 10g bar pricing
- [tax] https://www.estv.admin.ch/de/mehrwertsteuer — Swiss federal tax administration VAT (MWST) overview
- [news] https://www.bazg.admin.ch/de/tipps-verkauf-von-altgold — federal customs authority guidance on selling old gold
- [news] https://www.srf.ch/sendungen/kassensturz-espresso/espresso/begehrtes-edelmetall-altgold-die-kette-der-grossmutter-nicht-unter-wert-verkaufen — Swiss broadcaster report on old-gold buyback values
- [used] https://www.gold.de/haendler/schweiz/ — Directory of Swiss bullion dealers (Degussa, Geiger, philoro Schweiz, GVS); confirms local market structure, n

### FR France
- [dealer] https://www.achat-or-et-argent.fr/or/lingots-et-lingotins/3551/lingot-10g-or — 10g bar buy and sell prices from a French dealer
- [dealer] https://www.bdor.fr/achat-or-en-ligne/lingotin-or-10-grammes — 10g lingotin tiered sale prices
- [tax] https://bofip.impots.gouv.fr/bofip/2061-PGP.html — BOFIP official doctrine on VAT exemption for investment gold
- [used] https://en.wikipedia.org/wiki/European_Union_value-added_tax — Standard VAT rate FR 20% (applied to jewelry; read 2026-11-27)

### BE Belgium
- [dealer] https://www.achat-or-et-argent.fr/or/lingots-et-lingotins/3551/lingot-10g-or — French dealer page with buy and sell prices (no Belgian 10g dealer found)
- [dealer] https://www.bdor.fr/achat-or-en-ligne/lingotin-or-10-grammes — French dealer 10g tiered pricing; mentions Belgian premium variation
- [tax] https://www.minfin.fgov.be/myminfin-rest/finform/public/pdf/3704 — SPF Finances (Belgian federal finance) document; content not verified
- [used] https://www.argentorshop.be/en/gold-bar-10-grams-emeko — Selling prices and stated premiums for Emeko/Metalor bars 5g-1kg, checked vs spot ~106.75 EUR/g on 2026-11-27;
- [used] https://en.wikipedia.org/wiki/European_Union_value-added_tax — Standard VAT rate BE 21% (applied to jewelry; read 2026-11-27)

### ES Spain
- [dealer] https://www.inversoro.es/lingotes-de-oro/lingote-de-oro-10-gramos/ — Spanish dealer 10g bar prices and premium explanation
- [tax] https://www3.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/Reg_tributacion/Oro/RE_oro_inversion/anexo_noveno.pdf — Agencia Tributaria annex on investment gold weight and purity
- [news] https://taxdown.es/blog/oro-fiscalidad-hacienda — tax guide on VAT exemption and capital gains for gold in Spain
- [used] https://stonexbullion.com/es/lingotes-de-oro/10g/ — Lowest listed 10g bar 1106.00 EUR, premium 37.14 EUR (about 3.5%) vs spot, 'Exento de IVA', 2026-11-27; other 
- [used] https://en.wikipedia.org/wiki/European_Union_value-added_tax — Standard VAT rate ES 21% (applied to jewelry; read 2026-11-27)

### IT Italy
- [dealer] https://stonexbullion.com/it/lingotti-oro/10g/ — Italian listings of 10g bars with VAT-inclusive prices and premiums
- [dealer] https://www.goldavenue.com/it/comprare/oro/lingotti-d-oro-da-10-grammi — 10g gold bar listings and resale terms
- [tax] https://www.agenziaentrate.gov.it/portale/documents/20143/0/Consulenza+giuridica+n.+16+del+24+dicembre+2020.pdf/65d63bd2-ccbe-1a0b-4d51-fea31b533afd — Agenzia delle Entrate ruling on VAT exemption for investment gold
- [used] https://en.wikipedia.org/wiki/European_Union_value-added_tax — Standard VAT rate IT 22% (applied to jewelry; read 2026-11-27)

### PT Portugal
- [dealer] https://www.cgd.pt/Particulares/montra-caixa/Pages/Barra-em-ouro-10g.aspx — Caixa Geral de Depositos 10g bar sale price (bank)
- [tax] https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/diplomas_legislativos/Documents/decreto-lei_362-99_de_16_de_setembro_i_serie.pdf — Decreto-Lei 362/99 investment gold VAT regime text
- [news] https://www.deco.proteste.pt/investe/investimentos/outros-produtos/dossie/tudo-sobre-o-ouro/comprar-ouro-como-investimento-guia-pratico — DECO consumer guide on buying and selling gold, buy-sell spread
- [used] https://en.wikipedia.org/wiki/European_Union_value-added_tax — Standard VAT rate PT 23% (applied to jewelry; read 2026-11-27)

### US United States
- [dealer] https://www.pacificpreciousmetals.com/product/1137-10g-sunshine-minting-gold-bar — Dealer listing for 10g gold bar with buyback price shown
- [dealer] https://sdbullion.com/gold/gold-bars/10-gram-gold-bars — Dealer category page for 10g gold bars
- [dealer] https://www.boldpreciousmetals.com/product/10-gram-gold-bars — Dealer listing for 10g gold bars from refiners
- [tax] https://taxfoundation.org/blog/state-sales-tax-gold-bullion/ — Neutral tax-policy summary of state sales tax on gold bullion
- [tax] https://cdtfa.ca.gov/formspubs/pub64/taxability-of-sales-and-labor-charges.htm — California tax authority guide on taxability of jewelry sales and labor charges
- [news] https://www.cbsnews.com/news/states-with-no-sales-tax-on-silver-and-gold — News overview of states exempting gold and silver from sales tax
- [used] https://sdbullion.com/silver/silver-bars/1-oz-silver-bars — Silver bar asks 1oz, 10oz, 100oz, 1kg vs silver spot $44.85/oz on 2026-11-27
- [used] https://www.kitco.com/charts/gold — Spot cross-check: 24K gold about $3,656.50/oz bid on 2026-11-27

### MX Mexico
- [spot] https://goldpricez.com/lang-es/mx — Mexican peso gold price aggregator with buy and sell per gram
- [spot] https://www.goldpricedata.com/es/gold-rates/mexico — Mexican peso gold price tracker with bar estimate and tax note
- [tax] https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2025/rgce/anexos/Anexo27delasRGCEpara2025.pdf — SAT official annex from search on IVA and gold; relevance to retail VAT unverified
- [used] https://www.costco.com.mx/Joyeria-y-Relojes/Oro/Lingotes-de-Oro/Lingote-de-Oro-1-oz-PAMP-Diwali/p/2053302 — Ask MXN 73,599 for 1 oz bar, 2026-11-27
- [used] https://mley.mx/LIVA/articulo/9o/ — Fraccion VIII exempts gold ingots >=99% in retail sales; fraccion VI exempts onza troy pieces
- [used] https://www.goldpricez.com/ — Spot gold USD 3644.22/oz, 2026-11-27; USD/MXN from open.er-api.com

### BR Brazil
- [spot] https://goldpricez.com/lang-pt/br — Brazilian real gold price aggregator with buy and sell per gram
- [tax] https://www.gov.br/receitafederal/pt-br/portais/nf-e-ouro — Receita Federal portal on NF-e Ouro and gold trade rules
- [news] https://www.infomoney.com.br/onde-investir/ouro-tambem-paga-imposto-entenda-regras-e-quando-o-investidor-deve-declarar-ao-fisco/ — Financial news explainer on taxation of gold (ICMS, IOF, income tax)

### AR Argentina
- [spot] https://goldpricez.com/lang-es/ar — Argentine peso gold price aggregator with buy and sell per gram
- [tax] https://www.argentina.gob.ar/sites/default/files/tributos_vigentes_-_periodo_al_30.06.2025.pdf — Government list of current tributes, useful for IVA and gold context
- [news] https://www.cronista.com/finanzas-mercados/una-oportunidad-de-oro-cuanto-cuesta-el-gramo-hoy-en-argentina-y-como-comprarlo — Financial news on local gold bar pricing and buy/sell spread

### CO Colombia
- [spot] https://www.banrep.gov.co/en/node/65186 — Banco de la Republica buy and sell reference for precious metals
- [tax] https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_17977_2025.htm — DIAN ruling on withholding for gold, scrap and used jewellery purchases
- [spot] https://goldpricez.com/lang-es/co — Colombian peso gold price aggregator with per gram figure
- [used] https://www.rankia.co/blog/trading-desde-cero/5910323-como-invertir-oro-colombia — 19% IVA on bars, coins and jewellery; Oroexpress bar asks (undated, not used)
- [used] https://www.oroexpress.com.co/lingotes — Sizes offered: 1 g, 5 g, 1 oz, 24K 999.9 certified; prices not shown

### CL Chile
- [dealer] https://tienda.casamoneda.cl/wp-content/uploads/2025/11/terminos-condiciones-compraventa-oro-1763126212957978117194.pdf — Casa de Moneda de Chile gold buy/sell terms and conditions
- [tax] https://www.sii.cl/destacados/iva_bienes/ — SII official page on VAT for goods
- [news] https://www.biobiochile.cl/noticias/economia/actualidad-economica/2026/10/12/el-creciente-negocio-de-venta-de-lingotes-de-oro-no-pagan-iva-en-chile.shtml — News on VAT-free status of 24K gold bars in Chile

### PE Peru
- [dealer] https://tucambista.pe/cotizacion-del-oro-en-peru-hoy — Peruvian currency exchange site with gold buy and sell quotes
- [tax] https://orientacion.sunat.gob.pe/node/1098 — SUNAT guidance on IGV for sales of goods
- [spot] https://www.goldrate24.com/es/precios-del-oro/america-del-sur/peru/gram/ — Peruvian sol gold price per gram aggregator

### NG Nigeria
- [spot] https://goldpricez.com/ng/gram — Naira gold price per gram aggregator
- [news] https://kpmg.com/ng/en/insights/2026/10/nigerias-vat-reset.html — KPMG analysis of Nigeria VAT reset (2026)
- [spot] https://www.livepriceofgold.com/nigeria-gold-price-per-gram.html — Naira live gold price per gram with bid and ask

### KE Kenya
- [spot] https://www.goldrate24.com/gold-prices/africa/kenya/ — Kenyan shilling gold price aggregator
- [tax] https://www.kra.go.ke/images/publications/List-of-Goods-and-Services-Listed-in-First-and-Second-Schedule-of-the-VAT-Act-TIMS---July-2026.pdf — KRA list of VAT-exempt and zero-rated goods (July 2026)
- [news] https://www.kenyans.co.ke/news/125329-kra-releases-updated-list-vat-exempt-zero-rated-goods — News coverage of KRA updated VAT-exempt and zero-rated list
- [used] https://taxsummaries.pwc.com/kenya/corporate/other-taxes — VAT rates: 16% general, 8% fuel, 0% exempt/zero-rated

### GH Ghana
- [spot] https://goldpricez.com/gh/24k/gram — Cedi gold price per gram aggregator for 24K
- [news] https://www.vatupdate.com/2026/09/04/ghana-exempts-mandatory-gold-sales-to-the-state-from-vat/ — VAT update on exemption for mandatory gold sales to the state (2026)
- [tax] https://gra.gov.gh/domestic-tax/tax-types/vat-exemptions/ — Ghana Revenue Authority VAT exemptions page

### ET Ethiopia
- [spot] https://www.livepriceofgold.com/ethiopia-gold-price-per-gram.html — Birr gold price per gram with live bid and ask
- [news] https://globaltaxnews.ey.com/news/2024-1317-ethiopia-issues-directive-to-review-list-of-goods-exempt-from-vat — EY news on Ethiopian directive reviewing VAT-exempt goods list
- [tax] https://www.mofed.gov.et/media/filer_public/a7/ff/a7ff1a1d-c013-444d-8315-7803422b9782/vat_proclamation_latest_draft-_english_-2023_1.pdf — Ministry of Finance VAT proclamation draft (2023); verify against final text
- [used] https://capitalethiopia.com/?p=76087 — Retail vs NBE gold price and official vs parallel FX rates, Oct 2025
