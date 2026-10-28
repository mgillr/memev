// SPDX-License-Identifier: Apache-2.0
// `memev upgrade` prints the checkout URL stored for this vault. The URL is configuration.
// Nothing in this file is a payment provider, a price, a sender, or an endpoint.
import { config } from './common.mjs';

/** The checkout URL from vault config, or an empty string when none is set. */
export function checkoutUrl(root) {
  const url = config(root)?.checkout?.url;
  return typeof url === 'string' ? url.trim() : '';
}

export async function command(cmd, pos, flags, { root }) {
  void cmd; void pos; void flags;
  const url = checkoutUrl(root);
  if (!url) {
    console.log('No checkout URL is set in this vault.');
    return 1;
  }
  console.log(url);
  return 0;
}
