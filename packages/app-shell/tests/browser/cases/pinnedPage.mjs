/**
 * The same assertions as `pinnedShort`, on a list many screens long.
 *
 * Both lengths, because they used to fail differently and the difference was instructive: a long
 * list's opening journey was far enough to be instant whatever the rule underneath said, so it went
 * on looking fine while a short one visibly slid into place. Under `column-reverse` neither has an
 * opening journey at all — the box rests at its newest end by layout — and the point of keeping both
 * is that a future change cannot quietly reintroduce a length-dependent answer.
 *
 * The growth half matters more here, not less: the longer the list, the more rows are reflowing as
 * their bylines arrive, and the further the old implementation ended up from the end. Measured in
 * the app on a long transcript: 2114px of growth, the scroller moved 2006px, 108px left over and
 * never recovered.
 */
export { checkPinned as check } from './pinnedShort.mjs';

export const name = 'a long pinned list opens at its end and stays there';
export const scenario = 'ds:pinned-page';
export const widths = [420];
