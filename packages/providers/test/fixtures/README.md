Example responses copied verbatim from DataForSEO's documentation (fetched 2026-11-21):

- `dfs-trends.json` — https://docs.dataforseo.com/v3/keywords_data/google_trends/explore/live/
  Path: `tasks[0].result[0].items[type="google_trends_graph"].data[].{date_from, date_to, missing_data, values[0]}`
  (the docs example was requested with `type` web; ours sends `type: "youtube"`, same response shape).
