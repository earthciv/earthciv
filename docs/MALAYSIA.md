# Malaysia edition (`my`)

Built by `pipeline/malaysia.py` into `web/data/my/`. This page grows into the full sources-and-methods note as the
edition is finished; for now it records the choices a reader can't see in the data.

## Cities

A city is a group of whole districts (*daerah*), the way a U.S. metro area groups counties.

**Conurbations.** DOSM does not define conurbations: its Census 2020 metadata says urban agglomerations are defined by
another agency. PLANMalaysia's National Physical Plan (NPP) names conurbations, but covers only Peninsular Malaysia
and Labuan, and its chapters could not be downloaded (the plan's site fails its certificate check).
So each conurbation follows the definition named below, turned into whole districts by one rule: **a district joins
when most of its residents live in the conurbation's member local authorities.** Kerian (Perak) joins George Town
because its four NPP-4 towns (Bagan Serai, Beriah, Bukit Merah, Parit Buntar) hold about 90,000 of its 166,000 people
(54%, from Wikipedia's town counts, so near the line); Selama stays out (about 13,000 of 34,000).

| City | Districts | Definition | Districts, 2020 | Published, 2020 |
|---|---|---|---|---|
| Kuala Lumpur | W.P. Kuala Lumpur, W.P. Putrajaya; Petaling, Klang, Gombak, Hulu Langat, Sepang (Selangor) | The Klang Valley's core councils. It has no official boundary, and NPP-4's 11-council national conurbation list could not be read; Kuala Langat is sometimes counted too | 8.15 M | — |
| George Town | Timur Laut, Barat Daya, Seberang Perai Utara, Tengah and Selatan (Pulau Pinang); Kuala Muda, Kulim, Bandar Baharu, Yan (Kedah); Kerian (Perak) | Fourth NPP (2021) Northern Conurbation | 2.91 M | 2.84 M |
| Johor Bahru | Johor Bahru, Kulai, Pontian, Kota Tinggi | Fourth NPP (2021) Southern Conurbation; its six local authorities fill these four districts | 2.44 M | 2.49 M |
| Kuching | Kuching, Samarahan | Kuching North, Kuching South, Padawan and Kota Samarahan councils (Sarawak is outside the NPP) | 0.74 M | 0.79 M |
| Kota Kinabalu | Kota Kinabalu, Penampang, Putatan | Kota Kinabalu with the built-up Penampang and Putatan districts (Sabah is outside the NPP) | 0.73 M | 0.73 M |

"Published" totals are the 2020 Census counts by local authority, as gathered in Wikipedia's article on each
conurbation; Kuching's is a later DOSM figure. The 17-council "Greater Kuala Lumpur" (which adds Seremban, Port
Dickson, Bentong, Muallim and three more Selangor districts) is not used: Seremban keeps its own banner. Sungai Petani (Kuala Muda) and Kulim
have no banner of their own: they are part of George Town.

Each banner sits at the principal city in the first district listed. Putatan is too small to own a hex at 6 km; its
people are still counted.

**Other cities.** Every other district with at least 150,000 residents is a city of its own, named after its largest
place in Natural Earth. A city of 500,000 or more is a metro.

**Summing.** Populations, GDP, workers and labour-force counts add up across a group. Medians and Gini coefficients
(HIES) do not: see "Economy" below for the rule.

## Economy

Built by `pipeline/malaysia_economy.py` (called from three small hooks in `malaysia.py`). Every input is a DOSM table;
`sources.json` lists the files and hashes. Ethnicity and religion are not used anywhere in this section.

| Yield or figure | Source | Year | Geography |
|---|---|---|---|
| **Gold** = GDP | DOSM real GDP by sector (`gdp_state_real_supply`, `gdp_annual_real_supply`, `gdp_district_real_supply`) | 2025 (states, Malaysia); 2020 (districts, cities) | state, district |
| **Food, Production, Science, Culture** = workers | DOSM employed persons by industry and state (Labour Force Survey, MSIC 2008), archive.data.gov.my | 2021 | state; districts are estimates |
| Unemployment | DOSM `lfs_district`, `lfs_state_sex` | 2024 annual | district, state |
| Income, poverty, Gini, spending | DOSM `hies_district`, `hies_state`, `hh_income` (HIES) | 2024 | district, state, nation |
| Tree cover, cropland, built-up | Esri Sentinel-2 10 m land cover (the same samples as the terrain) | latest annual | hex |

**Gold is GDP in constant 2015 ringgit.** DOSM publishes the district series only at constant 2015 prices (2015 to 2020)
and nominal GDP only for the nation, so "state share × national nominal GDP" would have meant inventing the split. Real
RM keeps one unit for districts, cities, states and the nation. Consequences, all shown in the app through `gdp_year`
and the `unit`: states and Malaysia are 2025, districts and cities are 2020, so a city's GDP and its state's are not
the same year; GDP per resident divides by the residents of the GDP year. Offshore oil and gas (DOSM's "Supra", RM 43 bn
in 2025) belongs to no state or district: it is in Malaysia's GDP (`nation.gdp_offshore`) and the sum of the 16 states
falls short of the nation by exactly that. DOSM folds **Putrajaya into Kuala Lumpur** in the 2020 district table (the
state tables list it apart), so Putrajaya's district has no GDP and Kuala Lumpur's GDP per resident divides by both
territories' residents. Sectors with under RM 5 m are blank in the source and counted as 0. GDP by sector uses DOSM's five
sectors (agriculture; mining & quarrying, with offshore oil and gas; manufacturing; construction; services). The total
also holds import duties, so the sectors add to `gdp_basic`, not `gdp`.

**Workers by industry.** A Census 2020 table of workers by industry for states or districts was searched for and not
found: none appears in the data.gov.my catalogue, and the Kawasanku dashboard
(district profiles from the census) has none either. The best available is the Labour Force Survey estimate by state,
2021 (its estimates are benchmarked to the 2020 Census), from the data.gov.my archive; the archive's licence is not
stated on the portal (see the M6 licence item). Yields follow Canada's mapping: Food = agriculture, forestry & fishing;
Production = manufacturing + construction + mining & quarrying; Science = professional, scientific & technical +
information & communication; Culture = arts, entertainment & recreation. Electricity and water are merged as
`utilities`, wholesale and retail as `retail`, and households as employers fall in `other`, so the industry icons
resolve. State figures are exact. **District and city figures are estimates:** each state's workers in an industry are
shared over its districts in proportion to the district's 2020 GDP in the matching sector (agriculture, mining,
manufacturing and construction have their own; every service industry follows services GDP). Where a state's sector GDP
is blank everywhere the split falls back to total GDP, then to population. The four single-district areas (Perlis, Kuala
Lumpur, Labuan, Putrajaya) take the state's figures. District workers add back to the state totals exactly (checked at
build time). The yield descriptions say "an estimate".

