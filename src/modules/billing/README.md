# Billing Module

This module provides integration with Stripe for billing and subscription management.

## Features

- Three standard pricing plans:
  - Basic: $20/project + 50 cents per evaluation
  - Standard: $30/project + 25 cents per evaluation
  - Premium: $50/project + 10 cents per evaluation
- Custom pricing option
- Usage tracking for evaluations (PR analysis, assistant questions)
- Automated invoice generation
- Stripe integration for payment processing

## Setup

1. Install the required dependencies:

   ```bash
   npm install stripe class-validator class-transformer
   npm install --save-dev @types/stripe
   ```

2. Add the following environment variables to your `.env` file:

   ```
   STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
   STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key
   STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_secret
   ```

3. Run database migrations:

   ```bash
   npx prisma migrate dev --name add_billing_tables
   ```

4. Seed pricing plans:
   ```bash
   npm run prisma:seed
   ```

## Usage

### Track usage

To track usage for evaluations (e.g., PR analysis, assistant questions):

```typescript
import { trackUsage } from './modules/billing/billing.utils';

// In your service
async function analyzeCode() {
  // Your analysis logic

  // Track the usage
  await trackUsage(
    this._prismaService,
    this._billingService,
    organizationId,
    repositoryId,
    'PR_ANALYSIS',
    'Code analysis for PR #123',
  );
}
```

### Generate invoices

Invoices can be generated through the API endpoint:

```
POST /billing/invoices/generate
{
  "organizationId": "organization_uuid",
  "fromDate": "2023-01-01", // optional
  "toDate": "2023-01-31"    // optional
}
```

### Webhook setup

Set up a Stripe webhook in the Stripe dashboard to receive events at:

```
https://your-domain.com/webhooks/stripe
```

Configure the webhook to send these events:

- invoice.payment_succeeded
- invoice.payment_failed
- customer.subscription.updated
- customer.subscription.deleted
