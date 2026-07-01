# Hikaflow Backend

<div align="center">

![Hikaflow analytics dashboard](docs/assets/hikaflow-dashboard.png)

**NestJS backend for an AI-powered engineering workflow platform: repository intelligence, PR analysis, reporting, billing, organizations, and assistant workflows.**

![NestJS](https://img.shields.io/badge/NestJS-10-e0234e?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-2563eb?style=for-the-badge&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Prisma-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![BullMQ](https://img.shields.io/badge/BullMQ-Workers-dc2626?style=for-the-badge)
![Stripe](https://img.shields.io/badge/Stripe-Billing-635bff?style=for-the-badge&logo=stripe&logoColor=white)

</div>

## Overview

Hikaflow Backend powers a SaaS platform for AI-assisted software engineering. The system connects to Git providers, analyzes repositories and pull requests, generates code intelligence, tracks team and organization activity, produces reports, manages billing, and supports assistant-style workflows over repository data.

The backend is organized as a modular NestJS application with Prisma/PostgreSQL persistence, JWT authentication, scheduled jobs, queue-based repository scanning, AI provider integrations, email delivery, and Stripe billing.

## Product Context

Public Hikaflow positioning focuses on AI-powered code analysis, repository intelligence, issue detection, AI fixes, documentation generation, PR summaries, CI/reporting workflows, and engineering team insight. This backend implements the platform service layer behind that product direction:

- Repository ingestion and scan lifecycle.
- Pull request and comment tracking.
- Assistant queries over repository structure.
- Weekly and executive reporting.
- Usage, plan, invoice, and organization billing models.
- Team, collaborator, and organization management.

## Screenshots

| Analytics Dashboard | AI Assistant |
| --- | --- |
| ![Hikaflow dashboard](docs/assets/hikaflow-dashboard.png) | ![Hikaflow assistant](docs/assets/hikaflow-assistant.png) |

## System Architecture

```mermaid
flowchart TB
    Client[React Frontend] --> API[NestJS API]
    API --> Auth[JWT, Local, Google Strategies]
    API --> Prisma[Prisma Service]
    Prisma --> DB[(PostgreSQL)]

    API --> Git[GitHub / Bitbucket Credentials]
    API --> Repo[Repository Module]
    API --> PR[Pull Request and Comment Modules]
    API --> Reports[Reports and Executive Reports]
    API --> Billing[Stripe Billing]
    API --> Org[Organizations, Teams, Collaborators]

    API --> Queue[BullMQ Repository Scan Queue]
    Queue --> Worker[Repository Scan Worker]
    Worker --> Analysis[Repository Analysis Services]
    Analysis --> AI[OpenAI / Gemini Helpers]

    Scheduler[Nest Schedule Cron Jobs] --> RepoCron[Repository Scan Cron]
    Scheduler --> PrCron[PR Tracker Cron]
    Scheduler --> BillingCron[Billing Cron]
    Scheduler --> WeeklyReports[Weekly Reports Cron]
```

## Core Modules

| Module | Responsibility |
| --- | --- |
| `account` / `user` | User account lifecycle, profile data, verification, account state. |
| `accountCredentials` | Git provider credential records for GitHub and Bitbucket integrations. |
| `organization` / `team` | Organization accounts, invitations, roles, teams, collaborators. |
| `repository` | Connected repository records and repository ownership. |
| `repositoryScan` | Repository scan lifecycle, analysis services, query parsing, safe query execution, worker queue integration. |
| `pullRequest` / `comment` / `prTracker` | PR metadata, review comment tracking, PR status automation. |
| `commitSummary` / `codeOverview` | Commit intelligence and repository-level code summaries. |
| `reports` / `executiveReport` | Weekly reports, regression reports, engineering summaries. |
| `billing` / `discount` | Subscription plans, usage logs, invoices, discounts, Stripe integration. |
| `webhooks` | External event intake for Git/provider/payment workflows. |
| `mail` / `verificationCode` | Transactional email and account verification flow. |

## Data Model Highlights

The Prisma schema includes domain models for:

- Users, accounts, login types, verification, and referrals.
- Organizations, organization accounts, roles, invitations, teams, and collaborators.
- Git provider credentials and repository provider types.
- Repository scans, scan statuses, file types, documentation types, and repository intelligence.
- PR tracker status, comment status, duplicate code classification, and comment types.
- Subscription plans, pricing models, invoices, discounts, usage logs, and billing status.
- Weekly reports and regression reports for engineering insight.

## Repository Scan Pipeline

```mermaid
sequenceDiagram
    participant U as User
    participant API as NestJS API
    participant Q as BullMQ Queue
    participant W as Scan Worker
    participant G as Git Provider
    participant AI as AI Provider
    participant DB as PostgreSQL

    U->>API: Connect repository / request scan
    API->>DB: Persist repository and scan request
    API->>Q: Enqueue repository scan job
    W->>Q: Consume scan job
    W->>G: Fetch repository metadata and files
    W->>AI: Analyze structure, issues, summaries
    W->>DB: Save scan result and report data
    API-->>U: Return scan status and insights
```

## Background Jobs

`AppModule` registers scheduled services for:

- Billing lifecycle processing.
- Feedback analysis.
- PR tracker automation.
- Repository scan automation.
- Weekly report generation.

The repository scan worker is started separately:

```bash
npm run start:worker
```

## Technology Stack

- **Runtime:** Node.js, NestJS 10, TypeScript.
- **Persistence:** PostgreSQL with Prisma ORM.
- **Auth:** Passport, JWT, local strategy, Google strategy.
- **Jobs:** BullMQ worker for repository scan processing.
- **AI:** OpenAI SDK, Google Generative AI, token encoding helpers.
- **Billing:** Stripe subscriptions, invoices, usage logs, discounts.
- **Email:** Nodemailer, Nest mailer, Handlebars templates.
- **Git:** Simple Git, provider credentials for GitHub/Bitbucket style integrations.
- **API docs:** Nest Swagger and Swagger UI.
- **Quality:** Jest, ESLint, Prettier, e2e test config.

## Environment

Create an environment file with values matching the services enabled in your deployment:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/hikaflow
JWT_SECRET=replace_with_strong_secret
OPENAI_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
MAIL_HOST=...
MAIL_USER=...
MAIL_PASSWORD=...
```

Keep provider tokens and webhook secrets out of source control.

## Run Locally

```bash
npm install
npm run prisma:sync
npm run start:dev
```

Run migrations:

```bash
npm run prisma:migrate:run
```

Run the scan worker in a separate terminal:

```bash
npm run start:worker
```

## Test and Build

```bash
npm run test
npm run test:e2e
npm run test:cov
npm run build
```

## Scaling Plan

- Split long repository scans into smaller queue jobs by repository area and analysis type.
- Add queue retry policies, dead-letter handling, and operator-visible scan failure states.
- Add OpenTelemetry tracing for API requests, AI calls, queue jobs, and Git provider calls.
- Add rate-limit and quota enforcement around assistant questions and AI evaluations.
- Move provider-specific Git integrations behind a stable adapter interface.
- Add contract tests for billing, webhooks, and repository scan status transitions.
- Add read models for dashboard/report pages to reduce expensive aggregate queries.

## Skills Demonstrated

- Modular NestJS API design.
- Prisma data modeling for SaaS products.
- Queue-based background processing.
- AI-assisted repository analysis.
- Billing and subscription workflows.
- Organization/team authorization modeling.
- Scheduled automation and report generation.
- Production-oriented service boundaries.