**Unemployment** is unemployed persons ÷ labour force from the Labour Force Survey 2024. Counts, not rates, are summed
for conurbations. The 2025 districts have empty 2024 rows in the source, so their parents' figures stand. The four
single-district areas use the state's survey. 2024 is used for states too (the state table runs to 2025) so every area
shares a year.

**Household income, poverty, Gini (HIES 2024).** Income is gross monthly household income in RM (not annual); poverty
is the absolute poverty rate (share of households below the national poverty line income). Survey names differ from the
boundary file: `ALIASES[(state, name as published)]` in `malaysia_economy.py` maps them (e.g. `Larut & Matang`,
`S.P.Tengah`, `Hulu` in Terengganu, `Tanjong Manis`, and the older `Cameron Highland`, `Manjung (Dinding)`, `Hulu
Langat`), and a test checks that every name in every year of the LFS, HIES and GDP tables reaches a boundary district.
Medians and Gini can not be added. The rule: (1) a district made of several survey districts (Beaufort, Papar,
Simunjan, Sri Aman and Serian, which the 2025 districts were cut from) takes the **population-weighted mean** of its
parts' means and poverty rates (weights = the 2025 DOSM populations, the first year the new districts exist; Membakut
counts towards Beaufort and Papar by the crosswalk shares); its **median is the same weighted mean of the medians**, an
approximation, said so in the lens text; its **Gini is empty**. (2) A conurbation's income is the population-weighted
mean of its members' medians (an approximation); Gini, poverty and mean income are district-only lenses and columns, and a
city carries no Gini.

