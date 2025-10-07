# 🚓 Sigma Cloud Dispatches Tracker

## 📋 Overview

Sigma Cloud Dispatches Tracker is a scheduled monitoring job designed to detect excessive dispatch activity reported by Segware. It operates on a 2-day rolling window, retrieving dispatch records from all companies via the Segware API. The service analyzes each account's total number of dispatches and flags accounts that exceed a configurable threshold.

Once a threshold breach is detected, the system enriches the data with account, company, and client group metadata from Segware APIs. Alerts are sent through WhatsApp and also injected into the Segware alarm system for centralized visibility. The system tracks active alerts in a trigger table to prevent repeated notifications and automatically clears alerts when dispatch volume normalizes.

This service plays a critical role in identifying accounts that may be misconfigured or experiencing abnormal security activity, helping operational teams act swiftly and proactively.

### 🎯 Objectives 
 
- Monitor dispatch activity over a rolling 2-day period
- Fetch dispatches for all companies using the Segware API
- Filter and aggregate dispatches per account
- Calculate the total number of dispatches across all types per account
- Detect when total dispatches exceed the defined threshold
- Track alert state per account to avoid duplicate notifications
- Clear alerts when dispatch volumes return to normal
- Enrich alert data with account, company, and client group metadata
- Send alert notifications via WhatsApp using the ChatPro API
- Inject dispatch-related alerts into the Segware alarm system
- Persist alerts and metadata in internal logging tables
- Log all operations and errors for auditability and diagnostics
- Run as a recurring background job suitable for scheduled execution

--- 

## 📦 Quick Start

### ⚠️ Prerequisites 

- [**Node.js**](https://nodejs.org/) ≥ `20.14.0` — _JavaScript runtime environment_
- [**MySQL**](https://www.mysql.com/) ≥ `8.0` — _Relational database_

### ⚙️ Setup 

```bash 
# Clone & navigate
git clone <repository-url> && cd sigma-cloud-dispatches-tracker

# Configure environment
cp .env.example .env  # Edit with your settings

# Install dependencies (auto-runs database setup)
npm install
```

> **💡 Database:** Import `storage.sql.example` before running `npm install`

---

## ⚡ Usage

### 🛠️ Development

```bash
npm run start:development
```

### 🏗️ Production

```bash
npm run build && npm run start:production
```

---

## 📚 Command Reference

### 🧰 Core

| Command | Description |
| ------- | ----------- |
| `npm run start:development` | _Start the application in development_ |
| `npm run start:production` | _Start the application in production_ |
| `npm run build` | _Build the application for production_ |
| `npm run build:watch` | _Build the application with watch mode_ |
| `npm run clean` | _Clean application build artifacts_ |
 
### 🛢️ Database

| Command | Description |
| ------- | ----------- |
| `npm run db:pull` | _Pull database schema into Prisma across all schemas_ |
| `npm run db:push` | _Push Prisma schema to the database across all schemas_ |
| `npm run db:generate` | _Generate Prisma Client for all schemas_ |
| `npm run db:migrate:dev` | _Run development migrations across all schemas_ |
| `npm run db:migrate:deploy` | _Deploy migrations to production across all schemas_ |
| `npm run db:studio` | _Open Prisma Studio (GUI) across all schemas_ |
| `npm run db:reset` | _Reset database (pull + generate) for all schemas_ |

### 🐳 Docker 

| Command | Description |
| ------- | ----------- |
| `npm run docker:build:development` | _Build Docker image for development_ |
| `npm run docker:build:production` | _Build Docker image for production_ |
| `npm run docker:run:development` | _Run development Docker container_ |
| `npm run docker:run:production` | _Run production Docker container_ |
| `npm run docker:compose:up:development` | _Start Docker Compose in development_ |
| `npm run docker:compose:up:production` | _Start Docker Compose in production_ |
| `npm run docker:compose:up:build:development` | _Start & rebuild Docker Compose in development_ |
| `npm run docker:compose:up:build:production` | _Start & rebuild Docker Compose in production_ |
| `npm run docker:compose:down` | _Stop Docker Compose services_ |
| `npm run docker:compose:logs` | _View Docker Compose logs_ |
| `npm run docker:prune` | _Clean up unused Docker resources_ |

### 🧪 Testing

| Command | Description |
| ------- | ----------- |
| `npm test` | _Run all tests once_ |
| `npm run test:watch` | _Run tests in watch mode_ |
| `npm run test:coverage` | _Run tests and generate a coverage report_ |
   