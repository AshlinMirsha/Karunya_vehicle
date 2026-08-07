-- Migration: Add remark column to attendance table for manual overrides
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS remark text;
