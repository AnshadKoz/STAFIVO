-- Create a secure function to insert attendance logs.
-- This function uses SECURITY DEFINER to bypass RLS, allowing anonymous users to insert data.

CREATE OR REPLACE FUNCTION public.insert_attendance_log(payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, auth
AS $function$
BEGIN
  INSERT INTO public.attendance_logs (
    worker_id,
    outlet_id,
    action,
    timestamp_utc,
    source,
    gps_lat,
    gps_lng,
    gps_accuracy_m,
    face_score
  ) VALUES (
    (payload->>'worker_id')::uuid,
    (payload->>'outlet_id')::uuid,
    payload->>'action',
    (payload->>'timestamp_utc')::timestamp,
    payload->>'source',
    (payload->>'gps_lat')::double precision,
    (payload->>'gps_lng')::double precision,
    (payload->>'gps_accuracy_m')::double precision,
    (payload->>'face_score')::double precision
  );
END;
$function$;

-- Grant permission to anonymous users (and authenticated users)
GRANT EXECUTE ON FUNCTION public.insert_attendance_log(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.insert_attendance_log(jsonb) IS 'Securely inserts attendance logs for anonymous users.';
