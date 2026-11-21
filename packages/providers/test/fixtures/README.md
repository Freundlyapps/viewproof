Example responses copied verbatim from DataForSEO's documentation (fetched 2026-11-21):

- `dfs-clickstream.json` — https://docs.dataforseo.com/v3/keywords_data/clickstream_data/bulk_search_volume/live/
  Path: `tasks[0].result[0].items[].{keyword, search_volume, monthly_searches[].{year, month, search_volume}}`
- `dfs-trends.json` — https://docs.dataforseo.com/v3/keywords_data/google_trends/explore/live/
  Path: `tasks[0].result[0].items[type="google_trends_graph"].data[].{date_from, date_to, missing_data, values[0]}`
  (the docs example was requested with `type` web; ours sends `type: "youtube"`, same response shape).
