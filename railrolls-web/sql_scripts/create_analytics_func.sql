CREATE OR REPLACE FUNCTION get_worker_analytics(start_date date)
RETURNS TABLE (
  worker_id uuid,
  total_hours numeric,
  ot_hours numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id as worker_id,
    COALESCE(SUM(wdh.hours_worked), 0) as total_hours,
    COALESCE(SUM(wa.hours), 0) as ot_hours
  FROM workers w
  LEFT JOIN worker_daily_hours wdh 
    ON w.id = wdh.worker_id 
    AND wdh.work_date >= start_date
  LEFT JOIN worker_adjustments wa 
    ON w.id = wa.worker_id 
    AND wa.kind = 'ot' 
    AND wa.effective_date >= start_date
  GROUP BY w.id;
END;
$$ LANGUAGE plpgsql;
