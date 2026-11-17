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

## BetterCSP Course Explorer

Use Node.js 22.18 or newer (validated with Node 24). Install the existing locked dependencies
with `npm ci`, then run `npm run dev` and open http://localhost:3000.
Search for **Multivariable Calculus** or **01:640:251**, then open the course and expand a
section to inspect its meetings, index, source restrictions, and snapshot status.

The adapter reads `data/rutgers/spring-2027.json` on the server once per process. Keep that
file available locally. Search/filter/page state lives in the URL; the full JSON is never
sent as client JavaScript. Snapshot capture time is unknown and availability is not live.

Validation: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
To serve the production build locally: `npm run start`.
See [the architecture reference](docs/ARCHITECTURE.md) for implemented boundaries and future phases.
