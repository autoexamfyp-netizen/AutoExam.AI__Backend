-- =============================================================================
-- AutoExam.ai — question_bank.in_bank (exam-only vs reusable bank)
-- Run after 010_password_recovery_email_check.sql.
-- =============================================================================

alter table public.question_bank
  add column if not exists in_bank boolean not null default true;

create index if not exists question_bank_in_bank_idx on public.question_bank(in_bank);
