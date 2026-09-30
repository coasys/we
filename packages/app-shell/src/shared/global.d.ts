declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*.scss' {
  const content: { [className: string]: string };
  export default content;
}

declare module '*.glb' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module 'globe-threejs';

/*
  Stylesheets imported from a package by name, for their side effects only.

  Each of these resolves through its package's export map to a `.css` file, so there is nothing to
  declare types for — but the specifier does not end in `.css` either, so none of the patterns above
  matches it. TypeScript 5 let a side-effect import of an unresolvable module pass in silence, and
  TypeScript 6 reports it (TS2882), which is how these came to light.

  Declared here rather than beside each import because the four app packages compile app-shell's own
  sources through their `paths`, so one declaration answers for all of them.
*/
declare module '@we/tokens/css';
declare module '@we/tokens/css/fonts';
declare module '@we/components/styles';
declare module '@we/widgets/styles';
declare module '@we/block-solid/styles';
declare module '@we/graph-solid/styles';
