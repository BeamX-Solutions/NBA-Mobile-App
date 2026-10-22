-- fee_scale_bands goes.
--
-- The table was meant to hold Scale 4 as data, but it was never seeded and
-- nothing reads it. Since 20261019110000_server_owns_the_fee the bands live in
-- public.professional_fee_for, mirrored by mobile/lib/fees/scale-2023.ts and
-- the practitioner web app's lib/fees/legal-fees.ts. An empty table beside
-- them reads as though the fee scale were missing, which is how it was found
-- on 22 October 2026, after the hosted database was cleared of test data.
--
-- fee_scales stays: calculations.fee_scale_id points at the active row, and a
-- new row is how an amended Order would be versioned.

drop table public.fee_scale_bands;
