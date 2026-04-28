# Kitty TA/DA Dashboard

A lightweight Node.js dashboard for managing and exporting TA/DA reports. This application proxies requests to the Sokrio API and provides an interactive interface for calculating traveling and daily allowances.

## 🚀 Deployment Instructions

This project is ready for deployment on platforms like **Render**, **Railway**, **Koyeb**, or **Heroku**.

### 1. GitHub Setup
- Ensure this is a **Private** repository.
- Your `.env` file is excluded via `.gitignore` for security.

### 2. Required Environment Variables
When deploying, you must configure the following environment variables in your hosting provider's dashboard:

| Key | Description |
|-----|-------------|
| `PORT` | The port the server should run on (usually provided by the platform). |
| `LOGIN_API_URL` | Upstream login endpoint for the Sokrio API. |
| `USER_BULK_API_URL` | Upstream endpoint for user data download. |
| `DAY_REPORT_API_URL` | URL for the Daily Attendance/Report API. |
| `DEFAULT_IDENTIFIER` | Default email/ID for login (optional fallback). |
| `DEFAULT_PASSWORD` | Default password for login (optional fallback). |

### 3. Build & Start Commands
- **Build Command:** `npm install`
- **Start Command:** `npm start`

## 🛠 Features
- **Dynamic Dashboard:** Real-time TA/DA calculation.
- **Excel Export:** Download filtered reports in CSV format.
- **Manual Adjustments:** Override TA values per user.
- **Secure Proxy:** Handles API authentication safely.

---
**Powered by Sokrio Technologies LTD.**
