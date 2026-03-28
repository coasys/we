import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from '@lexical/list';
import { mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  INDENT_CONTENT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  LexicalEditor,
  OUTDENT_CONTENT_COMMAND,
  TextNode,
} from 'lexical';
import { useLexicalComposerContext } from 'lexical-solid';
import { createEffect, onCleanup } from 'solid-js';

// Todo:
// + handle delete key press
//    + prevent empty spaces from blocking delete
//    + prevent delete on nested list item removing parent item
// + handle drag and drop

function tabKeyPress(event: KeyboardEvent, editor: LexicalEditor): boolean {
  event.preventDefault();
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;

  const node = selection.anchor.getNode();
  const parentNode = node.getParent();
  const listItemNode = $isListItemNode(parentNode) ? parentNode : null;

  // Handle list item indentation
  if (listItemNode) {
    // Find the parent list node
    const listNode = listItemNode.getParent();
    if (!listNode || !$isListNode(listNode)) return false;

    // Remove indentation if SHIFT key also pressed (and item is nested)
    if (event.shiftKey) {
      // Fallback on default handling if list item isn't nested
      const listParent = listNode.getParent();
      if (!$isListItemNode(listParent)) return false;

      const grandParentList = listParent.getParent();
      if (!grandParentList || !$isListNode(grandParentList)) return false;

      editor.update(() => {
        // Insert this list item after its parent list item in the grandparent list
        listParent.insertAfter(listItemNode);

        // Check if parent list is now empty after removing this item
        if (listNode.getChildrenSize() === 0) listNode.remove();
      });

      return true;
    }

    // Prevent indentation if this is the first item in the list
    if (listItemNode === listNode.getFirstChild()) return false;

    // Get the previous sibling
    const previousSibling = listItemNode.getPreviousSibling(); // always a list item node (but could be empty)...
    if (!previousSibling || !$isListItemNode(previousSibling)) return false;

    // Check if the previous sibling already has a nested list of the same type
    let nestedList = null as null | ListNode;
    previousSibling.getChildren().forEach((child) => {
      if ($isListNode(child) && child.getTag() === listNode.getTag()) nestedList = child;
    });

    editor.update(() => {
      if (!nestedList) {
        // Create a new nested list with the same tag as the parent
        const listType = listNode.getTag(); // 'bullet', 'number', or 'check'
        nestedList = $createListNode(listType as any);
        previousSibling.append(nestedList);
      }

      // Move current list item to the nested list
      nestedList.append(listItemNode);
    });

    return true;
  } else {
    // Handle standard indentation
    if (event.shiftKey) editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
    else editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
    return true;
  }
}

function enterKeyPress(event: KeyboardEvent, editor: LexicalEditor): boolean {
  // Only handle if we have a valid selection
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;

  // Get the current node and check if it's in a list item
  const node = selection.anchor.getNode();
  const parentNode = node.getParent();
  if (!$isListItemNode(parentNode)) return false;

  // Check if the list item is empty
  const textContent = parentNode.getTextContent();
  if (textContent === '' || textContent === '\u200B') {
    // Get reference to the list
    const listNode = parentNode.getParent();
    if (!$isListNode(listNode)) return false;

    // Execute the update
    event.preventDefault();
    editor.update(() => {
      const listParent = listNode.getParent();

      if ($isListItemNode(listParent)) {
        // NESTED LIST CASE
        const newListItem = $createListItemNode();
        const textNode = $createTextNode('\u200B');
        newListItem.append(textNode);

        // Insert after parent
        const grandparentList = listParent.getParent();
        if ($isListNode(grandparentList)) {
          const index = grandparentList.getChildren().indexOf(listParent);

          if (index !== -1 && index < grandparentList.getChildrenSize() - 1) {
            const nextSibling = grandparentList.getChildAtIndex(index + 1);
            if (nextSibling) nextSibling.insertBefore(newListItem);
          } else {
            grandparentList.append(newListItem);
          }

          // Set selection to the beginning of the new list item
          textNode.select();
        }
      } else {
        // TOP-LEVEL LIST CASE
        const paragraph = $createParagraphNode();
        listNode.insertAfter(paragraph);

        // Set selection to the beginning of the paragraph
        paragraph.select();
      }

      // Clean up
      parentNode.remove();
      if (listNode.getChildrenSize() === 0) listNode.remove();
    });

    return true;
  }

  return false;
}

function listNodeTransform(node: ListNode): void {
  // Fix nested list structures when copy-pasted from other text editors
  const children = node.getChildren();
  // Loop through the children of the list node
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child instanceof ListItemNode) {
      // Check if this is an empty container for a nested list
      const grandchildren = child.getChildren();
      // If there's only one child and it's a list node, we need to fix the structure
      if (grandchildren.length === 1 && grandchildren[0] instanceof ListNode) {
        // 1. Find the previous list item
        const prevSibling = child.getPreviousSibling();
        if (prevSibling instanceof ListItemNode) {
          // 2. Move the nested list to the previous item
          const nestedList = grandchildren[0];
          child.remove();
          prevSibling.append(nestedList);
          i--; // Adjust for the removed node
        }
      }
    }
  }
}

