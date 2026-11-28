# Clocks

A **clock** (`@we/clock`) is a moment that something shows, plus the playback that moves it. Clocks have names in one app-wide `ClockRegistry`, and `ClockStore` gives each clock to templates as a reactive `ClockView`.

**Why:** Two things that follow the same named clock show the same moment by construction, with no values passed between them: a globe, a list and a scrubber play together. A template cannot find the earliest of a list of dates, so the followers contribute the range. A template expression must not run 60 times a second, so the store publishes a playing clock at most 5 times a second.

**Parent:** [Stores](README.md)

<details><summary>How it works</summary>

1. `ClockRegistry.get(id)` makes a clock the first time its name is asked for and keeps it. A name says what is played (`"events"`, `call:<id>`), not where.
2. `ClockState` has `at`, `from`, `to`, `playing`, `speed`, `duration`, `rate`, `loop` and `driven`. `at` is `null` until a seek or a play, and `null` means "show everything".
3. `contribute(key, extent)` adds a follower's span; the range is the union, until `configure` sets one. `drive(read)` takes the moment from outside, for example a video position.
4. While it plays, a clock moves every animation frame and tells listeners with cause `'tick'`. Every other change has cause `'change'`. `throttle(clock, ms, cb)` listens at a lower rate but hears every `'change'` at once.
5. `ClockStore` subscribes through `throttle` at 200 ms. Its `ClockView` adds `atIso`, `fromIso`, `toIso`, `atLabel`, `ticks`, `progress` and `canPlay`, because a schema has no dates. Its actions are `play`, `pause`, `toggle`, `seek`, `seekProgress`, `setSpeed`, `setLoop` and `configure`.

The registry in `shared/clocks.ts` is the one that templates (through `clockStore`), modules (through the `clocks` kernel, [Kernels](../../modules/contract/kernels.md)) and the globe (through its `clocks` prop, [Globe](../../modules/bundled/space-tools/globe.md)) use.

</details>

<details><summary>Where in the code</summary>

- [packages/clock/src/clock.ts](../../../packages/clock/src/clock.ts): `Clock`, `ClockState`, `ClockCause`, `ClockSettings`, `ClockScheduler`, `throttle`.
- [packages/clock/src/registry.ts](../../../packages/clock/src/registry.ts): `ClockRegistry`.
- [packages/clock/src/ticks.ts](../../../packages/clock/src/ticks.ts), [time.ts](../../../packages/clock/src/time.ts): `clockTicks`, `momentLabel`, `parseDuration`, `toIso`, `toTime`, `utcDay`, `DAY`.
- [packages/app-shell/src/shared/clocks.ts](../../../packages/app-shell/src/shared/clocks.ts): `clockRegistry`.
- [packages/app-shell/src/frameworks/solid/stores/ClockStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/ClockStore.tsx): `ClockStore`, `ClockView`.

</details>
