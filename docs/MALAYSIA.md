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

**Summing.** Populations add up across a group. Medians and Gini coefficients (HIES) do not, so economic panels for
the conurbations will need their own rule.

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
