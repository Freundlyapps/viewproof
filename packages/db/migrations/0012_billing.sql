-- Plan 7: usage counters for plan limits (research 09), Stripe billing state and processed webhook events.
CREATE TABLE usage_counts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, period)
);
-- Distinct outlier searches per UTC day (repeating a query is free).
CREATE TABLE outlier_searches (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  query TEXT NOT NULL,
  PRIMARY KEY (user_id, day, query)
);
-- One Stripe customer per user. users.plan is derived from status by the webhook.
CREATE TABLE billing (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  customer_id TEXT UNIQUE NOT NULL,
  subscription_id TEXT,
  status TEXT,
  period_end TEXT,
  cancel_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
