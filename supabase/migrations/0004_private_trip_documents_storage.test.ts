import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('./0004_private_trip_documents_storage.sql', import.meta.url), 'utf8');

describe('private trip document Storage migration', () => {
  it('configures a private 25 MiB bucket with only the approved MIME types', () => {
    expect(migration).toMatch(/insert into storage\.buckets[\s\S]*?values[\s\S]*?\);/i);
    expect(migration).not.toMatch(/on\s+conflict\s*\(\s*id\s*\)\s*do\s+update/i);
    expect(migration).toMatch(/'trip-documents'[\s\S]*?false[\s\S]*?26214400/);
    expect(migration).toContain("'application/pdf'");
    expect(migration).toContain("'image/jpeg'");
    expect(migration).toContain("'image/png'");
    expect(migration).toContain("'image/webp'");
  });

  it('checks a validated first path segment against existing member/editor authorization', () => {
    expect(migration.match(/for select[\s\S]*?public\.is_trip_member\(/)?.[0]).toBeTruthy();
    expect(migration.match(/for insert[\s\S]*?public\.can_edit_trip\(/)?.[0]).toBeTruthy();
    expect(migration.match(/for delete[\s\S]*?public\.can_edit_trip\(/)?.[0]).toBeTruthy();
    expect(migration).toContain("split_part(name, '/', 1) ~*");
    expect(migration).toContain('then public.is_trip_member(split_part(name, \'/\', 1)::uuid)');
    expect(migration).toContain('then public.can_edit_trip(split_part(name, \'/\', 1)::uuid)');
  });

  it('does not define object update access or modify existing trip authorization', () => {
    expect(migration).not.toMatch(/for\s+update/i);
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)|with\s+check\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/alter\s+table\s+public\.trips|create\s+policy[^;]*public\.trips/i);
    expect(migration).toContain('public.is_trip_member');
    expect(migration).toContain('public.can_edit_trip');
  });
});
