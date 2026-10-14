import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('./0007_trip_invitation_server_guards.sql', import.meta.url), 'utf8');
const limiterFunction = migration.match(/create function public\.consume_trip_invitation_rate_limit\(target_user uuid\)[\s\S]*?\$function\$;/i)?.[0] ?? '';

describe('server-only invitation guard migration', () => {
  it('keeps the rate-limit table private and stores one atomic fixed-window counter per user', () => {
    expect(migration).toMatch(/create table public\.trip_invitation_rate_limits[\s\S]*?user_id uuid primary key references auth\.users\(id\) on delete cascade/i);
    expect(migration).toMatch(/alter table public\.trip_invitation_rate_limits enable row level security/i);
    expect(migration).toMatch(/revoke all on table public\.trip_invitation_rate_limits from public, anon, authenticated, service_role/i);
    expect(limiterFunction).toMatch(/on conflict \(user_id\) do update/i);
    expect(limiterFunction).toMatch(/current_limit\.window_started_at <= current_at - interval '1 hour' then current_at/i);
    expect(limiterFunction).toMatch(/current_limit\.window_started_at <= current_at - interval '1 hour' then 1/i);
    expect(limiterFunction).toMatch(/current_limit\.request_count < 11 then current_limit\.request_count \+ 1\s+else 11/i);
    expect(limiterFunction).toMatch(/return current_count <= 10/i);
  });

  it('exposes only a service-role boolean membership lookup, not Auth user records', () => {
    expect(migration).toMatch(/create function public\.trip_has_member_email\(target_trip uuid, target_email text\)\s+returns boolean/i);
    expect(migration).toMatch(/join public\.trip_members as m on m\.user_id = u\.id/i);
    expect(migration).toMatch(/m\.trip_id = target_trip/i);
    expect(migration).toMatch(/pg_catalog\.lower\(pg_catalog\.btrim\(u\.email\)\) = pg_catalog\.lower\(pg_catalog\.btrim\(target_email\)\)/i);
    expect(migration).toMatch(/revoke all on function public\.trip_has_member_email\(uuid, text\) from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.trip_has_member_email\(uuid, text\) to service_role/i);
    expect(migration).toMatch(/revoke all on function public\.consume_trip_invitation_rate_limit\(uuid\) from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.consume_trip_invitation_rate_limit\(uuid\) to service_role/i);
    expect(migration).not.toMatch(/create policy|alter policy|drop policy|trip_members\s+for\s+(?:insert|update|delete)/i);
  });
});
