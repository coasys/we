import postcssImport from 'postcss-import';

export default {
  plugins: [postcssImport({ path: ['src'] })],
};
