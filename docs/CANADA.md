# Canada edition

This copy extends [usaciv](https://karpathy.ai/usaciv), the original project by Andrej Karpathy
([announcement](https://x.com/karpathy/status/2125779541952246039)), with a Canada edition. It is live at
[usaciv-canada.pages.dev/?country=ca](https://usaciv-canada.pages.dev/?country=ca).

The deployed site opens on the Canada edition: `web/index.html` declares it with `data-default-country="ca"`, and the
country menu at the top left switches to the U.S. edition (`?country=us`). Without that attribute, as in the upstream
project, a page opens on the U.S. edition and `?country=ca` selects Canada. The country parameter is kept in shared links.

Run `uv run python -m pipeline serve` from the project root and open [the local site](http://127.0.0.1:8765/).
The Canadian data files are bundled under `web/data/ca/` and load from the same static site as the U.S. edition.

## Data and map methods

| Publisher and dataset | What the map uses |
| --- | --- |
| [Statistics Canada 2021 Census boundary files](https://www150.statcan.gc.ca/n1/pub/92-160-g/92-160-g2021002-eng.htm) | Cartographic provinces, territories, census divisions, census metropolitan areas (CMAs), census agglomerations (CAs) and population centres. |
| [Statistics Canada 17-10-0152-01](https://doi.org/10.25318/1710015201-eng) and [17-10-0148-01](https://doi.org/10.25318/1710014801-eng) | July 1 population estimates on 2021 boundaries: the latest year (2025) for population, and 2021 to 2025 for growth, of Canada, the provinces and territories, census divisions (17-10-0152), and CMAs and CAs (17-10-0148). Census division figures colour the density and growth lenses. |
| [Statistics Canada 98-10-0005-01](https://doi.org/10.25318/9810000501-eng) and [98-10-0002-01](https://doi.org/10.25318/9810000201-eng) | 2021 Census land area (the density denominator) and official names, and the 2021 Census count kept as `census_population` for shares of other census counts. |
| [Statistics Canada 2021 Census tables for census divisions](https://www12.statcan.gc.ca/census-recensement/index-eng.cfm): 98-10-0057, 98-10-0103, 98-10-0022, 98-10-0348, 98-10-0387, 98-10-0259, 98-10-0354 and 98-10-0458 | The income, low income, median age, born abroad, degrees, commute, homeowners, faith and largest-tradition lenses. |
| Statistics Canada 2021 Census tables for Canada, provinces, CMAs and CAs: 98-10-0448, 98-10-0061, 98-10-0253 and 98-10-0256 | Workers by NAICS industry (the Food, Production, Science and Culture yields and the industry lists), employment, median household income, rent and home value, and the unemployment of census agglomerations (labelled as 2021 Census figures). |
| Statistics Canada 2021 Census tables for the City View (Canada, CMAs and CAs): 98-10-0448 (detailed NAICS industries), 98-10-0449, 98-10-0020, 98-10-0457, 98-10-0455, 98-10-0384 and 98-10-0324 | City View districts and city types (the U.S. district rule on employed residents by detailed industry), and the citizen rows: occupation (NOC 2021), age, how people got to work and who worked at home, education of adults 25+, and generation status. |
| [Statistics Canada Labour Force Survey 14-10-0464-01](https://doi.org/10.25318/1410046401-eng) and [14-10-0461-01](https://doi.org/10.25318/1410046101-eng) | Unemployment of Canada, the provinces and territories and the 41 CMAs: the latest annual average (2025), people aged 15+. |
| [Statistics Canada 36-10-0222-01](https://doi.org/10.25318/3610022201-eng) and [36-10-0468-01](https://doi.org/10.25318/3610046801-eng) | GDP in current Canadian dollars, the latest year of each table: 2025 for Canada, the provinces and territories (market prices), 2022 for CMAs (basic prices, the GDP table's metro definitions). |
| [Natural Resources Canada 2020 Land Cover of Canada](https://open.canada.ca/data/en/dataset/ee1580ab-a23d-4f86-a09b-79763677eb47) | A 5 km image of the land-cover classes from NRCan's WMS, sampled and grouped for the hex renderer and the forest, farmland and built-up lenses. |
| [NOAA ETOPO1](https://www.ncei.noaa.gov/products/etopo-global-relief-model) and [Natural Earth](https://www.naturalearthdata.com/) | Elevation and depths, major rivers and lakes, neighbouring outlines, settlement anchors, highways and rail lines. |
| [NRCan Map 900A](https://open.canada.ca/data/en/dataset/000183ed-8864-42f0-ae43-c4313a860720) | Named metal, nonmetal and coal mines, oil sands operations, and oil and gas fields. The plotted coordinates are source locations. |
| [WRI Global Power Plant Database](https://datasets.wri.org/datasets/global-power-plant-database) | Canadian plants with at least 25 MW as listed in 2016–17: WRI took them from Natural Resources Canada's August 2017 North American inventory (capacity years mostly 2016 and 2017; the newest plant at 25 MW or more was commissioned in 2014). Plants built or closed since are not reflected. |
| [Statistics Canada 36-10-0711-01](https://doi.org/10.25318/3610071101-eng) | GDP at basic prices by industry for the provinces and territories, summed for Canada: the latest year with every industry published (2023). It feeds the Gold report's industry breakdown, the Economy advisor and the GDP figures in the worker reports. |
| [Parks Canada administrative areas](https://open.canada.ca/data/en/dataset/e1f0c975-f40c-4313-9be2-beb951e35f4e) and [2025–26 attendance](https://open.canada.ca/data/en/dataset/1e2bd6b2-d6c7-415b-8c95-f5f6b2459759) | The wonders ranked by visits: the 15 most-visited national parks and reserves, the 5 most-visited marine parks and historic canals, and the 12 most-visited national historic sites (at most one per city). Footprints of the parks and marine parks. |
| [Statistics Canada 23-10-0253-01](https://doi.org/10.25318/2310025301-eng) and [23-10-0254-01](https://doi.org/10.25318/2310025401-eng), placed with [OurAirports](https://ourairports.com/data/) | Airports on the Ports & airports layer: every airport with 10,000+ passengers enplaned in 2025, the year before, and cargo loaded and unloaded (tonnes), plus airports handling 10,000+ tonnes of cargo (Mirabel). Hub classes apply the FAA's shares of national boardings. Statistics Canada suppresses some airports for confidentiality, among them Whitehorse, Iqaluit, Charlottetown, Kingston and Kitchener/Waterloo, so they are not shown. Îles-de-la-Madeleine has no land hex and is left out, as the U.S. builder leaves out sites off its map. |
| [Transport Canada table M17](https://tdih-cdit.tc.canada.ca/en/addendum-tables/2024/table-m17-cargo-tonnage-handled-canada-port-authorities-2015-2024-0) | Ports on the Ports & airports layer: the 17 Canada Port Authorities by cargo tonnage in 2024 (preliminary), placed at Natural Earth's port points (Thunder Bay and Belledune at their official place names). The page states no licence; it is a Government of Canada publication, cited here. Private and provincial ports are not included. |
| [Statistics Canada 23-10-0142-01](https://doi.org/10.25318/2310014201-eng), the Canadian Freight Analysis Framework | Trade routes on the map and in the Commerce advisor: the 40 largest freight flows by value between its zones in different provinces whose anchors are at least 250 km apart (the U.S. rule), both directions summed, with each zone's partners and totals. 2017 is the framework's latest year. It covers air, rail and for-hire truck only (no water, pipeline or private trucking), in current Canadian dollars and tonnes. Its 25 domestic zones are 12 CMAs, the rest of each province, and whole provinces and territories. Lines bow north between anchor cities as a drawing aid; the framework assigns no route. |
| Treasury Board's [Directory of Federal Real Property](https://open.canada.ca/data/en/dataset/08013e71-101a-457c-af76-c7b13a08ff64) and [Statistics Canada 98-10-0142-01](https://doi.org/10.25318/9810014201-eng) | The Military layer and advisor. Bases are a hand-checked list of 30 main Canadian Forces bases, wings and stations among DND's military properties, with satellite properties folded in. Each is placed at its most built-up parcel (Gagetown at Oromocto, not its training area) and tiered by land area as in the U.S., plus 8 flagships on small land. Restricted ground is every DND military property of 100 km² or more; the directory has no boundaries, so each is drawn on the hexes of its parcel points. Serving members (Regular Force and Primary Reserve) and veterans come from the 2021 Census, by province and city, where they live. Garrison cities follow the U.S. Encampment rule. Canada publishes no personnel by base or defence spending by province, so the U.S. troops-and-dollars section is left out. |
| [Public Safety Canada Canadian Disaster Database](https://open.canada.ca/data/en/dataset/1c3d15f9-9cfa-4010-8462-0d67e493d9b9) and [Statistics Canada 18-10-0005-01](https://doi.org/10.25318/1810000501-eng) | The Culture advisor's disasters: natural disasters that began 1980–2022 in Canada (the database ends in December 2022), by type, province, year and cost. Epidemics and events abroad are left out, as FEMA leaves out COVID-19. Costs are the database's estimated total, or the payments it records where it gives none (a lower bound), moved to 2025 dollars with the annual CPI, as NOAA adjusts its costs. A province's cost is its equal share of each event that touched it, NOAA's rule. |
| [NRCan Canadian Geographical Names Database](https://open.canada.ca/data/en/dataset/e27c6eba-3c5d-4051-9db2-082dc6411c2c) | Official place-name points of the national historic sites and historic canals among the wonders (the Klondike sites at Dawson's Historical Complex). |
| [Statistics Canada 37-10-0232-01](https://doi.org/10.25318/3710023201-eng), the [Open Database of Educational Facilities](https://open.canada.ca/data/en/dataset/4dd64c98-b12a-49c7-be29-21c77d22b675) and [Wikidata](https://www.wikidata.org/) | Research universities: the 20 with the most doctoral students in 2023/2024, at most two per city. 2024/2025 is not used because UBC's count drops from 4,155 to 315 (a reporting change). Campus points come from ODEF v2.1; UBC (not listed) and Memorial (no coordinates) come from Wikidata. Canada publishes no research spending by university, the U.S. ranking's measure. |

Power plants are assigned to provinces and territories by matching their WRI coordinates to the
[Statistics Canada digital boundaries](https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/0),
which include water. Each hydrocarbon field counts once under its NRCan field type (oil, gas, oil and gas, or bitumen).
Oil sands mining operations are counted separately.

The grid uses Canada Atlas Lambert (EPSG:3978) and a 25 km projected radius. Seven samples approximate the land,
water and administrative assignment. Small islands, shorelines, urban areas and park boundaries are schematic at this
scale.

### Rules shared with the U.S. edition

- **Sites on water.** A power plant, mine or field whose hex is water or neighbouring land snaps to the nearest hex of
  its own province or territory, as the U.S. builders do. The five Grand Banks oil fields, about 350 km offshore, are
  shown on the nearest Newfoundland coast hex and say so in their tooltips, as U.S. offshore wind does.
- **Cities.** Each banner shows the first-named city of its CMA or CA (Ottawa for Ottawa - Gatineau); the full census
  name stays in the panel and in search. It sits at a matching Natural Earth settlement within 5 km of the census
  boundary, otherwise at the area's core population centre (the one named in its title, else the largest lying mostly
  inside it). Every city gets its own banner hex, bigger cities first, within two rings.
- **Wonders.** The U.S. edition's four rules: national parks, other park units, research universities (at most two per
  city) and landmarks (at most one per city). Canada's landmarks are ranked by attendance, not hand-picked, and
  leave out canals and sites inside a park wonder (Rogers Pass, Cave and Basin). Markers sit on land and footprints
  cover land hexes only. A site whose hex is water or foreign moves into its city's hexes when it has a city (Fort
  George to St. Catharines, not across the lake to Toronto), otherwise to the nearest land hex. Its province is that
  of its own point. Parks Canada reports Mount Revelstoke and Glacier with one attendance figure, so they count as
  one wonder, as the U.S. edition merges the National Mall's memorials.
- **Water, lenses and growth.** Water depths and coast classes follow the U.S. world builder. Lens colours span the
  2nd–98th percentile of hexes. Growth runs from July 1, 2021 to the latest July 1 estimate, the U.S. edition's window;
  a change beyond ±25% would be left blank, the U.S. sanity cap (none reaches it on the estimates).
- **Yields, panels and lenses.** Census industries are NAICS 2017 sectors, the same sectors as the U.S. industry keys,
  so the yields use the U.S. definitions. Each census lens reuses the U.S. lens's name, colours and group; its value
  is the census division covering most of the hex.
- **The national view.** The map opens as the U.S. edition does: all the land framed in the window, here the whole
  country, Arctic included. Canada's cities line the bottom of that frame, where the lens dock and the minimap sit, so
  the fit stops above the lens dock and the minimap is no taller than the U.S. one (152 px). Banner population floors
  are the U.S. floors scaled by Canada's share of the U.S. population (12%), so a city gets its banner at the zoom
  where a U.S. city of the same share would; zoom in for more. The country menu is styled as the U.S. brand text and
  shrinks to the emblem where the U.S. edition hides that text.
- **City View.** The U.S. City View with Canadian data. Districts use the U.S. catalog and rule (location quotient of
  at least 1.25, specialities at 3, up to five, ranked by workers above the national norm) on 2021 Census counts of
  employed residents by detailed NAICS 2017 industry, so workers are counted where they live, not where the jobs are;
  the Industrial zone adds all of mining (21) and Canada's mining, mill, paper and aluminium towns, the Government plaza
  is federal (except defence) and provincial administration, the Encampment is Defence services, and 'Capital city' goes
  to Ottawa – Gatineau. Citizens map NOC 2021 groups onto the U.S. occupation categories (managers include business
  and finance professionals; farm workers include mining), and origins are the census generation status. Resource
  sites belong to the city whose hexes hold them. City GDP has no industry breakdown (Statistics Canada publishes CMA
  totals only), and per-person GDP divides by the population of the GDP year.
- **Advisors.** Census divisions stand in for counties. CMAs and CAs are built from municipalities, not divisions, so
  metros keep their own census figures and have no rolled-up division columns.

The Canadian edition supplies all five yields (Gold is GDP; Food, Production, Science and Culture count workers by
industry, as in the U.S.), population, growth and unemployment reports, 14 lenses (density, growth, income, low income,
median age, born abroad, degrees, commute, homeowners, forest, farmland, built-up, faith and largest tradition), city
and regional panels with income, rent, home value and industries, the City View (click a city: its hexes with
estimated residents and land use, its industry districts and resource sites, citizens, economy, workforce and peers),
all ten advisors (Energy & Resources, Economy, People, Prosperity & Housing, Commerce, Military, Knowledge, Land,
Culture and Explorer) on a
census-division table (`counties.json`), GDP by industry, and road, rail, port and airport, wonder (national parks,
canals and marine parks, national historic sites and research universities), military and freight route map layers. The U.S. lenses with no Canadian census equivalent are left out: broadband, uninsured, the CDC
wellbeing index, disaster declarations (the Canadian Disaster Database locates events by province, so disasters appear
in the Culture advisor by province instead), veterans (no census division table) and home value (no census division
table; it is in the city and regional panels). The Military advisor has no troops-and-dollars section, because Canada
publishes no personnel by base or defence spending by province.

### Statistics Canada census tables

Small tables are downloaded whole as CSV. From the large ones (98-10-0448, 98-10-0253, 98-10-0256 and 98-10-0458) only
the needed series are requested through Statistics Canada's [Web Data Service](https://www.statcan.gc.ca/en/developers/wds),
its documented API; `pipeline/canada_census.py` caches each reply under `data/raw/canada/` and logs it like a download.
The 2021 Census week fell in May 2021, during COVID-19 restrictions: census unemployment (10.3% nationally) is higher
and average commutes shorter than in a usual year. Incomes are for 2020.

### Unemployment and the years shown

Unemployment comes from the Labour Force Survey's latest annual average (2025: 6.8% for Canada, whose survey total
covers the ten provinces) for Canada, every province and territory, and the 41 CMAs, also through the Web Data Service.
The survey does not publish census agglomerations, so `unemployment` is null for them and their 2021 Census rate is kept
in `unemployment_census` (present on every row, never ranked with the survey's figures). Panels show it as
"Unemployment (2021 Census)" and compare it with Canada's 2021 Census rate.

### Population, GDP and the years shown

Population is Statistics Canada's July 1, 2025 estimate on 2021 boundaries, and growth runs from July 1, 2021, the
window the U.S. edition takes from the Census Bureau's population estimates. Table 17-10-0005 already has July 1, 2026
for the provinces, but the city and census division estimates for 2026 follow in January 2027, so the map uses 2025
throughout and every level adds up. Density is that population per km² of 2021 land. Income, education, housing,
commuting and workers by industry stay on the 2021 Census, the newest source for them (2026 Census results start in
2027). Shares of census counts (the employed, workers per 1,000 residents) use the 2021 Census population,
`census_population`, so no ratio divides one year by another.

GDP is 2025 for Canada, the provinces and the territories and 2022 for CMAs, the latest year of each table. Each row
also carries `gdp_population`, the July 1 population of its GDP year, and per-person GDP divides by it (2025 GDP ÷ 2025
population for provinces; 2022 GDP ÷ 2022 population for CMAs). The Gold report keeps per-person metro rankings off.

Because the Canadian figures come from different years, the top bar marks each stat with its year (population '25,
the worker yields '21, GDP '25, unemployment '25), reports name it beside "National report", and panels label rows and
sections with theirs (population 2025, census figures 2021, incomes 2020, GDP 2025 or 2022, unemployment 2025).

Canadian census, population estimate, Labour Force Survey and GDP figures are adapted from the Statistics Canada tables listed above, under the
[Statistics Canada Open Licence](https://www.statcan.gc.ca/en/terms-conditions/open-licence).

## Rebuild

```sh
uv run --group build python -m pipeline.canada
```

The `build` dependency group pins numpy, Pillow, pyproj and shapely to the versions that produced the committed data,
so a rebuild from the same cached inputs gives byte-identical files. The rebuild downloads public source files without
API keys and caches them under `data/raw/canada/`. Pass `--force`
to refresh those files. The publisher URLs, SHA-256 fingerprints and retrieval dates are logged in
`data/raw/canada/manifest.json` and listed in the Canadian Almanac. The existing `python -m pipeline package` command
bundles both editions and the source archive.
