# Sitecore Content SDK Next.js Sample Application

## Overview

This is the basic Next.js (App Router) starter with minimal XM Cloud integration.

## How to Run This Starter Locally

In this repo it runs as the `rendering-nextjs` container, started by `pnpm sitecore:up` — see
the root README's [Running SitecoreAI locally](../../README.md#running-sitecoreai-locally).
It is served at https://nextjs.xmc-starter-js.localhost.

To run it outside the container instead (note that port 3000 is also the Marketplace starter's
default), from the repo root:

```bash
cd sitecore/rendering-host
npm install
npm run dev
```

Open **http://localhost:3000**.

## Documentation

- Copied from [Sitecore/xmcloud-starter-js](https://github.com/Sitecore/xmcloud-starter-js/tree/main/examples/basic-nextjs) — see `sitecore/THIRD-PARTY.md` for the licence.
- [Sitecore Content SDK for XM Cloud](https://doc.sitecore.com/xmc/en/developers/content-sdk/sitecore-content-sdk-for-xm-cloud.html)
