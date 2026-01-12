-- Update payroll generation to support outlet filtering
-- Replaces the function with a version that accepts p_outlet_id (default null)

CREATE OR REPLACE FUNCTION generate_payroll_for_month(p_month date, p_outlet_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_month_text text;
  v_worker_count integer;
  v_total_base numeric(10,2);
  v_total_ot numeric(10,2);
  v_total_incentive numeric(10,2);
  v_total_fine numeric(10,2);
  v_total_payout numeric(10,2);
  v_audit_user_id uuid;
BEGIN
  v_month_text := to_char(p_month, 'YYYY-MM');

  -- Get the app_user_id of the current user for the audit log
  SELECT id INTO v_audit_user_id FROM app_users WHERE auth_id = auth.uid() LIMIT 1;

  -- 1. DELETE existing records for this month (scoped by outlet if provided)
  DELETE FROM payroll_records 
  WHERE payroll_month = v_month_text
    AND worker_id IN (
      SELECT id FROM workers 
      WHERE (p_outlet_id IS NULL OR outlet_id = p_outlet_id)
    );

  -- 2. INSERT new payroll records
  INSERT INTO payroll_records (
    worker_id,
    payroll_month,
    base_salary,
    overtime,
    incentives,
    fines,
    calculated_total
  )
  SELECT
    w.id,
    v_month_text,
    -- Base Salary
    COALESCE(
      (SELECT SUM(wdh.hours_worked) FROM worker_daily_hours wdh WHERE wdh.worker_id = w.id AND to_char(wdh.work_date, 'YYYY-MM') = v_month_text), 0
    ) * COALESCE(w.base_salary_per_hour, 0),
    
    -- Overtime
    COALESCE(
      (SELECT SUM(wa.hours) FROM worker_adjustments wa WHERE wa.worker_id = w.id AND wa.kind = 'ot' AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text), 0
    ) * COALESCE(w.ot_rate_per_hour, 0),

    -- Incentives
    COALESCE(
      (SELECT SUM(wa.amount) FROM worker_adjustments wa WHERE wa.worker_id = w.id AND wa.kind = 'incentive' AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text), 0
    ),

    -- Fines
    COALESCE(
      (SELECT SUM(wa.amount) FROM worker_adjustments wa WHERE wa.worker_id = w.id AND wa.kind IN ('fine', 'deduction') AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text), 0
    ),

    -- Total
    (
      (COALESCE((SELECT SUM(hours_worked) FROM worker_daily_hours wdh WHERE wdh.worker_id = w.id AND to_char(wdh.work_date, 'YYYY-MM') = v_month_text), 0) * COALESCE(w.base_salary_per_hour, 0)) +
      (COALESCE((SELECT SUM(hours) FROM worker_adjustments wa WHERE wa.worker_id = w.id AND wa.kind = 'ot' AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text), 0) * COALESCE(w.ot_rate_per_hour, 0)) +
      COALESCE((SELECT SUM(amount) FROM worker_adjustments wa WHERE wa.worker_id = w.id AND wa.kind = 'incentive' AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text), 0) -
      COALESCE((SELECT SUM(amount) FROM worker_adjustments wa WHERE wa.worker_id = w.id AND wa.kind IN ('fine', 'deduction') AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text), 0)
    )
  FROM workers w
  WHERE (p_outlet_id IS NULL OR w.outlet_id = p_outlet_id);

  -- 3. CALCULATE totals for Audit (Filtered by outlet if provided)
  -- Note: We calculate totals for the *Action* performed. 
  -- If p_outlet_id is set, we only audit the generation for that outlet.
  -- Existing audit logic was for "Total Payroll in Month". 
  -- We should probably only count what we just generated or what matches the filter.
  -- Since the user said "If outlet_id is set -> process only workers of that outlet", the audit should reflect that scope.
  
  SELECT 
    COUNT(*), 
    COALESCE(SUM(base_salary), 0), 
    COALESCE(SUM(overtime), 0), 
    COALESCE(SUM(incentives), 0),
    COALESCE(SUM(fines), 0),
    COALESCE(SUM(calculated_total), 0)
  INTO 
    v_worker_count, 
    v_total_base, 
    v_total_ot, 
    v_total_incentive, 
    v_total_fine, 
    v_total_payout
  FROM payroll_records pr
  JOIN workers w ON pr.worker_id = w.id
  WHERE pr.payroll_month = v_month_text
    AND (p_outlet_id IS NULL OR w.outlet_id = p_outlet_id);

  -- 4. INSERT Audit Record
  INSERT INTO payroll_generation_audit (
    generated_by,
    payroll_month,
    worker_count,
    total_base_salary,
    total_overtime,
    total_incentives,
    total_fines,
    total_payout,
    parameters -- Store parameters to distinguish outlet runs
  ) VALUES (
    v_audit_user_id,
    v_month_text,
    v_worker_count,
    v_total_base,
    v_total_ot,
    v_total_incentive,
    v_total_fine,
    v_total_payout,
    CASE WHEN p_outlet_id IS NOT NULL THEN jsonb_build_object('outlet_id', p_outlet_id) ELSE NULL END
  );

END;
$$;
