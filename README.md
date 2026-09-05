# mcc

Modern multicoincharts.com rebuilt with next.js

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

## TypeScript 7 — how lint works here

This project runs **TypeScript 7.0.2**, the native (Go) compiler. TS 7 does not
ship the JavaScript compiler API that tooling consumes via `require("typescript")`,
which has two consequences:

- **`next build`** requires `experimental.useTypeScriptCli: true` in
  `next.config.ts`. Without it Next.js tries to type check through the TS JS API
  and fails with *"TypeScript 7.0.2 does not provide the compiler API required by
  Next.js."* With the flag, Next.js shells out to the `tsc` CLI instead.
- **`npm run lint`** works, but only through a shim. `typescript-eslint` still
  declares peer `typescript: >=4.8.4 <6.1.0` and hard-throws at load time on TS 7,
  so the lint script preloads `scripts/eslint-ts6.cjs`, which patches
  `Module._resolveFilename` to resolve `typescript` to the side-by-side
  `typescript-6` alias (`npm:typescript@^6.0.3`). ESLint parses with TS 6 while
  `tsc` and `next build` use TS 7.

### Removing the shim

Delete `scripts/eslint-ts6.cjs`, the `typescript-6` devDependency, and the
`--require` in the `lint` script once
[`typescript-eslint` supports TS 7](https://github.com/typescript-eslint/typescript-eslint/issues/10940).
As of `typescript-eslint@8.69.0` (and its canary), the peer range still caps at
`<6.1.0`, so all three pieces are still needed.

### Do not "fix" this by dropping the TypeScript ESLint config

Removing `eslint-config-next/typescript` from `eslint.config.mjs` makes `eslint .`
exit `0`, but that is a **false green**: `typescript-eslint` supplies the TS parser,
so ESLint silently stops linting `.ts`/`.tsx` files altogether and reports zero
problems while checking nothing. (It also drops the `ignores` that keep `.next/`
build output from being linted.)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
