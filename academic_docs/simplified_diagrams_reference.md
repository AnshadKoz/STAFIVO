# WorkForge – Simplified Diagram Reference
## For PPT, Word Documents, and Handwritten Exams

**Project:** WorkForge – Worker Attendance and Payroll Management System  
**Course:** MCA Main Project  
**Module:** Web Application (Admin & Manager)

---

## 1. USE CASE DIAGRAM - Simplified Reference

### Actors and Relationships

**Actors:**
1. Admin
2. Manager
3. Supabase Backend (External)

### Admin Use Cases (15 total)
```
Admin performs:
├── UC1: Login
├── UC2: Manage Outlets
├── UC3: Manage Workers
├── UC4: Manage Managers
├── UC5: Approve Worker Onboarding
├── UC6: Monitor Attendance
├── UC7: Log Attendance Manually
├── UC8: Add Worker Adjustments
├── UC9: Generate Payroll
├── UC10: Preview Payroll
├── UC11: View Worker Payslip
├── UC12: Export Payroll Stats
├── UC13: View Dashboard & Analytics
├── UC14: Reset User Passwords
└── UC15: Logout
```

### Manager Use Cases (12 total)
```
Manager performs:
├── UC1: Login
├── UC16: View Assigned Outlet
├── UC17: Submit Worker Onboarding Request
├── UC18: View Request Status
├── UC19: Monitor Worker Attendance (Outlet-Scoped)
├── UC20: Log Attendance for Workers
├── UC21: Review Fine Appeals
├── UC22: Respond to Fine Appeals
├── UC23: Preview Outlet Payroll (Read-Only)
├── UC24: View Notifications
├── UC25: View Worker Analytics
└── UC15: Logout
```

### Supabase Backend Interactions
```
All use cases connect to Supabase Backend for:
- User Authentication (auth.users)
- Data Storage and Retrieval
- Row Level Security Enforcement
- Real-Time Updates
- Analytics Processing
```

---

## 2. DFD LEVEL 0 - Context Diagram (Simplified)

### System: WorkForge Web Application

**External Entities:**
- Admin
- Manager
- Supabase Backend

### Data Flow Table

| From | To | Data Flow |
|------|-----|-----------|
| **Admin → System** | | |
| | | • Login Credentials |
| | | • Outlet Management Data (Create/Update/Delete) |
| | | • Worker Management Data (Create/Update) |
| | | • Manager Management Data (Create/Assign) |
| | | • Approval Decisions (Worker Requests) |
| | | • Attendance Logs (Manual Entry) |
| | | • Worker Adjustments (OT/Fine/Incentive) |
| | | • Payroll Generation Requests |
| | | • Password Reset Requests |
| **System → Admin** | | |
| | | • Dashboard Summary & Analytics |
| | | • Attendance Reports (All Outlets) |
| | | • Payroll Data & Worker Payslips |
| | | • Outlet Analytics Charts |
| | | • Worker Statistics (CSV) |
| | | • Pending Worker Requests |
| **Manager → System** | | |
| | | • Login Credentials |
| | | • Worker Onboarding Requests |
| | | • Attendance Logs (Manual Entry) |
| | | • Fine Appeal Responses |
| **System → Manager** | | |
| | | • Assigned Outlet Details |
| | | • Attendance Data (Outlet-Filtered) |
| | | • Worker List (Outlet-Filtered) |
| | | • Payroll Preview (Read-Only) |
| | | • System Notifications |
| | | • Pending Fine Appeals |
| | | • Worker Request Status |
| | | • Worker Performance Analytics |
| **System ↔ Supabase** | | |
| | | • Authentication Requests/Responses |
| | | • Database CRUD Operations |
| | | • RLS Policy Enforcement |
| | | • Real-Time Data Sync |

---

## 3. DFD LEVEL 1 - Admin Module (Tabular Format)

### Process List

| Process # | Process Name | Description |
|-----------|--------------|-------------|
| 1.0 | Authenticate Admin | Verify credentials, check role=admin in app_users |
| 2.0 | Manage Outlets | Create, update, delete outlet records with GPS |
| 3.0 | Manage Workers | Create workers with auth, update details, reset pwd |
| 4.0 | Manage Managers | Create managers, assign outlets, manage access |
| 5.0 | Approve Worker Onboarding | Review/approve/reject manager requests |
| 6.0 | Monitor Attendance | View all attendance logs, manual entry |
| 7.0 | Process Worker Adjustments | Add OT/Incentive/Fine/Deduction records |
| 8.0 | Generate Payroll | Calculate & save payroll for given month |
| 9.0 | Generate Reports & Analytics | Dashboard stats, outlet analytics, CSV export |

