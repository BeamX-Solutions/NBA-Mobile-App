-- The Nigerian Bar Association's branch directory.
--
-- The directory is the Association's, not a list of whoever happened to sign
-- up. Every branch arrives INACTIVE, and activating one is what brings it onto
-- the platform: it becomes selectable when a lawyer registers, and its members
-- can draw receipts. Nothing here activates anything.
--
-- SOURCE. Taken from the NBA Remuneration Portal, src/components/BranchSelect.tsx,
-- which is the implementation already in use and the same source the fee
-- engine was ported from. Its list is grouped by state in the source file, so
-- each branch carries the state the portal files it under rather than one
-- inferred here. That matters: an earlier draft of this migration mapped the
-- states by hand from a list that gave only names, and every one of those was
-- a guess.
--
-- 149 branches across all 36 states and the Federal Capital Territory.
--
-- CODES.
--
-- branch_code is the branch name in capitals with punctuation removed, which
-- is the convention the two existing rows already follow (ANAOCHA, AWKA) and
-- the one that reads properly inside an RBIN: NBA/ONITSHA/0001/2026 says
-- something that NBA/079/0001/2026 does not.
--
-- short_code appears in certificate numbers and is limited to six characters
-- and must be unique, so it is the first six of branch_code. Two pairs collide
-- at that length. They are resolved by giving the plainer name the clean code
-- and suffixing the other, so Katsina keeps KATSIN and Katsina-Ala becomes
-- KATSI2, rather than whichever happened to be inserted first winning.
--
-- The two branches that already exist are skipped on their branch_code, so
-- this cannot touch the short codes AN and AW that their issued certificate
-- numbers were drawn against.
--
-- Bank details, chairman and signature are left null. They are the branch's
-- own to fill in from Branch Records once it has an administrator.

