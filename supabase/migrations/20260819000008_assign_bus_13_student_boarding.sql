-- Migration: Assign Bus 13 students to their respective boarding points

DO $$
DECLARE
  v_bus_id UUID;
  v_student_id UUID;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_close_date DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day';
  rec RECORD;
BEGIN
  -- Get bus_id for Bus 13
  SELECT id INTO v_bus_id 
  FROM public.buses 
  WHERE bus_number = '13' OR bus_number = 'Bus 13' OR bus_number = 'BUS 13'
  LIMIT 1;

  IF v_bus_id IS NULL THEN
    INSERT INTO public.buses (bus_number, route)
    VALUES ('13', 'Kinathukadavu - Sundarapuram - Kuniyamuthur Route')
    RETURNING id INTO v_bus_id;
  END IF;

  FOR rec IN
    SELECT name, bp FROM json_to_recordset('[
      {"name": "HARI SIDDARTH L", "bp": "KINATHUKADAVU"},
      {"name": "VIGNESH KUMAR S", "bp": "OTHAKAL MANDAPAM"},
      {"name": "LIWYA KAROLIN B", "bp": "OTHAKAL MANDAPAM - PREMIER MILL"},
      {"name": "RANJITH B", "bp": "MALUMICHAMPATTI"},
      {"name": "HARSHANSIVA S.N", "bp": "MALUMICHAMPATTI"},
      {"name": "JASLIN DAVISON", "bp": "MALUMICHAMPATTI"},
      {"name": "HARSHITHAA P S", "bp": "MALUMICHAMPATTI"},
      {"name": "CHRIS LEONARD C", "bp": "MALUMICHAMPATTI"},
      {"name": "HARSHITHA V", "bp": "EACHANARI"},
      {"name": "LAVANYA M S", "bp": "RATHINAM CAMPUS"},
      {"name": "HEMATHRI B S", "bp": "RATHINAM CAMPUS"},
      {"name": "SUGEETHA KIRUBALINI S", "bp": "LIC COLONY, SUNDARAPURAM"},
      {"name": "V SHERWIN GLADSTAIN", "bp": "SIDCO, POLLACHI MAIN ROAD"},
      {"name": "PRAJITH S", "bp": "SUNDARAPURAM GANDHINAGAR"},
      {"name": "ABISHEK FRANKLIN A", "bp": "SUNDARAPURAM"},
      {"name": "ARIES NATHYA A", "bp": "SUNDARAPURAM"},
      {"name": "SHARMI S", "bp": "SUNDARAPURAM"},
      {"name": "AREENA SHAFRA A", "bp": "SUNDARAPURAM"},
      {"name": "MOHAMMED SADIQ A", "bp": "ATHUPAALLAM"},
      {"name": "SANFIA BEGUM M", "bp": "ATHUPAALLAM"},
      {"name": "MOHAMMED MANAS M", "bp": "KUNIYAMUTHUR - High School"},
      {"name": "JONES INFANT A", "bp": "KUNIYAMUTHUR - HP Petrol Bank"},
      {"name": "GURU PRASATH V", "bp": "KUNIYAMUTHUR - HP Petrol Bank"},
      {"name": "VARUN NANDHA", "bp": "KUNIYAMUTHUR - HP Petrol Bank"},
      {"name": "MUKUND R", "bp": "KUNIYAMUTHUR - HMR"},
      {"name": "GOWTHAM K", "bp": "KUNIYAMUTHUR -Sundarapuram Pirivu"},
      {"name": "SAMUEL A", "bp": "KUNIYAMUTHUR -Sundarapuram Pirivu"},
      {"name": "FAYAZ N", "bp": "KUNIYAMUTHUR -Sundarapuram Pirivu"},
      {"name": "MEGHA JACINTHA D", "bp": "KUNIYAMUTHUR -Sundarapuram Pirivu"},
      {"name": "SYLVIA M", "bp": "KUNIYAMUTHUR -Sundarapuram Pirivu"},
      {"name": "SIBI CHAKRAVARTHI S S", "bp": "KUNIYAMUTHUR -Sundarapuram Pirivu"},
      {"name": "JELIN GIFTA C", "bp": "KUNIYAMUTHUR - Edayar Palyam Pirivu"},
      {"name": "ANNAMOLE S", "bp": "KUNIYAMUTHUR - Edayar Palyam Pirivu"},
      {"name": "MUNTASIR N", "bp": "KUNIYAMUTHUR - Edayar Palyam Pirivu"},
      {"name": "DOMINIC RAJA M S", "bp": "KUNIYAMUTHUR - Edayar Palyam Pirivu"},
      {"name": "JOEL MICHEL AUSTIN M", "bp": "VIJAYALAKSHMI MILLS"},
      {"name": "MOHAMMED ARIEF", "bp": "VIJAYALAKSHMI MILLS"},
      {"name": "ALWIN VINCENT KUMAR", "bp": "VIJAYALAKSHMI MILLS"},
      {"name": "ALEENA VINCENT KUMAR", "bp": "VIJAYALAKSHMI MILLS"},
      {"name": "AJAY KUMAR R S", "bp": "VIJAYALAKSHMI MILLS"},
      {"name": "DANNIE MAC MILAN A.R.", "bp": "VIJAYALAKSHMI MILLS"},
      {"name": "JAIRAM B S", "bp": "VIJAYALAKSHMI MILLS"},
      {"name": "SOORYAPRAKASH SENTHILKUMAR", "bp": "VIJAYALAKSHMI MILLS"},
      {"name": "JEEVITHAN S", "bp": "BK PUDUR"},
      {"name": "JAYA SHREE", "bp": "BK PUDUR"},
      {"name": "RINU C R", "bp": "BK PUDUR"},
      {"name": "ALVIN SYLVESTER I", "bp": "WESTERN RING ROAD"}
    ]') AS x(name TEXT, bp TEXT)
  LOOP
    v_student_id := NULL;

    -- 1. Try to find student in public.profiles
    SELECT id INTO v_student_id
    FROM public.profiles
    WHERE role = 'student'
      AND (
        lower(trim(full_name)) = lower(trim(rec.name))
        OR lower(full_name) ILIKE '%' || lower(trim(rec.name)) || '%'
        OR lower(trim(rec.name)) ILIKE '%' || lower(full_name) || '%'
      )
    ORDER BY CASE WHEN lower(trim(full_name)) = lower(trim(rec.name)) THEN 1 ELSE 2 END
    LIMIT 1;

    IF v_student_id IS NOT NULL THEN
      -- Update student's bus_id to Bus 13
      UPDATE public.profiles SET bus_id = v_bus_id WHERE id = v_student_id;

      -- Close old active boarding details
      UPDATE public.student_boarding_details
      SET effective_to = v_close_date, updated_at = now()
      WHERE student_id = v_student_id
        AND effective_to IS NULL;

      -- Insert new active boarding detail
      INSERT INTO public.student_boarding_details
        (student_id, boarding_point, bus_stop_no, effective_from, effective_to)
      VALUES
        (v_student_id, rec.bp, NULL, v_today, NULL);
    END IF;

    -- Also update pending_student_assignments if applicable
    UPDATE public.pending_student_assignments
    SET bus_id = v_bus_id
    WHERE lower(trim(full_name)) = lower(trim(rec.name))
       OR lower(full_name) ILIKE '%' || lower(trim(rec.name)) || '%';
  END LOOP;
END $$;