### Data Stores Used

| Store # | Table Name | Purpose |
|---------|------------|---------|
| D1 | auth.users | Supabase authentication |
| D2 | app_users | User profiles (role, name, outlet_id) |
| D3 | outlets | Outlet locations with GPS coordinates |
| D4 | workers | Worker records with salary rates |
| D5 | managers | Manager-outlet mapping |
| D6 | attendance_logs | Check-in/out records |
| D7 | worker_adjustments | OT/Fine/Incentive records |
| D8 | payroll_records | Generated payroll data |
| D9 | worker_onboarding_requests | Manager-submitted requests |
| D10 | worker_daily_hours | Calculated hours (view) |
| D11 | payroll_generation_audit | Audit trail |

### Key Data Flows (Admin Module)

**Process 1.0: Authenticate Admin**
```
Input:  Admin → Email, Password
Flow:   P1.0 ↔ D1 (Verify credentials)
        P1.0 ↔ D2 (Fetch profile, verify role='admin')
Output: P1.0 → Admin (Auth success/fail)
```

**Process 2.0: Manage Outlets**
```
Input:  Admin → Outlet details (name, GPS, radius)
Flow:   P2.0 ↔ D3 (CRUD operations)
Output: P2.0 → Admin (Outlet created/updated/deleted)
```

**Process 3.0: Manage Workers**
```
Input:  Admin → Worker details (name, email, phone, outlet, salary)
Flow:   P3.0 ↔ D1 (Create auth user)
        P3.0 ↔ D4 (Create/update worker)
        P3.0 → D3 (Read outlet data)
Output: P3.0 → Admin (Worker created/updated)
```

**Process 5.0: Approve Worker Onboarding**
```
Input:  Admin → Request ID, Decision (approve/reject), Comment
Flow:   P5.0 ↔ D9 (Update request status)
        P5.0 → D1 (Create auth user if approved)
        P5.0 → D4 (Create worker if approved)
Output: P5.0 → Admin (Request processed, worker created)
```

**Process 8.0: Generate Payroll**
```
Input:  Admin → Payroll month (YYYY-MM)
Flow:   P8.0 → D4 (Read workers)
        P8.0 → D10 (Read worked hours)
        P8.0 ↔ D7 (Read adjustments)
        P8.0 ↔ D8 (Create/read payroll records)
        P8.0 → D11 (Log audit)
Output: P8.0 → Admin (Payroll generated, payslips available)

Calculation:
Base Salary = Hours × Hourly Rate
Total = Base + OT + Incentives - Fines
```

**Process 9.0: Generate Reports**
```
Input:  Admin → Date range, Filters
Flow:   P9.0 → D10 (Read hours)
        P9.0 → D7 (Read adjustments)
        P9.0 → D8 (Read payroll)
        P9.0 → D3, D4 (Read outlets/workers)
Output: P9.0 → Admin (Dashboard analytics, CSV export)
```

---

## 4. DFD LEVEL 1 - Manager Module (Tabular Format)

### Process List

| Process # | Process Name | Description | RLS Applied |
|-----------|--------------|-------------|-------------|
| 1.0 | Authenticate Manager | Verify credentials, check role=manager | - |
| 2.0 | View Assigned Outlet | Retrieve outlet details | Yes (own outlet) |
| 3.0 | Monitor Worker Attendance | View attendance logs (outlet-filtered) | Yes |
| 4.0 | Submit Worker Onboarding Request | Request admin to create worker | Yes |
| 5.0 | Log Attendance | Manually log IN/OUT for outlet workers | Yes |
| 6.0 | Review Fine Appeals | View/respond to appeals assigned to self | Yes |
| 7.0 | Preview Outlet Payroll | Read-only payroll preview (outlet workers) | Yes |
| 8.0 | View Notifications | View/mark notifications as read | Yes |
| 9.0 | View Worker Analytics | Worker performance analytics | Yes |

### Data Stores Used

| Store # | Table Name | Manager Access Level |
|---------|------------|---------------------|
| D1 | auth.users | Read own auth record |
| D2 | app_users | Read own profile |
| D3 | managers | Read own manager record |
| D4 | outlets | Read assigned outlet only |
| D5 | workers | Read outlet workers only (RLS) |
| D6 | attendance_logs | Read outlet logs only (RLS) |
| D7 | worker_onboarding_requests | Create & read own requests |
| D8 | fine_appeals | Read/update appeals where manager_id=self |
| D9 | worker_adjustments | Read outlet adjustments (via appeals) |
| D10 | notifications | Read own notifications |
| D11 | worker_daily_hours | Read outlet workers' hours (RLS) |
| D12 | payroll_records | Read-only, outlet-filtered |

