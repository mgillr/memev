// SPDX-License-Identifier: Apache-2.0
// The paid merge client. When the install turns the paid engine flag on, the sync conflict
// resolver hands a same-note conflict to the external merge engine through the call boundary in
// merge.mjs. The engine is a separate component under its own licence, not part of this
// repository: the install points the boundary at it as a command, and this module holds only the
// client side of that wiring, no merge logic of its own. It ships with every install, so the flag
// reports the engine as installed only when a provider or an existing engine command is configured.

import { commandProvider } from './merge.mjs';

export { commandProvider };
