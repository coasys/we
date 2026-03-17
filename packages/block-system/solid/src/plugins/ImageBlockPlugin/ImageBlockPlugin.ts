import { $getSelection, $isRangeSelection, createCommand, LexicalCommand } from 'lexical';
import { useLexicalComposerContext } from 'lexical-solid';
import { createEffect } from 'solid-js';

import { $createImageNode } from '../../nodes/ImageNode';

export const INSERT_IMAGE_COMMAND: LexicalCommand<{ src: string; altText: string }> = createCommand();

export default function ImagePlugin() {
  const [editor] = useLexicalComposerContext();

  const insertImage = (url: string, altText: string = 'Image') => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const imageNode = $createImageNode(url, altText);
        selection.insertNodes([imageNode]);
      }
    });
  };

  // Register command to insert images
  createEffect(() => {
    const unregisterCommand = editor.registerCommand(
      INSERT_IMAGE_COMMAND,
      (payload: { src: string; altText: string }) => {
        insertImage(payload.src, payload.altText);
        return true;
      },
      0,
    );

    // Cleanup the command registration when the component is destroyed
    return () => {
      unregisterCommand();
    };
  });

  return null;
}

// import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
// import { $getSelection, $isRangeSelection, createCommand, LexicalCommand } from 'lexical';
// import { useCallback, useEffect } from 'react';
// import { $createImageNode } from '../../nodes/Image';

// export const INSERT_IMAGE_COMMAND: LexicalCommand<{ src: string; altText: string }> = createCommand();

// export default function ImagePlugin() {
//   const [editor] = useLexicalComposerContext();

//   const insertImage = useCallback(
//     (url: string, altText: string = 'Image') => {
//       editor.update(() => {
//         const selection = $getSelection();
//         if ($isRangeSelection(selection)) {
//           const imageNode = $createImageNode(url, altText);
//           selection.insertNodes([imageNode]);
//         }
//       });
//     },
//     [editor],
//   );

//   // Register command to insert images
//   useEffect(() => {
//     editor.registerCommand(
//       INSERT_IMAGE_COMMAND,
//       (payload: { src: string; altText: string }) => {
//         insertImage(payload.src, payload.altText);
//         return true;
//       },
//       0,
//     );
//   }, [editor, insertImage]);

//   return null;
// }
