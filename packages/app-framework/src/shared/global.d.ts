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
