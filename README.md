This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

### Species enrichment signing

Generate two independent random 32-byte keys per environment and encode each as 64 hexadecimal characters. Set them in the server environment. Keep both out of client bundles, logs, and repository files.

- `SPECIES_ENRICHMENT_SIGNING_SECRET` signs temporary proposals for a Management profile. Keep this key in the app environment only.
- `SPECIES_INSERT_PROOF_SECRET` signs 60-second INSERT proofs. Store the same key in the main Amber Supabase project's Vault as `species_database_insert_proof_v1`. PostgreSQL allows up to five seconds of app clock lead on the upper bound and rejects proofs at expiry.

Before enabling acceptance in an environment:

1. Verify that the migration owner can read `vault.decrypted_secrets` and use `extensions.hmac`, and that API users cannot read Vault secrets. Keep `private` and `vault` outside the Data API's exposed schemas. See the [Supabase Vault documentation](https://supabase.com/docs/guides/database/vault).
2. Configure the server keys and matching Vault entry before applying the controlled INSERT migration. Apply that migration before exposing the acceptance flow.
3. Verify through the target Data API that a direct Management INSERT without a valid proof fails, a caller-scoped acceptance succeeds with the correct `updated_by`, and a duplicate returns a conflict without overwriting the row.
