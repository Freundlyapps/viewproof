-- Google's success bodies carry a `kind` ("youtube#channelListResponse"), which the YouTube client once mistook
-- for an error kind and passed through; the cache then stored those raw bodies as if they were reports.
-- They are only a cache: drop them and they are fetched again.
DELETE FROM report_cache WHERE body LIKE '{"kind":"youtube%';
