# Checkout

> **DRAFT. Not an offer and not in force.** Self-serve checkout is Stripe, in test mode only.
> Nothing is live. Personal is $15/month or $144/year, up to 3 computers, all included.
> The licence email From address comes from deployment config (`MEMEV_LICENCE_FROM`).
> The licence endpoint URL comes from config. This repository contains no address, host, or IP.

`memev upgrade` prints the checkout URL stored in this vault's config at `checkout.url`. The
program does not contain a built-in checkout address. When `checkout.url` is empty, the command
says that no checkout URL is set and stops.

## Flow

1. A person runs `memev upgrade` and gets the checkout URL from config.
2. They open that page and pay there.
3. The page notifies the licence endpoint that the payment finished, by a webhook.
4. The endpoint emails a licence key to the address given at checkout.
5. The person runs `memev license activate <key>` on their computer. That command is described in
   [PRICING.md](PRICING.md). It contacts only the licence endpoint that was configured for it.

No step above runs until the checkout URL and the licence endpoint exist. Neither is built in.

## Webhook to the licence-key email

The webhook carries a payment reference and the email address typed at checkout. It does not carry
a machine name or a vault id. The licence endpoint checks the webhook, makes one licence key, and
emails that key to the address from the checkout.

The From address of that email is the deployment value `MEMEV_LICENCE_FROM`. It is not written in
this repository. The licence endpoint URL is configuration, and no host or IP is written here.
Until both are set, the endpoint sends nothing.

## Refund path

A refund notice arrives on the same webhook path as the payment notice. The licence endpoint marks
that licence key ended. The vault is not deleted. After the key has ended, the computer is on the
free tier, the same as `memev license remove`. A refund does not need a second checkout URL.

## Decided

- Payment provider: Stripe, in test mode only. Nothing is live.
- Personal: $15/month or $144/year, up to 3 computers, all included. There is no per-computer add-on.
- Free stays free. Team and above stay contact us.
- The licence email From address is `MEMEV_LICENCE_FROM` in deployment config. No address is stored here.
- The licence endpoint URL is configuration. No host or IP is stored here.