function listItemNodeTransform(node: ListItemNode): void {
  // Add blank text node to empty list items to maintain consistent HTML structure & avoid positioning issues
  if (node.getChildrenSize() === 0) {
    const textNode = $createTextNode('\u200B');
    node.append(textNode);
  }
}

function textNodeTransform(node: TextNode): void {
  // Remove unwanted invisible spaces from list item and paragraph nodes
  const parent = node.getParent();
  const text = node.getTextContent();
  const listItemWithMultipleBlankSpaces = $isListItemNode(parent) && text.length > 1 && text.includes('\u200B');
  const paragraphWithBlankSpaces = $isParagraphNode(parent) && text.includes('\u200B');

  if (listItemWithMultipleBlankSpaces || paragraphWithBlankSpaces) {
    // Remove the invisible spaces
    const newText = text.replace(/\u200B/g, '');
    node.setTextContent(newText);
    // Move the cursor position to the end of the text node
    node.select(newText.length);
  }
}

export default function IndentationPlugin(): null {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    const unregisterListeners = mergeRegister(
      // Register key press commands
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event: KeyboardEvent): boolean => tabKeyPress(event, editor),
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event: KeyboardEvent) => enterKeyPress(event, editor),
        COMMAND_PRIORITY_CRITICAL,
      ),

      // Register node transformations
      editor.registerNodeTransform(ListNode, listNodeTransform),
      editor.registerNodeTransform(ListItemNode, listItemNodeTransform),
      editor.registerNodeTransform(TextNode, textNodeTransform),
    );

    // Cleanup when the component is destroyed
    onCleanup(() => {
      unregisterListeners();
    });
  });

  return null;
}

// import {
//   $createListItemNode,
//   $createListNode,
//   $isListItemNode,
//   $isListNode,
//   ListItemNode,
//   ListNode,
// } from '@lexical/list';
// import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
// import { mergeRegister } from '@lexical/utils';
// import {
//   $createParagraphNode,
//   $createTextNode,
//   $getSelection,
//   $isParagraphNode,
//   $isRangeSelection,
//   COMMAND_PRIORITY_CRITICAL,
//   INDENT_CONTENT_COMMAND,
//   KEY_ENTER_COMMAND,
//   KEY_TAB_COMMAND,
//   LexicalEditor,
//   OUTDENT_CONTENT_COMMAND,
//   TextNode,
// } from 'lexical';
// import { useEffect } from 'react';

// // Todo:
// // + handle delete key press
// //    + prevent empty spaces from blocking delete
// //    + prevent delete on nested list item removing parent item
// // + handle drag and drop

// function tabKeyPress(event: KeyboardEvent, editor: LexicalEditor): boolean {
//   event.preventDefault();
//   const selection = $getSelection();
//   if (!$isRangeSelection(selection)) return false;

//   const node = selection.anchor.getNode();
//   const parentNode = node.getParent();
//   const listItemNode = $isListItemNode(parentNode) ? parentNode : null;

//   // Handle list item indentation
//   if (listItemNode) {
//     // Find the parent list node
//     const listNode = listItemNode.getParent();
//     if (!listNode || !$isListNode(listNode)) return false;

//     // Remove indentation if SHIFT key also pressed (and item is nested)
//     if (event.shiftKey) {
//       // Fallback on deafult handling if list item isn't nested
//       const listParent = listNode.getParent();
//       // console.log('listParent', listParent);
//       if (!$isListItemNode(listParent)) return false;
//       else {
//         // Todo: handle empty list items here... (need further step up the tree...)
//         // use: findListItemNode(listParent) ?
//         const grandParentList = listParent.getParent();

//         if (!grandParentList || !$isListNode(grandParentList)) return false;

//         editor.update(() => {
//           // Insert this list item after its parent list item in the grandparent list
//           listParent.insertAfter(listItemNode);

//           // Check if parent list is now empty after removing this item
//           if (listNode.getChildrenSize() === 0) listNode.remove();
//         });

//         return true;
//       }
//     }

//     // Prevent indentation if this is the first item in the list
//     if (listItemNode === listNode.getFirstChild()) return false;

//     // Get the previous sibling
//     const previousSibling = listItemNode.getPreviousSibling(); // always a list item node (but could be empty)...
//     if (!previousSibling || !$isListItemNode(previousSibling)) return false;
//     // if (!findListItemNode(previousSibling)) return false;

//     // Check if the previous sibling already has a nested list of the same type (why)
//     let nestedList = null as null | ListNode;
//     previousSibling.getChildren().forEach((child) => {
//       if ($isListNode(child) && child.getTag() === listNode.getTag()) nestedList = child;
//     });

//     editor.update(() => {
//       if (!nestedList) {
//         // Create a new nested list with same tag as parent
//         const listType = listNode.getTag(); // 'bullet', 'number', or 'check'
//         nestedList = $createListNode(listType as any);
//         previousSibling.append(nestedList);
//       }

//       // Move current list item to the nested list
//       nestedList.append(listItemNode);
//     });

