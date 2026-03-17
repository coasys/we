import { DecoratorNode } from 'lexical';

import ImageBlock from '../../components/ImageBlock';

export class ImageNode extends DecoratorNode<HTMLElement> {
  __src: string | undefined;
  __altText: string | undefined;
  __width: number | undefined;
  __height: number | undefined;

  static getType(): string {
    return 'image';
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__altText, node.__width, node.__height, node.__key);
  }

  constructor(src?: string, altText?: string, width?: number, height?: number, key?: string) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__width = width;
    this.__height = height;
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'we-block-composer-block';
    return div;
  }

  updateDOM(): boolean {
    return false; // No updates needed - handled by SolidJS
  }

  decorate(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'we-block-composer-block';

    // Render the ImageBlock component into the container
    const imageBlock = (
      <ImageBlock
        src={this.__src}
        altText={this.__altText}
        width={this.__width}
        height={this.__height}
        nodeKey={this.__key}
      />
    );

    // Use SolidJS's `render` function to mount the component
    import('solid-js/web').then(({ render }) => {
      render(() => imageBlock, container);
    });

    return container;
  }

  getSrc(): string | undefined {
    return this.__src;
  }

  getAltText(): string | undefined {
    return this.__altText;
  }

  setSrc(src: string): void {
    const writable = this.getWritable();
    writable.__src = src;
  }

  exportJSON() {
    return {
      type: 'image',
      src: this.__src,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
      version: 1,
    };
  }

  static importJSON(serializedNode: any): ImageNode {
    const { src, altText, width, height } = serializedNode;
    return new ImageNode(src, altText, width, height);
  }
}

export function $createImageNode(src?: string, altText?: string, width?: number, height?: number): ImageNode {
  return new ImageNode(src, altText, width, height);
}

export function $isImageNode(node: any): node is ImageNode {
  return node instanceof ImageNode;
}

// import { DecoratorNode } from 'lexical';
// import { ReactNode } from 'react';
// import ImageBlock from '../../components/ImageBlock';
// import editorStyles from '../../index.module.scss';

// export class ImageNode extends DecoratorNode<ReactNode> {
//   __src: string | undefined;
//   __altText: string | undefined;
//   __width: number | undefined;
//   __height: number | undefined;

//   static getType(): string {
//     return 'image';
//   }

//   static clone(node: ImageNode): ImageNode {
//     return new ImageNode(node.__src, node.__altText, node.__width, node.__height, node.__key);
//   }

//   constructor(src?: string, altText?: string, width?: number, height?: number, key?: string) {
//     super(key);
//     this.__src = src;
//     this.__altText = altText;
//     this.__width = width;
//     this.__height = height;
//   }

//   createDOM(): HTMLElement {
//     const div = document.createElement('div');
//     div.className = 'we-block-composer-block';
//     return div;
//   }

//   updateDOM(): boolean {
//     return false; // No updates needed - handled by React
//   }

//   decorate(): ReactNode {
//     return (
//       <ImageBlock
//         src={this.__src}
//         altText={this.__altText}
//         width={this.__width}
//         height={this.__height}
//         nodeKey={this.__key}
//       />
//     );
//   }

//   getSrc(): string | undefined {
//     return this.__src;
//   }

//   getAltText(): string | undefined {
//     return this.__altText;
//   }

//   setSrc(src: string): void {
//     const writable = this.getWritable();
//     writable.__src = src;
//   }

//   exportJSON() {
//     return {
//       type: 'image',
//       src: this.__src,
//       altText: this.__altText,
//       width: this.__width,
//       height: this.__height,
//       version: 1,
//     };
//   }

//   static importJSON(serializedNode: any): ImageNode {
//     const { src, altText, width, height } = serializedNode;
//     return new ImageNode(src, altText, width, height);
//   }
// }

// export function $createImageNode(src?: string, altText?: string, width?: number, height?: number): ImageNode {
//   return new ImageNode(src, altText, width, height);
// }

// export function $isImageNode(node: any): node is ImageNode {
//   return node instanceof ImageNode;
// }