insert into public.branches (name, branch_code, short_code, state)
values
  ('NBA Aba Branch', 'ABA', 'ABA', 'Abia'),
  ('NBA Umuahia Branch', 'UMUAHIA', 'UMUAHI', 'Abia'),
  ('NBA Yola Branch', 'YOLA', 'YOLA', 'Adamawa'),
  ('NBA Mubi Branch', 'MUBI', 'MUBI', 'Adamawa'),
  ('NBA Ganye Branch', 'GANYE', 'GANYE', 'Adamawa'),
  ('NBA Uyo Branch', 'UYO', 'UYO', 'Akwa Ibom'),
  ('NBA Eket Branch', 'EKET', 'EKET', 'Akwa Ibom'),
  ('NBA Ikot Ekpene Branch', 'IKOTEKPENE', 'IKOTEK', 'Akwa Ibom'),
  ('NBA Oron Branch', 'ORON', 'ORON', 'Akwa Ibom'),
  ('NBA Awka Branch', 'AWKA', 'AWKA', 'Anambra'),
  ('NBA Onitsha Branch', 'ONITSHA', 'ONITSH', 'Anambra'),
  ('NBA Nnewi Branch', 'NNEWI', 'NNEWI', 'Anambra'),
  ('NBA Aguata Branch', 'AGUATA', 'AGUATA', 'Anambra'),
  ('NBA Anaocha Branch', 'ANAOCHA', 'ANAOCH', 'Anambra'),
  ('NBA Ogidi Branch', 'OGIDI', 'OGIDI', 'Anambra'),
  ('NBA Otuocha Branch', 'OTUOCHA', 'OTUOCH', 'Anambra'),
  ('NBA Bauchi Branch', 'BAUCHI', 'BAUCHI', 'Bauchi'),
  ('NBA Azare Branch', 'AZARE', 'AZARE', 'Bauchi'),
  ('NBA Misau Branch', 'MISAU', 'MISAU', 'Bauchi'),
  ('NBA Yenagoa Branch', 'YENAGOA', 'YENAGO', 'Bayelsa'),
  ('NBA Brass Branch', 'BRASS', 'BRASS', 'Bayelsa'),
  ('NBA Makurdi Branch', 'MAKURDI', 'MAKURD', 'Benue'),
  ('NBA Gboko Branch', 'GBOKO', 'GBOKO', 'Benue'),
  ('NBA Katsina-Ala Branch', 'KATSINAALA', 'KATSI2', 'Benue'),
  ('NBA Otukpo Branch', 'OTUKPO', 'OTUKPO', 'Benue'),
  ('NBA Vandeikya Branch', 'VANDEIKYA', 'VANDEI', 'Benue'),
  ('NBA Zaki Biam Branch', 'ZAKIBIAM', 'ZAKIBI', 'Benue'),
  ('NBA Maiduguri Branch', 'MAIDUGURI', 'MAIDUG', 'Borno'),
  ('NBA Biu Branch', 'BIU', 'BIU', 'Borno'),
  ('NBA Gwoza Branch', 'GWOZA', 'GWOZA', 'Borno'),
  ('NBA Calabar Branch', 'CALABAR', 'CALABA', 'Cross River'),
  ('NBA Ikom Branch', 'IKOM', 'IKOM', 'Cross River'),
  ('NBA Ogoja Branch', 'OGOJA', 'OGOJA', 'Cross River'),
  ('NBA Obudu Branch', 'OBUDU', 'OBUDU', 'Cross River'),
  ('NBA Asaba Branch', 'ASABA', 'ASABA', 'Delta'),
  ('NBA Warri Branch', 'WARRI', 'WARRI', 'Delta'),
  ('NBA Sapele Branch', 'SAPELE', 'SAPELE', 'Delta'),
  ('NBA Ughelli Branch', 'UGHELLI', 'UGHELL', 'Delta'),
  ('NBA Agbor Branch', 'AGBOR', 'AGBOR', 'Delta'),
  ('NBA Kwale Branch', 'KWALE', 'KWALE', 'Delta'),
  ('NBA Oleh Branch', 'OLEH', 'OLEH', 'Delta'),
  ('NBA Abakaliki Branch', 'ABAKALIKI', 'ABAKAL', 'Ebonyi'),
  ('NBA Afikpo Branch', 'AFIKPO', 'AFIKPO', 'Ebonyi'),
  ('NBA Onueke Branch', 'ONUEKE', 'ONUEKE', 'Ebonyi'),
  ('NBA Benin City Branch', 'BENINCITY', 'BENINC', 'Edo'),
  ('NBA Auchi Branch', 'AUCHI', 'AUCHI', 'Edo'),
  ('NBA Ekpoma Branch', 'EKPOMA', 'EKPOMA', 'Edo'),
  ('NBA Uromi Branch', 'UROMI', 'UROMI', 'Edo'),
  ('NBA Igarra Branch', 'IGARRA', 'IGARRA', 'Edo'),
  ('NBA Ado Ekiti Branch', 'ADOEKITI', 'ADOEKI', 'Ekiti'),
  ('NBA Ikere Ekiti Branch', 'IKEREEKITI', 'IKEREE', 'Ekiti'),
  ('NBA Ilawe Ekiti Branch', 'ILAWEEKITI', 'ILAWEE', 'Ekiti'),
  ('NBA Ijero Ekiti Branch', 'IJEROEKITI', 'IJEROE', 'Ekiti'),
  ('NBA Enugu Branch', 'ENUGU', 'ENUGU', 'Enugu'),
  ('NBA Nsukka Branch', 'NSUKKA', 'NSUKKA', 'Enugu'),
  ('NBA Agbani Branch', 'AGBANI', 'AGBANI', 'Enugu'),
  ('NBA Oji River Branch', 'OJIRIVER', 'OJIRIV', 'Enugu'),
  ('NBA Enugu Ezike Branch', 'ENUGUEZIKE', 'ENUGUE', 'Enugu'),
  ('NBA Abuja Branch', 'ABUJA', 'ABUJA', 'FCT'),
  ('NBA Gwagwalada Branch', 'GWAGWALADA', 'GWAGWA', 'FCT'),
  ('NBA Kuje Branch', 'KUJE', 'KUJE', 'FCT'),
  ('NBA Gombe Branch', 'GOMBE', 'GOMBE', 'Gombe'),
  ('NBA Billiri Branch', 'BILLIRI', 'BILLIR', 'Gombe'),
  ('NBA Kaltungo Branch', 'KALTUNGO', 'KALTUN', 'Gombe'),
  ('NBA Owerri Branch', 'OWERRI', 'OWERRI', 'Imo'),
  ('NBA Orlu Branch', 'ORLU', 'ORLU', 'Imo'),
  ('NBA Okigwe Branch', 'OKIGWE', 'OKIGWE', 'Imo'),
  ('NBA Oguta Branch', 'OGUTA', 'OGUTA', 'Imo'),
  ('NBA Dutse Branch', 'DUTSE', 'DUTSE', 'Jigawa'),
  ('NBA Hadejia Branch', 'HADEJIA', 'HADEJI', 'Jigawa'),
  ('NBA Birnin Kudu Branch', 'BIRNINKUDU', 'BIRNIN', 'Jigawa'),
  ('NBA Gumel Branch', 'GUMEL', 'GUMEL', 'Jigawa'),
  ('NBA Kaduna Branch', 'KADUNA', 'KADUNA', 'Kaduna'),
  ('NBA Kafanchan Branch', 'KAFANCHAN', 'KAFANC', 'Kaduna'),
  ('NBA Zaria Branch', 'ZARIA', 'ZARIA', 'Kaduna'),
  ('NBA Kagoro Branch', 'KAGORO', 'KAGORO', 'Kaduna'),
  ('NBA Kano Branch', 'KANO', 'KANO', 'Kano'),
  ('NBA Wudil Branch', 'WUDIL', 'WUDIL', 'Kano'),
  ('NBA Rano Branch', 'RANO', 'RANO', 'Kano'),
  ('NBA Katsina Branch', 'KATSINA', 'KATSIN', 'Katsina'),
  ('NBA Daura Branch', 'DAURA', 'DAURA', 'Katsina'),
  ('NBA Funtua Branch', 'FUNTUA', 'FUNTUA', 'Katsina'),
  ('NBA Malumfashi Branch', 'MALUMFASHI', 'MALUMF', 'Katsina'),
  ('NBA Birnin Kebbi Branch', 'BIRNINKEBBI', 'BIRNI2', 'Kebbi'),
  ('NBA Argungu Branch', 'ARGUNGU', 'ARGUNG', 'Kebbi'),
  ('NBA Yelwa Branch', 'YELWA', 'YELWA', 'Kebbi'),
  ('NBA Lokoja Branch', 'LOKOJA', 'LOKOJA', 'Kogi'),
  ('NBA Okene Branch', 'OKENE', 'OKENE', 'Kogi'),
  ('NBA Idah Branch', 'IDAH', 'IDAH', 'Kogi'),
  ('NBA Kabba Branch', 'KABBA', 'KABBA', 'Kogi'),
  ('NBA Anyigba Branch', 'ANYIGBA', 'ANYIGB', 'Kogi'),
  ('NBA Ankpa Branch', 'ANKPA', 'ANKPA', 'Kogi'),
  ('NBA Ilorin Branch', 'ILORIN', 'ILORIN', 'Kwara'),
  ('NBA Offa Branch', 'OFFA', 'OFFA', 'Kwara'),
  ('NBA Lafiagi Branch', 'LAFIAGI', 'LAFIAG', 'Kwara'),
  ('NBA Patigi Branch', 'PATIGI', 'PATIGI', 'Kwara'),
  ('NBA Lagos Branch', 'LAGOS', 'LAGOS', 'Lagos'),
  ('NBA Ikeja Branch', 'IKEJA', 'IKEJA', 'Lagos'),
  ('NBA Badagry Branch', 'BADAGRY', 'BADAGR', 'Lagos'),
  ('NBA Ikorodu Branch', 'IKORODU', 'IKOROD', 'Lagos'),
  ('NBA Epe Branch', 'EPE', 'EPE', 'Lagos'),
  ('NBA Lafia Branch', 'LAFIA', 'LAFIA', 'Nasarawa'),
  ('NBA Keffi Branch', 'KEFFI', 'KEFFI', 'Nasarawa'),
  ('NBA Karu Branch', 'KARU', 'KARU', 'Nasarawa'),
  ('NBA Akwanga Branch', 'AKWANGA', 'AKWANG', 'Nasarawa'),
  ('NBA Minna Branch', 'MINNA', 'MINNA', 'Niger'),
  ('NBA Bida Branch', 'BIDA', 'BIDA', 'Niger'),
  ('NBA Kontagora Branch', 'KONTAGORA', 'KONTAG', 'Niger'),
  ('NBA Suleja Branch', 'SULEJA', 'SULEJA', 'Niger'),
  ('NBA Mokwa Branch', 'MOKWA', 'MOKWA', 'Niger'),
  ('NBA Abeokuta Branch', 'ABEOKUTA', 'ABEOKU', 'Ogun'),
  ('NBA Sagamu Branch', 'SAGAMU', 'SAGAMU', 'Ogun'),
  ('NBA Ijebu Ode Branch', 'IJEBUODE', 'IJEBUO', 'Ogun'),
  ('NBA Ilaro Branch', 'ILARO', 'ILARO', 'Ogun'),
  ('NBA Ota Branch', 'OTA', 'OTA', 'Ogun'),
  ('NBA Akure Branch', 'AKURE', 'AKURE', 'Ondo'),
  ('NBA Ondo Branch', 'ONDO', 'ONDO', 'Ondo'),
  ('NBA Owo Branch', 'OWO', 'OWO', 'Ondo'),
  ('NBA Okitipupa Branch', 'OKITIPUPA', 'OKITIP', 'Ondo'),
  ('NBA Ikare Branch', 'IKARE', 'IKARE', 'Ondo'),
  ('NBA Osogbo Branch', 'OSOGBO', 'OSOGBO', 'Osun'),
  ('NBA Ile Ife Branch', 'ILEIFE', 'ILEIFE', 'Osun'),
  ('NBA Ilesa Branch', 'ILESA', 'ILESA', 'Osun'),
  ('NBA Ede Branch', 'EDE', 'EDE', 'Osun'),
  ('NBA Ibadan Branch', 'IBADAN', 'IBADAN', 'Oyo'),
  ('NBA Ogbomoso Branch', 'OGBOMOSO', 'OGBOMO', 'Oyo'),
  ('NBA Oyo Branch', 'OYO', 'OYO', 'Oyo'),
  ('NBA Iseyin Branch', 'ISEYIN', 'ISEYIN', 'Oyo'),
  ('NBA Saki Branch', 'SAKI', 'SAKI', 'Oyo'),
  ('NBA Jos Branch', 'JOS', 'JOS', 'Plateau'),
  ('NBA Shendam Branch', 'SHENDAM', 'SHENDA', 'Plateau'),
  ('NBA Pankshin Branch', 'PANKSHIN', 'PANKSH', 'Plateau'),
  ('NBA Langtang Branch', 'LANGTANG', 'LANGTA', 'Plateau'),
  ('NBA Port Harcourt Branch', 'PORTHARCOURT', 'PORTHA', 'Rivers'),
  ('NBA Okrika Branch', 'OKRIKA', 'OKRIKA', 'Rivers'),
  ('NBA Degema Branch', 'DEGEMA', 'DEGEMA', 'Rivers'),
  ('NBA Ahoada Branch', 'AHOADA', 'AHOADA', 'Rivers'),
  ('NBA Sokoto Branch', 'SOKOTO', 'SOKOTO', 'Sokoto'),
  ('NBA Tambuwal Branch', 'TAMBUWAL', 'TAMBUW', 'Sokoto'),
  ('NBA Gwadabawa Branch', 'GWADABAWA', 'GWADAB', 'Sokoto'),
  ('NBA Jalingo Branch', 'JALINGO', 'JALING', 'Taraba'),
  ('NBA Wukari Branch', 'WUKARI', 'WUKARI', 'Taraba'),
  ('NBA Takum Branch', 'TAKUM', 'TAKUM', 'Taraba'),
  ('NBA Damaturu Branch', 'DAMATURU', 'DAMATU', 'Yobe'),
  ('NBA Gashua Branch', 'GASHUA', 'GASHUA', 'Yobe'),
  ('NBA Potiskum Branch', 'POTISKUM', 'POTISK', 'Yobe'),
  ('NBA Gusau Branch', 'GUSAU', 'GUSAU', 'Zamfara'),
  ('NBA Kaura Namoda Branch', 'KAURANAMODA', 'KAURAN', 'Zamfara'),
  ('NBA Talata Mafara Branch', 'TALATAMAFARA', 'TALATA', 'Zamfara')
on conflict (branch_code) do nothing;
