-- Migration 0002 — Agent Per Thread
-- Adds agent_runtime column to threads table (nullable, no default constraint).
-- A NULL value means "fall back to the parent session's agent_runtime at turn-start time."
-- This is purely additive: no existing column is altered or dropped.
-- SQLite cannot ALTER COLUMN constraints, so the sessions.agent_runtime CHECK stays unchanged.
ALTER TABLE threads ADD COLUMN agent_runtime TEXT DEFAULT NULL;
