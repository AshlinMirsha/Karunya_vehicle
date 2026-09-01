-- Ensure Bus 3 exists in public.buses
insert into public.buses (bus_number, route, capacity, latitude, longitude)
values ('3', 'Karunya Campus Route 3', 60, 0.0, 0.0)
on conflict (bus_number) do update set capacity = coalesce(public.buses.capacity, 60);

-- Pre-assign all 45 students to Bus No. 3
do $$
declare
  b3_id uuid;
begin
  select id into b3_id from public.buses where bus_number = '3' limit 1;

  -- 1. Insert/update pending_student_assignments
  insert into public.pending_student_assignments (email, full_name, register_number, bus_id, status)
  values
    ('navaneethakrishnan26@karunya.edu.in', 'S.M.NAVANEETHA KRISHNAN', 'URK26RA1011', b3_id, 'active'),
    ('deepakkumarr@karunya.edu.in', 'DEEPAKKUMAR R', 'URK26CS6051', b3_id, 'active'),
    ('jamiejohn@karunya.edu.in', 'JAMIE JIA SAMUEL', 'URK25CS1005', b3_id, 'active'),
    ('afnaa@karunya.edu.in', 'AFNA A', 'URK25AC1062', b3_id, 'active'),
    ('harinig23@karunya.edu.in', 'HARINI G', 'URK23AC1011', b3_id, 'active'),
    ('oviyar@karunya.edu.in', 'OVIYA R', 'URK24MP1001', b3_id, 'active'),
    ('sarkubiaazam@karunya.edu.in', 'SARKUBIA AZAM SHER K', 'URK23AE1007', b3_id, 'active'),
    ('vishnupriyag25@karunya.edu.in', 'VISHNUPRIYA G', 'PRK25MS1084', b3_id, 'active'),
    ('gokilavanik25@karunya.edu.in', 'GOKILAVANI K', 'URK25DS3007', b3_id, 'active'),
    ('hemachandranv@karunya.edu.in', 'HEMACHANDRAN V P', 'URK26BM1009', b3_id, 'active'),
    ('kevinroger@karunya.edu.in', 'KEVIN ROGER S', 'URK26CSD043', b3_id, 'active'),
    ('lohiths@karunya.edu.in', 'LOHITH.S', 'URK26CS1171', b3_id, 'active'),
    ('mervinjose@karunya.edu.in', 'MERVIN JOSE B', 'URK26AE4020', b3_id, 'active'),
    ('noeljobi@karunya.edu.in', 'NOEL JOBI', 'URK26CS1225', b3_id, 'active'),
    ('ranjiths24@karunya.edu.in', 'RANJITH S', 'URK24AI1009', b3_id, 'active'),
    ('benhananjoshua@karunya.edu.in', 'BENHANAN JOSHUA J', 'URK25AE4008', b3_id, 'active'),
    ('deepikar26@karunya.edu.in', 'DEEPIKA R', 'URK26CS1131', b3_id, 'active'),
    ('jayeshv@karunya.edu.in', 'JAYESH V PRAKASH NAIDU', 'URK24CO2018', b3_id, 'active'),
    ('pearlinemahima@karunya.edu.in', 'PEARLINE MAHIMA THINAKARAN', 'URK23CS1168', b3_id, 'active'),
    ('varshaantonis@karunya.edu.in', 'VARSHA ANTONIS .V', 'URK26CSD050', b3_id, 'active'),
    ('hanieljosh@karunya.edu.in', 'HANIEL JOSH S R', 'URK26CS7081', b3_id, 'active'),
    ('jacobs26@karunya.edu.in', 'JACOB.S', 'URK26RA4016', b3_id, 'active'),
    ('niketham@karunya.edu.in', 'NIKETHA M S', 'URK25AI1048', b3_id, 'active'),
    ('ricthinr@karunya.edu.in', 'RICTHIN.R', 'URK26MP1011', b3_id, 'active'),
    ('roshanc@karunya.edu.in', 'ROSHAN C B', 'URK26EE1013', b3_id, 'active'),
    ('nitesha@karunya.edu.in', 'A.NITESH', 'URK26BT1024', b3_id, 'active'),
    ('franzkingstein@karunya.edu.in', 'FRANZ KINGSTEIN N', 'URK23AI1112', b3_id, 'active'),
    ('ashwinb25@karunya.edu.in', 'B ASHWIN', 'PRK25RA1003', b3_id, 'active'),
    ('noelantony@karunya.edu.in', 'NOEL ANTONY KOCHUKULAM', 'URK25BM2035', b3_id, 'active'),
    ('selenad@karunya.edu.in', 'SELENA D', 'URK24CM4022', b3_id, 'active'),
    ('sharonroselina@karunya.edu.in', 'SHARON ROSEINA J', 'URK26PY1016', b3_id, 'active'),
    ('vaishnaviv25@karunya.edu.in', 'VAISHNAVI V', 'PRK25AD1015', b3_id, 'active'),
    ('adithyap@karunya.edu.in', 'ADITHYA P', 'URK23CO2025', b3_id, 'active'),
    ('aneesham@karunya.edu.in', 'ANEESHA M', 'URK25CS1219', b3_id, 'active'),
    ('angelinhebsibha@karunya.edu.in', 'ANGELIN HEBSIBHA S', 'URK25CS9080', b3_id, 'active'),
    ('arthurkevin@karunya.edu.in', 'ARTHUR KEVIN M', 'URK25RA1003', b3_id, 'active'),
    ('jesnab@karunya.edu.in', 'JESNA K B', 'URK25BM1014', b3_id, 'active'),
    ('lincyjenita@karunya.edu.in', 'LINCY JENITA J', 'URK23CS5079', b3_id, 'active'),
    ('nikithad@karunya.edu.in', 'NIKITHA D', 'URK25BM2030', b3_id, 'active'),
    ('vigneshi@karunya.edu.in', 'VIGNESH I', 'URK26CS1201', b3_id, 'active'),
    ('manasavisagai@karunya.edu.in', 'MANASA VISAGAI G', 'URK23BT5002', b3_id, 'active'),
    ('radhakrishnan26@karunya.edu.in', 'RADHAKRISHNAN S', 'URK26RA3009', b3_id, 'active'),
    ('saduryag23@karunya.edu.in', 'SADURYA G', 'RRK23MS2001', b3_id, 'active'),
    ('sanjaykaarthik@karunya.edu.in', 'SANJAY KAARTHIK N', 'URK26BT4012', b3_id, 'active'),
    ('sridharshika@karunya.edu.in', 'SRI DHARSHIKA', 'URK26CS6058', b3_id, 'active')
  on conflict (email) do update set
    full_name = excluded.full_name,
    register_number = excluded.register_number,
    bus_id = excluded.bus_id,
    status = 'active';

  -- 2. Update existing active profiles for signed-in students
  update public.profiles p
  set
    bus_id = b3_id,
    full_name = coalesce(nullif(psa.full_name, ''), p.full_name),
    register_number = coalesce(nullif(psa.register_number, ''), p.register_number),
    status = 'active'
  from public.pending_student_assignments psa
  where lower(p.email) = lower(psa.email)
    and psa.bus_id = b3_id;
end;
$$;
