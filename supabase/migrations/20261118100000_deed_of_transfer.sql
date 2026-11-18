-- Deed of Transfer joins the documents a practitioner can prepare.
--
-- It is priced like a Deed of Assignment: Scale 4A, on the consideration, the
-- transferee's practitioner on the full rate and the transferor's on half.
--
-- ADD VALUE is alone in this file because a new enum value cannot be used in
-- the transaction that adds it. The functions that price and code it follow
-- in 20261118100100_deed_of_transfer_fee.sql.

alter type public.document_type add value if not exists 'deed_of_transfer' after 'deed_of_assignment';