### Key Data Flows (Manager Module)

**Process 1.0: Authenticate Manager**
```
Input:  Manager → Email, Password
Flow:   P1.0 ↔ D1 (Verify credentials)
        P1.0 ↔ D2 (Fetch profile, verify role='manager')
        P1.0 → D3 (Read manager record for outlet_id)
Output: P1.0 → Manager (Auth success, outlet assignment)
```

**Process 2.0: View Assigned Outlet**
```
Input:  Manager → View request
Flow:   P2.0 → D3 (Read outlet_id from manager record)
        P2.0 → D4 (Read outlet details)
Output: P2.0 → Manager (Outlet name, GPS, radius)
```

**Process 3.0: Monitor Worker Attendance**
```
Input:  Manager → Date filter, Worker filter
Flow:   P3.0 → D6 (Read attendance_logs, RLS filters by outlet)
        P3.0 → D5 (Read worker names, RLS filters by outlet)
Output: P3.0 → Manager (Attendance logs for outlet workers)
```

**Process 4.0: Submit Worker Onboarding Request**
```
Input:  Manager → Worker details (name, email, phone, salary)
Flow:   P4.0 → D3 (Read outlet_id)
        P4.0 ↔ D7 (Create request with requested_by=manager)
Output: P4.0 → Manager (Request submitted, status=pending)
```

**Process 5.0: Log Attendance**
```
Input:  Manager → Worker ID, Action (IN/OUT)
Flow:   P5.0 → D3 (Read outlet_id)
        P5.0 → D5 (Verify worker belongs to outlet)
        P5.0 ↔ D6 (Create attendance record)
Output: P5.0 → Manager (Attendance logged)
```

**Process 6.0: Review Fine Appeals**
```
Input:  Manager → Appeal ID, Decision (approve/reject), Comment
Flow:   P6.0 ↔ D8 (Read/update appeals where manager_id=self)
        P6.0 ↔ D9 (Update adjustment if approved)
        P6.0 → D5 (Read worker names)
Output: P6.0 → Manager (Appeal resolved, notification sent)
```

**Process 7.0: Preview Outlet Payroll**
```
Input:  Manager → Payroll month (YYYY-MM)
Flow:   P7.0 → D5 (Read outlet workers, RLS filtered)
        P7.0 → D11 (Read worked hours)
        P7.0 → D9 (Read adjustments)
        P7.0 → D12 (Read existing payroll records)
Output: P7.0 → Manager (Read-only payroll preview)

Note: Manager CANNOT generate/modify payroll, only preview
```

**Process 8.0: View Notifications**
```
Input:  Manager → Mark as read request
Flow:   P8.0 ↔ D10 (Read/update notifications where user_id=manager)
Output: P8.0 → Manager (Notification list, unread count)
```

**Process 9.0: View Worker Analytics**
```
Input:  Manager → Date range
Flow:   P9.0 → D5 (Read outlet workers)
        P9.0 → D11 (RPC: get_worker_analytics, RLS filters outlet)
        P9.0 → D9 (Read adjustments for OT hours)
Output: P9.0 → Manager (Worker hours chart, OT analytics)
```

---

## 5. Row Level Security (RLS) Implementation

### Manager RLS Rules Summary

**workers table:**
```
Manager can SELECT workers WHERE outlet_id = (
  SELECT outlet_id FROM managers WHERE app_user_id = auth.uid()
)
```

**attendance_logs table:**
```
Manager can SELECT/INSERT attendance_logs WHERE outlet_id = (
  SELECT outlet_id FROM managers WHERE app_user_id = auth.uid()
)
```

**worker_onboarding_requests table:**
```
Manager can SELECT WHERE requested_by = auth.uid()
Manager can INSERT with requested_by = auth.uid()
```

**fine_appeals table:**
```
Manager can SELECT/UPDATE WHERE manager_id = auth.uid()
```

**notifications table:**
```
Manager can SELECT/UPDATE WHERE user_id = auth.uid()
```

**Admin RLS:**
```
Admin bypasses RLS for all tables (unrestricted access)
```

---

## 6. Payroll Calculation Workflow (Process 8.0 Detailed)

### Step-by-Step Process

**Step 1:** Admin enters payroll month (e.g., "2026-01")

**Step 2:** System fetches all active workers from D4 (workers table)

