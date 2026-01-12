-- Restore payroll generation logic
-- This function was previously overwritten by an audit-only version.
-- This script restores the calculation logic using worker_daily_hours and worker_adjustments.

CREATE OR REPLACE FUNCTION generate_payroll_for_month(p_month date)
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

  -- 1. DELETE existing records for this month to allow regeneration
  DELETE FROM payroll_records WHERE payroll_month = v_month_text;

  -- 2. INSERT new payroll records
  -- We aggregate data from worker_daily_hours (base salary) and worker_adjustments (OT, incentives, fines)
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
    -- Base Salary: Total Hours * Base Rate
    COALESCE(
      (
        SELECT SUM(wdh.hours_worked)
        FROM worker_daily_hours wdh
        WHERE wdh.worker_id = w.id
          AND to_char(wdh.work_date, 'YYYY-MM') = v_month_text
      ), 0
    ) * COALESCE(w.base_salary_per_hour, 0),
    
    -- Overtime: OT Hours * OT Rate
    COALESCE(
      (
        SELECT SUM(wa.hours)
        FROM worker_adjustments wa
        WHERE wa.worker_id = w.id
          AND wa.kind = 'ot'
          AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text
      ), 0
    ) * COALESCE(w.ot_rate_per_hour, 0),

    -- Incentives: Sum of amounts
    COALESCE(
      (
        SELECT SUM(wa.amount)
        FROM worker_adjustments wa
        WHERE wa.worker_id = w.id
          AND wa.kind = 'incentive'
          AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text
      ), 0
    ),

    -- Fines: Sum of amounts (treated as positive value here, subtracted in total)
    COALESCE(
      (
        SELECT SUM(wa.amount)
        FROM worker_adjustments wa
        WHERE wa.worker_id = w.id
          AND wa.kind IN ('fine', 'deduction')
          AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text
      ), 0
    ),

    -- Total Calculation
    (
      -- Base
      (COALESCE(
        (SELECT SUM(hours_worked) FROM worker_daily_hours wdh WHERE wdh.worker_id = w.id AND to_char(wdh.work_date, 'YYYY-MM') = v_month_text), 0
      ) * COALESCE(w.base_salary_per_hour, 0)) +
      -- OT
      (COALESCE(
        (SELECT SUM(hours) FROM worker_adjustments wa WHERE wa.worker_id = w.id AND wa.kind = 'ot' AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text), 0
      ) * COALESCE(w.ot_rate_per_hour, 0)) +
      -- Incentives
      COALESCE(
        (SELECT SUM(amount) FROM worker_adjustments wa WHERE wa.worker_id = w.id AND wa.kind = 'incentive' AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text), 0
      ) -
      -- Fines
      COALESCE(
        (SELECT SUM(amount) FROM worker_adjustments wa WHERE wa.worker_id = w.id AND wa.kind IN ('fine', 'deduction') AND to_char(wa.effective_date, 'YYYY-MM') = v_month_text), 0
      )
    )
  FROM workers w;

  -- 3. CALCULATE totals for Audit
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
  FROM payroll_records
  WHERE payroll_month = v_month_text;

  -- 4. INSERT Audit Record
  INSERT INTO payroll_generation_audit (
    generated_by,
    payroll_month,
    worker_count,
    total_base_salary,
    total_overtime,
    total_incentives,
    total_fines,
    total_payout
  ) VALUES (
    v_audit_user_id,
    v_month_text,
    v_worker_count,
    v_total_base,
    v_total_ot,
    v_total_incentive,
    v_total_fine,
    v_total_payout
  );

END;
$$;
