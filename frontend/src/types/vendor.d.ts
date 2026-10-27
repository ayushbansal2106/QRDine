/**
 * Vendor-prefixed Web Audio constructor.
 *
 * Safari shipped `webkitAudioContext` before the unprefixed name landed in the
 * DOM spec, and still requires it in older versions. Both call sites were
 * casting `window` to `any` to reach it, which quietly disabled type checking
 * for the surrounding expression as well — including the `new Ctor()` that
 * actually matters.
 *
 * Declaring the prefix is the honest fix: the property genuinely does not exist
 * on `Window` in the standard lib, and augmenting `Window` describes reality
 * without weakening anything.
 */
interface Window {
  webkitAudioContext?: typeof AudioContext;
}