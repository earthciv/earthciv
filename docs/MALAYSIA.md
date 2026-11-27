# Malaysia edition (`my`)

A Malaysia edition of EarthCiv: the 13 states and 3 federal territories, their 160 administrative districts
(*daerah*) and 47 cities, on one map with the peninsula and Borneo. Built by `pipeline/malaysia.py` (with
`malaysia_economy.py`, `malaysia_resources.py`, `malaysia_layers.py` and `malaysia_cityview.py`) into `web/data/my/`.

Run `uv run python -m pipeline serve` from the project root and open
[the local site](http://127.0.0.1:8765/?country=my).

## Data and map methods

| Publisher and dataset | Vintage | Licence | What the map uses |
| --- | --- | --- | --- |
| [Department of Statistics Malaysia (DOSM), via data.gov.my: Administrative district boundaries](https://github.com/data-gov-my/datagovmy-front) | 2023 (160 districts) | MIT | State and district of every hex |
| [Department of Statistics Malaysia (DOSM): Population Table: Administrative Districts](https://data.gov.my/data-catalogue/population_district) | 2026 (mid-year estimate) | CC BY 4.0 | Population and growth of Malaysia, its states, federal territories, districts and cities |
| [Department of Statistics Malaysia (DOSM): MyCensus 2020 area profiles (Kawasanku): religion by district](https://data.gov.my/dashboard/kawasanku) | 2020 Census | CC BY 4.0 | Religion lenses (shares of residents) |
| [Department of Statistics Malaysia (DOSM): Real GDP by district and by state; real GDP of Malaysia](https://data.gov.my/data-catalogue/gdp_district_real_supply) | District 2020; state and nation 2025 | CC BY 4.0 | Gold (GDP) of districts, cities, states and Malaysia; GDP by sector |
| [Department of Statistics Malaysia (DOSM): Employed persons by industry and state, 1982-2021](https://archive.data.gov.my/data/dataset/employed-persons-by-industry-and-state) | 2021 | Creative Commons Attribution (archive.data.gov.my; version not stated) | Food, Production, Science and Culture yields (workers by industry); Jobs by industry |
| [Department of Statistics Malaysia (DOSM): Labour Force Survey: district and state](https://data.gov.my/data-catalogue/lfs_district) | 2024 annual | CC BY 4.0 | Unemployment |
| [Department of Statistics Malaysia (DOSM): Household Income and Expenditure Survey: district, state and Malaysia](https://data.gov.my/data-catalogue/hies_district) | HIES 2024 | CC BY 4.0 | Income, poverty, Gini and household spending |
| [Department of Statistics Malaysia (DOSM): Labour force by educational attainment and state, 1982-2021](https://archive.data.gov.my/data/dataset/labour-force-by-state-and-educational-attainment) | 2021 | Creative Commons Attribution (archive.data.gov.my; version not stated) | Education row of the City View (a state mix) |
| [NOAA National Centers for Environmental Information (via ERDDAP): ETOPO1 Global Relief Model](https://www.ncei.noaa.gov/products/etopo-global-relief-model) | ETOPO1, 1 arc-minute | Public domain | Elevation, relief and water depth |
| [Impact Observatory, Microsoft and Esri: Sentinel-2 10m Land Use/Land Cover](https://livingatlas.arcgis.com/landcover/) | Latest annual map | CC BY 4.0 | Terrain colours and symbols; Forest, farmland and built-up shares |
| [Natural Earth: Natural Earth v5.1.2](https://www.naturalearthdata.com/) | v5.1.2 | Public domain | Neighbouring land, lakes and rivers; City banner positions |
| [World Resources Institute: Global Power Plant Database](https://datasets.wri.org/datasets/global-power-plant-database) | Database v1.3.0; WRI records no capacity year for Malaysian plants | CC BY 4.0 | Power plants |
| [Wikidata contributors: Wikidata: oil fields, gas fields and LNG terminals in Malaysia](https://www.wikidata.org/) | Query result at build time | CC0 | Oil, gas and LNG sites |
| [DOSM, with the Ministry of Agriculture and Food Security (MAFS) and the Department of Agriculture (DOA), via data.gov.my: Crops by district](https://data.gov.my/data-catalogue/crops_district_area) | 2024 | CC BY 4.0 | Crop resources |
| [Descals, Szantoi, Meijaard et al.: Global industrial and smallholder oil palm map, 2019](https://zenodo.org/records/4473715) | 2019 | CC BY 4.0 | Plantations counted as cropland, not forest; Oil palm sites |
| [DOSM, from the Forestry Department (Perhutanan), via data.gov.my: Permanent reserved forest by state](https://data.gov.my/data-catalogue/forest_reserve_state) | 2024 | CC BY 4.0 | Forest reserve area of states |
| [Natural Earth: Natural Earth v5.1.2 roads and railroads](https://www.naturalearthdata.com/) | v5.1.2 (1:10m) | Public domain | Roads and rail on the map |
| [OurAirports (David Megginson): OurAirports](https://ourairports.com/data/) | As retrieved | Public domain | Airport positions by IATA code |
| [Wikidata contributors: Wikidata: annual passengers of Malaysian airports](https://www.wikidata.org/) | Passengers in 2019, as retrieved | CC0 | Airports and their hub classes |
| [Ministry of Higher Education (MOHE), via data.gov.my: Lecturers in public universities](https://data.gov.my/data-catalogue/lecturers_uni) | 2025 | CC BY 4.0 | Research-university wonders |
| [UNESCO World Heritage Centre: UNESCO World Heritage List: Malaysia](https://whc.unesco.org/en/statesparties/my) | Inscriptions to 2025 | Public listing | World Heritage wonders |
| [DOSM: Impact of Floods](https://open.dosm.gov.my/publications/flood_impact_2025) | 2021–2025 | No licence stated (© DOSM publication) | Flood losses by state and district |

Licences are as each publisher's page states them. The data.gov.my catalogue pages give CC BY 4.0; the older
archive.data.gov.my pages give "Creative Commons Attribution" with no version; DOSM's Impact of Floods publication
states no licence, so its figures are cited as DOSM's and not redistributed beyond the map's totals.

**Map.** Lambert azimuthal equal-area centred at 109.5°E 4°N, so the peninsula, the South China Sea and Borneo share
one canvas at true relative size. Hexes have a 6 km radius (3,520 land hexes; Malaysia is about 4% of the lower 48's
area, so the U.S. 25 km hexes would leave too few). Each hex takes the district holding most of its seven samples.
Thailand, Singapore, Brunei, Indonesia and the Philippines are drawn as neighbouring land. Small islands and coasts are schematic.

**Districts.** The boundary file (data.gov.my, 2023) has 160 districts. DOSM's tables from 2025 list six newer ones
(Membakut in Sabah; Gedong, Lingga, Pantu, Sebuyau and Siburan in Sarawak). Each is folded back into the district it
was carved from, found from the fall in that parent's population between 2024 and 2025; Membakut is split between
Beaufort and Papar in proportion to their falls.

**People lenses.** Density, growth (2021 to the latest year) and non-citizens (share of residents). Ethnicity lenses
give each DOSM group as a share of **citizens** (latest mid-year estimate); religion lenses give each group as a share
of **all residents** (Census 2020, Kawasanku area profiles). Every ethnicity and religion lens uses the same neutral
colour scale on a fixed 0-100% domain. There is no "largest group" lens, and nothing else in the edition (yields,
scores, cities, citizens, advisors) reads these figures.

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
| Tree cover, cropland, built-up | Esri Sentinel-2 10 m land cover (the same samples as the terrain), with oil palm moved from trees to cropland (Descals 2019) | latest annual | hex |

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
2021 (its estimates are benchmarked to the 2020 Census), from the data.gov.my archive, whose dataset page gives the licence as
"Creative Commons Attribution" (no version stated). Yields follow Canada's mapping: Food = agriculture, forestry & fishing;
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
GDP per resident; (group Land): Tree cover, Cropland, Built-up. The land-cover map counts rubber and other tree crops as
trees (oil palm is moved to cropland: see Resources and land), so "Tree cover" is not natural forest (renamed from
Canada's "Forest" for that reason).

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
| Oil palm | Descals et al. 2019 global oil palm map (Zenodo 4473715, CC BY 4.0; 10 m, industrial and smallholder; zip cached in `data/raw/malaysia/descals/`) | Tiles are reduced once to 0.009° (~1 km) blocks of oil palm share (`oilpalm_1km.npy`). A district with 20,000+ ha of oil palm carries an `oil_palm` site (hectares = block share × area, summed over blocks whose centre lies in the district). The 2019 map predates later planting |
| District crops | DOSM `crops_district_area` (data.gov.my; MAFS, DOA; 2017–2024, latest year used) | One site per district whose planted area of **durian** (≥ 1,000 ha), **coconut** (≥ 1,500), **pineapple** (≥ 800) or **sago** (≥ 1,500) passes the floor, on the hex of the district nearest its centre; `value` is hectares. `Selama`, `Kalabakan`, `Kecil Lojing`, Kuala Lumpur and Putrajaya are not in the table |
| State `energy` | the plants above | MW per type, as Canada: only mapped plants |
| State `land` | Esri Sentinel-2 cover sampled at 7 points per hex | Mean of the hex shares, as Canada. **Plantations read as trees** (see below) |
| State `forest_reserve` | `forest_reserve_state` (DOSM, from the Forestry Department; 2024) | Hectares of permanent reserved forest, an extra key; it is not a land-cover share |

**Land cover and oil palm.** The Esri map counts plantations as trees. Right after it is sampled, every sample point
that lies on a 1 km block at least half oil palm (Descals 2019) and is classed trees, shrub or grass becomes cropland;
water, built-up land and flooded vegetation are left alone. This feeds the terrain, the Tree cover and Cropland lenses
and the states' `land`. Before → after (state mean of hex shares, forest / crop): Johor 80% / 4% → 44% / 43%; Pahang
90% / 2% → 73% / 21%; Perak 83% / 7% → 69% / 22%; Sabah 92% / 2% → 77% / 19%; Sarawak 94% / 2% → 87% / 10%. Rubber and
other tree crops still read as trees, and oil palm planted since 2019 is missed, so Tree cover remains an overestimate
of natural forest (the lens name and note say so).

**Known double counts.** WRI lists Tanjung Bin (Johor) as two coal rows at one site (3,244 and 2,100 MW) and Kapar
(Selangor) as a coal row and a gas row of the same company (1,600 and 2,420 MW). They are kept as published and
flagged in the text pack; Johor and Selangor capacity may be overstated.

**Not on the map, and why** (the text pack says the same):

* **Mines** (tin, bauxite, gold, iron, silica…): `mineral_extraction` gives output by state and commodity (2016–2021),
  with no positions. A point per state would be invented.
* **Rubber and paddy:** `crops_district_area` holds no oil palm, rubber or paddy. Paddy is in `crops_state` (by state
  only); no open rubber area was found. (Oil palm comes from the Descals map above; MPOB's 2015 state totals, a
  data.gov.my archive spreadsheet, are a cross-check: Johor 740k ha, Pahang 725k, Sabah 1.54M, Sarawak 1.44M.)
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
| Wonders: World Heritage | UNESCO's list for Malaysia (hand-entered positions, checked against OpenStreetMap and Wikidata) | The six inscribed properties: Gunung Mulu, Kinabalu Park, Melaka and George Town (one property drawn at both cities, so seven wonders), the Lenggong Valley, the Niah Caves and FRIM Selangor Forest Park (2025). Not ranked |
| Wonders: parks | hand-picked | Taman Negara, Bako, Endau-Rompin, Tunku Abdul Rahman Park and Royal Belum State Park (not UNESCO sites). Malaysia publishes no open visitor counts by park, so they are `curated` and not ranked. No park footprints are published as open data, so `cells` is null |
| Wonders: research universities | The five public universities the Ministry of Higher Education designated Research Universities (UM, UKM, USM, UPM in 2006, UTM in 2010), ranked by lecturers in 2025 (`lecturers_uni`, MOHE via data.gov.my) | At most 2 per city, as Canada. **UPM is left out** because UM and UKM already fill Greater Kuala Lumpur; the rule text says so. Malaysia publishes no research spending or doctoral enrolment by university. Campus points come from the project geocoder (OpenStreetMap) |
| Wonders: landmarks | hand-picked | Petronas Twin Towers, Bakun Dam, Kellie's Castle and the Langkawi Sky Bridge: none a place of worship, at most one per city, none on the hex of another wonder. Candidates dropped for sharing a city or hex with another wonder: Perdana Putra (Putrajaya, Greater Kuala Lumpur), the Penang Bridge (George Town); Sipadan has no land hex in reach |
| Disasters | DOSM *Impact of Floods* workbooks, 2022–2025 releases (each carries two years; each year is taken from the latest release that has it) | `floods`: the value of flood losses in current ringgit (RM thousand) per year 2021–2025, by state (six categories, totals) and by district. The 2021 release has no workbook; 2021 is the one in the 2022 report. DOSM's `n.a` and broken cells are `null`, its `-` ("not affected") is 0. **District figures cover only living quarters, vehicles, business premises and manufacturing** (agriculture and infrastructure are published by state only), so districts do not add up to the state or the nation. **2021 state rows are partial**: DOSM published that year's agriculture and infrastructure losses for the nation only (RM 90.6 million and RM 2.0 billion), so the states add up to RM 4.0 billion of the national RM 6.1 billion (`states_complete` is false for 2021, and the viewer's multi-year sum starts in 2022); from 2022 they add up to the nation. Perlis and the federal territories take their state row; districts DOSM only lists after 2025 are split over their parents with the M2 crosswalk |

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

Bakun Dam is a hand-picked landmark here; that does not conflict with the resources layer, which leaves the large Sarawak hydro plants out only because WRI omits them and no capacity is typed in by hand.

Race and religion (PLAN.md): no wonder is chosen by a community or a faith; no place of worship is a wonder; the
tests check wonder names and rule texts.

## City View (`districts.json`, `citizens.json`)

Built by `pipeline/malaysia_cityview.py` (hooks in `pipeline/malaysia.py`), listed in `edition.json` `files`;
`sources.roles.citizens` is `dosm_city_view`. Both files follow the contracts Canada's do; the engine needed one
generic change (`citizens.json` `row_labels` may reword a row's subtitle and nouns).

### Industry districts

The U.S. rule (location quotient ≥ 1.25 and ≥ 1,000 workers or 1% of the city's workers; ≤ 5 per city; badge from the
strongest district; "Capital city" only for Kuala Lumpur) applied to each city's workers by industry (`cities.json`
`jobs`, M2). **These are estimates, not counts**: DOSM publishes workers by industry for states only (LFS 2021), and
M2 shares each state's workers over its districts by 2020 district GDP in the matching sector (agriculture, mining,
manufacturing, construction, services). Inside a state every city therefore has the state's mix of service
industries, scaled by how large its services sector is; read a district as "this state's industry, concentrated in
this city". The file's `rule.text` and the text pack (`cv.districts_counting`, `cv.districts_note`) say so.

| District | Industries (M2 keys) |
|---|---|
| Campus | professional, information, education |
| Commercial hub | finance |
| Industrial zone | manufacturing, mining |
| Theater square | arts |
| Entertainment complex | accommodation & food service |
| Government plaza | public administration |
| Aqueduct & dam | utilities |

Not drawn: Harbor (transport & storage mixes ports, trucking and post), Aerodrome and Encampment (no aviation or
defence workers published), and no farm district (the engine's catalog has none; agriculture is a Food yield). No
specialities (`sub` is empty): DOSM publishes no detailed industries.

### Citizens

| Row | Source | Notes |
|---|---|---|
| Age | `population_district.csv`, latest year (2026 mid-year estimate), both sexes, **ethnicity "overall" rows only** | counted per district and summed; the six 2025 districts folded back as in the population series. Five-year bands, so children are 0-14, young adults 15-34, middle-aged 35-64, elders 65+ (the text pack relabels the engine's "under 18"). Median age interpolated inside its band. |
| Education | `labour_force_education_state.csv` (DOSM, archive.data.gov.my, 1982-2021 table; 2021 used) | **a state mix**: no education table exists by district. Each district's LFS 2024 labour force takes its state's 2021 mix (none / primary / secondary / tertiary). It counts the labour force aged 15+, not adults 25+, and tertiary includes diplomas and certificates, so `bachelors_plus` is left out and the "have a degree" chip is hidden. Within a state every city has the same mix. |

Missing, and said so in the text pack (`citizens.row_missing`, `citizens.note`): **occupation** (the archive lists
"Employed persons by occupation and state" but attaches no file), **how people get to work** and **where people were
born** (citizenship is not place of birth, so it is not used for that row). Household size is published by district
(Census 2020, Kawasanku `household_size`) but the City View has no row or chip for it, so it is not added. Only the age
row is compared with Malaysia for the "standout citizens" call-out and the ▲▼ marks: the education row is the state's
mix, and showing it as a local trait would mislead. Income is already in
the City View through M2 (`median_income`).

### Race and religion are not here

Rule 5 of "Race and religion" (PLAN.md): ethnicity and religion never feed personas, names, scores or advisor text.
The City View's citizens are unnamed figures of one skin tone, so the edition needs no naming scheme: nothing in the
file or the interface gives anyone a name, and none of the rows is split by ethnicity or religion. The module never
reads the ethnicity columns (other than the "overall" rows), the religion parquet or the non-citizen column.
`tests/test_malaysia_edition.py` enforces this: `citizens.json` and `districts.json` carry no field or text that names
a group, `citizens.json` holds only the age and education rows, and the module's source is checked.

## Rebuild

```sh
uv run --group build python -m pipeline.malaysia
```

Set `PYTHONUTF8=1` on Windows. The `build` dependency group pins the libraries that produced the committed data
(duckdb reads the Kawasanku parquet). The rebuild downloads public files without API keys and caches them under
`data/raw/malaysia/`; pass `--force` to refresh them. Publisher URLs, SHA-256 fingerprints and retrieval dates are
logged in `data/raw/malaysia/manifest.json` and listed in the Almanac.