//     return true;
//   } else {
//     // Handle standard indentation
//     if (event.shiftKey) editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
//     else editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
//     return true;
//   }
// }

// function enterKeyPress(event: KeyboardEvent, editor: LexicalEditor): boolean {
//   // Only handle if we have a valid selection
//   const selection = $getSelection();
//   if (!$isRangeSelection(selection)) return false;

//   // Get the current node and check if it's in a list item
//   const node = selection.anchor.getNode();
//   const parentNode = node.getParent();
//   if (!$isListItemNode(parentNode)) return false;

//   // Check if the list item is empty
//   const textContent = parentNode.getTextContent();
//   if (textContent === '' || textContent === '\u200B') {
//     // Get reference to the list
//     const listNode = parentNode.getParent();
//     if (!$isListNode(listNode)) return false;

//     // Execute the update
//     event.preventDefault();
//     editor.update(() => {
//       const listParent = listNode.getParent();

//       if ($isListItemNode(listParent)) {
//         // NESTED LIST CASE
//         const newListItem = $createListItemNode();
//         const textNode = $createTextNode('\u200B');
//         newListItem.append(textNode);

//         // Insert after parent
//         const grandparentList = listParent.getParent();
//         if ($isListNode(grandparentList)) {
//           const index = grandparentList.getChildren().indexOf(listParent);

//           if (index !== -1 && index < grandparentList.getChildrenSize() - 1) {
//             const nextSibling = grandparentList.getChildAtIndex(index + 1);
//             if (nextSibling) nextSibling.insertBefore(newListItem);
//           } else {
//             grandparentList.append(newListItem);
//           }

//           // Set selection to beginning of new list item
//           textNode.select();
//         }
//       } else {
//         // TOP-LEVEL LIST CASE
//         const paragraph = $createParagraphNode();
//         listNode.insertAfter(paragraph);

//         // Set selection to beginning of paragraph
//         paragraph.select();
//       }

//       // Clean up
//       parentNode.remove();
//       if (listNode.getChildrenSize() === 0) listNode.remove();
//     });

//     return true;
//   }

//   return false;
// }

// function listNodeTransform(node: ListNode): void {
//   // Fix nested list structures when copy pasted from other text editors
//   const children = node.getChildren();
//   // Loop through the children of the list node
//   for (let i = 0; i < children.length; i++) {
//     const child = children[i];
//     if (child instanceof ListItemNode) {
//       // Check if this is an empty container for a nested list
//       const grandchildren = child.getChildren();
//       // If there's only one child and it's a list node, we need to fix the structure
//       if (grandchildren.length === 1 && grandchildren[0] instanceof ListNode) {
//         // 1. Find the previous list item
//         const prevSibling = child.getPreviousSibling();
//         if (prevSibling instanceof ListItemNode) {
//           // 2. Move the nested list to the previous item
//           const nestedList = grandchildren[0];
//           child.remove();
//           prevSibling.append(nestedList);
//           i--; // Adjust for the removed node
//         }
//       }
//     }
//   }
// }

// function listItemNodeTransform(node: ListItemNode): void {
//   // Add blank text node to empty list items to mainatin consistent html structure & avoid positioning issues
//   if (node.getChildrenSize() === 0) {
//     const textNode = $createTextNode('\u200B');
//     node.append(textNode);
//   }
// }

// function textNodeTransform(node: TextNode): void {
//   // Remove unwanted invisible spaces from list item and paragraph nodes
//   const parent = node.getParent();
//   const text = node.getTextContent();
//   const listItemWithMultipleBlankSpaces = $isListItemNode(parent) && text.length > 1 && text.includes('\u200B');
//   const paragraphWithBlankSpaces = $isParagraphNode(parent) && text.includes('\u200B');

//   if (listItemWithMultipleBlankSpaces || paragraphWithBlankSpaces) {
//     // Remove the invisible spaces
//     const newText = text.replace(/\u200B/g, '');
//     node.setTextContent(newText);
//     // Move the cursor position to the end of the text node
//     node.select(newText.length);
//   }
// }

// export default function IndentationPlugin(): null {
//   const [editor] = useLexicalComposerContext();

//   useEffect(() => {
//     const unregisterListeners = mergeRegister(
//       // Register key press commands
//       editor.registerCommand(
//         KEY_TAB_COMMAND,
//         (event: KeyboardEvent) => tabKeyPress(event, editor),
//         COMMAND_PRIORITY_CRITICAL,
//       ),
//       editor.registerCommand(
//         KEY_ENTER_COMMAND,
//         (event: KeyboardEvent) => enterKeyPress(event, editor),
//         COMMAND_PRIORITY_CRITICAL,
//       ),

//       // Register node transformations
//       editor.registerNodeTransform(ListNode, listNodeTransform),
//       editor.registerNodeTransform(ListItemNode, listItemNodeTransform),
//       editor.registerNodeTransform(TextNode, textNodeTransform),
//     );

//     return () => {
//       unregisterListeners();
//     };
//   }, [editor]);

//   return null;
// }
