-- SQL editor code for testing verification by type
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.certificate_records (
  id uuid primary key default gen_random_uuid(),
  serial_number text not null unique,
  full_name text not null,
  certificate_type text not null default 'Certificate',
  verification_type text not null default 'certificate',
  status text not null default 'active',
  issue_date date,
  expiry_date date,
  document_url text,
  image_url text,
  remarks text,
  created_at timestamptz not null default now()
);

alter table public.certificate_records enable row level security;

create policy if not exists "Allow read access to certificate records"
  on public.certificate_records
  for select
  using (true);

insert into public.certificate_records (
  serial_number,
  full_name,
  certificate_type,
  verification_type,
  status,
  issue_date,
  expiry_date,
  document_url,
  image_url,
  remarks
)
values
  (
    '001',
    'Test User',
    'COP/COC/COE',
    'sirb',
    'active',
    '2026-01-01',
    '2031-01-01',
    '/static/media/sample-certificate.svg',
    '/static/media/sample-certificate.svg',
    'SIRB test record'
  ),
  (
    '002',
    'Juan Dela Cruz',
    'Identification Card',
    'id',
    'active',
    '2025-03-01',
    '2030-03-01',
    '/static/media/sample-certificate.svg',
    '/static/media/sample-certificate.svg',
    'ID test record'
  ),
  (
    '003',
    'Maria Santos',
    'Certificate',
    'certificate',
    'active',
    '2024-06-01',
    '2029-06-01',
    '/static/media/sample-certificate.svg',
    '/static/media/sample-certificate.svg',
    'Certificate test record'
  )
on conflict (serial_number) do update
set
  full_name = excluded.full_name,
  certificate_type = excluded.certificate_type,
  verification_type = excluded.verification_type,
  status = excluded.status,
  issue_date = excluded.issue_date,
  expiry_date = excluded.expiry_date,
  document_url = excluded.document_url,
  image_url = excluded.image_url,
  remarks = excluded.remarks;

select serial_number, full_name, certificate_type, verification_type, status
from public.certificate_records
order by serial_number;
