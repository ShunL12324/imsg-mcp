-- Migration 0001: initial schema
CREATE TABLE IF NOT EXISTS messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guid             TEXT    UNIQUE NOT NULL,
  text             TEXT,
  sender           TEXT,
  is_from_me       INTEGER NOT NULL DEFAULT 0,
  chat_identifier  TEXT,
  timestamp        INTEGER NOT NULL,  -- Unix seconds
  received_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_sender    ON messages(sender);
