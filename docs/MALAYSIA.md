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
