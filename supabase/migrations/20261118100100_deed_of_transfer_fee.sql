-- Price and code the Deed of Transfer added in 20261118100000.
--
-- Both functions are reproduced in full; the only change in each is the
-- deed_of_transfer line.

-- Short code for the invoice reference, as in TXN-8924-DOT.
create or replace function public.document_type_code(p_type public.document_type)
returns text
language sql
immutable
as $$
  select case p_type
    when 'deed_of_assignment' then 'DOA'
    when 'deed_of_transfer'   then 'DOT'
    when 'deed_of_conveyance' then 'DOC'
    when 'deed_of_gift'       then 'DOG'
    when 'contract_of_sale'   then 'COS'
    when 'deed_of_surrender'  then 'DOS'
    when 'deed_of_exchange'   then 'DOE'
    when 'mortgage_deed'      then 'MTG'
    when 'deed_of_release'    then 'DOR'
    when 'tenancy_agreement'  then 'TEN'
    when 'deed_of_lease'      then 'LSE'
    when 'deed_of_sub_lease'  then 'SLS'
    when 'power_of_attorney'  then 'POA'
  end;
$$;

-- Reproduced from 20261019110000_server_owns_the_fee.sql with deed_of_transfer
-- added to 4A.
create or replace function public.professional_fee_for(
  p_document_type public.document_type,
  p_amount bigint
)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare
  -- {min, max, percent} in kobo; a null max is the open top band.
  v_bands bigint[];
  v_band bigint[];
  v_upper bigint;
  v_hundredths bigint := 0;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'The amount cannot be negative.' using errcode = '22023';
  end if;
  -- ₦1,000,000,000,000, the clients' MAX_AMOUNT_KOBO.
  if p_amount > 100000000000000 then
    raise exception 'The amount is larger than the calculator accepts.' using errcode = '22023';
  end if;

  v_bands := case
    -- 4A, conveyancing, assignments and transfers.
    when p_document_type in ('deed_of_assignment', 'deed_of_transfer', 'deed_of_conveyance',
                             'deed_of_gift', 'contract_of_sale', 'deed_of_surrender',
                             'deed_of_exchange') then
      array[[0, 5000000000, 10], [5000000000, 10000000000, 5], [10000000000, null, 3]]
    -- 4B, mortgages.
    when p_document_type in ('mortgage_deed', 'deed_of_release') then
      array[[0, 5000000000, 4], [5000000000, 10000000000, 3], [10000000000, null, 2]]
    -- 4C, leases and tenancies, on annual rent. The inert ₦10m boundary is
    -- mobile's, marked SUSPECT there; reproduced so the figures agree.
    when p_document_type in ('tenancy_agreement', 'deed_of_lease', 'deed_of_sub_lease') then
      array[[0, 500000000, 10], [500000000, 1000000000, 5], [1000000000, null, 5]]
  end;

  if v_bands is null then
    raise exception 'This document is not covered by Scale 4. The fee is agreed with the client under paragraph 2 of the Order.'
      using errcode = '22023';
  end if;

  -- Marginal bands, summed exactly in hundredths of a kobo, rounded once,
  -- half up: the web engine's method, which mobile's float sum approximates.
  foreach v_band slice 1 in array v_bands loop
    continue when p_amount <= v_band[1];
    v_upper := case when v_band[2] is null or p_amount < v_band[2] then p_amount else v_band[2] end;
    v_hundredths := v_hundredths + (v_upper - v_band[1]) * v_band[3];
  end loop;

  return (v_hundredths + 50) / 100;
end;
$$;

revoke execute on function public.professional_fee_for(public.document_type, bigint) from public, anon;
grant execute on function public.professional_fee_for(public.document_type, bigint) to authenticated, service_role;
