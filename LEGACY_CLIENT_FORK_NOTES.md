# Legacy Polestar client — fork notes

**The `clone_modules/polestar.js/` submodule points at [`kaohlive/polestar.js`](https://github.com/kaohlive/polestar.js), our patched fork of `@andysmithfal/polestar.js`, not the vanilla npm package.**

The `package.json` inside that submodule still identifies itself as `@andysmithfal/polestar.js@1.8.0` — the version number was never bumped after we forked. The upstream author has not published fixes for the issues listed below and the package has effectively been unmaintained since early 2024, so we carry the patches in the fork. Drivers load it via `require('../../clone_modules/polestar.js')`. In v3.2.11 the `@andysmithfal/polestar.js` entry was removed from the root `package.json` dependencies so it is no longer possible to accidentally think the two copies are interchangeable — they are not.

## What differs from upstream 1.8.0

1. **`CarTelematicsV2` instead of `CarTelematics`.** Polestar quietly retired the single-VIN `carTelematics(vin: String!)` query in mid-2024; requests started returning `null` payloads. The fork switched to the multi-VIN `carTelematicsV2(vins: [String!]!)` query and filters the returned arrays by the selected VIN inside `getBattery()` / `getOdometer()` / `getHealthData()`.
2. **GraphQL error surfacing.** Upstream ignores `response.data.errors` and returns `undefined` on failure, which meant expired tokens or bad requests looked identical to "no data yet". The fork throws a real `Error` carrying the concatenated GraphQL error messages so the caller can distinguish transport-vs-auth failures.
3. **Debug helpers `getAccessToken()` and `getVehicleVin()`.** Used by the `debug-getvehicles.js`, `test-alternative-queries.js`, `test-available-fields.js` and `test-queries.js` scripts at the repo root when reproducing a user's API state without going through the full driver stack. Upstream 1.8.0 does not expose them.

## Why not publish it back to npm?

Because we would need to either:

- get commit access to `@andysmithfal/polestar.js` (upstream is quiet), or
- publish a rename such as `@kaohlive/polestar-legacy` and rewire the callers.

Neither is worth the effort while this client is only used as a fallback — the C3 gRPC backend under `clone_modules/polestar-c3/` is the primary source for supported vehicles. If the C3 rollout continues to hold, the plan is to retire this legacy fallback entirely rather than invest in packaging it.

## If you touch the fork

- Keep the changes above intact unless you have replaced them with something equivalent.
- Update this note if new behaviour diverges from upstream so the next contributor doesn't need to diff against the npm tarball to figure out what is intentional.
