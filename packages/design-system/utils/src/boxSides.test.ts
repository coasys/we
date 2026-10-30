/**
 * A variant bag that names some sides of a box keeps the sides it does not name.
 *
 * Padding, margin and the corners are each one declaration, so a tier's or a state's padding is one
 * custom property that falls back as a whole. Before `withBoxSidesFilled`, the sides a bag left out
 * were written as `0`: `mdUpProps: { pt }` over `px: '40px'` lost the forty pixels at that width.
 */
import { describe, expect, it } from 'vitest';

import { buildStateFragmentStyles, tierBagOf, withBoxSidesFilled } from './index';

const paddingOf = (bag: Parameters<typeof buildStateFragmentStyles>[0] | undefined) =>
  bag && buildStateFragmentStyles(bag, 'column').padding;

describe('tierBagOf', () => {
  it('keeps the sides a tier does not name from the tiers beneath it and the base', () => {
    const props = { px: '22px', pt: '110px', smUpProps: { px: '40px' }, mdUpProps: { pt: '124px', pb: '70px' } };
    expect(paddingOf(tierBagOf(props, 'sm'))).toBe('110px 40px 0 40px');
    expect(paddingOf(tierBagOf(props, 'md'))).toBe('124px 40px 70px 40px');
  });

  it('reads the nearest tier first', () => {
    const props = { p: '100', smUpProps: { px: '200' }, mdUpProps: { px: '300' }, lgUpProps: { pt: '400' } };
    expect(tierBagOf(props, 'lg')).toEqual({ pt: '400', pr: '300', pb: '100', pl: '300' });
  });

  it('fills margin and corners the same way', () => {
    const props = { mx: '200', r: '300', mdUpProps: { mt: '400', rt: '500' } };
    expect(tierBagOf(props, 'md')).toEqual({
      mt: '400',
      mr: '200',
      ml: '200',
      rtl: '500',
      rtr: '500',
      rbr: '300',
      rbl: '300',
    });
  });

  it('leaves a bag alone that names a whole box, or none of one', () => {
    const whole = { px: '200', mdUpProps: { p: '400', gap: '300' } };
    expect(tierBagOf(whole, 'md')).toBe(whole.mdUpProps);
    const none = { px: '200', mdUpProps: { gap: '300' } };
    expect(tierBagOf(none, 'md')).toBe(none.mdUpProps);
  });

  it('has nothing for a tier the element does not set', () => {
    expect(tierBagOf({ px: '200' }, 'md')).toBeUndefined();
    expect(tierBagOf({ px: '200', mdUpProps: {} }, 'md')).toBeUndefined();
  });
});

describe('withBoxSidesFilled — a state', () => {
  it('keeps the resting sides a hover does not name', () => {
    const props = { px: '300', py: '200' };
    expect(paddingOf(withBoxSidesFilled({ pt: '100' }, [props]))).toBe(
      'var(--we-space-100) var(--we-space-300) var(--we-space-200) var(--we-space-300)',
    );
  });

  it('leaves a side nobody names to the builder, as before', () => {
    expect(withBoxSidesFilled({ pt: '100' }, [{}])).toEqual({ pt: '100' });
  });
});
