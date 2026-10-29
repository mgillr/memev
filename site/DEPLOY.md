# Deploy the site

This file lists the steps to publish the two static sites. DNS changes and the production deploy
are not part of this contract and need the owner's explicit go. The names below are placeholders.

## What is built

- `site/web`: the Memev business site, for its own subdomain.
- `site/landing`: the main-domain landing page, with two cards that route to the Memora site and
  to the Memev site.
- `site/build.mjs`: copies the two sites into `site/dist` and fills the config placeholders.
- `site/config.example.json`: the shape of the config, with reserved example hosts only.

## Steps

1. Create two static projects on the chosen static host: one for `site/web` and one for
   `site/landing`.
2. Point the two names at the two projects: the subdomain name at the web project, and the main
   domain name at the landing project.
3. Write the config file with the real values: the company name, the two host names, the contact
   address, the postal address, the phone, the two site URLs, the form endpoint or mailto address,
   and the path to the demo film. Start from `site/config.example.json`.
4. Set `SITE_CONFIG` to the path of that config file and run `node site/build.mjs`. This writes
   `site/dist/web` and `site/dist/landing` with the placeholders filled and the demo film copied
   in.
5. Upload `site/dist/web` to the web project and `site/dist/landing` to the landing project.

## What this contract does not do

This contract makes no DNS change and no deploy. The DNS records and the production deploy are
listed here as steps for the owner, and they need the owner's explicit go before they happen.
