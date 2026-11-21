-- Whether a sign-in asked Google for the permission screen (needed for lasting access).
-- Plain returning sign-ins skip it; existing rows were all started with it.
ALTER TABLE oauth_states ADD COLUMN prompt_consent INTEGER NOT NULL DEFAULT 1;
