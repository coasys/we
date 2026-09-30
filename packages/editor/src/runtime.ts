/**
 * What the shell needs from the editor before there is an editor.
 *
 * The host contract (so a host can be provided at mount) and the rail geometry (so the layout can
 * size around panels that may never open). Both are needed on the first render of every session;
 * the editing UI behind `@we/editor` is needed only in a mode most sessions never enter. Keeping
 * them apart is what lets that UI, and CodeMirror with it, load on demand.
 */
export { EditorHostProvider, type EditorHost, useEditorHost } from './host';
export * from './panelLayout';
