# Referral credit: DRAFT

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

> **DRAFT. Not an offer and not in force.** The credit and the mechanism below are decided.
> The credit is opt-in only, and nothing in it runs until checkout is live.

## The credit

A customer who refers a new customer gets **one free month of Personal**. The credit goes to the
referrer only. The referred customer pays the normal Personal price. The credit is a fixed value,
not a checkout discount, and it is not transferable.

## How the code is issued

- Only a customer on a running Personal subscription can get a referral code.
- It is opt-in. The customer asks for the code, and until they do, no code exists and nothing is
  prepared for it.
- The code is a Stripe checkout referral code. Stripe issues it and Stripe holds it. Memev does
  not mint the code, store it, or show it inside the app.
- The code names no person, machine, vault, or e-mail address, and it carries no data that Memev
  could read.

## How it is redeemed at checkout

1. The referred person buys Personal through the same Stripe checkout as everyone else
   ([CHECKOUT.md](CHECKOUT.md)).
2. At checkout they enter the code in the field Stripe shows for it.
3. Stripe applies the code and records that the payment came through a referral.
4. Nothing else changes. The licence key, the email, and `memev license activate` work exactly as
   they do today ([PRICING.md](PRICING.md)).

The referred person does not tell Memev anything. If they do not enter a code, nothing happens on
either side.

## What the referrer gets

- One free month of Personal, on their own subscription.
- Stripe applies the credit on the referrer's billing, the same way it applies any credit it
  holds. Memev does not compute, grant, or reverse the credit itself.
- One code earns the credit once, when the referred customer's first Personal payment succeeds.
  A refund of that payment ends the credit, the same way a refund ends a licence
  ([CHECKOUT.md](CHECKOUT.md)).

## What is never collected

- No in-app tracking. Memev does not show, store, or send referral codes, and no referral state
  lives in the vault.
- No telemetry of any kind. The client reports nothing about a referral to any server.
- No machine names, vault ids, or device ids travel with a referral.
- The only data involved is what Stripe checkout already handles for a normal payment, and Memev
  never sees it.
- Opt-in only. No code is issued, and no credit is possible, unless the referrer asks for the
  code.

## Decided

- Credit: one free month of Personal, for the referrer only.
- Mechanism: a Stripe checkout referral code, issued and redeemed by Stripe.
- Tracking: none. No in-app tracking, no telemetry.
- Consent: opt-in only.
