-- Migration: Seed master boarding points for Bus 13 (Coordinator Titus)

DO $$
DECLARE
  v_bus_id UUID;
  v_names TEXT[] := ARRAY[
    'KINATHUKADAVU',
    'OTHAKAL MANDAPAM',
    'OTHAKAL MANDAPAM - PREMIER MILL',
    'MALUMICHAMPATTI',
    'EACHANARI',
    'RATHINAM CAMPUS',
    'LIC COLONY, SUNDARAPURAM',
    'SIDCO, POLLACHI MAIN ROAD',
    'SUNDARAPURAM GANDHINAGAR',
    'SUNDARAPURAM',
    'KURUCHI',
    'ATHUPAALLAM',
    'KUNIYAMUTHUR - High School',
    'KUNIYAMUTHUR - HP Petrol Bank',
    'KUNIYAMUTHUR - HMR',
    'KUNIYAMUTHUR - Sundarapuram Pirivu',
    'KUNIYAMUTHUR - Edayar Palyam Pirivu',
    'VIJAYALAKSHMI MILLS',
    'BK PUDUR',
    'WESTERN RING ROAD'
  ];
  v_name TEXT;
BEGIN
  -- Find bus_id for Bus 13
  SELECT id INTO v_bus_id 
  FROM public.buses 
  WHERE bus_number = '13' OR bus_number = 'Bus 13' OR bus_number = 'BUS 13'
  LIMIT 1;

  -- If Bus 13 does not exist in buses table, create it
  IF v_bus_id IS NULL THEN
    INSERT INTO public.buses (bus_number, route)
    VALUES ('13', 'Kinathukadavu - Sundarapuram - Kuniyamuthur Route')
    RETURNING id INTO v_bus_id;
  END IF;

  -- Insert each boarding point for Bus 13 with NULL (default '-') stop_no
  FOREACH v_name IN ARRAY v_names LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.boarding_points 
      WHERE bus_id = v_bus_id AND lower(trim(name)) = lower(trim(v_name))
    ) THEN
      INSERT INTO public.boarding_points (bus_id, name, stop_no, is_active)
      VALUES (v_bus_id, v_name, NULL, true);
    END IF;
  END LOOP;
END $$;
