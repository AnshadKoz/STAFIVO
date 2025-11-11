
---

```markdown
# 🚆 Rail Rolls – Worker Attendance & Payroll System

A **smart attendance & payroll management system** built for **QSR (Quick Service Restaurant) chains** to efficiently handle **worker attendance, salary tracking, and payroll automation** — all with **face authentication** and **GPS validation**.

---

## 🌟 Key Features

### 👷 Worker Attendance
- On-device **Face Authentication** (Offline-first)
- **GPS-based validation** for outlet check-ins
- **Offline attendance logging** (auto-sync when online)
- Daily, weekly, and monthly attendance summaries

### 💰 Payroll Management
- Automated **salary calculations** with incentives, fines & overtime
- Exportable **payroll reports**
- **Payment tracking** for each worker

### 🧠 Manager Console (Web)
- Built with **Next.js + Supabase**
- Manage outlets, workers, and payroll data
- Role-based access (Admin / Manager)
- Real-time analytics dashboard

### 📱 Worker App (Mobile)
- Built with **Flutter**
- Offline-first design
- Simple UI for attendance & daily status

---

## 🧩 Tech Stack

| Layer | Technology |
|-------|-------------|
| Frontend (Mobile) | Flutter |
| Frontend (Web Console) | Next.js (React + TypeScript) |
| Backend & DB | Supabase (PostgreSQL + Edge Functions) |
| Authentication | Supabase Auth |
| Cloud Functions | Edge Functions (TypeScript) |
| Storage | Supabase Storage |
| Face Auth | On-device ML + Secure local templates |

---

## 🗂️ Project Structure

```

railrolls/
│
├── mobile/           # Flutter app for workers
│   ├── lib/
│   └── pubspec.yaml
│
├── web/              # Next.js admin/manager console
│   ├── src/
│   └── package.json
│
└── backend/          # Supabase edge functions, SQL, and schema
├── functions/
├── migrations/
└── seed.sql

````

---

## ⚙️ Setup Guide

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/<your-username>/railrolls.git
cd railrolls
````

### 2️⃣ Setup Supabase

* Create a new Supabase project
* Note down your `API URL`, `anon key`, and `service key`
* Run the SQL from `backend/migrations/` in the Supabase SQL Editor

### 3️⃣ Run Mobile App

```bash
cd mobile
flutter pub get
flutter run
```

### 4️⃣ Run Web Console

```bash
cd web
npm install
npm run dev
```

---

## 📸 Screenshots (Coming Soon)

*Add screenshots or GIFs of your app & web console once ready!*

---

## 👨‍💻 Team

| Name                 | Role                            |
| -------------------- | ------------------------------- |
| Anshad K (Koz)       | Flutter Developer, Project Lead |
| Dilbar Suhood M | Supabase & Web Developer        |

---

## 🚀 Roadmap

* [x] Supabase DB setup
* [x] Auth & Role management
* [ ] Face authentication integration
* [ ] Payroll automation
* [ ] Manager dashboard with analytics
* [ ] Exportable reports

---

## 🛡 License

This project is licensed under the **MIT License** – feel free to use and modify with credit.

---

## 💬 Feedback & Support

For feedback, suggestions, or collaboration, reach out via
📧 **[[anshadfakrudheenkk@gmail.com](mailto:anshadfakrudheenkk@gmail.com)]** or open an issue on GitHub!

---

> *Built with ❤️ using Flutter, Next.js, and Supabase.*

```

---

Would you like me to tailor it more for **freelance portfolio presentation** (like emphasizing your role, client, and project goals), or keep it **technical and developer-focused** for GitHub?
```
