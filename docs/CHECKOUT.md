# Checkout

> **DRAFT. Not an offer and not in force.** The payment provider, the prices, the address that
> sends the licence key, and who operates the licence endpoint are not decided. This note is the
> flow only. Those four values are filled in after that decision, and not before.

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

The From address of that email is not set. The operator of the licence endpoint is not set. Until
both are set, the endpoint sends nothing.

## Refund path

A refund notice arrives on the same webhook path as the payment notice. The licence endpoint marks
that licence key ended. The vault is not deleted. After the key has ended, the computer is on the
free tier, the same as `memev license remove`. A refund does not need a second checkout URL.

## Not decided yet

- payment provider
- prices
- licence-key sender address
- who operates the licence endpoint
