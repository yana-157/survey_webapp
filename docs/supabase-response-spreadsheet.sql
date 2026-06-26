-- Run this once in the Supabase SQL editor for the survey project.
-- It creates the raw JSON response table plus a spreadsheet-friendly table
-- with one row per submission, indexed by respondent_id.

create table if not exists public.full_boundary_responses (
  id bigint generated always as identity primary key,
  respondent_id text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists full_boundary_responses_respondent_id_idx
  on public.full_boundary_responses (respondent_id);

create table if not exists public.full_boundary_response_spreadsheet (
  id bigint generated always as identity primary key,
  respondent_id text not null,
  submitted_at timestamptz not null,
  relationship_to_wilkinsburg text,
  anchor_area text,
  years_connected text,
  active_neighborhoods jsonb not null,
  neighborhood_count integer not null,
  neighborhood_summary text,
  neighborhood_mappings jsonb not null,
  neighborhood_rows jsonb not null,
  unassigned_block_count integer not null,
  unassigned_blocks jsonb not null,
  invalid_state_count integer not null,
  invalid_states jsonb not null,
  response_json jsonb not null
);

create index if not exists full_boundary_response_spreadsheet_respondent_id_idx
  on public.full_boundary_response_spreadsheet (respondent_id);

create index if not exists full_boundary_response_spreadsheet_submitted_at_idx
  on public.full_boundary_response_spreadsheet (submitted_at);

alter table public.full_boundary_responses enable row level security;
alter table public.full_boundary_response_spreadsheet enable row level security;

drop policy if exists "Allow public survey inserts" on public.full_boundary_responses;
create policy "Allow public survey inserts"
  on public.full_boundary_responses
  for insert
  to anon
  with check (true);

drop policy if exists "Allow public spreadsheet upserts" on public.full_boundary_response_spreadsheet;
drop policy if exists "Allow public spreadsheet inserts" on public.full_boundary_response_spreadsheet;
create policy "Allow public spreadsheet inserts"
  on public.full_boundary_response_spreadsheet
  for insert
  to anon
  with check (true);

create or replace view public.full_boundary_response_export as
select
  respondent_id,
  submitted_at,
  relationship_to_wilkinsburg,
  anchor_area,
  years_connected,
  neighborhood_count,
  neighborhood_summary,
  neighborhood_mappings,
  unassigned_block_count,
  unassigned_blocks,
  invalid_state_count,
  invalid_states
from public.full_boundary_response_spreadsheet
order by submitted_at;