**Step 3:** For each worker:
```
a. Get base_salary_per_hour from workers table
b. Get worked_hours from worker_daily_hours (filtered by month)
c. Calculate: base_salary = hours × hourly_rate
```

**Step 4:** Fetch adjustments from D7 (worker_adjustments):
```
a. SUM(amount) WHERE kind='ot' AND effective_date in month
b. SUM(amount) WHERE kind='incentive' AND effective_date in month
c. SUM(amount) WHERE kind='fine' AND effective_date in month
d. SUM(amount) WHERE kind='deduction' AND effective_date in month
```

**Step 5:** Calculate final total:
```
calculated_total = base_salary 
                 + overtime 
                 + incentives 
                 - fines 
                 - deductions
```

**Step 6:** Insert record into D8 (payroll_records):
```
INSERT INTO payroll_records (
  worker_id,
  payroll_month,
  base_salary,
  overtime,
  incentives,
  fines,
  calculated_total,
  created_at
) VALUES (...)
```

**Step 7:** Log generation in D11 (payroll_generation_audit):
```
INSERT INTO payroll_generation_audit (
  generated_by,
  payroll_month,
  worker_count,
  total_payout,
  generation_timestamp
) VALUES (...)
```

**Step 8:** Return payroll run results to admin

### Preview vs Generate
- **Preview:** Same calculation, no database insert
- **Generate:** Calculation + insert into payroll_records

---

## 7. Quick Reference Tables

### Admin Capabilities
| Feature | Create | Read | Update | Delete |
|---------|--------|------|--------|--------|
| Outlets | ✓ | ✓ | ✓ | ✓ |
| Workers | ✓ | ✓ | ✓ | ✗ |
| Managers | ✓ | ✓ | ✓ | ✗ |
| Attendance | ✓ | ✓ | ✗ | ✗ |
| Adjustments | ✓ | ✓ | ✗ | ✗ |
| Payroll | ✓ | ✓ | ✗ | ✗ |
| Approve Requests | ✓ | ✓ | ✗ | ✗ |

### Manager Capabilities
| Feature | Create | Read | Update | Delete |
|---------|--------|------|--------|--------|
| Outlets | ✗ | ✓ (own) | ✗ | ✗ |
| Workers | ✗ | ✓ (outlet) | ✗ | ✗ |
| Attendance | ✓ (outlet) | ✓ (outlet) | ✗ | ✗ |
| Worker Requests | ✓ | ✓ (own) | ✗ | ✗ |
| Fine Appeals | ✗ | ✓ (assigned) | ✓ | ✗ |
| Payroll | ✗ | ✓ (preview) | ✗ | ✗ |
| Notifications | ✗ | ✓ (own) | ✓ (mark read) | ✗ |

### Authentication Flow
```
1. User enters email + password
2. Supabase Auth validates
3. Fetch app_users record (auth_id = user.id)
4. Check role:
   - admin → /admin dashboard
   - manager → /manager dashboard
   - worker → /worker (mobile only)
5. Middleware enforces auth on all routes
```

---

## 8. Exam Tips

### For Handwritten Diagrams:

**Use Case Diagram:**
- Draw large system boundary rectangle
- Place actors (stick figures) outside
- Draw ovals inside for use cases
- Connect with solid lines (performs)
- Connect use cases to Supabase with dashed lines (uses)

**DFD Level 0:**
- Central system (rectangle)
- 3 external entities (Admin, Manager, Supabase)
- Label all arrows with data names
- Keep it simple, show main data flows only

**DFD Level 1:**
- Number processes (1.0, 2.0, etc.)
- Use circles or rounded rectangles for processes
- Cylinders for data stores (D1, D2, etc.)
- Clear data flow arrows with labels

### For PPT Slides:

**Slide 1:** Use Case Diagram
- Title: "WorkForge Use Case Diagram"
- Include the Mermaid diagram or simplified table
- Bullet points: 3 actors, 15 admin use cases, 12 manager use cases

**Slide 2:** DFD Level 0
- Title: "Context Diagram - System Overview"
- Show the system + 3 external entities
- Key data flows table

**Slide 3-4:** DFD Level 1 Admin
- Title: "Admin Module Data Flow"
- Process list table
- Key processes highlighted

**Slide 5-6:** DFD Level 1 Manager
- Title: "Manager Module Data Flow"
- Process list table
- Emphasize RLS filtering

**Slide 7:** Key Features
- Role-based access control
- Payroll automation
- Real-time notifications
- Outlet-level data filtering

---

**End of Simplified Reference**
