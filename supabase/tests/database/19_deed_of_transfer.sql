-- Deed of Transfer (20261118100000, 20261118100100): the server prices it on
-- Scale 4A like an assignment and gives it its own invoice code.

begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select is(public.professional_fee_for('deed_of_transfer', 5000000000), 500000000::bigint,
  '₦50m transfer is 10% of the whole: ₦5m');
select is(public.professional_fee_for('deed_of_transfer', 6000000000),
  public.professional_fee_for('deed_of_assignment', 6000000000),
  'a transfer costs the same as an assignment of the same value');
select is(public.document_type_code('deed_of_transfer'), 'DOT',
  'a transfer invoice is coded DOT');
select is(public.document_type_code('deed_of_assignment'), 'DOA',
  'existing codes are unchanged');

select * from finish();
rollback;