**Lenses added** (group Prosperity): Income (median monthly household income), Poverty, Inequality (Gini), Unemployment,
GDP per resident; (group Land): Tree cover, Cropland, Built-up. The land-cover map counts oil-palm and rubber estates as
trees, so "Tree cover" is not natural forest (renamed from Canada's "Forest" for that reason) and cropland leaves
estates out.

**counties.json** has one row per district (world.json `counties` order): area, density, GDP, GDP per resident, income,
spending, poverty, Gini, unemployment, the four worker estimates, the city the district belongs to (`cbsa`) and a
representative hex. Worker columns are estimates, as above.

**Gaps.** No district-level workers by industry (estimated), no nominal GDP by state or district, no GDP after 2020 by
district, no median age or education lenses yet, and no rent or home-value figures (left empty). Poverty and Gini are
empty for a handful of districts as described above.

## Resources and land (`resources.json`; states' `energy`, `land`, `forest_reserve`)

Built by `pipeline/malaysia_resources.py`. Only data that carries its own position is placed on the map.

| Layer | Source | Rule |
|---|---|---|
| Power plants | WRI Global Power Plant Database v1.3.0 (the same pinned file as Canada's; WRI records no capacity year for Malaysian plants, so the vintage is the database version) | Every Malaysian plant of 25 MW or more, as listed; the hex is the plant's own, or the nearest land hex when the point falls in the sea. Solar rows come from Wiki-Solar. WRI's owner field reads "Penisular Malaysia Electricity Supply Company" for plants all over Sabah and Sarawak, so owners are shown only when it says something else |
| Oil, gas and LNG sites | Wikidata (CC0), cached SPARQL result `wikidata_energy_sites.json` | Items whose country is Malaysia and whose class is an oil field, gas field, liquefaction or regasification terminal, with an English label. About a dozen: Tapis, Samarang, Tukau, Baronia, Betty, three Sabah blocks, Bintulu LNG, Melaka and Pengerang terminals. Left out: Ambalat (claimed by Indonesia), *Kilang Abok Berhad* (a company label at an onshore point). **Not an inventory**: no open dataset lists Petronas's producing fields with positions, and none is typed in from memory |
| Offshore rule | as Canada's Grand Banks | A site on water goes to the nearest land hex of the whole map (reach 250 km; Tapis is ~175 km off Terengganu) and says so in its `detail`. Samarang, off Labuan, lands on Labuan's hex |
| District crops | DOSM `crops_district_area` (data.gov.my; MAFS, DOA; 2017–2024, latest year used) | One site per district whose planted area of **durian** (≥ 1,000 ha), **coconut** (≥ 1,500), **pineapple** (≥ 800) or **sago** (≥ 1,500) passes the floor, on the hex of the district nearest its centre; `value` is hectares. `Selama`, `Kalabakan`, `Kecil Lojing`, Kuala Lumpur and Putrajaya are not in the table |
| State `energy` | the plants above | MW per type, as Canada: only mapped plants |
| State `land` | Esri Sentinel-2 cover sampled at 7 points per hex | Mean of the hex shares, as Canada. **Plantations read as trees** (see below) |
| State `forest_reserve` | `forest_reserve_state` (DOSM, from the Forestry Department; 2024) | Hectares of permanent reserved forest, an extra key; it is not a land-cover share |

**Known double counts.** WRI lists Tanjung Bin (Johor) as two coal rows at one site (3,244 and 2,100 MW) and Kapar
(Selangor) as a coal row and a gas row of the same company (1,600 and 2,420 MW). They are kept as published and
flagged in the text pack; Johor and Selangor capacity may be overstated.

**Not on the map, and why** (the text pack says the same):

* **Mines** (tin, bauxite, gold, iron, silica…): `mineral_extraction` gives output by state and commodity (2016–2021),
  with no positions. A point per state would be invented.
* **Oil palm, rubber, paddy:** `crops_district_area` holds no oil palm, rubber or paddy. Paddy is in `crops_state`
  (by state only); oil palm exists as MPOB's 2015 area by state (a data.gov.my archive spreadsheet); no open rubber area
  was found.
* **Large Sarawak hydro** (Bakun, Murum) is missing from the WRI database and is not added by hand.
* Forest reserves have state totals only.

## Map layers (`infrastructure.json`, `wonders.json`, `disasters.json`)

Built by `pipeline/malaysia_layers.py` (called from `pipeline/malaysia.py`); the worked example is Canada's
`infrastructure()`, `wonders()` and `canada_disasters.py`. Every input is registered in `sources.json`.

| Layer | Source | Rule |
|---|---|---|
| Roads | Natural Earth v5.1.2 1:10m roads (the pinned release's shapefile, read by a small stdlib reader, so no new dependency) | Scale rank 8 or less, sampled every 4 km and snapped to hex links as Canada does. Class 0 ("main highway") is rank 5 or less, class 1 ("major road") ranks 6 to 8. Natural Earth is map art: roads it omits are missing |
| Rail | Natural Earth v5.1.2 1:10m railroads | Tier 0 (main line) is rank 5 or less, every other rank is a secondary line. About 140 links: Natural Earth's coverage of Malaysian rail is partial |
| Airports | OurAirports (positions, by IATA code) with Wikidata's annual passengers (CC0, cached SPARQL result `wikidata_airport_passengers.json`; originally from Malaysia Airports and the Department of Civil Aviation) | Every airport with 900,000+ passengers in **2019**, the last year before the pandemic and the one year most airports have. The figures are total passengers (arrivals plus departures); `enplanements` (the "boardings" the viewer shows) is **half of them, an estimate**, and the row keeps `passengers`. Hub classes by passengers: large 5 million+, medium 2 million+, small 900,000+. Airports with no 2019 figure (Ipoh, Kuantan, Labuan and others) are not shown. There is no prior-year figure and no cargo |
| Wonders: World Heritage | UNESCO's list for Malaysia (hand-entered positions, checked against OpenStreetMap and Wikidata) | The five inscribed properties: Gunung Mulu, Kinabalu Park, Melaka and George Town (one property drawn at both cities, so six wonders), the Lenggong Valley and the Niah Caves. Not ranked |
| Wonders: parks | hand-picked | Taman Negara, Bako, Endau-Rompin, Tunku Abdul Rahman Park and Royal Belum State Park (not UNESCO sites). Malaysia publishes no open visitor counts by park, so they are `curated` and not ranked. No park footprints are published as open data, so `cells` is null |
| Wonders: research universities | The five public universities the Ministry of Higher Education designated Research Universities (UM, UKM, USM, UPM, UTM), ranked by lecturers in 2025 (`lecturers_uni`, MOHE via data.gov.my) | At most 2 per city, as Canada. **UPM is left out** because UM and UKM already fill Greater Kuala Lumpur; the rule text says so. Malaysia publishes no research spending or doctoral enrolment by university. Campus points come from the project geocoder (OpenStreetMap) |
| Wonders: landmarks | hand-picked | Petronas Twin Towers, Bakun Dam, Kellie's Castle and the Langkawi Sky Bridge: none a place of worship, at most one per city, none on the hex of another wonder. Candidates dropped for sharing a city or hex with another wonder: Perdana Putra (Putrajaya, Greater Kuala Lumpur), the Penang Bridge (George Town); Sipadan has no land hex in reach |
| Disasters | DOSM *Impact of Floods* workbooks, 2022–2025 releases (each carries two years; each year is taken from the latest release that has it) | `floods`: the value of flood losses in current ringgit (RM thousand) per year 2021–2025, by state (six categories, totals) and by district. The 2021 release has no workbook; 2021 is the one in the 2022 report. DOSM's `n.a` and broken cells are `null`, its `-` ("not affected") is 0. **District figures cover only living quarters, vehicles, business premises and manufacturing** (agriculture and infrastructure are published by state only), so districts do not add up to the state or the nation. Perlis and the federal territories take their state row; districts DOSM only lists after 2025 are split over their parents with the M2 crosswalk |

The viewer reads the flood block from a generic shape (`disasters.json` `floods`, DATA_CONTRACTS.md); the layer tooltip
and the Culture advisor read a wonders rule's `measure` / `measure_name` (any ranking) and `listed` (a published list).

### Left out, and why

* **`trade.json`** (freight between states): no open inter-state freight data. the DOSM trade tables found (data.gov.my
  catalogue and open.dosm.gov.my) are national external trade, not flows between places.
* **`military.json`**: no open list of bases or land areas that a base could be checked against was found (the Ministry of Defence
  publishes none), and an uncited list would break the "hand-checked and defensible" rule. No Encampment is drawn.
* **Ports** (in `infrastructure.json`): there are no open cargo statistics by port, and Natural Earth's 1:10m port
  points lack Port Klang and Tanjung Pelepas, the two largest. A list without a measure would be an arbitrary one, so
  `ports` is empty and `rules.ports` says why. Wikidata lists ports but no tonnage.
* **Disaster events**: DOSM gives losses, not events, dates, deaths or other hazards (landslides, storms), so only floods
  are shown and the text pack says so.
* **Park and university rankings by visitors or research spending**: not published as open data.

Race and religion (PLAN.md): no wonder is chosen by a community or a faith; no place of worship is a wonder; the
tests check wonder names and rule texts.
