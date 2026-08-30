-- Reference data every environment needs.
--
-- This is deliberately a migration rather than seed data. The State Band
-- mapping decides which rate ladder applies to a practitioner, so it is
-- closer to schema than to fixtures: every environment must have it, and
-- correcting it later should leave an auditable migration behind rather than
-- being an undocumented edit to a production row.
--
-- PROVISIONAL. Band 3 (Lagos and FCT) is established from public sources, and
-- the brief names Akwa Ibom, Bayelsa, Benue, Cross River and Delta as Band 2
-- but describes that as "a group including", so the list may be incomplete.
-- Everything else defaults to Band 1 pending the full Schedule (SPEC.md
-- section 10). mobile/lib/fees/placeholder-scale.ts mirrors this mapping and
-- the two must be corrected together.

insert into public.state_bands (state, band) values
  ('Abia', 1),
  ('Adamawa', 1),
  ('Akwa Ibom', 2),
  ('Anambra', 1),
  ('Bauchi', 1),
  ('Bayelsa', 2),
  ('Benue', 2),
  ('Borno', 1),
  ('Cross River', 2),
  ('Delta', 2),
  ('Ebonyi', 1),
  ('Edo', 1),
  ('Ekiti', 1),
  ('Enugu', 1),
  ('FCT', 3),
  ('Gombe', 1),
  ('Imo', 1),
  ('Jigawa', 1),
  ('Kaduna', 1),
  ('Kano', 1),
  ('Katsina', 1),
  ('Kebbi', 1),
  ('Kogi', 1),
  ('Kwara', 1),
  ('Lagos', 3),
  ('Nasarawa', 1),
  ('Niger', 1),
  ('Ogun', 1),
  ('Ondo', 1),
  ('Osun', 1),
  ('Oyo', 1),
  ('Plateau', 1),
  ('Rivers', 1),
  ('Sokoto', 1),
  ('Taraba', 1),
  ('Yobe', 1),
  ('Zamfara', 1)
on conflict (state) do nothing;

-- The current Order, with no bands attached. The engine refuses to calculate
-- against a scale with no matching bands, so an empty scale fails loudly
-- rather than quietly returning zero. Bands are loaded once the client
-- supplies the Schedule tables.
insert into public.fee_scales (order_name, effective_from, is_active)
select
  'Legal Practitioners (Remuneration for Business, Legal Services and Representation) Order, 2023',
  date '2023-05-16',
  true
where not exists (select 1 from public.fee_scales where is_active);
