-- Ensure Bus 4 exists in public.buses
insert into public.buses (bus_number, route, capacity, latitude, longitude)
values ('4', 'Karunya Campus Route 4', 60, 0.0, 0.0)
on conflict (bus_number) do update set capacity = coalesce(public.buses.capacity, 60);

-- Pre-assign all 43 students to Bus No. 4
do $$
declare
  b4_id uuid;
begin
  select id into b4_id from public.buses where bus_number = '4' limit 1;

  -- 1. Insert/update pending_student_assignments
  insert into public.pending_student_assignments (email, full_name, register_number, bus_id, status)
  values
    ('annalakshmia@karunya.edu.in', 'ANNALAKSHMI A', 'URK23AC1123', b4_id, 'active'),
    ('annieswetha@karunya.edu.in', 'ANNIE SWETHA B', 'URK23BT1047', b4_id, 'active'),
    ('shamsangthus@karunya.edu.in', 'SHAM SANGTHUS S', 'URK25AI1138', b4_id, 'active'),
    ('kiirtiraaj@karunya.edu.in', 'KIIRTI RAAJ S', 'URK26AI1153', b4_id, 'active'),
    ('abinayasria@karunya.edu.in', 'ABINAYASRI A', 'URK23BT1006', b4_id, 'active'),
    ('ddanyl@karunya.edu.in', 'DANYL JONATHAN D', 'URK26CS1183', b4_id, 'active'),
    ('jenisiamary@karunya.edu.in', 'JENISIA MARY J', 'URK25CS9035', b4_id, 'active'),
    ('lathishal@karunya.edu.in', 'LATHISHA L ROSE', 'URK26CS1119', b4_id, 'active'),
    ('snehasri@karunya.edu.in', 'S NEHASRI', 'URK24FP1010', b4_id, 'active'),
    ('shradhakrishna@karunya.edu.in', 'SHRADHA KRISHNA', 'URK24CS9041', b4_id, 'active'),
    ('sugandh@karunya.edu.in', 'SUGANDH', 'URK26RA4018', b4_id, 'active'),
    ('albianroy@karunya.edu.in', 'ALBIAN ROY T', 'URK23EC1030', b4_id, 'active'),
    ('mouless@karunya.edu.in', 'MOULES S R', 'URK26BT5015', b4_id, 'active'),
    ('jemimaa24@karunya.edu.in', 'JEMIMA A', 'URK24AI1023', b4_id, 'active'),
    ('sanjayraams@karunya.edu.in', 'SANJAYRAAM S', 'URK24CO2026', b4_id, 'active'),
    ('allanjosh@karunya.edu.in', 'ALLAN JOSH HERZEN J', 'URK26ME1028', b4_id, 'active'),
    ('genesistynee@karunya.edu.in', 'GENESIS TYNEE J N', 'URK26CS1069', b4_id, 'active'),
    ('joshuaj25@karunya.edu.in', 'JOSHUA J', 'URK25CM4043', b4_id, 'active'),
    ('sivaadhika@karunya.edu.in', 'SIVA ADHIKA UMAMAHESVARAN', 'URK23BT4008', b4_id, 'active'),
    ('sreeramn@karunya.edu.in', 'SREERAM N', 'URK24FS1004', b4_id, 'active'),
    ('nahshonvikas@karunya.edu.in', 'NAHSHON VIKAS R', 'URK26CS1106', b4_id, 'active'),
    ('kavyam25@karunya.edu.in', 'KAVYA M', 'URK25BT1026', b4_id, 'active'),
    ('mosesl@karunya.edu.in', 'MOSES L C', 'URK25EC1050', b4_id, 'active'),
    ('sidheevinod@karunya.edu.in', 'SIDHEE VINOD', 'URK23EC3003', b4_id, 'active'),
    ('christillam@karunya.edu.in', 'CHRISTILLA M', 'URK26DS5017', b4_id, 'active'),
    ('kkrishna26@karunya.edu.in', 'K KRISHNA', 'URK26BT4010', b4_id, 'active'),
    ('akarthikeyan@karunya.edu.in', 'A KARTHIKEYAN', 'URK23CS1272', b4_id, 'active'),
    ('aldrinbenedict@karunya.edu.in', 'ALDRIN BENEDICT M', 'URK23CS5028', b4_id, 'active'),
    ('ananiyaa@karunya.edu.in', 'ANANIYA A', 'URK26CS7139', b4_id, 'active'),
    ('avilashirenj@karunya.edu.in', 'AVILASHIREN J', 'URK23CM4058', b4_id, 'active'),
    ('cyruscelestine@karunya.edu.in', 'CYRUS CELESTINE A', 'URK25ME6005', b4_id, 'active'),
    ('evanalinette@karunya.edu.in', 'EVANA LINETTE L J', 'URK26BM2017', b4_id, 'active'),
    ('joelsmith@karunya.edu.in', 'JOEL SMITH M', 'URK24AI1047', b4_id, 'active'),
    ('leninjose@karunya.edu.in', 'LENIN JOSE G', 'URK26CS9074', b4_id, 'active'),
    ('makizhanj@karunya.edu.in', 'MAKIZHAN J', 'URK24CS5034', b4_id, 'active'),
    ('sanjaynesan@karunya.edu.in', 'SANJAY NESAN J', 'URK23AI1041', b4_id, 'active'),
    ('rsharan@karunya.edu.in', 'SHARAN LENA R', 'URK25CS7098', b4_id, 'active'),
    ('davev@karunya.edu.in', 'DAVE V SHAH', 'URK25CO2008', b4_id, 'active'),
    ('vishnuragavan@karunya.edu.in', 'VISHNU RAGAVAN P', 'URK25CS6039', b4_id, 'active'),
    ('sairamr@karunya.edu.in', 'SAIRAM R', 'URK26BT5009', b4_id, 'active'),
    ('kasturinachiyar@karunya.edu.in', 'KASTURI NACHIYAR P', 'URK23BT5006', b4_id, 'active'),
    ('lithanyasree@karunya.edu.in', 'LITHANYA SREE CM', 'URK25AC1024', b4_id, 'active'),
    ('kirans26@karunya.edu.in', 'KIRAN S M', 'URK26EC7045', b4_id, 'active')
  on conflict (email) do update set
    full_name = excluded.full_name,
    register_number = excluded.register_number,
    bus_id = excluded.bus_id,
    status = 'active';

  -- 2. Update existing active profiles for signed-in students
  update public.profiles p
  set
    bus_id = b4_id,
    full_name = coalesce(nullif(psa.full_name, ''), p.full_name),
    register_number = coalesce(nullif(psa.register_number, ''), p.register_number),
    status = 'active'
  from public.pending_student_assignments psa
  where lower(p.email) = lower(psa.email)
    and psa.bus_id = b4_id;
end;
$$;
